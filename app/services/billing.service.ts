/**
 * Billing Service
 *
 * Handles plan management, usage counting, limit checks, and feature gating.
 *
 * Key responsibilities:
 * - Track shipment usage per billing cycle
 * - Enforce plan limits (hard stop on new shipments when limit reached)
 * - Feature gating based on plan tier
 * - Support for billing flow with Shopify Billing API
 */

import type { PlanTier, Merchant } from "@prisma/client";
import { prisma } from "~/db.server";

/**
 * Plan tier limits (shipments per month)
 * Enterprise has unlimited shipments
 */
export const PLAN_LIMITS: Record<PlanTier, number> = {
  STARTER: 100,
  PROFESSIONAL: 500,
  BUSINESS: 2000,
  ENTERPRISE: Infinity,
};

/**
 * Plan names for display and Shopify Billing API
 */
export const PLAN_NAMES: Record<PlanTier, string> = {
  STARTER: "Starter",
  PROFESSIONAL: "Professional",
  BUSINESS: "Business",
  ENTERPRISE: "Enterprise",
};

/**
 * Plan prices in USD for display
 */
export const PLAN_PRICES: Record<PlanTier, number> = {
  STARTER: 9.99,
  PROFESSIONAL: 29.99,
  BUSINESS: 79.99,
  ENTERPRISE: 149.99,
};

/**
 * Features gated by plan tier
 */
export interface PlanFeatures {
  dashboard: boolean;
  manualNotifications: boolean;
  multiCarrierDisplay: boolean; // Starter shows single carrier only
  basicFiltering: boolean;
  fullFiltering: boolean; // Professional+ gets full filtering
  bulkActions: boolean; // Professional+
  csvExport: boolean; // Professional+
  analyticsMetrics: boolean; // Business+
  priorityPolling: boolean; // Business+
}

/**
 * Get feature availability for a plan tier
 */
export function getPlanFeatures(planTier: PlanTier): PlanFeatures {
  const features: PlanFeatures = {
    dashboard: true,
    manualNotifications: true,
    multiCarrierDisplay: planTier !== "STARTER",
    basicFiltering: true,
    fullFiltering: planTier !== "STARTER",
    bulkActions: planTier !== "STARTER",
    csvExport: planTier !== "STARTER",
    analyticsMetrics: planTier === "BUSINESS" || planTier === "ENTERPRISE",
    priorityPolling: planTier === "BUSINESS" || planTier === "ENTERPRISE",
  };

  return features;
}

/**
 * Check if a specific feature is available for a plan tier
 */
export function hasFeature(
  planTier: PlanTier,
  feature: keyof PlanFeatures
): boolean {
  return getPlanFeatures(planTier)[feature];
}

/**
 * Billing cycle boundaries for a merchant.
 * Uses installedAt as the start of the first billing cycle,
 * then cycles every 30 days.
 */
export interface BillingCycle {
  start: Date;
  end: Date;
}

/**
 * Calculate the current billing cycle for a merchant.
 * The billing cycle is based on the merchant's installation date,
 * with cycles rolling over every 30 days.
 */
export function getCurrentBillingCycle(
  installedAt: Date,
  now: Date = new Date()
): BillingCycle {
  const installTime = installedAt.getTime();
  const currentTime = now.getTime();
  const msPerCycle = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

  // Calculate how many complete cycles have passed
  const cyclesPassed = Math.floor((currentTime - installTime) / msPerCycle);

  // Calculate current cycle boundaries
  const cycleStartTime = installTime + cyclesPassed * msPerCycle;
  const cycleEndTime = cycleStartTime + msPerCycle;

  return {
    start: new Date(cycleStartTime),
    end: new Date(cycleEndTime),
  };
}

/**
 * Usage information for a merchant's current billing cycle
 */
export interface UsageInfo {
  /** Number of shipments counted toward the plan limit */
  used: number;
  /** Maximum shipments allowed for the plan */
  limit: number;
  /** Whether the merchant is at or over their limit */
  isAtLimit: boolean;
  /** Percentage of limit used (0-100, capped at 100) */
  percentUsed: number;
  /** Number of shipments remaining before hitting limit */
  remaining: number;
  /** Current billing cycle boundaries */
  billingCycle: BillingCycle;
}

