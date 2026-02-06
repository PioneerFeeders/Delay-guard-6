import { describe, it, expect, vi, beforeEach } from "vitest";

// Import modules after mocking
import { authenticate } from "~/shopify.server";
import { getMerchantByShopId } from "~/services/merchant.service";
import { createShipmentFromFulfillment } from "~/services/shipment.service";
import { checkPlanLimit, getDowngradeInfo } from "~/services/billing.service";
import { enqueuePollJob } from "~/queue.server";
import { action } from "../webhooks.fulfillments.create";

// Mock all external dependencies
vi.mock("~/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({
  prisma: {},
}));

vi.mock("~/services/merchant.service", () => ({
  getMerchantByShopId: vi.fn(),
}));

vi.mock("~/services/shipment.service", () => ({
  createShipmentFromFulfillment: vi.fn(),
  checkDuplicateTrackingNumber: vi.fn(),
}));

vi.mock("~/services/billing.service", () => ({
  checkPlanLimit: vi.fn(),
  getDowngradeInfo: vi.fn(),
}));

vi.mock("~/queue.server", () => ({
  enqueuePollJob: vi.fn(),
}));

const mockWebhookAuth = authenticate.webhook as ReturnType<typeof vi.fn>;
const mockGetMerchant = getMerchantByShopId as ReturnType<typeof vi.fn>;
const mockCreateShipment = createShipmentFromFulfillment as ReturnType<typeof vi.fn>;
const mockCheckPlanLimit = checkPlanLimit as ReturnType<typeof vi.fn>;
const mockGetDowngradeInfo = getDowngradeInfo as ReturnType<typeof vi.fn>;
const mockEnqueuePollJob = enqueuePollJob as ReturnType<typeof vi.fn>;

