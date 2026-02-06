import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";
import type { ShipmentsApiResponse } from "~/lib/validation";

// Import mocks after setup
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { loader } from "../api.shipments";

// Mock authenticate
vi.mock("~/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
}));

// Mock Prisma
vi.mock("~/db.server", () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn(),
    },
    shipment: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

const mockAuthenticate = authenticate.admin as ReturnType<typeof vi.fn>;
const mockMerchantFindUnique = prisma.merchant.findUnique as ReturnType<typeof vi.fn>;
const mockShipmentFindMany = prisma.shipment.findMany as ReturnType<typeof vi.fn>;
const mockShipmentCount = prisma.shipment.count as ReturnType<typeof vi.fn>;
const mockShipmentGroupBy = prisma.shipment.groupBy as ReturnType<typeof vi.fn>;
const mockQueryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>;

describe("api.shipments loader", () => {
  const mockMerchant = { id: "merchant-123" };
  const mockSession = { shop: "test-shop.myshopify.com" };

  const mockShipment = {
    id: "ship-1",
    orderNumber: "#1001",
    trackingNumber: "1Z123456789",
    carrier: "UPS" as const,
    serviceLevel: "ground",
    customerName: "John Doe",
    customerEmail: "john@example.com",
    shipDate: new Date("2026-02-01"),
    expectedDeliveryDate: new Date("2026-02-05"),
    daysDelayed: 2,
    orderValue: { toString: () => "99.99" } as Prisma.Decimal,
    currentStatus: "in_transit",
    isDelayed: true,
    isResolved: false,
    isDelivered: false,
    notificationSent: false,
    lastScanLocation: "Chicago, IL",
    lastScanTime: new Date("2026-02-04T10:00:00Z"),
    fulfillmentLocationId: "loc-1",
    fulfillmentLocationName: "Main Warehouse",
    shopifyOrderId: "order-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup
    mockAuthenticate.mockResolvedValue({ session: mockSession });
    mockMerchantFindUnique.mockResolvedValue(mockMerchant);
    mockShipmentFindMany.mockResolvedValue([mockShipment]);
    mockShipmentCount.mockResolvedValue(1);
    mockShipmentGroupBy.mockResolvedValue([]); // No duplicate tracking numbers by default
    mockQueryRaw.mockResolvedValue([]);
  });

  function createRequest(params: Record<string, string> = {}): Request {
    const url = new URL("http://localhost/api/shipments");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return new Request(url.toString());
  }

  describe("authentication and authorization", () => {
    it("should authenticate the request", async () => {
      const request = createRequest();
      await loader({ request, context: {}, params: {} });

      expect(mockAuthenticate).toHaveBeenCalledWith(request);
    });

    it("should return 404 if merchant not found", async () => {
      mockMerchantFindUnique.mockResolvedValue(null);

      const request = createRequest();
      const response = await loader({ request, context: {}, params: {} });
      const data = await response.json() as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Merchant not found");
    });
  });

  describe("pagination", () => {
    it("should use default pagination values", async () => {
      const request = createRequest();
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 50,
        })
      );
    });

    it("should apply custom pagination", async () => {
      const request = createRequest({ page: "3", pageSize: "25" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 50, // (3-1) * 25
          take: 25,
        })
      );
    });

    it("should return correct pagination metadata", async () => {
      mockShipmentCount.mockResolvedValueOnce(75);

      const request = createRequest({ page: "2", pageSize: "20" });
      const response = await loader({ request, context: {}, params: {} });
      const data = await response.json() as ShipmentsApiResponse;

      expect(data.pagination).toEqual({
        page: 2,
        pageSize: 20,
        total: 75,
        totalPages: 4,
      });
    });
  });

  describe("filtering by tab", () => {
    it("should filter by 'all' tab (no additional filters)", async () => {
      const request = createRequest({ tab: "all" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            merchantId: "merchant-123",
            isArchived: false,
          }),
        })
      );
    });

    it("should filter by 'delayed' tab", async () => {
      const request = createRequest({ tab: "delayed" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDelayed: true,
            isResolved: false,
            isDelivered: false,
          }),
        })
      );
    });

    it("should filter by 'pending' tab", async () => {
      const request = createRequest({ tab: "pending" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            currentStatus: "pending",
            hasCarrierScan: false,
            isDelivered: false,
          }),
        })
      );
    });

    it("should filter by 'resolved' tab", async () => {
      const request = createRequest({ tab: "resolved" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isResolved: true,
          }),
        })
      );
    });

    it("should filter by 'delivered' tab", async () => {
      const request = createRequest({ tab: "delivered" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDelivered: true,
          }),
        })
      );
    });
  });

  describe("filtering by carrier", () => {
    it("should filter by carrier", async () => {
      const request = createRequest({ carrier: "UPS" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            carrier: "UPS",
          }),
        })
      );
    });
  });

  describe("filtering by service level", () => {
    it("should filter by service level", async () => {
      const request = createRequest({ serviceLevel: "ground" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            serviceLevel: "ground",
          }),
        })
      );
    });
  });

  describe("filtering by delay status", () => {
    it("should filter by delayed status", async () => {
      const request = createRequest({ delayStatus: "delayed" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDelayed: true,
          }),
        })
      );
    });

    it("should filter by on_time status", async () => {
      const request = createRequest({ delayStatus: "on_time" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDelayed: false,
            isDelivered: false,
          }),
        })
      );
    });

    it("should filter by pending status", async () => {
      const request = createRequest({ delayStatus: "pending" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            hasCarrierScan: false,
          }),
        })
      );
    });
  });

  describe("filtering by order value", () => {
    it("should filter by minimum order value", async () => {
      const request = createRequest({ orderValueMin: "50" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderValue: { gte: 50 },
          }),
        })
      );
    });

    it("should filter by maximum order value", async () => {
      const request = createRequest({ orderValueMax: "200" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderValue: { lte: 200 },
          }),
        })
      );
    });

    it("should filter by order value range", async () => {
      const request = createRequest({ orderValueMin: "50", orderValueMax: "200" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderValue: { gte: 50, lte: 200 },
          }),
        })
      );
    });
  });

  describe("filtering by ship date", () => {
    it("should filter by ship date from", async () => {
      const request = createRequest({ shipDateFrom: "2026-01-15" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shipDate: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        })
      );
    });

    it("should filter by ship date to", async () => {
      const request = createRequest({ shipDateTo: "2026-02-15" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shipDate: expect.objectContaining({
              lte: expect.any(Date),
            }),
          }),
        })
      );
    });
  });

  describe("filtering by location", () => {
    it("should filter by fulfillment location", async () => {
      const request = createRequest({ locationId: "loc-123" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fulfillmentLocationId: "loc-123",
          }),
        })
      );
    });
  });

  describe("sorting", () => {
    it("should use default sorting (daysDelayed desc)", async () => {
      const request = createRequest();
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { daysDelayed: "desc" },
        })
      );
    });

    it("should apply custom sort column", async () => {
      const request = createRequest({ sortBy: "shipDate" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { shipDate: "desc" },
        })
      );
    });

    it("should apply custom sort direction", async () => {
      const request = createRequest({ sortBy: "orderNumber", sortDir: "asc" });
      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { orderNumber: "asc" },
        })
      );
    });
  });

  describe("response format", () => {
    it("should return shipments with correct format", async () => {
      const request = createRequest();
      const response = await loader({ request, context: {}, params: {} });
      const data = await response.json() as ShipmentsApiResponse;

      expect(data.shipments).toHaveLength(1);
      const shipment = data.shipments[0];

      expect(shipment.id).toBe("ship-1");
      expect(shipment.orderNumber).toBe("#1001");
      expect(shipment.trackingNumber).toBe("1Z123456789");
      expect(shipment.carrier).toBe("UPS");
      expect(shipment.serviceLevel).toBe("ground");
      expect(shipment.customerName).toBe("John Doe");
      expect(shipment.customerEmail).toBe("john@example.com");
      expect(shipment.shipDate).toBe("2026-02-01T00:00:00.000Z");
      expect(shipment.expectedDeliveryDate).toBe("2026-02-05T00:00:00.000Z");
      expect(shipment.daysDelayed).toBe(2);
      expect(shipment.orderValue).toBe("99.99");
      expect(shipment.isDelayed).toBe(true);
      expect(shipment.lastScanLocation).toBe("Chicago, IL");
    });

    it("should handle null values correctly", async () => {
      mockShipmentFindMany.mockResolvedValue([{
        ...mockShipment,
        expectedDeliveryDate: null,
        orderValue: null,
        lastScanTime: null,
        serviceLevel: null,
      }]);

      const request = createRequest();
      const response = await loader({ request, context: {}, params: {} });
      const data = await response.json() as ShipmentsApiResponse;

      const shipment = data.shipments[0];
      expect(shipment.expectedDeliveryDate).toBeNull();
      expect(shipment.orderValue).toBeNull();
      expect(shipment.lastScanTime).toBeNull();
      expect(shipment.serviceLevel).toBeNull();
    });

    it("should include pagination in response", async () => {
      mockShipmentCount.mockResolvedValueOnce(100);

      const request = createRequest({ page: "2", pageSize: "20" });
      const response = await loader({ request, context: {}, params: {} });
      const data = await response.json() as ShipmentsApiResponse;

      expect(data.pagination).toEqual({
        page: 2,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      });
    });

    it("should include summary statistics in response", async () => {
      // Summary stats come from separate count queries
      mockShipmentCount
        .mockResolvedValueOnce(1) // Main query count
        .mockResolvedValueOnce(10) // totalActive
        .mockResolvedValueOnce(3) // delayed
        .mockResolvedValueOnce(2); // deliveredToday

      mockQueryRaw.mockResolvedValue([
        { carrier: "UPS", avg_days: 3.5 },
        { carrier: "FEDEX", avg_days: 2.8 },
      ]);

      const request = createRequest();
      const response = await loader({ request, context: {}, params: {} });
      const data = await response.json() as ShipmentsApiResponse;

      expect(data.summary).toEqual({
        totalActive: 10,
        delayed: 3,
        deliveredToday: 2,
        avgDeliveryTimeByCarrier: {
          UPS: 3.5,
          FEDEX: 2.8,
          USPS: null,
        },
      });
    });
  });

  describe("combined filters", () => {
    it("should apply multiple filters together", async () => {
      const request = createRequest({
        tab: "delayed",
        carrier: "FEDEX",
        orderValueMin: "100",
        sortBy: "shipDate",
        sortDir: "asc",
        page: "2",
        pageSize: "10",
      });

      await loader({ request, context: {}, params: {} });

      expect(mockShipmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            merchantId: "merchant-123",
            isArchived: false,
            isDelayed: true,
            isResolved: false,
            isDelivered: false,
            carrier: "FEDEX",
            orderValue: { gte: 100 },
          }),
          orderBy: { shipDate: "asc" },
          skip: 10,
          take: 10,
        })
      );
    });
  });
});
