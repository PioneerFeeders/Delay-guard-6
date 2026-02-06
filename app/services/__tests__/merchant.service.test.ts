import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_MERCHANT_SETTINGS } from "~/lib/validation";

// Import after mock setup
import { prisma } from "~/db.server";
import {
  generateRandomPollOffset,
  parseMerchantSettings,
  createOrUpdateMerchant,
  getMerchantByShopId,
  getMerchantById,
  updateMerchantSettings,
  completeOnboarding,
  updateMerchantBilling,
  markMerchantUninstalled,
  updateShopStatus,
  updateMerchantPlanTier,
  isDowngrade,
  getActiveMerchantIds,
} from "../merchant.service";

// Mock Prisma - must use inline values since vi.mock is hoisted
vi.mock("~/db.server", () => ({
  prisma: {
    merchant: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Get typed mocks
const mockUpsert = prisma.merchant.upsert as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.merchant.findUnique as ReturnType<typeof vi.fn>;
const mockFindUniqueOrThrow = prisma.merchant.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.merchant.findMany as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.merchant.update as ReturnType<typeof vi.fn>;

describe("merchant.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("generateRandomPollOffset", () => {
    it("should generate a number between 0 and 239", () => {
      // Run multiple times to test randomness bounds
      for (let i = 0; i < 100; i++) {
        const offset = generateRandomPollOffset();
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(239);
        expect(Number.isInteger(offset)).toBe(true);
      }
    });
  });

  describe("parseMerchantSettings", () => {
    it("should return default settings for empty object", () => {
      const result = parseMerchantSettings({});
      expect(result).toEqual(DEFAULT_MERCHANT_SETTINGS);
    });

    it("should return default settings for null", () => {
      const result = parseMerchantSettings(null);
      expect(result).toEqual(DEFAULT_MERCHANT_SETTINGS);
    });

    it("should return default settings for undefined", () => {
      const result = parseMerchantSettings(undefined);
      expect(result).toEqual(DEFAULT_MERCHANT_SETTINGS);
    });

    it("should return default settings for invalid JSON", () => {
      const result = parseMerchantSettings("not an object");
      expect(result).toEqual(DEFAULT_MERCHANT_SETTINGS);
    });

    it("should parse valid settings", () => {
      const settings = {
        delayThresholdHours: 12,
        autoArchiveDays: 60,
      };
      const result = parseMerchantSettings(settings);
      expect(result.delayThresholdHours).toBe(12);
      expect(result.autoArchiveDays).toBe(60);
      // Other defaults should be applied
      expect(result.defaultSortColumn).toBe("daysDelayed");
      expect(result.defaultSortDirection).toBe("desc");
    });

    it("should apply defaults for missing fields", () => {
      const settings = {
        delayThresholdHours: 10,
      };
      const result = parseMerchantSettings(settings);
      expect(result.delayThresholdHours).toBe(10);
      expect(result.autoArchiveDays).toBe(30); // default
      expect(result.columnVisibility.length).toBeGreaterThan(0);
    });

    it("should clamp delayThresholdHours within valid range", () => {
      // The schema has min(0) and max(72), so values outside this range
      // should cause validation to fail and use defaults
      const result = parseMerchantSettings({ delayThresholdHours: -1 });
      expect(result.delayThresholdHours).toBe(8); // default

      const result2 = parseMerchantSettings({ delayThresholdHours: 100 });
      expect(result2.delayThresholdHours).toBe(8); // default
    });

    it("should preserve custom notification template", () => {
      const settings = {
        notificationTemplate: {
          subject: "Custom Subject",
          body: "Custom body content",
        },
      };
      const result = parseMerchantSettings(settings);
      expect(result.notificationTemplate.subject).toBe("Custom Subject");
      expect(result.notificationTemplate.body).toBe("Custom body content");
    });

    it("should preserve custom delivery windows", () => {
      const settings = {
        deliveryWindows: {
          ups_ground: 7,
          fedex_ground: 6,
        },
      };
      const result = parseMerchantSettings(settings);
      expect(result.deliveryWindows.ups_ground).toBe(7);
      expect(result.deliveryWindows.fedex_ground).toBe(6);
    });

    it("should preserve custom column order", () => {
      const settings = {
        columnOrder: ["trackingNumber", "orderNumber", "carrier"],
      };
      const result = parseMerchantSettings(settings);
      expect(result.columnOrder).toEqual([
        "trackingNumber",
        "orderNumber",
        "carrier",
      ]);
    });
  });

  describe("createOrUpdateMerchant", () => {
    const mockMerchantBase = {
      id: "merchant-123",
      shopifyShopId: "test-shop.myshopify.com",
      shopDomain: "test-shop.myshopify.com",
      email: "test@example.com",
      timezone: "America/New_York",
      settings: {},
      planTier: "STARTER" as const,
      billingStatus: "PENDING" as const,
      randomPollOffset: 120,
      installedAt: new Date(),
      onboardingDone: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should create a new merchant with default settings", async () => {
      mockUpsert.mockResolvedValue(mockMerchantBase);

      const result = await createOrUpdateMerchant({
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { shopifyShopId: "test-shop.myshopify.com" },
        create: expect.objectContaining({
          shopifyShopId: "test-shop.myshopify.com",
          shopDomain: "test-shop.myshopify.com",
          email: "test@example.com",
          planTier: "STARTER",
          billingStatus: "PENDING",
          onboardingDone: false,
        }),
        update: expect.objectContaining({
          shopDomain: "test-shop.myshopify.com",
          email: "test@example.com",
        }),
      });

      expect(result.id).toBe("merchant-123");
      expect(result.settings).toEqual(DEFAULT_MERCHANT_SETTINGS);
    });

    it("should generate random poll offset for new merchants", async () => {
      mockUpsert.mockResolvedValue(mockMerchantBase);

      await createOrUpdateMerchant({
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
      });

      const createData = mockUpsert.mock.calls[0][0].create;
      expect(createData.randomPollOffset).toBeGreaterThanOrEqual(0);
      expect(createData.randomPollOffset).toBeLessThanOrEqual(239);
    });

    it("should use provided timezone", async () => {
      mockUpsert.mockResolvedValue({
        ...mockMerchantBase,
        timezone: "America/Los_Angeles",
      });

      await createOrUpdateMerchant({
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/Los_Angeles",
      });

      const createData = mockUpsert.mock.calls[0][0].create;
      expect(createData.timezone).toBe("America/Los_Angeles");
    });

    it("should default to America/New_York timezone", async () => {
      mockUpsert.mockResolvedValue(mockMerchantBase);

      await createOrUpdateMerchant({
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
      });

      const createData = mockUpsert.mock.calls[0][0].create;
      expect(createData.timezone).toBe("America/New_York");
    });

    it("should parse stored settings JSON", async () => {
      const customSettings = {
        delayThresholdHours: 12,
        autoArchiveDays: 45,
      };

      mockUpsert.mockResolvedValue({
        ...mockMerchantBase,
        settings: customSettings,
      });

      const result = await createOrUpdateMerchant({
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
      });

      expect(result.settings.delayThresholdHours).toBe(12);
      expect(result.settings.autoArchiveDays).toBe(45);
    });
  });

  describe("getMerchantByShopId", () => {
    it("should return null when merchant not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getMerchantByShopId("nonexistent.myshopify.com");

      expect(result).toBeNull();
    });

    it("should return merchant with parsed settings", async () => {
      const mockMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: { delayThresholdHours: 10 },
        planTier: "STARTER" as const,
        billingStatus: "ACTIVE" as const,
        randomPollOffset: 100,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindUnique.mockResolvedValue(mockMerchant);

      const result = await getMerchantByShopId("test-shop.myshopify.com");

      expect(result).not.toBeNull();
      expect(result?.settings.delayThresholdHours).toBe(10);
      expect(result?.settings.autoArchiveDays).toBe(30); // default
    });
  });

  describe("getMerchantById", () => {
    it("should return null when merchant not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getMerchantById("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should return merchant with parsed settings", async () => {
      const mockMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: {},
        planTier: "PROFESSIONAL" as const,
        billingStatus: "ACTIVE" as const,
        randomPollOffset: 50,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindUnique.mockResolvedValue(mockMerchant);

      const result = await getMerchantById("merchant-123");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("merchant-123");
      expect(result?.settings).toEqual(DEFAULT_MERCHANT_SETTINGS);
    });
  });

  describe("updateMerchantSettings", () => {
    it("should merge new settings with existing", async () => {
      const existingMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: { delayThresholdHours: 8, autoArchiveDays: 30 },
        planTier: "STARTER" as const,
        billingStatus: "ACTIVE" as const,
        randomPollOffset: 100,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindUniqueOrThrow.mockResolvedValue(existingMerchant);
      mockUpdate.mockResolvedValue({
        ...existingMerchant,
        settings: { delayThresholdHours: 12, autoArchiveDays: 30 },
      });

      const result = await updateMerchantSettings("merchant-123", {
        delayThresholdHours: 12,
      });

      expect(result.settings.delayThresholdHours).toBe(12);
      expect(result.settings.autoArchiveDays).toBe(30); // preserved
    });
  });

  describe("completeOnboarding", () => {
    it("should set onboardingDone to true", async () => {
      const mockMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: {},
        planTier: "STARTER" as const,
        billingStatus: "ACTIVE" as const,
        randomPollOffset: 100,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUpdate.mockResolvedValue(mockMerchant);

      const result = await completeOnboarding("merchant-123");

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "merchant-123" },
        data: { onboardingDone: true },
      });
      expect(result.onboardingDone).toBe(true);
    });
  });

  describe("updateMerchantBilling", () => {
    it("should update plan tier and billing status", async () => {
      const mockMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: {},
        planTier: "PROFESSIONAL" as const,
        billingStatus: "ACTIVE" as const,
        randomPollOffset: 100,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUpdate.mockResolvedValue(mockMerchant);

      const result = await updateMerchantBilling(
        "merchant-123",
        "PROFESSIONAL",
        "ACTIVE"
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "merchant-123" },
        data: { planTier: "PROFESSIONAL", billingStatus: "ACTIVE" },
      });
      expect(result.planTier).toBe("PROFESSIONAL");
      expect(result.billingStatus).toBe("ACTIVE");
    });
  });

  describe("markMerchantUninstalled", () => {
    it("should set billing status to CANCELLED", async () => {
      const mockMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: {},
        planTier: "STARTER" as const,
        billingStatus: "CANCELLED" as const,
        randomPollOffset: 100,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUpdate.mockResolvedValue(mockMerchant);

      const result = await markMerchantUninstalled("test-shop.myshopify.com");

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { shopifyShopId: "test-shop.myshopify.com" },
        data: {
          billingStatus: "CANCELLED",
          uninstalledAt: expect.any(Date),
        },
      });
      expect(result?.billingStatus).toBe("CANCELLED");
    });

    it("should return null if merchant not found", async () => {
      mockUpdate.mockRejectedValue(new Error("Record not found"));

      const result = await markMerchantUninstalled(
        "nonexistent.myshopify.com"
      );

      expect(result).toBeNull();
    });
  });

  describe("updateShopStatus", () => {
    it("should update shopFrozen and shopPlanName", async () => {
      mockUpdate.mockResolvedValue({});

      await updateShopStatus("merchant-123", {
        shopFrozen: true,
        shopPlanName: "Basic",
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "merchant-123" },
        data: {
          shopFrozen: true,
          shopPlanName: "Basic",
        },
      });
    });

    it("should set shopFrozen to false for active shops", async () => {
      mockUpdate.mockResolvedValue({});

      await updateShopStatus("merchant-123", {
        shopFrozen: false,
        shopPlanName: "Shopify Plus",
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "merchant-123" },
        data: {
          shopFrozen: false,
          shopPlanName: "Shopify Plus",
        },
      });
    });
  });

  describe("updateMerchantPlanTier", () => {
    it("should update plan tier and track previous tier", async () => {
      const mockMerchant = {
        id: "merchant-123",
        shopifyShopId: "test-shop.myshopify.com",
        shopDomain: "test-shop.myshopify.com",
        email: "test@example.com",
        timezone: "America/New_York",
        settings: {},
        planTier: "PROFESSIONAL" as const,
        previousPlanTier: "STARTER" as const,
        billingStatus: "ACTIVE" as const,
        randomPollOffset: 100,
        installedAt: new Date(),
        onboardingDone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockFindUniqueOrThrow.mockResolvedValue({ planTier: "STARTER" });
      mockUpdate.mockResolvedValue(mockMerchant);

      const result = await updateMerchantPlanTier("merchant-123", "PROFESSIONAL");

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "merchant-123" },
        data: {
          previousPlanTier: "STARTER",
          planTier: "PROFESSIONAL",
          billingStatus: "ACTIVE",
        },
      });
      expect(result.planTier).toBe("PROFESSIONAL");
    });
  });

  describe("isDowngrade", () => {
    it("should return true when downgrading from higher tier", () => {
      expect(isDowngrade("PROFESSIONAL", "STARTER")).toBe(true);
      expect(isDowngrade("ENTERPRISE", "BUSINESS")).toBe(true);
      expect(isDowngrade("BUSINESS", "STARTER")).toBe(true);
    });

    it("should return false when upgrading to higher tier", () => {
      expect(isDowngrade("STARTER", "PROFESSIONAL")).toBe(false);
      expect(isDowngrade("BUSINESS", "ENTERPRISE")).toBe(false);
      expect(isDowngrade("STARTER", "BUSINESS")).toBe(false);
    });

    it("should return false when staying on same tier", () => {
      expect(isDowngrade("STARTER", "STARTER")).toBe(false);
      expect(isDowngrade("PROFESSIONAL", "PROFESSIONAL")).toBe(false);
    });

    it("should return false when previous tier is null", () => {
      expect(isDowngrade(null, "STARTER")).toBe(false);
      expect(isDowngrade(null, "ENTERPRISE")).toBe(false);
    });
  });

  describe("getActiveMerchantIds", () => {
    it("should return merchant IDs for non-frozen, non-cancelled merchants", async () => {
      mockFindMany.mockResolvedValue([
        { id: "merchant-1" },
        { id: "merchant-2" },
        { id: "merchant-3" },
      ]);

      const result = await getActiveMerchantIds();

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          billingStatus: { not: "CANCELLED" },
          shopFrozen: false,
        },
        select: { id: true },
      });
      expect(result).toEqual(["merchant-1", "merchant-2", "merchant-3"]);
    });

    it("should return empty array when no active merchants", async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await getActiveMerchantIds();

      expect(result).toEqual([]);
    });
  });
});
