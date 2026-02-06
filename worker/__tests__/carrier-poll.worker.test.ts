import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Job } from "bullmq";
import type { CarrierPollJobData } from "../../app/jobs/types";
import type { CarrierTrackingResponse, TrackingResult } from "../../app/services/carriers/carrier.interface";
import type { Merchant, Shipment } from "@prisma/client";
import { processCarrierPoll } from "../carrier-poll.worker";

// Import mocked modules
import { prisma } from "../../app/db.server";
import { trackShipment } from "../../app/services/carriers/carrier.service";

// Mock Prisma
vi.mock("../../app/db.server", () => ({
  prisma: {
    shipment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(), // For billing.service.ts plan limit checks
    },
    trackingEvent: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    merchant: {
      findUnique: vi.fn(), // For billing.service.ts plan limit checks
    },
  },
}));

// Mock carrier service
vi.mock("../../app/services/carriers/carrier.service", () => ({
  trackShipment: vi.fn(),
}));

/**
 * Helper to create a mock BullMQ job
 */
function createMockJob(shipmentId: string): Job<CarrierPollJobData> {
  return {
    id: `poll-${shipmentId}`,
    data: { shipmentId },
    updateProgress: vi.fn(),
  } as unknown as Job<CarrierPollJobData>;
}

/**
 * Helper to create a UTC date
 */
function utcDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00.000Z");
}

/**
 * Create a mock shipment with merchant
 */
function createMockShipment(overrides: Partial<Shipment & { merchant: Merchant }> = {}): Shipment & { merchant: Merchant } {
  const merchant: Merchant = {
    id: "merchant-1",
    shopifyShopId: "shop-123",
    shopDomain: "test-shop.myshopify.com",
    email: "owner@test-shop.com",
    timezone: "America/New_York",
    settings: {
      delayThresholdHours: 8,
      autoArchiveDays: 30,
      deliveryWindows: {},
      columnVisibility: [],
      columnOrder: [],
      defaultSortColumn: "daysDelayed",
      defaultSortDirection: "desc",
      notificationTemplate: {
        subject: "Update on your order #{order_number}",
        body: "Test body",
      },
      fromEmail: null,
    },
    planTier: "STARTER",
    previousPlanTier: null,
    billingStatus: "ACTIVE",
    randomPollOffset: 15,
    installedAt: new Date(),
    uninstalledAt: null,
    onboardingDone: true,
    shopPlanName: null,
    shopFrozen: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    id: "shipment-1",
    merchantId: "merchant-1",
    shopifyOrderId: "order-123",
    shopifyFulfillmentId: "fulfillment-123",
    orderNumber: "#1001",
    trackingNumber: "1Z999AA10123456784",
    carrier: "UPS",
    serviceLevel: "Ground",
    customerName: "John Doe",
    customerEmail: "john@example.com",
    customerPhone: null,
    shippingAddress: null,
    shipDate: utcDate("2026-02-02"),
    expectedDeliveryDate: utcDate("2026-02-09"),
    expectedDeliverySource: "DEFAULT",
    currentStatus: "pending",
    isDelayed: false,
    delayFlaggedAt: null,
    daysDelayed: 0,
    lastCarrierStatus: null,
    lastScanLocation: null,
    lastScanTime: null,
    carrierExceptionCode: null,
    carrierExceptionReason: null,
    rescheduledDeliveryDate: null,
    fulfillmentLocationId: null,
    fulfillmentLocationName: null,
    orderValue: null,
    isResolved: false,
    resolvedAt: null,
    resolvedBy: null,
    resolutionReason: null,
    resolutionNotes: null,
    notificationSent: false,
    notificationSentAt: null,
    isDelivered: false,
    deliveredAt: null,
    isArchived: false,
    lastPolledAt: null,
    nextPollAt: null,
    pollErrorCount: 0,
    hasCarrierScan: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    merchant,
    ...overrides,
  } as Shipment & { merchant: Merchant };
}

/**
 * Create a successful tracking result
 */
