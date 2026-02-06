import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import after mock setup
import { prisma } from "~/db.server";
import { sessionStorage } from "~/shopify.server";
import { enqueuePollJob } from "~/queue.server";
import {
  syncFulfillments,
  getSyncStatus,
} from "../sync.service";

// Mock Prisma
vi.mock("~/db.server", () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn(),
    },
    shipment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

// Mock Shopify session storage
vi.mock("~/shopify.server", () => ({
  sessionStorage: {
    loadSession: vi.fn(),
  },
}));

// Mock queue
vi.mock("~/queue.server", () => ({
  enqueuePollJob: vi.fn(),
  getQueue: vi.fn(() => ({
    getJob: vi.fn(),
  })),
}));

// Mock queues
vi.mock("~/jobs/queues", () => ({
  QUEUE_FULFILLMENT_SYNC: "fulfillment-sync",
}));

// Get typed mocks
const mockMerchantFindUnique = prisma.merchant.findUnique as ReturnType<typeof vi.fn>;
const mockShipmentFindUnique = prisma.shipment.findUnique as ReturnType<typeof vi.fn>;
const mockShipmentFindFirst = prisma.shipment.findFirst as ReturnType<typeof vi.fn>;
const mockShipmentCreate = prisma.shipment.create as ReturnType<typeof vi.fn>;
const mockShipmentGroupBy = prisma.shipment.groupBy as ReturnType<typeof vi.fn>;
const mockLoadSession = sessionStorage.loadSession as ReturnType<typeof vi.fn>;
const mockEnqueuePollJob = enqueuePollJob as ReturnType<typeof vi.fn>;