/**
 * Get the current usage for a merchant's billing cycle.
 *
 * A shipment counts toward the limit when it has received at least one
 * carrier scan (hasCarrierScan = true). This means:
 * - Shipments without tracking numbers don't count
 * - Shipments that never get picked up don't count
 * - Once a shipment gets its first carrier scan, it counts
 */
export async function getCurrentUsage(
  merchantId: string,
  installedAt: Date
): Promise<UsageInfo> {
  const billingCycle = getCurrentBillingCycle(installedAt);

  // Count shipments with carrier scans in the current billing cycle
  const used = await prisma.shipment.count({
    where: {
      merchantId,
      hasCarrierScan: true,
      createdAt: {
        gte: billingCycle.start,
        lt: billingCycle.end,
      },
    },
  });

  // Get merchant's plan to determine limit
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { planTier: true },
  });

  if (!merchant) {
    throw new Error(`Merchant ${merchantId} not found`);
  }

  const limit = PLAN_LIMITS[merchant.planTier];
  const isAtLimit = used >= limit;
  const percentUsed = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);

  return {
    used,
    limit,
    isAtLimit,
    percentUsed,
    remaining,
    billingCycle,
  };
}

/**
 * Check if a merchant can track a new shipment.
 * Returns true if they are under their plan limit.
 *
 * Note: This is checked at two points:
 * 1. When a new fulfillment webhook is received (to decide whether to create the shipment)
 * 2. When a shipment gets its first carrier scan (the point at which it actually counts)
 *
 * We allow shipment creation even at limit, but won't count new scans until they upgrade.
 */
export async function canTrackNewShipment(
  merchantId: string,
  installedAt: Date
): Promise<boolean> {
  const usage = await getCurrentUsage(merchantId, installedAt);
  return !usage.isAtLimit;
}

/**
 * Check if a merchant can record a first carrier scan for a shipment.
 * This is called when hasCarrierScan transitions from false to true.
 */
export async function canRecordFirstScan(
  merchantId: string,
  installedAt: Date
): Promise<boolean> {
  const usage = await getCurrentUsage(merchantId, installedAt);
  return !usage.isAtLimit;
}

/**
 * Result of a plan limit check
 */
export interface PlanLimitCheckResult {
  allowed: boolean;
  reason?: string;
  usage?: UsageInfo;
}

/**
 * Comprehensive check for whether a merchant can create/track a new shipment.
 * Provides detailed information about the result.
 */
export async function checkPlanLimit(
  merchant: Pick<Merchant, "id" | "installedAt" | "billingStatus" | "planTier">
): Promise<PlanLimitCheckResult> {
  // Check billing status first
  if (merchant.billingStatus === "CANCELLED") {
    return {
      allowed: false,
      reason: "Subscription cancelled",
    };
  }

  // Pending billing is allowed (new merchants in onboarding)
  // They can use the Starter plan features until they upgrade

  const usage = await getCurrentUsage(merchant.id, merchant.installedAt);

  if (usage.isAtLimit) {
    return {
      allowed: false,
      reason: `Plan limit reached (${usage.used}/${usage.limit} shipments). Upgrade to continue tracking new shipments.`,
      usage,
    };
  }

  return {
    allowed: true,
    usage,
  };
}

/**
 * Get display-friendly billing information for the merchant dashboard
 */
export interface BillingInfo {
  planTier: PlanTier;
  planName: string;
  planPrice: number;
  billingStatus: string;
  usage: UsageInfo;
  features: PlanFeatures;
  nextPlanTier: PlanTier | null;
  nextPlanName: string | null;
  nextPlanPrice: number | null;
  nextPlanLimit: number | null;
}

/**
 * Get complete billing information for a merchant
 */
export async function getBillingInfo(
  merchant: Pick<Merchant, "id" | "installedAt" | "billingStatus" | "planTier">
): Promise<BillingInfo> {
  const usage = await getCurrentUsage(merchant.id, merchant.installedAt);
  const features = getPlanFeatures(merchant.planTier);

  // Determine next plan tier for upgrade prompt
  const planOrder: PlanTier[] = ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"];
  const currentIndex = planOrder.indexOf(merchant.planTier);
  const nextPlanTier = currentIndex < planOrder.length - 1 ? planOrder[currentIndex + 1] : null;

  return {
    planTier: merchant.planTier,
    planName: PLAN_NAMES[merchant.planTier],
    planPrice: PLAN_PRICES[merchant.planTier],
    billingStatus: merchant.billingStatus,
    usage,
    features,
    nextPlanTier,
    nextPlanName: nextPlanTier ? PLAN_NAMES[nextPlanTier] : null,
    nextPlanPrice: nextPlanTier ? PLAN_PRICES[nextPlanTier] : null,
    nextPlanLimit: nextPlanTier ? PLAN_LIMITS[nextPlanTier] : null,
  };
}

