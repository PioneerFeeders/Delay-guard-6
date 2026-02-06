/**
 * Billing API Route
 *
 * Handles billing operations including:
 * - GET: Retrieve current billing info, usage, and features
 * - POST: Handle billing actions (selectPlan, confirmPlan)
 *
 * Actions:
 * - selectPlan: Initiates plan selection/upgrade, returns Shopify confirmation URL
 * - confirmPlan: Handles callback after merchant approves charge in Shopify
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "~/shopify.server";
import {
  getMerchantByShopId,
  updateMerchantBilling,
} from "~/services/merchant.service";
import {
  getBillingInfo,
  getAllPlans,
  tierToPlanName,
  planNameToTier,
  PLAN_NAMES,
} from "~/services/billing.service";
import type { PlanTier } from "@prisma/client";

/**
 * Schema for selectPlan action
 */
const SelectPlanSchema = z.object({
  action: z.literal("selectPlan"),
  planTier: z.enum(["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"]),
});

/**
 * Schema for confirmPlan action
 */
const ConfirmPlanSchema = z.object({
  action: z.literal("confirmPlan"),
  chargeId: z.string().optional(), // May be provided by Shopify redirect
});

/**
 * Schema for getting billing info
 */
const GetBillingSchema = z.object({
  action: z.literal("getBilling"),
});

/**
 * Union of all action schemas
 */
const BillingActionSchema = z.discriminatedUnion("action", [
  SelectPlanSchema,
  ConfirmPlanSchema,
  GetBillingSchema,
]);

/**
 * GET /api/billing
 * Returns billing info, current usage, and available plans
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);

  if (!merchant) {
    return json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  try {
    const billingInfo = await getBillingInfo(merchant);
    const allPlans = getAllPlans();

    // Check current subscription status from Shopify
    let hasActiveSubscription = false;
    let subscriptionPlan: string | null = null;

    try {
      // Try to get current subscription using billing.check
      // Use the plan names as configured in shopify.server.ts
      const subscriptionCheck = await billing.check({
        plans: ["Starter", "Professional", "Business", "Enterprise"],
        isTest: process.env.NODE_ENV !== "production",
      });

      if (subscriptionCheck.hasActivePayment) {
        hasActiveSubscription = true;
        subscriptionPlan = subscriptionCheck.appSubscriptions?.[0]?.name ?? null;
      }
    } catch {
      // billing.check may fail if no subscription exists, that's okay
    }

    return json({
      billing: billingInfo,
      plans: allPlans,
      hasActiveSubscription,
      subscriptionPlan,
    });
  } catch (error) {
    console.error("Failed to get billing info:", error);
    return json(
      { error: "Failed to get billing information" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/billing
 * Handles billing actions
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  const { session, billing } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);

  if (!merchant) {
    return json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Validate the action
  const parseResult = BillingActionSchema.safeParse(body);

  if (!parseResult.success) {
    return json(
      {
        error: "Invalid request",
        details: parseResult.error.flatten(),
      },
      { status: 400 }
    );
  }

  const actionData = parseResult.data;

  try {
    switch (actionData.action) {
      case "selectPlan":
        return await handleSelectPlan(merchant.id, actionData.planTier, billing, session.shop);

      case "confirmPlan":
        return await handleConfirmPlan(merchant.id, billing, session.shop);

      case "getBilling":
        // Return billing info (same as loader, but via POST)
        const billingInfo = await getBillingInfo(merchant);
        return json({ billing: billingInfo });

      default:
        return json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Billing action failed:", error);
    return json(
      { error: "Billing operation failed" },
      { status: 500 }
    );
  }
}

/**
 * Handle plan selection - creates Shopify subscription and returns confirmation URL
 */
async function handleSelectPlan(
  merchantId: string,
  planTier: PlanTier,
  billing: any,
  shop: string
): Promise<Response> {
  const planName = tierToPlanName(planTier);

  console.log(`[billing] Merchant ${merchantId} selecting plan: ${planName}`);

  try {
    // Cancel any existing subscription before creating new one
    // This is handled automatically by Shopify when creating a new subscription

    // Request the subscription from Shopify
    const response = await billing.request({
      plan: planName,
      isTest: process.env.NODE_ENV !== "production",
      returnUrl: `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/billing/callback`,
    });

    // billing.request returns the confirmation URL directly when a redirect is needed
    // If the response is a redirect, we need to return it
    if (response.confirmationUrl) {
      return json({
        success: true,
        confirmationUrl: response.confirmationUrl,
        message: "Redirecting to Shopify to confirm billing",
      });
    }

    // If billing was already approved (e.g., test mode with auto-approve)
    // the subscription is already active
    if (response.hasActivePayment) {
      await updateMerchantBilling(merchantId, planTier, "ACTIVE");

      return json({
        success: true,
        message: "Plan activated successfully",
        planTier,
        planName,
      });
    }

    // Fallback - shouldn't normally reach here
    return json({
      success: false,
      error: "Unexpected billing response",
    });
  } catch (error: any) {
    // Check if this is a redirect response (billing.request throws when redirect needed)
    if (error.confirmationUrl) {
      return json({
        success: true,
        confirmationUrl: error.confirmationUrl,
        message: "Redirecting to Shopify to confirm billing",
      });
    }

    console.error(`[billing] Failed to create subscription for merchant ${merchantId}:`, error);
    throw error;
  }
}

/**
 * Handle plan confirmation after merchant approves in Shopify
 */
async function handleConfirmPlan(
  merchantId: string,
  billing: any,
  _shop: string
): Promise<Response> {
  console.log(`[billing] Confirming plan for merchant ${merchantId}`);

  try {
    // Check what subscription is now active
    const subscriptionCheck = await billing.check({
      plans: Object.values(PLAN_NAMES),
      isTest: process.env.NODE_ENV !== "production",
    });

    if (!subscriptionCheck.hasActivePayment) {
      return json({
        success: false,
        error: "No active subscription found. Please select a plan.",
      });
    }

    // Find which plan was activated
    const activePlan = subscriptionCheck.appSubscriptions?.[0]?.name;

    if (!activePlan) {
      return json({
        success: false,
        error: "Could not determine active plan",
      });
    }

    const planTier = planNameToTier(activePlan);

    if (!planTier) {
      console.error(`[billing] Unknown plan name from Shopify: ${activePlan}`);
      return json({
        success: false,
        error: `Unknown plan: ${activePlan}`,
      });
    }

    // Update merchant record with the new plan
    await updateMerchantBilling(merchantId, planTier, "ACTIVE");

    console.log(`[billing] Merchant ${merchantId} plan confirmed: ${planTier}`);

    return json({
      success: true,
      message: "Plan activated successfully",
      planTier,
      planName: activePlan,
    });
  } catch (error) {
    console.error(`[billing] Failed to confirm plan for merchant ${merchantId}:`, error);
    throw error;
  }
}