function createTrackingResult(overrides: Partial<TrackingResult> = {}): TrackingResult {
  return {
    trackingNumber: "1Z999AA10123456784",
    carrier: "UPS",
    currentStatus: "In Transit",
    isException: false,
    exceptionCode: null,
    exceptionReason: null,
    expectedDeliveryDate: utcDate("2026-02-09"),
    rescheduledDeliveryDate: null,
    isDelivered: false,
    deliveredAt: null,
    lastScanLocation: "Louisville, KY",
    lastScanTime: new Date("2026-02-04T08:00:00Z"),
    events: [
      {
        timestamp: new Date("2026-02-04T08:00:00Z"),
        type: "I",
        description: "Arrived at facility",
        city: "Louisville",
        state: "KY",
        country: "US",
        rawData: {},
      },
      {
        timestamp: new Date("2026-02-03T14:00:00Z"),
        type: "I",
        description: "In transit",
        city: "Chicago",
        state: "IL",
        country: "US",
        rawData: {},
      },
    ],
    ...overrides,
  };
}

describe("carrier-poll.worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-04T12:00:00Z"));
    vi.clearAllMocks();

    // Default mocks for billing service plan limit checks
    // These are called when hasCarrierScan transitions from false to true
    vi.mocked(prisma.shipment.count).mockResolvedValue(0); // Under limit
    vi.mocked(prisma.merchant.findUnique).mockResolvedValue({ planTier: "STARTER" } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("processCarrierPoll", () => {
    describe("skip scenarios", () => {
      it("should skip when shipment not found", async () => {
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(null);

        const job = createMockJob("shipment-missing");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.skipReason).toBe("Shipment not found");
        expect(trackShipment).not.toHaveBeenCalled();
      });

      it("should skip when shipment already delivered", async () => {
        const shipment = createMockShipment({ isDelivered: true });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.skipReason).toBe("Already delivered");
        expect(trackShipment).not.toHaveBeenCalled();
      });

      it("should skip when shipment is archived", async () => {
        const shipment = createMockShipment({ isArchived: true });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.skipReason).toBe("Archived");
        expect(trackShipment).not.toHaveBeenCalled();
      });

      it("should skip when carrier is UNKNOWN", async () => {
        const shipment = createMockShipment({ carrier: "UNKNOWN" });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.skipReason).toBe("Unknown carrier - needs merchant review");
        expect(trackShipment).not.toHaveBeenCalled();
      });

      it("should skip when merchant subscription is cancelled", async () => {
        const shipment = createMockShipment({
          merchant: {
            ...createMockShipment().merchant,
            billingStatus: "CANCELLED",
          },
        });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.skipReason).toBe("Merchant subscription cancelled");
        expect(trackShipment).not.toHaveBeenCalled();
      });
    });

    describe("successful poll scenarios", () => {
      it("should update shipment with tracking data on success", async () => {
        const shipment = createMockShipment();
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 2 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult();
        const response: CarrierTrackingResponse = { success: true, data: trackingResult };
        vi.mocked(trackShipment).mockResolvedValue(response);

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.skipped).toBeUndefined();
        expect(result.isDelayed).toBe(false);
        expect(result.isDelivered).toBe(false);
        expect(result.newEventsCount).toBe(2);

        expect(prisma.shipment.update).toHaveBeenCalledWith({
          where: { id: "shipment-1" },
          data: expect.objectContaining({
            currentStatus: "In Transit",
            lastScanLocation: "Louisville, KY",
            pollErrorCount: 0,
          }),
        });
      });

      it("should mark hasCarrierScan when first events received", async () => {
        const shipment = createMockShipment({ hasCarrierScan: false });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 2 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult();
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        await processCarrierPoll(job);

        expect(prisma.shipment.update).toHaveBeenCalledWith({
          where: { id: "shipment-1" },
          data: expect.objectContaining({
            hasCarrierScan: true,
          }),
        });
      });

      it("should not add duplicate tracking events", async () => {
        const shipment = createMockShipment({ hasCarrierScan: true });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);

        // Existing events match what carrier returns
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([
          {
            eventTimestamp: new Date("2026-02-04T08:00:00Z"),
            eventType: "I",
            eventDescription: "Arrived at facility",
          },
          {
            eventTimestamp: new Date("2026-02-03T14:00:00Z"),
            eventType: "I",
            eventDescription: "In transit",
          },
        ] as any);
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult();
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.newEventsCount).toBe(0);
        expect(prisma.trackingEvent.createMany).not.toHaveBeenCalled();
      });

      it("should detect delivery and update shipment", async () => {
        const shipment = createMockShipment();
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const deliveredAt = new Date("2026-02-04T10:30:00Z");
        const trackingResult = createTrackingResult({
          isDelivered: true,
          deliveredAt,
          currentStatus: "Delivered",
          events: [
            {
              timestamp: deliveredAt,
              type: "D",
              description: "Delivered",
              city: "New York",
              state: "NY",
              country: "US",
              rawData: {},
            },
          ],
        });
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.isDelivered).toBe(true);

        expect(prisma.shipment.update).toHaveBeenCalledWith({
          where: { id: "shipment-1" },
          data: expect.objectContaining({
            isDelivered: true,
            deliveredAt,
            nextPollAt: null, // Should stop polling
            isDelayed: false, // Should clear delay flag
            daysDelayed: 0,
          }),
        });
      });

      it("should detect carrier exception and flag as delayed", async () => {
        // Set time past expected delivery + grace period
        vi.setSystemTime(new Date("2026-02-10T20:00:00Z"));

        const shipment = createMockShipment({
          expectedDeliveryDate: utcDate("2026-02-09"),
          isDelayed: false,
        });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult({
          isException: true,
          exceptionCode: "X1",
          exceptionReason: "Weather delay",
          currentStatus: "Exception",
        });
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.isDelayed).toBe(true);

        expect(prisma.shipment.update).toHaveBeenCalledWith({
          where: { id: "shipment-1" },
          data: expect.objectContaining({
            isDelayed: true,
            carrierExceptionCode: "X1",
            carrierExceptionReason: "Weather delay",
            delayFlaggedAt: expect.any(Date),
          }),
        });
      });

      it("should detect delay when past expected delivery + grace period", async () => {
        // Feb 9 + 8 hour grace = Feb 10 ~8AM, we're past that
        vi.setSystemTime(new Date("2026-02-10T20:00:00Z"));

        const shipment = createMockShipment({
          expectedDeliveryDate: utcDate("2026-02-09"),
          expectedDeliverySource: "CARRIER",
          isDelayed: false,
        });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult({
          isException: false,
          expectedDeliveryDate: utcDate("2026-02-09"),
        });
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(true);
        expect(result.isDelayed).toBe(true);

        expect(prisma.shipment.update).toHaveBeenCalledWith({
          where: { id: "shipment-1" },
          data: expect.objectContaining({
            isDelayed: true,
            daysDelayed: 1,
          }),
        });
      });
    });

    describe("error handling", () => {
      it("should increment pollErrorCount on carrier API failure", async () => {
        const shipment = createMockShipment({ pollErrorCount: 0 });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const errorResponse: CarrierTrackingResponse = {
          success: false,
          error: {
            code: "API_ERROR",
            message: "Service unavailable",
            retryable: false,
          },
        };
        vi.mocked(trackShipment).mockResolvedValue(errorResponse);

        const job = createMockJob("shipment-1");
        const result = await processCarrierPoll(job);

        expect(result.success).toBe(false);
        expect(result.error).toBe("API_ERROR: Service unavailable");

        expect(prisma.shipment.update).toHaveBeenCalledWith({
          where: { id: "shipment-1" },
          data: expect.objectContaining({
            pollErrorCount: 1,
            lastPolledAt: expect.any(Date),
          }),
        });
      });

      it("should throw on retryable errors to trigger BullMQ retry", async () => {
        const shipment = createMockShipment({ pollErrorCount: 0 });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const errorResponse: CarrierTrackingResponse = {
          success: false,
          error: {
            code: "NETWORK_ERROR",
            message: "Connection timeout",
            retryable: true,
          },
        };
        vi.mocked(trackShipment).mockResolvedValue(errorResponse);

        const job = createMockJob("shipment-1");

        await expect(processCarrierPoll(job)).rejects.toThrow("NETWORK_ERROR: Connection timeout");
      });

      it("should add extra delay for rate limit errors", async () => {
        const shipment = createMockShipment({ pollErrorCount: 0 });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const errorResponse: CarrierTrackingResponse = {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            retryable: true,
          },
        };
        vi.mocked(trackShipment).mockResolvedValue(errorResponse);

        const job = createMockJob("shipment-1");

        await expect(processCarrierPoll(job)).rejects.toThrow("RATE_LIMITED: Too many requests");

        // Should have added extra delay for rate limiting
        const updateCall = vi.mocked(prisma.shipment.update).mock.calls[0][0];
        const nextPollAt = updateCall.data.nextPollAt as Date;

        // Normal interval is 6 hours for upcoming delivery + 15 min offset = ~375 min
        // Rate limit adds 30 minutes = ~405 min from now minimum
        const minutesFromNow = (nextPollAt.getTime() - new Date().getTime()) / (60 * 1000);
        expect(minutesFromNow).toBeGreaterThanOrEqual(375 + 30);
      });
    });

    describe("poll interval calculation", () => {
      it("should set correct next poll time for imminent delivery", async () => {
        // Expected delivery tomorrow
        vi.setSystemTime(new Date("2026-02-08T12:00:00Z"));

        const shipment = createMockShipment({
          expectedDeliveryDate: utcDate("2026-02-09"),
        });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult();
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        await processCarrierPoll(job);

        const updateCall = vi.mocked(prisma.shipment.update).mock.calls[0][0];
        const nextPollAt = updateCall.data.nextPollAt as Date;

        // 4 hours + 15 min offset = 255 minutes from now
        const minutesFromNow = (nextPollAt.getTime() - new Date().getTime()) / (60 * 1000);
        expect(minutesFromNow).toBeCloseTo(255, 0);
      });

      it("should set more frequent polls for past due shipments", async () => {
        // Past expected delivery
        vi.setSystemTime(new Date("2026-02-11T12:00:00Z"));

        const shipment = createMockShipment({
          expectedDeliveryDate: utcDate("2026-02-09"),
        });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult({
          isException: false,
          expectedDeliveryDate: utcDate("2026-02-09"),
        });
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        await processCarrierPoll(job);

        const updateCall = vi.mocked(prisma.shipment.update).mock.calls[0][0];
        const nextPollAt = updateCall.data.nextPollAt as Date;

        // 2 hours (past due) + 15 min offset = 135 minutes from now
        const minutesFromNow = (nextPollAt.getTime() - new Date().getTime()) / (60 * 1000);
        expect(minutesFromNow).toBeCloseTo(135, 0);
      });

      it("should use longer interval for future deliveries", async () => {
        // Expected delivery 6+ days out
        vi.setSystemTime(new Date("2026-02-02T12:00:00Z"));

        const shipment = createMockShipment({
          expectedDeliveryDate: utcDate("2026-02-15"),
        });
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult({
          expectedDeliveryDate: utcDate("2026-02-15"),
        });
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        await processCarrierPoll(job);

        const updateCall = vi.mocked(prisma.shipment.update).mock.calls[0][0];
        const nextPollAt = updateCall.data.nextPollAt as Date;

        // 8 hours (future) + 15 min offset = 495 minutes from now
        const minutesFromNow = (nextPollAt.getTime() - new Date().getTime()) / (60 * 1000);
        expect(minutesFromNow).toBeCloseTo(495, 0);
      });

      it("should stop polling when delivered", async () => {
        const shipment = createMockShipment();
        vi.mocked(prisma.shipment.findUnique).mockResolvedValue(shipment);
        vi.mocked(prisma.trackingEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.trackingEvent.createMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.shipment.update).mockResolvedValue(shipment);

        const trackingResult = createTrackingResult({
          isDelivered: true,
          deliveredAt: new Date("2026-02-04T10:30:00Z"),
        });
        vi.mocked(trackShipment).mockResolvedValue({ success: true, data: trackingResult });

        const job = createMockJob("shipment-1");
        await processCarrierPoll(job);

        const updateCall = vi.mocked(prisma.shipment.update).mock.calls[0][0];
        expect(updateCall.data.nextPollAt).toBeNull();
      });
    });
  });
});
