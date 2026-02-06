import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FulfillmentWebhookPayload, OrderPartial } from "~/lib/validation";

// Import after mock setup
import { prisma } from "~/db.server";
import {
  createShipmentFromFulfillment,
  updateShipmentFromFulfillment,
  checkDuplicateTrackingNumber,
  getShipmentById,
  getShipmentByFulfillmentId,
  scheduleNextPoll,
  markShipmentHasCarrierScan,
  archiveOldDeliveredShipments,
} from "../shipment.service";

// Mock Prisma
vi.mock("~/db.server", () => ({
  prisma: {
    shipment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// Get typed mocks
const mockFindUnique = prisma.shipment.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.shipment.findFirst as ReturnType<typeof vi.fn>;
const mockCreate = prisma.shipment.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.shipment.update as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.shipment.updateMany as ReturnType<typeof vi.fn>;

describe("shipment.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  const mockFulfillment: FulfillmentWebhookPayload = {
    id: 123456789,
    order_id: 987654321,
    status: "success",
    created_at: "2026-02-04T10:00:00-05:00",
    tracking_company: "UPS",
    tracking_number: "1Z999AA10123456784",
    tracking_url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    service: "Ground",
    location_id: 12345,
  };

  const mockOrder: OrderPartial = {
    id: 987654321,
    name: "#1001",
    email: "customer@example.com",
    phone: "+1-555-123-4567",
    total_price: "99.99",
    currency: "USD",
    shipping_address: {
      first_name: "John",
      last_name: "Doe",
      name: "John Doe",
      address1: "123 Main St",
      address2: "Apt 4",
      city: "Anytown",
      province: "CA",
      province_code: "CA",
      country: "United States",
      country_code: "US",
      zip: "12345",
      phone: "+1-555-123-4567",
    },
    customer: {
      id: 111222333,
      email: "customer@example.com",
      phone: "+1-555-123-4567",
      first_name: "John",
      last_name: "Doe",
    },
  };

  describe("createShipmentFromFulfillment", () => {
    const mockCreatedShipment = {
      id: "shipment-123",
      merchantId: "merchant-456",
      shopifyOrderId: "987654321",
      shopifyFulfillmentId: "123456789",
      orderNumber: "#1001",
      trackingNumber: "1Z999AA10123456784",
      carrier: "UPS",
      serviceLevel: "ground",
      customerName: "John Doe",
      customerEmail: "customer@example.com",
      customerPhone: "+1-555-123-4567",
      shippingAddress: {},
      shipDate: new Date("2026-02-04T15:00:00Z"),
      currentStatus: "pending",
      isDelayed: false,
      isDelivered: false,
      isArchived: false,
      nextPollAt: new Date("2026-02-05T12:30:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should create a new shipment from fulfillment data", async () => {
      mockFindUnique.mockResolvedValue(null); // No existing shipment
      mockFindFirst.mockResolvedValue(null); // No duplicate
      mockCreate.mockResolvedValue(mockCreatedShipment);

      const result = await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: mockFulfillment,
        order: mockOrder,
        locationName: "Main Warehouse",
      });

      expect(result.isNew).toBe(true);
      expect(result.shipment.orderNumber).toBe("#1001");
      expect(result.shipment.trackingNumber).toBe("1Z999AA10123456784");
      expect(result.shipment.carrier).toBe("UPS");

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          merchantId: "merchant-456",
          shopifyOrderId: "987654321",
          shopifyFulfillmentId: "123456789",
          orderNumber: "#1001",
          trackingNumber: "1Z999AA10123456784",
          carrier: "UPS",
          customerName: "John Doe",
          customerEmail: "customer@example.com",
          fulfillmentLocationName: "Main Warehouse",
        }),
      });
    });

    it("should return existing shipment if already exists", async () => {
      mockFindUnique.mockResolvedValue(mockCreatedShipment);

      const result = await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: mockFulfillment,
        order: mockOrder,
      });

      expect(result.isNew).toBe(false);
      expect(result.shipment).toEqual(mockCreatedShipment);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should detect carrier from tracking number when company not provided", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue({
        ...mockCreatedShipment,
        carrier: "UPS",
      });

      const fulfillmentNoCompany: FulfillmentWebhookPayload = {
        ...mockFulfillment,
        tracking_company: null,
      };

      await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: fulfillmentNoCompany,
        order: mockOrder,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          carrier: "UPS",
        }),
      });
    });

    it("should set carrier to UNKNOWN when tracking number is missing", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockResolvedValue({
        ...mockCreatedShipment,
        carrier: "UNKNOWN",
        trackingNumber: "",
      });

      const fulfillmentNoTracking: FulfillmentWebhookPayload = {
        ...mockFulfillment,
        tracking_number: null,
        tracking_numbers: [],
        tracking_company: null,
      };

      await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: fulfillmentNoTracking,
        order: mockOrder,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          carrier: "UNKNOWN",
          trackingNumber: "",
          nextPollAt: null, // No polling when no tracking number
        }),
      });
    });

    it("should flag duplicate tracking numbers", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockFindFirst.mockResolvedValue({
        id: "existing-shipment",
        orderNumber: "#1000",
      });
      mockCreate.mockResolvedValue(mockCreatedShipment);

      const result = await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: mockFulfillment,
        order: mockOrder,
      });

      expect(result.isDuplicate).toBe(true);
    });

    it("should extract customer info from shipping address", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCreatedShipment);

      const orderNoCustomer: OrderPartial = {
        ...mockOrder,
        customer: null,
        email: null,
      };

      await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: mockFulfillment,
        order: orderNoCustomer,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerName: "John Doe",
          customerPhone: "+1-555-123-4567",
        }),
      });
    });

    it("should use tracking_numbers array when tracking_number is null", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCreatedShipment);

      const fulfillmentWithArray: FulfillmentWebhookPayload = {
        ...mockFulfillment,
        tracking_number: null,
        tracking_numbers: ["1Z999AA10123456784", "1Z999AA10123456785"],
      };

      await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: fulfillmentWithArray,
        order: mockOrder,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          trackingNumber: "1Z999AA10123456784", // First one
        }),
      });
    });

    it("should normalize service level", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCreatedShipment);

      const fulfillmentWithService: FulfillmentWebhookPayload = {
        ...mockFulfillment,
        service: "UPS Ground",
      };

      await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: fulfillmentWithService,
        order: mockOrder,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          serviceLevel: "ups_ground",
        }),
      });
    });

    it("should set nextPollAt to 30 minutes from now for new shipments with tracking", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCreatedShipment);

      await createShipmentFromFulfillment({
        merchantId: "merchant-456",
        fulfillment: mockFulfillment,
        order: mockOrder,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nextPollAt: new Date("2026-02-05T12:30:00Z"),
        }),
      });
    });
  });

  describe("updateShipmentFromFulfillment", () => {
    const existingShipment = {
      id: "shipment-123",
      merchantId: "merchant-456",
      shopifyFulfillmentId: "123456789",
      trackingNumber: "",
      carrier: "UNKNOWN",
      serviceLevel: null,
      currentStatus: "pending",
      nextPollAt: null,
      pollErrorCount: 0,
    };

    it("should return null if shipment does not exist", async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await updateShipmentFromFulfillment(
        "merchant-456",
        mockFulfillment
      );

      expect(result).toBeNull();
    });

    it("should update tracking number and carrier when tracking is added", async () => {
      mockFindUnique.mockResolvedValue(existingShipment);
      mockUpdate.mockResolvedValue({
        ...existingShipment,
        trackingNumber: "1Z999AA10123456784",
        carrier: "UPS",
        nextPollAt: new Date("2026-02-05T12:30:00Z"),
      });

      const result = await updateShipmentFromFulfillment(
        "merchant-456",
        mockFulfillment
      );

      expect(result).not.toBeNull();
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "shipment-123" },
        data: expect.objectContaining({
          trackingNumber: "1Z999AA10123456784",
          carrier: "UPS",
          pollErrorCount: 0, // Reset when tracking changes
        }),
      });
    });

    it("should set nextPollAt when tracking number is first added", async () => {
      mockFindUnique.mockResolvedValue(existingShipment);
      mockUpdate.mockResolvedValue({
        ...existingShipment,
        trackingNumber: "1Z999AA10123456784",
        carrier: "UPS",
        nextPollAt: new Date("2026-02-05T12:30:00Z"),
      });

      await updateShipmentFromFulfillment("merchant-456", mockFulfillment);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "shipment-123" },
        data: expect.objectContaining({
          nextPollAt: new Date("2026-02-05T12:30:00Z"),
        }),
      });
    });

    it("should not update if no tracking changes", async () => {
      const shipmentWithTracking = {
        ...existingShipment,
        trackingNumber: "1Z999AA10123456784",
        carrier: "UPS",
      };
      mockFindUnique.mockResolvedValue(shipmentWithTracking);

      const fulfillmentNoCompanyChange: FulfillmentWebhookPayload = {
        ...mockFulfillment,
        tracking_company: undefined,
      };

      const result = await updateShipmentFromFulfillment(
        "merchant-456",
        fulfillmentNoCompanyChange
      );

      expect(result).toEqual(shipmentWithTracking);
    });
  });

  describe("checkDuplicateTrackingNumber", () => {
    it("should return isDuplicate: false when no duplicate exists", async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await checkDuplicateTrackingNumber(
        "merchant-456",
        "1Z999AA10123456784"
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.existingShipment).toBeUndefined();
    });

    it("should return isDuplicate: true when duplicate exists", async () => {
      const existing = {
        id: "shipment-123",
        orderNumber: "#1000",
      };
      mockFindFirst.mockResolvedValue(existing);

      const result = await checkDuplicateTrackingNumber(
        "merchant-456",
        "1Z999AA10123456784"
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingShipment).toEqual(existing);
      expect(result.existingOrderNumber).toBe("#1000");
    });

    it("should exclude specified fulfillment ID from check", async () => {
      mockFindFirst.mockResolvedValue(null);

      await checkDuplicateTrackingNumber(
        "merchant-456",
        "1Z999AA10123456784",
        "fulfillment-to-exclude"
      );

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          merchantId: "merchant-456",
          trackingNumber: "1Z999AA10123456784",
          NOT: { shopifyFulfillmentId: "fulfillment-to-exclude" },
        },
      });
    });
  });

  describe("getShipmentById", () => {
    it("should return shipment when found", async () => {
      const mockShipment = { id: "shipment-123" };
      mockFindUnique.mockResolvedValue(mockShipment);

      const result = await getShipmentById("shipment-123");

      expect(result).toEqual(mockShipment);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: "shipment-123" },
      });
    });

    it("should return null when not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getShipmentById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getShipmentByFulfillmentId", () => {
    it("should find shipment by merchant and fulfillment ID", async () => {
      const mockShipment = { id: "shipment-123" };
      mockFindUnique.mockResolvedValue(mockShipment);

      const result = await getShipmentByFulfillmentId("merchant-456", "fulfillment-789");

      expect(result).toEqual(mockShipment);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: {
          merchantId_shopifyFulfillmentId: {
            merchantId: "merchant-456",
            shopifyFulfillmentId: "fulfillment-789",
          },
        },
      });
    });
  });

  describe("scheduleNextPoll", () => {
    it("should update nextPollAt for shipment", async () => {
      const nextPollAt = new Date("2026-02-05T16:00:00Z");
      mockUpdate.mockResolvedValue({ id: "shipment-123", nextPollAt });

      const result = await scheduleNextPoll("shipment-123", nextPollAt);

      expect(result.nextPollAt).toEqual(nextPollAt);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "shipment-123" },
        data: { nextPollAt },
      });
    });
  });

  describe("markShipmentHasCarrierScan", () => {
    it("should set hasCarrierScan to true", async () => {
      mockUpdate.mockResolvedValue({ id: "shipment-123", hasCarrierScan: true });

      const result = await markShipmentHasCarrierScan("shipment-123");

      expect(result.hasCarrierScan).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "shipment-123" },
        data: { hasCarrierScan: true },
      });
    });
  });

  describe("archiveOldDeliveredShipments", () => {
    it("should archive delivered shipments older than threshold", async () => {
      mockUpdateMany.mockResolvedValue({ count: 5 });

      const result = await archiveOldDeliveredShipments("merchant-456", 30);

      expect(result).toBe(5);
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          merchantId: "merchant-456",
          isDelivered: true,
          deliveredAt: { lte: expect.any(Date) },
          isArchived: false,
        },
        data: { isArchived: true },
      });
    });
  });
});