/**
 * Validate that a plan tier is valid
 */
export function isValidPlanTier(tier: string): tier is PlanTier {
  return tier in PLAN_LIMITS;
}

/**
 * Check if a plan change is a downgrade
 */
export function isDowngrade(previousTier: PlanTier, newTier: PlanTier): boolean {
  const tierOrder: PlanTier[] = ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"];
  const prevIndex = tierOrder.indexOf(previousTier);
  const newIndex = tierOrder.indexOf(newTier);
  return newIndex < prevIndex;
}

/**
 * Get the shipment limit for the new plan considering any in-progress shipments
 * that should continue being tracked after a downgrade.
 *
 * When a merchant downgrades:
 * - Existing in-progress shipments continue to be tracked
 * - New shipments are immediately subject to the new plan limits
 */
export interface DowngradeInfo {
  isDowngrade: boolean;
  previousTier: PlanTier | null;
  previousLimit: number | null;
  newLimit: number;
  activeShipmentCount: number;
  canCreateNewShipment: boolean;
  message: string | null;
}

export async function getDowngradeInfo(
  merchant: Pick<Merchant, "id" | "installedAt" | "planTier" | "previousPlanTier">
): Promise<DowngradeInfo> {
  const usage = await getCurrentUsage(merchant.id, merchant.installedAt);

  // Check if this is a downgrade situation
  const wasDowngraded = merchant.previousPlanTier
    ? isDowngrade(merchant.previousPlanTier, merchant.planTier)
    : false;

  const previousLimit = merchant.previousPlanTier
    ? PLAN_LIMITS[merchant.previousPlanTier]
    : null;
  const newLimit = PLAN_LIMITS[merchant.planTier];

  // For downgrades, we allow tracking to continue for existing shipments
  // but new shipments are subject to the new limit
  const canCreateNewShipment = usage.used < newLimit;

  let message: string | null = null;
  if (wasDowngraded) {
    if (usage.used >= newLimit) {
      message = `Your plan was downgraded to ${PLAN_NAMES[merchant.planTier]}. You've reached the new plan limit of ${newLimit} shipments. Existing shipments will continue to be tracked, but new shipments won't be tracked until you upgrade or a new billing cycle begins.`;
    } else {
      message = `Your plan was downgraded to ${PLAN_NAMES[merchant.planTier]}. You have ${newLimit - usage.used} shipments remaining this cycle.`;
    }
  }

  return {
    isDowngrade: wasDowngraded,
    previousTier: merchant.previousPlanTier,
    previousLimit,
    newLimit,
    activeShipmentCount: usage.used,
    canCreateNewShipment,
    message,
  };
}

/**
 * Map Shopify billing plan name to our PlanTier enum
 */
export function planNameToTier(planName: string): PlanTier | null {
  const normalized = planName.toLowerCase();
  if (normalized === "starter") return "STARTER";
  if (normalized === "professional") return "PROFESSIONAL";
  if (normalized === "business") return "BUSINESS";
  if (normalized === "enterprise") return "ENTERPRISE";
  return null;
}

/**
 * Map our PlanTier enum to Shopify billing plan name
 */
export function tierToPlanName(tier: PlanTier): string {
  return PLAN_NAMES[tier];
}

/**
 * Get all available plans for the pricing page
 */
export interface PlanInfo {
  tier: PlanTier;
  name: string;
  price: number;
  limit: number;
  features: PlanFeatures;
  isPopular?: boolean;
}

/**
 * Get information about all available plans
 */
export function getAllPlans(): PlanInfo[] {
  const planOrder: PlanTier[] = ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"];

  return planOrder.map((tier) => ({
    tier,
    name: PLAN_NAMES[tier],
    price: PLAN_PRICES[tier],
    limit: PLAN_LIMITS[tier],
    features: getPlanFeatures(tier),
    isPopular: tier === "PROFESSIONAL", // Mark Professional as popular
  }));
}