// Mock fetch for GraphQL calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("sync.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  const mockMerchant = {
    id: "merchant-123",
    shopifyShopId: "test-shop-123",
    shopDomain: "test-shop.myshopify.com",
    email: "test@example.com",
    timezone: "America/New_York",
    settings: {},
    planTier: "STARTER",
    billingStatus: "ACTIVE",
    randomPollOffset: 60,
    onboardingDone: true,
    installedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession = {
    id: "session-123",
    shop: "test-shop.myshopify.com",
    state: "state",
    isOnline: false,
    accessToken: "test-access-token",
  };

  const mockGraphQLFulfillmentResponse = {
    data: {
      fulfillments: {
        edges: [
          {
            node: {
              id: "gid://shopify/Fulfillment/123456789",
              legacyResourceId: "123456789",
              status: "SUCCESS",
              createdAt: "2026-02-04T10:00:00Z",
              updatedAt: "2026-02-04T10:30:00Z",
              trackingInfo: [
                {
                  company: "UPS",
                  number: "1Z999AA10123456784",
                  url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
                },
              ],
              location: {
                legacyResourceId: "12345",
                name: "Main Warehouse",
              },
              order: {
                id: "gid://shopify/Order/987654321",
                legacyResourceId: "987654321",
                name: "#1001",
                email: "customer@example.com",
                phone: "+1-555-123-4567",
                totalPriceSet: {
                  shopMoney: {
                    amount: "99.99",
                    currencyCode: "USD",
                  },
                },
                shippingAddress: {
                  firstName: "John",
                  lastName: "Doe",
                  name: "John Doe",
                  address1: "123 Main St",
                  address2: null,
                  city: "Anytown",
                  province: "California",
                  provinceCode: "CA",
                  country: "United States",
                  countryCode: "US",
                  zip: "12345",
                  phone: "+1-555-123-4567",
                  company: null,
                },
                customer: {
                  legacyResourceId: "111222333",
                  email: "customer@example.com",
                  phone: "+1-555-123-4567",
                  firstName: "John",
                  lastName: "Doe",
                },
              },
              service: {
                serviceName: "Ground",
              },
            },
            cursor: "cursor-1",
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "cursor-1",
        },
      },
    },
  };

  const mockCreatedShipment = {
    id: "shipment-123",
    merchantId: "merchant-123",
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
    shipDate: new Date("2026-02-04T10:00:00Z"),
    currentStatus: "success",
    isDelayed: false,
    isDelivered: false,
    isArchived: false,
    nextPollAt: new Date("2026-02-05T12:30:00Z"),
    hasCarrierScan: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("syncFulfillments", () => {
    it("should throw error when merchant not found", async () => {
      mockMerchantFindUnique.mockResolvedValue(null);

      await expect(syncFulfillments("nonexistent-merchant")).rejects.toThrow(
        "Merchant not found: nonexistent-merchant"
      );
    });

    it("should skip sync for cancelled merchant", async () => {
      mockMerchantFindUnique.mockResolvedValue({
        ...mockMerchant,
        billingStatus: "CANCELLED",
      });

      const result = await syncFulfillments("merchant-123");

      expect(result.total).toBe(0);
      expect(result.created).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should throw error when session not found", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(null);

      await expect(syncFulfillments("merchant-123")).rejects.toThrow(
        "Could not create admin client for merchant: merchant-123"
      );
    });

    it("should sync fulfillments and create shipments", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockGraphQLFulfillmentResponse),
      });
      mockShipmentFindUnique.mockResolvedValue(null); // No existing shipment
      mockShipmentFindFirst.mockResolvedValue(null); // No duplicate tracking
      mockShipmentCreate.mockResolvedValue(mockCreatedShipment);

      const result = await syncFulfillments("merchant-123", false);

      expect(result.total).toBe(1);
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.pollJobsEnqueued).toBe(1);

      // Verify shipment was created
      expect(mockShipmentCreate).toHaveBeenCalled();

      // Verify poll job was enqueued
      expect(mockEnqueuePollJob).toHaveBeenCalledWith("shipment-123");
    });

    it("should skip already synced fulfillments", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockGraphQLFulfillmentResponse),
      });
      mockShipmentFindUnique.mockResolvedValue(mockCreatedShipment); // Already exists

      const result = await syncFulfillments("merchant-123", false);

      expect(result.total).toBe(1);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockShipmentCreate).not.toHaveBeenCalled();
      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });

    it("should not enqueue poll job for UNKNOWN carrier", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);

      const responseWithoutTracking = {
        data: {
          fulfillments: {
            edges: [
              {
                node: {
                  ...mockGraphQLFulfillmentResponse.data.fulfillments.edges[0].node,
                  trackingInfo: [], // No tracking
                },
                cursor: "cursor-1",
              },
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: "cursor-1",
            },
          },
        },
      };

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(responseWithoutTracking),
      });
      mockShipmentFindUnique.mockResolvedValue(null);
      mockShipmentCreate.mockResolvedValue({
        ...mockCreatedShipment,
        carrier: "UNKNOWN",
        trackingNumber: "",
      });

      const result = await syncFulfillments("merchant-123", false);

      expect(result.created).toBe(1);
      expect(result.pollJobsEnqueued).toBe(0);
      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });

    it("should handle pagination", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockShipmentFindUnique.mockResolvedValue(null);
      mockShipmentFindFirst.mockResolvedValue(null);
      mockShipmentCreate.mockResolvedValue(mockCreatedShipment);

      // First page
      const page1Response = {
        data: {
          fulfillments: {
            edges: [
              mockGraphQLFulfillmentResponse.data.fulfillments.edges[0],
            ],
            pageInfo: {
              hasNextPage: true,
              endCursor: "cursor-1",
            },
          },
        },
      };

      // Second page
      const page2Response = {
        data: {
          fulfillments: {
            edges: [
              {
                node: {
                  ...mockGraphQLFulfillmentResponse.data.fulfillments.edges[0].node,
                  id: "gid://shopify/Fulfillment/123456790",
                  legacyResourceId: "123456790",
                },
                cursor: "cursor-2",
              },
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: "cursor-2",
            },
          },
        },
      };

      mockFetch
        .mockResolvedValueOnce({ json: () => Promise.resolve(page1Response) })
        .mockResolvedValueOnce({ json: () => Promise.resolve(page2Response) });

      const result = await syncFulfillments("merchant-123", false);

      expect(result.total).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should track progress via callback", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockGraphQLFulfillmentResponse),
      });
      mockShipmentFindUnique.mockResolvedValue(null);
      mockShipmentFindFirst.mockResolvedValue(null);
      mockShipmentCreate.mockResolvedValue(mockCreatedShipment);

      const progressCallback = vi.fn();
      await syncFulfillments("merchant-123", false, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith({
        processed: 1,
        total: 1,
        percentage: 100,
      });
    });

    it("should count duplicates correctly", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockGraphQLFulfillmentResponse),
      });
      mockShipmentFindUnique.mockResolvedValue(null);
      mockShipmentFindFirst.mockResolvedValue({
        id: "existing-shipment",
        orderNumber: "#1000",
      }); // Duplicate tracking
      mockShipmentCreate.mockResolvedValue(mockCreatedShipment);

      const result = await syncFulfillments("merchant-123", false);

      expect(result.duplicates).toBe(1);
    });

    it("should build correct query filter for partial sync", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ data: { fulfillments: { edges: [], pageInfo: { hasNextPage: false } } } }),
      });

      await syncFulfillments("merchant-123", false);

      // Check that the query includes date filter
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-shop.myshopify.com/admin/api/2025-01/graphql.json",
        expect.objectContaining({
          body: expect.stringContaining("created_at:>="),
        })
      );
    });

    it("should build empty query filter for full sync", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ data: { fulfillments: { edges: [], pageInfo: { hasNextPage: false } } } }),
      });

      await syncFulfillments("merchant-123", true);

      // Check that the query doesn't include date filter for full sync
      const calls = mockFetch.mock.calls;
      const bodyStr = calls[0][1].body;
      const body = JSON.parse(bodyStr);
      // Full sync should have empty or null query
      expect(body.variables.query === "" || body.variables.query === null).toBe(true);
    });

    it("should handle GraphQL errors gracefully", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);

      const errorResponse = {
        errors: [{ message: "Internal server error" }],
        data: {
          fulfillments: {
            edges: [],
            pageInfo: { hasNextPage: false },
          },
        },
      };

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(errorResponse),
      });

      // Should not throw, should complete with 0 results
      const result = await syncFulfillments("merchant-123", false);
      expect(result.total).toBe(0);
    });

    it("should handle rate limit errors with retry", async () => {
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);
      mockLoadSession.mockResolvedValue(mockSession);

      const rateLimitResponse = {
        errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
      };

      // First call: rate limited, second call: success
      mockFetch
        .mockResolvedValueOnce({ json: () => Promise.resolve(rateLimitResponse) })
        .mockResolvedValueOnce({ json: () => Promise.resolve(mockGraphQLFulfillmentResponse) });

      mockShipmentFindUnique.mockResolvedValue(null);
      mockShipmentFindFirst.mockResolvedValue(null);
      mockShipmentCreate.mockResolvedValue(mockCreatedShipment);

      // Use real timers for setTimeout to work
      vi.useRealTimers();

      const result = await syncFulfillments("merchant-123", false);

      expect(result.total).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("getSyncStatus", () => {
    it("should return sync status with counts", async () => {
      mockShipmentGroupBy.mockResolvedValue([
        { isDelayed: false, _count: 10 },
        { isDelayed: true, _count: 3 },
      ]);
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);

      const result = await getSyncStatus("merchant-123");

      expect(result.totalShipments).toBe(13);
      expect(result.delayedShipments).toBe(3);
      expect(result.lastSyncedAt).toEqual(mockMerchant.updatedAt);
    });

    it("should handle empty shipments", async () => {
      mockShipmentGroupBy.mockResolvedValue([]);
      mockMerchantFindUnique.mockResolvedValue(mockMerchant);

      const result = await getSyncStatus("merchant-123");

      expect(result.totalShipments).toBe(0);
      expect(result.delayedShipments).toBe(0);
    });

    it("should return null lastSyncedAt when merchant not found", async () => {
      mockShipmentGroupBy.mockResolvedValue([]);
      mockMerchantFindUnique.mockResolvedValue(null);

      const result = await getSyncStatus("merchant-123");

      expect(result.lastSyncedAt).toBeNull();
    });
  });
});
