import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import after mock setup
import { prisma } from "~/db.server";
import {
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_PRICES,
  getPlanFeatures,
  hasFeature,
  getCurrentBillingCycle,
  getCurrentUsage,
  canTrackNewShipment,
  canRecordFirstScan,
  checkPlanLimit,
  getBillingInfo,
  isValidPlanTier,
  planNameToTier,
  tierToPlanName,
  getAllPlans,
  isDowngrade,
  getDowngradeInfo,
} from "../billing.service";

// Mock Prisma - must use inline values since vi.mock is hoisted
vi.mock("~/db.server", () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn(),
    },
    shipment: {
      count: vi.fn(),
    },
  },
}));

// Get typed mocks
const mockFindUnique = prisma.merchant.findUnique as ReturnType<typeof vi.fn>;
const mockShipmentCount = prisma.shipment.count as ReturnType<typeof vi.fn>;

describe("billing.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("PLAN_LIMITS", () => {
    it("should have correct limits for each tier", () => {
      expect(PLAN_LIMITS.STARTER).toBe(100);
      expect(PLAN_LIMITS.PROFESSIONAL).toBe(500);
      expect(PLAN_LIMITS.BUSINESS).toBe(2000);
      expect(PLAN_LIMITS.ENTERPRISE).toBe(Infinity);
    });
  });

  describe("PLAN_NAMES", () => {
    it("should have correct names for each tier", () => {
      expect(PLAN_NAMES.STARTER).toBe("Starter");
      expect(PLAN_NAMES.PROFESSIONAL).toBe("Professional");
      expect(PLAN_NAMES.BUSINESS).toBe("Business");
      expect(PLAN_NAMES.ENTERPRISE).toBe("Enterprise");
    });
  });

  describe("PLAN_PRICES", () => {
    it("should have correct prices for each tier", () => {
      expect(PLAN_PRICES.STARTER).toBe(9.99);
      expect(PLAN_PRICES.PROFESSIONAL).toBe(29.99);
      expect(PLAN_PRICES.BUSINESS).toBe(79.99);
      expect(PLAN_PRICES.ENTERPRISE).toBe(149.99);
    });
  });

  describe("getPlanFeatures", () => {
    it("should return correct features for STARTER plan", () => {
      const features = getPlanFeatures("STARTER");

      expect(features.dashboard).toBe(true);
      expect(features.manualNotifications).toBe(true);
      expect(features.multiCarrierDisplay).toBe(false);
      expect(features.basicFiltering).toBe(true);
      expect(features.fullFiltering).toBe(false);
      expect(features.bulkActions).toBe(false);
      expect(features.csvExport).toBe(false);
      expect(features.analyticsMetrics).toBe(false);
      expect(features.priorityPolling).toBe(false);
    });

    it("should return correct features for PROFESSIONAL plan", () => {
      const features = getPlanFeatures("PROFESSIONAL");

      expect(features.dashboard).toBe(true);
      expect(features.manualNotifications).toBe(true);
      expect(features.multiCarrierDisplay).toBe(true);
      expect(features.basicFiltering).toBe(true);
      expect(features.fullFiltering).toBe(true);
      expect(features.bulkActions).toBe(true);
      expect(features.csvExport).toBe(true);
      expect(features.analyticsMetrics).toBe(false);
      expect(features.priorityPolling).toBe(false);
    });

    it("should return correct features for BUSINESS plan", () => {
      const features = getPlanFeatures("BUSINESS");

      expect(features.dashboard).toBe(true);
      expect(features.manualNotifications).toBe(true);
      expect(features.multiCarrierDisplay).toBe(true);
      expect(features.basicFiltering).toBe(true);
      expect(features.fullFiltering).toBe(true);
      expect(features.bulkActions).toBe(true);
      expect(features.csvExport).toBe(true);
      expect(features.analyticsMetrics).toBe(true);
      expect(features.priorityPolling).toBe(true);
    });

    it("should return correct features for ENTERPRISE plan", () => {
      const features = getPlanFeatures("ENTERPRISE");

      expect(features.dashboard).toBe(true);
      expect(features.manualNotifications).toBe(true);
      expect(features.multiCarrierDisplay).toBe(true);
      expect(features.basicFiltering).toBe(true);
      expect(features.fullFiltering).toBe(true);
      expect(features.bulkActions).toBe(true);
      expect(features.csvExport).toBe(true);
      expect(features.analyticsMetrics).toBe(true);
      expect(features.priorityPolling).toBe(true);
    });
  });

  describe("hasFeature", () => {
    it("should correctly check feature availability", () => {
      expect(hasFeature("STARTER", "bulkActions")).toBe(false);
      expect(hasFeature("PROFESSIONAL", "bulkActions")).toBe(true);
      expect(hasFeature("STARTER", "analyticsMetrics")).toBe(false);
      expect(hasFeature("BUSINESS", "analyticsMetrics")).toBe(true);
    });
  });

  describe("getCurrentBillingCycle", () => {
    it("should return first cycle for recently installed merchant", () => {
      const installedAt = new Date("2026-02-01T10:00:00Z");
      const now = new Date("2026-02-15T10:00:00Z");

      const cycle = getCurrentBillingCycle(installedAt, now);

      expect(cycle.start.getTime()).toBe(installedAt.getTime());
      expect(cycle.end.getTime()).toBe(
        installedAt.getTime() + 30 * 24 * 60 * 60 * 1000
      );
    });

    it("should return second cycle for merchant installed 31 days ago", () => {
      const installedAt = new Date("2026-01-01T10:00:00Z");
      const now = new Date("2026-02-01T10:00:00Z"); // 31 days later

      const cycle = getCurrentBillingCycle(installedAt, now);

      // Should be in the second cycle (day 31-60)
      const expectedStart = new Date(
        installedAt.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      expect(cycle.start.getTime()).toBe(expectedStart.getTime());
    });

    it("should handle exact cycle boundary", () => {
      const installedAt = new Date("2026-01-01T00:00:00Z");
      const now = new Date("2026-01-31T00:00:00Z"); // Exactly 30 days later

      const cycle = getCurrentBillingCycle(installedAt, now);

      // Should be in the second cycle
      const expectedStart = new Date(
        installedAt.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      expect(cycle.start.getTime()).toBe(expectedStart.getTime());
    });

    it("should calculate third cycle correctly", () => {
      const installedAt = new Date("2026-01-01T00:00:00Z");
      const now = new Date("2026-03-05T00:00:00Z"); // 63 days later

      const cycle = getCurrentBillingCycle(installedAt, now);

      // Should be in the third cycle (day 61-90)
      const expectedStart = new Date(
        installedAt.getTime() + 2 * 30 * 24 * 60 * 60 * 1000
      );
      expect(cycle.start.getTime()).toBe(expectedStart.getTime());
    });
  });

  describe("getCurrentUsage", () => {
    it("should return usage count for shipments with carrier scans", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(50);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const usage = await getCurrentUsage(merchantId, installedAt);

      expect(usage.used).toBe(50);
      expect(usage.limit).toBe(100);
      expect(usage.isAtLimit).toBe(false);
      expect(usage.percentUsed).toBe(50);
      expect(usage.remaining).toBe(50);
    });

    it("should correctly identify when at limit", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(100);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const usage = await getCurrentUsage(merchantId, installedAt);

      expect(usage.used).toBe(100);
      expect(usage.limit).toBe(100);
      expect(usage.isAtLimit).toBe(true);
      expect(usage.percentUsed).toBe(100);
      expect(usage.remaining).toBe(0);
    });

    it("should correctly identify when over limit", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(150);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const usage = await getCurrentUsage(merchantId, installedAt);

      expect(usage.used).toBe(150);
      expect(usage.limit).toBe(100);
      expect(usage.isAtLimit).toBe(true);
      expect(usage.percentUsed).toBe(100); // Capped at 100
      expect(usage.remaining).toBe(0);
    });

    it("should handle Enterprise plan with unlimited shipments", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(10000);
      mockFindUnique.mockResolvedValue({ planTier: "ENTERPRISE" });

      const usage = await getCurrentUsage(merchantId, installedAt);

      expect(usage.used).toBe(10000);
      expect(usage.limit).toBe(Infinity);
      expect(usage.isAtLimit).toBe(false);
      expect(usage.percentUsed).toBe(0); // No percent for unlimited
      expect(usage.remaining).toBe(Infinity);
    });

    it("should throw error if merchant not found", async () => {
      const merchantId = "nonexistent";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(0);
      mockFindUnique.mockResolvedValue(null);

      await expect(getCurrentUsage(merchantId, installedAt)).rejects.toThrow(
        "Merchant nonexistent not found"
      );
    });

    it("should query shipments with correct criteria", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");
      const now = new Date("2026-01-15T10:00:00Z");

      mockShipmentCount.mockResolvedValue(25);
      mockFindUnique.mockResolvedValue({ planTier: "PROFESSIONAL" });

      // Override Date.now for this test
      vi.useFakeTimers();
      vi.setSystemTime(now);

      await getCurrentUsage(merchantId, installedAt);

      expect(mockShipmentCount).toHaveBeenCalledWith({
        where: {
          merchantId,
          hasCarrierScan: true,
          createdAt: {
            gte: expect.any(Date),
            lt: expect.any(Date),
          },
        },
      });

      vi.useRealTimers();
    });
  });

  describe("canTrackNewShipment", () => {
    it("should return true when under limit", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(50);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const canTrack = await canTrackNewShipment(merchantId, installedAt);

      expect(canTrack).toBe(true);
    });

    it("should return false when at limit", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(100);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const canTrack = await canTrackNewShipment(merchantId, installedAt);

      expect(canTrack).toBe(false);
    });
  });

  describe("canRecordFirstScan", () => {
    it("should return true when under limit", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(99);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const canRecord = await canRecordFirstScan(merchantId, installedAt);

      expect(canRecord).toBe(true);
    });

    it("should return false when at limit", async () => {
      const merchantId = "merchant-123";
      const installedAt = new Date("2026-01-01T10:00:00Z");

      mockShipmentCount.mockResolvedValue(100);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const canRecord = await canRecordFirstScan(merchantId, installedAt);

      expect(canRecord).toBe(false);
    });
  });

  describe("checkPlanLimit", () => {
    it("should return not allowed for cancelled billing", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        billingStatus: "CANCELLED" as const,
        planTier: "STARTER" as const,
      };

      const result = await checkPlanLimit(merchant);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Subscription cancelled");
    });

    it("should return allowed for pending billing under limit", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        billingStatus: "PENDING" as const,
        planTier: "STARTER" as const,
      };

      mockShipmentCount.mockResolvedValue(50);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const result = await checkPlanLimit(merchant);

      expect(result.allowed).toBe(true);
      expect(result.usage).toBeDefined();
      expect(result.usage?.used).toBe(50);
    });

    it("should return allowed for active billing under limit", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        billingStatus: "ACTIVE" as const,
        planTier: "PROFESSIONAL" as const,
      };

      mockShipmentCount.mockResolvedValue(200);
      mockFindUnique.mockResolvedValue({ planTier: "PROFESSIONAL" });

      const result = await checkPlanLimit(merchant);

      expect(result.allowed).toBe(true);
      expect(result.usage?.limit).toBe(500);
    });

    it("should return not allowed when at limit", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        billingStatus: "ACTIVE" as const,
        planTier: "STARTER" as const,
      };

      mockShipmentCount.mockResolvedValue(100);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const result = await checkPlanLimit(merchant);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Plan limit reached");
      expect(result.reason).toContain("100/100");
    });
  });

  describe("getBillingInfo", () => {
    it("should return complete billing info for a merchant", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        billingStatus: "ACTIVE" as const,
        planTier: "PROFESSIONAL" as const,
      };

      mockShipmentCount.mockResolvedValue(250);
      mockFindUnique.mockResolvedValue({ planTier: "PROFESSIONAL" });

      const info = await getBillingInfo(merchant);

      expect(info.planTier).toBe("PROFESSIONAL");
      expect(info.planName).toBe("Professional");
      expect(info.planPrice).toBe(29.99);
      expect(info.billingStatus).toBe("ACTIVE");
      expect(info.usage.used).toBe(250);
      expect(info.usage.limit).toBe(500);
      expect(info.features.bulkActions).toBe(true);
      expect(info.nextPlanTier).toBe("BUSINESS");
      expect(info.nextPlanName).toBe("Business");
      expect(info.nextPlanPrice).toBe(79.99);
      expect(info.nextPlanLimit).toBe(2000);
    });

    it("should return null for next plan when on Enterprise", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        billingStatus: "ACTIVE" as const,
        planTier: "ENTERPRISE" as const,
      };

      mockShipmentCount.mockResolvedValue(5000);
      mockFindUnique.mockResolvedValue({ planTier: "ENTERPRISE" });

      const info = await getBillingInfo(merchant);

      expect(info.nextPlanTier).toBeNull();
      expect(info.nextPlanName).toBeNull();
      expect(info.nextPlanPrice).toBeNull();
      expect(info.nextPlanLimit).toBeNull();
    });
  });

  describe("isValidPlanTier", () => {
    it("should return true for valid plan tiers", () => {
      expect(isValidPlanTier("STARTER")).toBe(true);
      expect(isValidPlanTier("PROFESSIONAL")).toBe(true);
      expect(isValidPlanTier("BUSINESS")).toBe(true);
      expect(isValidPlanTier("ENTERPRISE")).toBe(true);
    });

    it("should return false for invalid plan tiers", () => {
      expect(isValidPlanTier("INVALID")).toBe(false);
      expect(isValidPlanTier("starter")).toBe(false);
      expect(isValidPlanTier("")).toBe(false);
    });
  });

  describe("planNameToTier", () => {
    it("should convert plan names to tiers", () => {
      expect(planNameToTier("Starter")).toBe("STARTER");
      expect(planNameToTier("Professional")).toBe("PROFESSIONAL");
      expect(planNameToTier("Business")).toBe("BUSINESS");
      expect(planNameToTier("Enterprise")).toBe("ENTERPRISE");
    });

    it("should handle case-insensitive input", () => {
      expect(planNameToTier("starter")).toBe("STARTER");
      expect(planNameToTier("PROFESSIONAL")).toBe("PROFESSIONAL");
      expect(planNameToTier("bUsInEsS")).toBe("BUSINESS");
    });

    it("should return null for invalid names", () => {
      expect(planNameToTier("Invalid")).toBeNull();
      expect(planNameToTier("")).toBeNull();
      expect(planNameToTier("Free")).toBeNull();
    });
  });

  describe("tierToPlanName", () => {
    it("should convert tiers to display names", () => {
      expect(tierToPlanName("STARTER")).toBe("Starter");
      expect(tierToPlanName("PROFESSIONAL")).toBe("Professional");
      expect(tierToPlanName("BUSINESS")).toBe("Business");
      expect(tierToPlanName("ENTERPRISE")).toBe("Enterprise");
    });
  });

  describe("getAllPlans", () => {
    it("should return all plans in order", () => {
      const plans = getAllPlans();

      expect(plans).toHaveLength(4);
      expect(plans[0].tier).toBe("STARTER");
      expect(plans[1].tier).toBe("PROFESSIONAL");
      expect(plans[2].tier).toBe("BUSINESS");
      expect(plans[3].tier).toBe("ENTERPRISE");
    });

    it("should mark Professional as popular", () => {
      const plans = getAllPlans();

      expect(plans[0].isPopular).toBeFalsy();
      expect(plans[1].isPopular).toBe(true);
      expect(plans[2].isPopular).toBeFalsy();
      expect(plans[3].isPopular).toBeFalsy();
    });

    it("should include correct details for each plan", () => {
      const plans = getAllPlans();

      const starter = plans.find((p) => p.tier === "STARTER");
      expect(starter?.name).toBe("Starter");
      expect(starter?.price).toBe(9.99);
      expect(starter?.limit).toBe(100);
      expect(starter?.features.bulkActions).toBe(false);

      const business = plans.find((p) => p.tier === "BUSINESS");
      expect(business?.name).toBe("Business");
      expect(business?.price).toBe(79.99);
      expect(business?.limit).toBe(2000);
      expect(business?.features.analyticsMetrics).toBe(true);
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
  });

  describe("getDowngradeInfo", () => {
    it("should identify downgrade situation", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        planTier: "STARTER" as const,
        previousPlanTier: "PROFESSIONAL" as const,
      };

      mockShipmentCount.mockResolvedValue(150);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const info = await getDowngradeInfo(merchant);

      expect(info.isDowngrade).toBe(true);
      expect(info.previousTier).toBe("PROFESSIONAL");
      expect(info.previousLimit).toBe(500);
      expect(info.newLimit).toBe(100);
      expect(info.activeShipmentCount).toBe(150);
      expect(info.canCreateNewShipment).toBe(false);
      expect(info.message).toContain("downgraded");
    });

    it("should allow new shipments if under new limit after downgrade", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        planTier: "STARTER" as const,
        previousPlanTier: "PROFESSIONAL" as const,
      };

      mockShipmentCount.mockResolvedValue(50);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const info = await getDowngradeInfo(merchant);

      expect(info.isDowngrade).toBe(true);
      expect(info.canCreateNewShipment).toBe(true);
      expect(info.message).toContain("50 shipments remaining");
    });

    it("should not flag as downgrade when there is no previous tier", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        planTier: "STARTER" as const,
        previousPlanTier: null,
      };

      mockShipmentCount.mockResolvedValue(50);
      mockFindUnique.mockResolvedValue({ planTier: "STARTER" });

      const info = await getDowngradeInfo(merchant);

      expect(info.isDowngrade).toBe(false);
      expect(info.previousTier).toBeNull();
      expect(info.message).toBeNull();
    });

    it("should not flag as downgrade when upgrading", async () => {
      const merchant = {
        id: "merchant-123",
        installedAt: new Date("2026-01-01T10:00:00Z"),
        planTier: "PROFESSIONAL" as const,
        previousPlanTier: "STARTER" as const,
      };

      mockShipmentCount.mockResolvedValue(50);
      mockFindUnique.mockResolvedValue({ planTier: "PROFESSIONAL" });

      const info = await getDowngradeInfo(merchant);

      expect(info.isDowngrade).toBe(false);
      expect(info.message).toBeNull();
    });
  });
});
