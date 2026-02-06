import { describe, it, expect, vi, beforeEach } from "vitest";

// Import modules after mocking
import { authenticate } from "~/shopify.server";
import { markMerchantUninstalled } from "~/services/merchant.service";
import { getQueue } from "~/queue.server";
import { action } from "../webhooks.app.uninstalled";

// Mock all external dependencies
vi.mock("~/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

vi.mock("~/services/merchant.service", () => ({
  markMerchantUninstalled: vi.fn(),
}));

vi.mock("~/queue.server", () => ({
  getQueue: vi.fn(),
}));

const mockWebhookAuth = authenticate.webhook as ReturnType<typeof vi.fn>;
const mockMarkMerchantUninstalled = markMerchantUninstalled as ReturnType<typeof vi.fn>;
const mockGetQueue = getQueue as ReturnType<typeof vi.fn>;

describe("webhooks.app.uninstalled action", () => {
  const mockShop = "test-shop.myshopify.com";
  const mockMerchant = {
    id: "merchant-123",
    shopifyShopId: mockShop,
    shopDomain: mockShop,
    billingStatus: "CANCELLED",
    uninstalledAt: new Date(),
  };

  const mockAppUninstalledPayload = {
    id: 12345678901234,
    name: "test-shop",
    email: "owner@test-shop.com",
    domain: mockShop,
  };

  const mockQueueAdd = vi.fn();
  const mockQueue = {
    add: mockQueueAdd,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful mocks
    mockWebhookAuth.mockResolvedValue({
      shop: mockShop,
      payload: mockAppUninstalledPayload,
    });

    mockMarkMerchantUninstalled.mockResolvedValue(mockMerchant);
    mockGetQueue.mockReturnValue(mockQueue);
    mockQueueAdd.mockResolvedValue({ id: "purge-job-id" });
  });

  function createRequest(): Request {
    return new Request("http://localhost/webhooks/app/uninstalled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mockAppUninstalledPayload),
    });
  }

  describe("successful uninstall processing", () => {
    it("should return 200 and mark merchant as uninstalled", async () => {
      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockMarkMerchantUninstalled).toHaveBeenCalledWith(mockShop);
    });

    it("should schedule data purge job for 30 days later", async () => {
      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        "purge-merchant",
        expect.objectContaining({
          merchantId: "merchant-123",
          shopDomain: mockShop,
        }),
        expect.objectContaining({
          delay: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
          jobId: "purge-merchant-123",
        })
      );
    });

    it("should use deduplicated jobId for purge job", async () => {
      const request = createRequest();
      await action({ request, context: {}, params: {} });

      expect(mockQueueAdd).toHaveBeenCalledWith(
        "purge-merchant",
        expect.anything(),
        expect.objectContaining({
          jobId: "purge-merchant-123",
        })
      );
    });
  });

  describe("merchant not found", () => {
    it("should return 200 if no merchant found to uninstall", async () => {
      mockMarkMerchantUninstalled.mockResolvedValue(null);

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe("payload validation", () => {
    it("should return 200 for invalid payload (prevents retries)", async () => {
      // Suppress console.error output
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockWebhookAuth.mockResolvedValue({
        shop: mockShop,
        payload: { invalid: "data" },
      });

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
      expect(mockMarkMerchantUninstalled).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("should return 200 on error (prevents infinite retries)", async () => {
      mockMarkMerchantUninstalled.mockRejectedValue(new Error("Database error"));

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
    });

    it("should return 200 if queue add fails", async () => {
      mockQueueAdd.mockRejectedValue(new Error("Redis connection failed"));

      const request = createRequest();
      const response = await action({ request, context: {}, params: {} });

      expect(response.status).toBe(200);
    });
  });
});
