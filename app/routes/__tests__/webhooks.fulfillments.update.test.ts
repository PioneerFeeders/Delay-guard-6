import { describe, it, expect, vi, beforeEach } from "vitest";

// Import modules after mocking
import { authenticate } from "~/shopify.server";
import { getMerchantByShopId } from "~/services/merchant.service";
import {
  updateShipmentFromFulfillment,
  createShipmentFromFulfillment,
  getShipmentByFulfillmentId,
} from "~/services/shipment.service";
import { enqueuePollJob } from "~/queue.server";
import { action } from "../webhooks.fulfillments.update";

// Mock all external dependencies
vi.mock("~/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

vi.mock("~/services/merchant.service", () => ({
  getMerchantByShopId: vi.fn(),
}));

vi.mock("~/services/shipment.service", () => ({
  updateShipmentFromFulfillment: vi.fn(),
  createShipmentFromFulfillment: vi.fn(),
  getShipmentByFulfillmentId: vi.fn(),
}));

vi.mock("~/queue.server", () => ({
  enqueuePollJob: vi.fn(),
}));

const mockWebhookAuth = authenticate.webhook as ReturnType<typeof vi.fn>;
const mockGetMerchant = getMerchantByShopId as ReturnType<typeof vi.fn>;
const mockUpdateShipment = updateShipmentFromFulfillment as ReturnType<typeof vi.fn>;
const mockCreateShipment = createShipmentFromFulfillment as ReturnType<typeof vi.fn>;
const mockGetShipmentByFulfillmentId = getShipmentByFulfillmentId as ReturnType<typeof vi.fn>;
const mockEnqueuePollJob = enqueuePollJob as ReturnType<typeof vi.fn>;

describe("webhooks.fulfillments.update action", () => {
  const mockShop = "test-shop.myshopify.com";
  const mockMerchant = {
    id: "merchant-123",
    shopifyShopId: mockShop,
    billingStatus: "ACTIVE",
    shopFrozen: false,
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

  const mockExistingShipment = {
    id: "shipment-123",
    carrier: "UPS",
    orderNumber: "#1001",
    trackingNumber: "1Z999AA10123456784",
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
    mockGetShipmentByFulfillmentId.mockResolvedValue(mockExistingShipment);
    mockUpdateShipment.mockResolvedValue(mockExistingShipment);
    mockEnqueuePollJob.mockResolvedValue(undefined);

    // Mock GraphQL responses for order fetch
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
        },
      }),
    });
  });

  function createRequest(): Request {
    return new Request("http://localhost/webhooks/fulfillments/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mockFulfillmentPayload),
    });
  }

  describe("updating existing shipment", () => {
    it("should return 200 and update existing shipment", async () => {
      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockUpdateShipment).toHaveBeenCalledWith(
        "merchant-123",
        mockFulfillmentPayload
      );
    });

    it("should not enqueue poll job when tracking number unchanged", async () => {
      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });

    it("should enqueue poll job when tracking number changes", async () => {
      // Existing shipment has different tracking number
      mockGetShipmentByFulfillmentId.mockResolvedValue({
        ...mockExistingShipment,
        trackingNumber: "DIFFERENT_NUMBER",
      });

      mockUpdateShipment.mockResolvedValue({
        ...mockExistingShipment,
        trackingNumber: "1Z999AA10123456784",
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).toHaveBeenCalledWith("shipment-123");
    });

    it("should enqueue poll job when tracking number added to previously empty shipment", async () => {
      // Existing shipment had no tracking number
      mockGetShipmentByFulfillmentId.mockResolvedValue({
        ...mockExistingShipment,
        trackingNumber: null,
      });

      mockUpdateShipment.mockResolvedValue({
        ...mockExistingShipment,
        trackingNumber: "1Z999AA10123456784",
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).toHaveBeenCalledWith("shipment-123");
    });

    it("should not enqueue poll job for UNKNOWN carrier", async () => {
      mockGetShipmentByFulfillmentId.mockResolvedValue({
        ...mockExistingShipment,
        trackingNumber: null,
      });

      mockUpdateShipment.mockResolvedValue({
        ...mockExistingShipment,
        trackingNumber: "1Z999AA10123456784",
        carrier: "UNKNOWN",
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });
  });

  describe("creating shipment when not found", () => {
    it("should create new shipment if not found", async () => {
      mockGetShipmentByFulfillmentId.mockResolvedValue(null);
      mockCreateShipment.mockResolvedValue({
        shipment: { id: "new-shipment-123", carrier: "UPS", orderNumber: "#1001" },
        isNew: true,
        isDuplicate: false,
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockCreateShipment).toHaveBeenCalled();
      expect(mockEnqueuePollJob).toHaveBeenCalledWith("new-shipment-123");
    });

    it("should not enqueue poll job for new shipment with UNKNOWN carrier", async () => {
      mockGetShipmentByFulfillmentId.mockResolvedValue(null);
      mockCreateShipment.mockResolvedValue({
        shipment: { id: "new-shipment-123", carrier: "UNKNOWN", orderNumber: "#1001" },
        isNew: true,
        isDuplicate: false,
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockCreateShipment).toHaveBeenCalled();
      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });

    it("should not enqueue poll job for new shipment without tracking number", async () => {
      mockGetShipmentByFulfillmentId.mockResolvedValue(null);
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
        shipment: { id: "new-shipment-123", carrier: "UNKNOWN", orderNumber: "#1001" },
        isNew: true,
        isDuplicate: false,
      });

      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockCreateShipment).toHaveBeenCalled();
      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });
  });

  describe("merchant validation", () => {
    it("should return 200 if merchant not found", async () => {
      mockGetMerchant.mockResolvedValue(null);

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockUpdateShipment).not.toHaveBeenCalled();
    });

    it("should skip update for cancelled merchant", async () => {
      mockGetMerchant.mockResolvedValue({
        ...mockMerchant,
        billingStatus: "CANCELLED",
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockUpdateShipment).not.toHaveBeenCalled();
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
      expect(mockUpdateShipment).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("should return 200 on error (prevents infinite retries)", async () => {
      mockUpdateShipment.mockRejectedValue(new Error("Database error"));

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
    });

    it("should handle update failure gracefully", async () => {
      mockUpdateShipment.mockResolvedValue(null);

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockEnqueuePollJob).not.toHaveBeenCalled();
    });
  });
});
