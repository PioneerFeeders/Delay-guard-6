import { prisma } from "~/db.server";
import type { Merchant, PlanTier, BillingStatus } from "@prisma/client";
import {
  MerchantSettingsSchema,
  DEFAULT_MERCHANT_SETTINGS,
  type MerchantSettings,
} from "~/lib/validation";

/**
 * Generate a random poll offset between 0 and 239 minutes.
 * This helps distribute carrier API polling across merchants to prevent thundering herd.
 */
export function generateRandomPollOffset(): number {
  return Math.floor(Math.random() * 240);
}

/**
 * Parse and validate merchant settings from JSON.
 * Returns default settings if parsing fails.
 */
export function parseMerchantSettings(settingsJson: unknown): MerchantSettings {
  try {
    const result = MerchantSettingsSchema.safeParse(settingsJson);
    if (result.success) {
      return result.data;
    }
    console.warn("Invalid merchant settings, using defaults:", result.error);
    return DEFAULT_MERCHANT_SETTINGS;
  } catch {
    return DEFAULT_MERCHANT_SETTINGS;
  }
}

export interface CreateOrUpdateMerchantParams {
  shopifyShopId: string;
  shopDomain: string;
  email: string;
  timezone?: string;
}

export interface MerchantWithSettings extends Omit<Merchant, "settings"> {
  settings: MerchantSettings;
}

/**
 * Create a new merchant record or update an existing one.
 * This is called on first app load after OAuth to ensure merchant record exists.
 *
 * For new merchants:
 * - Generates random poll offset (0-239 minutes) for staggered polling
 * - Sets default settings from MerchantSettingsSchema
 * - Sets initial plan tier to STARTER with PENDING billing status
 *
 * For existing merchants:
 * - Updates shopDomain and email if changed
 * - Does NOT reset poll offset, settings, or billing status
 */
export async function createOrUpdateMerchant(
  params: CreateOrUpdateMerchantParams
): Promise<MerchantWithSettings> {
  const { shopifyShopId, shopDomain, email, timezone } = params;

  const merchant = await prisma.merchant.upsert({
    where: { shopifyShopId },
    create: {
      shopifyShopId,
      shopDomain,
      email,
      timezone: timezone ?? "America/New_York",
      settings: DEFAULT_MERCHANT_SETTINGS as unknown as object,
      planTier: "STARTER",
      billingStatus: "PENDING",
      randomPollOffset: generateRandomPollOffset(),
      onboardingDone: false,
    },
    update: {
      // Only update domain and email - preserve other settings
      shopDomain,
      email,
      // Update timezone if provided
      ...(timezone && { timezone }),
    },
  });

  return {
    ...merchant,
    settings: parseMerchantSettings(merchant.settings),
  };
}

/**
 * Get a merchant by their Shopify shop ID.
 * Returns null if not found.
 */
export async function getMerchantByShopId(
  shopifyShopId: string
): Promise<MerchantWithSettings | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId },
  });

  if (!merchant) {
    return null;
  }

  return {
    ...merchant,
    settings: parseMerchantSettings(merchant.settings),
  };
}

/**
 * Get a merchant by their internal ID.
 * Returns null if not found.
 */
export async function getMerchantById(
  id: string
): Promise<MerchantWithSettings | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { id },
  });

  if (!merchant) {
    return null;
  }

  return {
    ...merchant,
    settings: parseMerchantSettings(merchant.settings),
  };
}

/**
 * Update merchant settings.
 * Merges with existing settings rather than replacing.
 */
export async function updateMerchantSettings(
  merchantId: string,
  settingsUpdate: Partial<MerchantSettings>
): Promise<MerchantWithSettings> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
  });

  const currentSettings = parseMerchantSettings(merchant.settings);
  const newSettings = MerchantSettingsSchema.parse({
    ...currentSettings,
    ...settingsUpdate,
  });

  const updated = await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      settings: newSettings as unknown as object,
    },
  });

  return {
    ...updated,
    settings: newSettings,
  };
}

/**
 * Mark merchant onboarding as complete.
 */
export async function completeOnboarding(
  merchantId: string
): Promise<MerchantWithSettings> {
  const merchant = await prisma.merchant.update({
    where: { id: merchantId },
    data: { onboardingDone: true },
  });

  return {
    ...merchant,
    settings: parseMerchantSettings(merchant.settings),
  };
}

/**
 * Update merchant billing status and plan tier.
 */
export async function updateMerchantBilling(
  merchantId: string,
  planTier: PlanTier,
  billingStatus: BillingStatus
): Promise<MerchantWithSettings> {
  const merchant = await prisma.merchant.update({
    where: { id: merchantId },
    data: { planTier, billingStatus },
  });

  return {
    ...merchant,
    settings: parseMerchantSettings(merchant.settings),
  };
}

/**
 * Mark a merchant as uninstalled (for cleanup scheduling).
 * Sets billing status to CANCELLED and records uninstalledAt timestamp.
 */
export async function markMerchantUninstalled(
  shopifyShopId: string
): Promise<Merchant | null> {
  try {
    return await prisma.merchant.update({
      where: { shopifyShopId },
      data: {
        billingStatus: "CANCELLED",
        uninstalledAt: new Date(),
      },
    });
  } catch {
    // Merchant may not exist if they never completed install
    return null;
  }
}

/**
 * Delete a merchant and all associated data.
 * Used during data purge after retention period.
 */
export async function deleteMerchant(merchantId: string): Promise<void> {
  // Prisma cascade delete will remove all related records
  await prisma.merchant.delete({
    where: { id: merchantId },
  });
}

/**
 * Update shop status (frozen/paused state and plan name).
 * Called on each app load to keep status current.
 */
export interface ShopStatusUpdate {
  shopFrozen: boolean;
  shopPlanName: string | null;
}

export async function updateShopStatus(
  merchantId: string,
  status: ShopStatusUpdate
): Promise<void> {
  await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      shopFrozen: status.shopFrozen,
      shopPlanName: status.shopPlanName,
    },
  });
}

/**
 * Update merchant plan tier when they change plans.
 * Tracks previous plan tier for downgrade handling.
 */
export async function updateMerchantPlanTier(
  merchantId: string,
  newPlanTier: PlanTier
): Promise<MerchantWithSettings> {
  const current = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { planTier: true },
  });

  const merchant = await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      previousPlanTier: current.planTier,
      planTier: newPlanTier,
      billingStatus: "ACTIVE",
    },
  });

  return {
    ...merchant,
    settings: parseMerchantSettings(merchant.settings),
  };
}

/**
 * Check if merchant has downgraded from a higher plan tier.
 */
export function isDowngrade(previousTier: PlanTier | null, newTier: PlanTier): boolean {
  if (!previousTier) return false;

  const tierOrder: PlanTier[] = ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"];
  const prevIndex = tierOrder.indexOf(previousTier);
  const newIndex = tierOrder.indexOf(newTier);

  return newIndex < prevIndex;
}

/**
 * Get merchants with active (non-frozen, non-cancelled) status for polling.
 */
export async function getActiveMerchantIds(): Promise<string[]> {
  const merchants = await prisma.merchant.findMany({
    where: {
      billingStatus: { not: "CANCELLED" },
      shopFrozen: false,
    },
    select: { id: true },
  });

  return merchants.map((m) => m.id);
}