describe("webhooks.fulfillments.create action", () => {
  const mockShop = "test-shop.myshopify.com";
  const mockMerchant = {
    id: "merchant-123",
    shopifyShopId: mockShop,
    billingStatus: "ACTIVE",
    shopFrozen: false,
    installedAt: new Date(),
    planTier: "STARTER",
    settings: {},
  };

  const mockFulfillmentPayload = {
    id: 12345678901234,
    order_id: 98765432109876,
    status: "success",
    created_at: "2026-02-05T10:00:00Z",
    tracking_company: "UPS",
    tracking_number: "1Z999AA10123456784",
    tracking_numbers: ["1Z999AA10123456784"],
    tracking_url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    tracking_urls: ["https://www.ups.com/track?tracknum=1Z999AA10123456784"],
    destination: {
      first_name: "John",
      last_name: "Doe",
      address1: "123 Main St",
      city: "New York",
      province: "NY",
      country: "US",
      zip: "10001",
    },
  };

  const mockGraphQL = vi.fn();
  const mockAdmin = {
    graphql: mockGraphQL,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful mocks
    mockWebhookAuth.mockResolvedValue({
      shop: mockShop,
      payload: mockFulfillmentPayload,
      admin: mockAdmin,
    });

    mockGetMerchant.mockResolvedValue(mockMerchant);

    mockCheckPlanLimit.mockResolvedValue({
      allowed: true,
      usage: { used: 50, limit: 100, isAtLimit: false, percentUsed: 50, remaining: 50 },
    });

    mockGetDowngradeInfo.mockResolvedValue({
      isDowngrade: false,
      canCreateNewShipment: true,
    });

    mockCreateShipment.mockResolvedValue({
      shipment: {
        id: "shipment-123",
        carrier: "UPS",
        orderNumber: "#1001",
        trackingNumber: "1Z999AA10123456784",
      },
      isNew: true,
      isDuplicate: false,
    });

    mockEnqueuePollJob.mockResolvedValue(undefined);

    // Mock GraphQL responses
    mockGraphQL.mockResolvedValue({
      json: () => Promise.resolve({
        data: {
          order: {
            name: "#1001",
            email: "customer@example.com",
            phone: "+15551234567",
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
              city: "New York",
              province: "NY",
              provinceCode: "NY",
              country: "US",
              countryCode: "US",
              zip: "10001",
              phone: null,
              company: null,
            },
            customer: {
              legacyResourceId: "123456789",
              email: "customer@example.com",
              phone: "+15551234567",
              firstName: "John",
              lastName: "Doe",
            },
          },
          location: {
            name: "Main Warehouse",
          },
        },
      }),
    });
  });

  function createRequest(): Request {
    return new Request("http://localhost/webhooks/fulfillments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mockFulfillmentPayload),
    });
  }

  describe("successful webhook processing", () => {
    it("should return 200 and create shipment for valid fulfillment", async () => {
      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: "merchant-123",
          fulfillment: mockFulfillmentPayload,
        })
      );
    });

    it("should enqueue poll job for new shipment with known carrier", async () => {
      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).toHaveBeenCalledWith("shipment-123");
    });

    it("should not enqueue poll job for UNKNOWN carrier", async () => {
      mockCreateShipment.mockResolvedValue({
        shipment: { id: "shipment-123", carrier: "UNKNOWN", orderNumber: "#1001" },
        isNew: true,
        isDuplicate: false,
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });

    it("should not enqueue poll job for existing shipment", async () => {
      mockCreateShipment.mockResolvedValue({
        shipment: { id: "shipment-123", carrier: "UPS", orderNumber: "#1001" },
        isNew: false,
        isDuplicate: false,
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });

    it("should still create shipment for duplicate tracking number", async () => {
      mockCreateShipment.mockResolvedValue({
        shipment: { id: "shipment-123", carrier: "UPS", orderNumber: "#1001" },
        isNew: true,
        isDuplicate: true,
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalled();
      expect(mockEnqueuePollJob).toHaveBeenCalled();
    });
  });

  describe("merchant validation", () => {
    it("should return 200 if merchant not found", async () => {
      mockGetMerchant.mockResolvedValue(null);

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).not.toHaveBeenCalled();
    });

    it("should skip shipment creation for cancelled merchant", async () => {
      mockGetMerchant.mockResolvedValue({
        ...mockMerchant,
        billingStatus: "CANCELLED",
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).not.toHaveBeenCalled();
    });

    it("should skip shipment creation for frozen shop", async () => {
      mockGetMerchant.mockResolvedValue({
        ...mockMerchant,
        shopFrozen: true,
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).not.toHaveBeenCalled();
    });
  });

  describe("plan limit handling", () => {
    it("should still create shipment when at plan limit", async () => {
      mockCheckPlanLimit.mockResolvedValue({
        allowed: false,
        reason: "Plan limit reached (100/100)",
        usage: { used: 100, limit: 100, isAtLimit: true, percentUsed: 100, remaining: 0 },
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      // Shipment is still created - enforcement happens in carrier-poll worker
      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalled();
    });

    it("should still create shipment for downgraded merchant", async () => {
      mockGetDowngradeInfo.mockResolvedValue({
        isDowngrade: true,
        canCreateNewShipment: false,
        previousLimit: 500,
        newLimit: 100,
        message: "You've downgraded from Professional to Starter",
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalled();
    });
  });

  describe("payload validation", () => {
    it("should return 200 for invalid payload (prevents retries)", async () => {
      // Suppress console.error output
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockWebhookAuth.mockResolvedValue({
        shop: mockShop,
        payload: { invalid: "data" },
        admin: mockAdmin,
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("fulfillment without tracking number", () => {
    it("should create pending shipment when no tracking number", async () => {
      mockWebhookAuth.mockResolvedValue({
        shop: mockShop,
        payload: {
          ...mockFulfillmentPayload,
          tracking_number: null,
          tracking_numbers: [],
        },
        admin: mockAdmin,
      });

      mockCreateShipment.mockResolvedValue({
        shipment: { id: "shipment-123", carrier: "UNKNOWN", orderNumber: "#1001" },
        isNew: true,
        isDuplicate: false,
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalled();
      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should return 200 on error (prevents infinite retries)", async () => {
      mockCreateShipment.mockRejectedValue(new Error("Database error"));

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
    });

    it("should handle order fetch failure gracefully", async () => {
      mockGraphQL.mockResolvedValue({
        json: () => Promise.resolve({ data: { order: null } }),
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      // Should still create shipment with fallback order data
      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalled();
    });
  });
});
