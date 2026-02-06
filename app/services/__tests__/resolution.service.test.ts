import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import after mock setup
import { prisma } from "~/db.server";
import {
  calculateTimeDelayedBeforeResolution,
  createResolutionLog,
  resolveShipment,
  bulkResolveShipments,
  getResolutionHistory,
  unresolveShipment,
  RESOLUTION_REASON_LABELS,
  RESOLUTION_REASONS,
} from "../resolution.service";

// Mock Prisma
vi.mock("~/db.server", () => ({
  prisma: {
    shipment: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    resolutionLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Get typed mocks
const mockShipmentFindFirst = prisma.shipment.findFirst as ReturnType<typeof vi.fn>;
const mockShipmentUpdate = prisma.shipment.update as ReturnType<typeof vi.fn>;
const mockResolutionLogCreate = prisma.resolutionLog.create as ReturnType<typeof vi.fn>;
const mockResolutionLogFindMany = prisma.resolutionLog.findMany as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;

describe("resolution.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("calculateTimeDelayedBeforeResolution", () => {
    it("should return null when delayFlaggedAt is null", () => {
      const result = calculateTimeDelayedBeforeResolution(null);
      expect(result).toBeNull();
    });

    it("should calculate time difference in minutes", () => {
      const delayFlaggedAt = new Date("2026-02-05T10:00:00Z");
      const resolvedAt = new Date("2026-02-05T12:30:00Z"); // 2.5 hours later

      const result = calculateTimeDelayedBeforeResolution(delayFlaggedAt, resolvedAt);
      expect(result).toBe(150); // 150 minutes
    });

    it("should return 0 for same time", () => {
      const time = new Date("2026-02-05T10:00:00Z");

      const result = calculateTimeDelayedBeforeResolution(time, time);
      expect(result).toBe(0);
    });

    it("should return 0 for negative difference (should not happen in practice)", () => {
      const delayFlaggedAt = new Date("2026-02-05T12:00:00Z");
      const resolvedAt = new Date("2026-02-05T10:00:00Z"); // Earlier time

      const result = calculateTimeDelayedBeforeResolution(delayFlaggedAt, resolvedAt);
      expect(result).toBe(0);
    });

    it("should calculate multi-day delays correctly", () => {
      const delayFlaggedAt = new Date("2026-02-03T10:00:00Z");
      const resolvedAt = new Date("2026-02-05T10:00:00Z"); // 2 days later

      const result = calculateTimeDelayedBeforeResolution(delayFlaggedAt, resolvedAt);
      expect(result).toBe(2880); // 48 hours = 2880 minutes
    });

    it("should use current time when resolvedAt not provided", () => {
      const delayFlaggedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      const result = calculateTimeDelayedBeforeResolution(delayFlaggedAt);
      // Should be approximately 60 minutes (allow for test execution time)
      expect(result).toBeGreaterThanOrEqual(59);
      expect(result).toBeLessThanOrEqual(61);
    });
  });

  describe("createResolutionLog", () => {
    it("should create a resolution log entry", async () => {
      const mockLog = {
        id: "log-123",
        shipmentId: "shipment-456",
        resolvedBy: "merchant@example.com",
        resolutionReason: "CONTACTED_CUSTOMER",
        notes: "Spoke with customer",
        timeDelayedBeforeResolution: 120,
      };

      mockResolutionLogCreate.mockResolvedValue(mockLog);

      const result = await createResolutionLog({
        shipmentId: "shipment-456",
        resolvedBy: "merchant@example.com",
        resolutionReason: "CONTACTED_CUSTOMER",
        notes: "Spoke with customer",
        timeDelayedBeforeResolution: 120,
      });

      expect(mockResolutionLogCreate).toHaveBeenCalledWith({
        data: {
          shipmentId: "shipment-456",
          resolvedBy: "merchant@example.com",
          resolutionReason: "CONTACTED_CUSTOMER",
          notes: "Spoke with customer",
          timeDelayedBeforeResolution: 120,
        },
      });
      expect(result).toEqual(mockLog);
    });

    it("should truncate notes to 500 characters", async () => {
      const longNotes = "a".repeat(600);
      mockResolutionLogCreate.mockResolvedValue({ id: "log-123" });

      await createResolutionLog({
        shipmentId: "shipment-456",
        resolvedBy: "merchant@example.com",
        resolutionReason: "OTHER",
        notes: longNotes,
      });

      const createCall = mockResolutionLogCreate.mock.calls[0][0];
      expect(createCall.data.notes).toHaveLength(500);
    });

    it("should handle null notes", async () => {
      mockResolutionLogCreate.mockResolvedValue({ id: "log-123" });

      await createResolutionLog({
        shipmentId: "shipment-456",
        resolvedBy: "merchant@example.com",
        resolutionReason: "DELIVERED_FALSE_ALARM",
        notes: null,
      });

      const createCall = mockResolutionLogCreate.mock.calls[0][0];
      expect(createCall.data.notes).toBeNull();
    });

    it("should handle undefined timeDelayedBeforeResolution", async () => {
      mockResolutionLogCreate.mockResolvedValue({ id: "log-123" });

      await createResolutionLog({
        shipmentId: "shipment-456",
        resolvedBy: "merchant@example.com",
        resolutionReason: "RESHIPPED",
      });

      const createCall = mockResolutionLogCreate.mock.calls[0][0];
      expect(createCall.data.timeDelayedBeforeResolution).toBeNull();
    });
  });

  describe("resolveShipment", () => {
    const defaultInput = {
      shipmentId: "shipment-123",
      merchantId: "merchant-456",
      resolvedBy: "merchant@example.com",
      resolutionReason: "CONTACTED_CUSTOMER" as const,
      notes: "Customer notified",
    };

    it("should resolve a shipment successfully", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "shipment-123",
        isResolved: false,
        isDelivered: false,
        delayFlaggedAt: new Date("2026-02-05T10:00:00Z"),
      });

      mockTransaction.mockResolvedValue([
        { id: "shipment-123" },
        { id: "log-789" },
      ]);

      const result = await resolveShipment(defaultInput);

      expect(result.success).toBe(true);
      expect(result.shipmentId).toBe("shipment-123");
      expect(result.resolutionLogId).toBe("log-789");
    });

    it("should return error when shipment not found", async () => {
      mockShipmentFindFirst.mockResolvedValue(null);

      const result = await resolveShipment(defaultInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Shipment not found");
    });

    it("should return error when shipment is already resolved", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "shipment-123",
        isResolved: true,
        isDelivered: false,
        delayFlaggedAt: null,
      });

      const result = await resolveShipment(defaultInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Shipment is already resolved");
    });

    it("should return error when shipment is delivered", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "shipment-123",
        isResolved: false,
        isDelivered: true,
        delayFlaggedAt: null,
      });

      const result = await resolveShipment(defaultInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot resolve a delivered shipment");
    });

    it("should calculate timeDelayedBeforeResolution when delayFlaggedAt exists", async () => {
      const delayFlaggedAt = new Date(Date.now() - 3600000); // 1 hour ago

      mockShipmentFindFirst.mockResolvedValue({
        id: "shipment-123",
        isResolved: false,
        isDelivered: false,
        delayFlaggedAt,
      });

      mockTransaction.mockResolvedValue([
        { id: "shipment-123" },
        { id: "log-789" },
      ]);

      await resolveShipment(defaultInput);

      // Verify transaction was called with timeDelayedBeforeResolution
      const transactionCall = mockTransaction.mock.calls[0][0];
      expect(transactionCall).toHaveLength(2); // shipment update and log create
    });

    it("should handle database errors", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "shipment-123",
        isResolved: false,
        isDelivered: false,
        delayFlaggedAt: null,
      });

      mockTransaction.mockRejectedValue(new Error("Database connection failed"));

      const result = await resolveShipment(defaultInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database connection failed");
    });

    it("should verify merchant owns the shipment", async () => {
      mockShipmentFindFirst.mockResolvedValue(null);

      await resolveShipment({
        ...defaultInput,
        merchantId: "wrong-merchant",
      });

      expect(mockShipmentFindFirst).toHaveBeenCalledWith({
        where: {
          id: "shipment-123",
          merchantId: "wrong-merchant",
        },
        select: expect.any(Object),
      });
    });
  });

  describe("bulkResolveShipments", () => {
    it("should resolve multiple shipments", async () => {
      // Mock for first shipment
      mockShipmentFindFirst
        .mockResolvedValueOnce({
          id: "ship-1",
          isResolved: false,
          isDelivered: false,
          delayFlaggedAt: null,
        })
        .mockResolvedValueOnce({
          id: "ship-2",
          isResolved: false,
          isDelivered: false,
          delayFlaggedAt: null,
        });

      mockTransaction
        .mockResolvedValueOnce([{ id: "ship-1" }, { id: "log-1" }])
        .mockResolvedValueOnce([{ id: "ship-2" }, { id: "log-2" }]);

      const result = await bulkResolveShipments({
        shipmentIds: ["ship-1", "ship-2"],
        merchantId: "merchant-123",
        resolvedBy: "merchant@example.com",
        resolutionReason: "SENT_NOTIFICATION",
        notes: "Bulk resolution",
      });

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
    });

    it("should handle partial failures", async () => {
      mockShipmentFindFirst
        .mockResolvedValueOnce({
          id: "ship-1",
          isResolved: false,
          isDelivered: false,
          delayFlaggedAt: null,
        })
        .mockResolvedValueOnce(null); // Second shipment not found

      mockTransaction.mockResolvedValueOnce([{ id: "ship-1" }, { id: "log-1" }]);

      const result = await bulkResolveShipments({
        shipmentIds: ["ship-1", "ship-2"],
        merchantId: "merchant-123",
        resolvedBy: "merchant@example.com",
        resolutionReason: "PARTIAL_REFUND",
      });

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe("Shipment not found");
    });

    it("should handle empty shipment list", async () => {
      const result = await bulkResolveShipments({
        shipmentIds: [],
        merchantId: "merchant-123",
        resolvedBy: "merchant@example.com",
        resolutionReason: "OTHER",
      });

      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  describe("getResolutionHistory", () => {
    it("should fetch resolution history for a shipment", async () => {
      const mockLogs = [
        {
          id: "log-2",
          shipmentId: "ship-123",
          resolvedAt: new Date("2026-02-05T12:00:00Z"),
          resolvedBy: "merchant@example.com",
          resolutionReason: "SENT_NOTIFICATION",
          notes: "Sent follow-up",
        },
        {
          id: "log-1",
          shipmentId: "ship-123",
          resolvedAt: new Date("2026-02-05T10:00:00Z"),
          resolvedBy: "merchant@example.com",
          resolutionReason: "CONTACTED_CUSTOMER",
          notes: "Initial contact",
        },
      ];

      mockResolutionLogFindMany.mockResolvedValue(mockLogs);

      const result = await getResolutionHistory("ship-123");

      expect(mockResolutionLogFindMany).toHaveBeenCalledWith({
        where: { shipmentId: "ship-123" },
        orderBy: { resolvedAt: "desc" },
      });
      expect(result).toEqual(mockLogs);
    });

    it("should return empty array when no history exists", async () => {
      mockResolutionLogFindMany.mockResolvedValue([]);

      const result = await getResolutionHistory("ship-new");

      expect(result).toEqual([]);
    });
  });

  describe("unresolveShipment", () => {
    it("should unresolve a resolved shipment", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "ship-123",
        isResolved: true,
      });

      mockShipmentUpdate.mockResolvedValue({ id: "ship-123" });

      const result = await unresolveShipment("ship-123", "merchant-456");

      expect(result.success).toBe(true);
      expect(mockShipmentUpdate).toHaveBeenCalledWith({
        where: { id: "ship-123" },
        data: {
          isResolved: false,
          resolvedAt: null,
          resolvedBy: null,
          resolutionReason: null,
          resolutionNotes: null,
        },
      });
    });

    it("should return error when shipment not found", async () => {
      mockShipmentFindFirst.mockResolvedValue(null);

      const result = await unresolveShipment("ship-123", "merchant-456");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Shipment not found");
    });

    it("should return error when shipment is not resolved", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "ship-123",
        isResolved: false,
      });

      const result = await unresolveShipment("ship-123", "merchant-456");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Shipment is not resolved");
    });

    it("should handle database errors", async () => {
      mockShipmentFindFirst.mockResolvedValue({
        id: "ship-123",
        isResolved: true,
      });

      mockShipmentUpdate.mockRejectedValue(new Error("Database error"));

      const result = await unresolveShipment("ship-123", "merchant-456");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database error");
    });
  });

  describe("Constants", () => {
    describe("RESOLUTION_REASON_LABELS", () => {
      it("should have labels for all resolution reasons", () => {
        expect(RESOLUTION_REASON_LABELS.CONTACTED_CUSTOMER).toBe(
          "Contacted customer - no action needed"
        );
        expect(RESOLUTION_REASON_LABELS.SENT_NOTIFICATION).toBe(
          "Sent delay notification"
        );
        expect(RESOLUTION_REASON_LABELS.PARTIAL_REFUND).toBe(
          "Issued partial refund"
        );
        expect(RESOLUTION_REASON_LABELS.FULL_REFUND).toBe(
          "Issued full refund"
        );
        expect(RESOLUTION_REASON_LABELS.RESHIPPED).toBe(
          "Reshipped order"
        );
        expect(RESOLUTION_REASON_LABELS.DELIVERED_FALSE_ALARM).toBe(
          "Package delivered (false alarm)"
        );
        expect(RESOLUTION_REASON_LABELS.CUSTOMER_CANCELLED).toBe(
          "Customer cancelled"
        );
        expect(RESOLUTION_REASON_LABELS.OTHER).toBe("Other");
      });
    });

    describe("RESOLUTION_REASONS", () => {
      it("should contain all 8 resolution reasons", () => {
        expect(RESOLUTION_REASONS).toHaveLength(8);
      });

      it("should contain expected values in correct order", () => {
        expect(RESOLUTION_REASONS[0]).toBe("CONTACTED_CUSTOMER");
        expect(RESOLUTION_REASONS[1]).toBe("SENT_NOTIFICATION");
        expect(RESOLUTION_REASONS[2]).toBe("PARTIAL_REFUND");
        expect(RESOLUTION_REASONS[3]).toBe("FULL_REFUND");
        expect(RESOLUTION_REASONS[4]).toBe("RESHIPPED");
        expect(RESOLUTION_REASONS[5]).toBe("DELIVERED_FALSE_ALARM");
        expect(RESOLUTION_REASONS[6]).toBe("CUSTOMER_CANCELLED");
        expect(RESOLUTION_REASONS[7]).toBe("OTHER");
      });
    });
  });
});
