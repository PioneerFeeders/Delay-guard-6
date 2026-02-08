/**
 * Feature Gate Hook
 *
 * Provides plan-based feature gating throughout the app.
 * Use this hook in any component that needs to check if a feature
 * is available on the merchant's current plan.
 *
 * Usage:
 *   const { hasFeature, planTier, UpgradeBanner } = useFeatureGate();
 *
 *   if (!hasFeature("csvExport")) {
 *     return <UpgradeBanner feature="CSV Export" requiredPlan="Professional" />;
 *   }
 */

import { useOutletContext } from "@remix-run/react";
import { Banner, Button, Text, InlineStack, BlockStack } from "@shopify/polaris";
import type { PlanTier } from "@prisma/client";
import type { PlanFeatures } from "~/services/billing.service";

interface AppContext {
  planTier: string;
}

/**
 * Feature availability by plan tier
 * Mirrors the server-side getPlanFeatures function
 */
function getClientPlanFeatures(planTier: string): PlanFeatures {
  return {
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
}

/**
 * Get the minimum plan tier required for a feature
 */
function getRequiredPlan(feature: keyof PlanFeatures): string {
  // Features available on all plans
  if (["dashboard", "manualNotifications", "basicFiltering"].includes(feature)) {
    return "Starter";
  }
  // Professional+ features
  if (["multiCarrierDisplay", "fullFiltering", "bulkActions", "csvExport"].includes(feature)) {
    return "Professional";
  }
  // Business+ features
  if (["analyticsMetrics", "priorityPolling"].includes(feature)) {
    return "Business";
  }
  return "Enterprise";
}

export function useFeatureGate() {
  let context: AppContext;

  try {
    context = useOutletContext<AppContext>();
  } catch {
    // Fallback if context is not available
    context = { planTier: "STARTER" };
  }

  const planTier = context?.planTier || "STARTER";
  const features = getClientPlanFeatures(planTier);

  const hasFeature = (feature: keyof PlanFeatures): boolean => {
    return features[feature];
  };

  return {
    planTier,
    features,
    hasFeature,
    getRequiredPlan,
  };
}

/**
 * Upgrade Banner Component
 *
 * Display this when a user tries to access a feature not available on their plan.
 */
export function UpgradeBanner({
  feature,
  requiredPlan,
  description,
}: {
  feature: string;
  requiredPlan?: string;
  description?: string;
}) {
  const { planTier } = useFeatureGate();
  const plan = requiredPlan || "Professional";

  return (
    <Banner
      title={`${feature} requires the ${plan} plan`}
      tone="warning"
      action={{
        content: `Upgrade to ${plan}`,
        url: "/app/settings?tab=4",
      }}
    >
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd">
          {description ||
            `You're currently on the ${planTier === "STARTER" ? "Starter" : planTier === "PROFESSIONAL" ? "Professional" : planTier} plan. Upgrade to ${plan} to unlock ${feature.toLowerCase()}.`}
        </Text>
      </BlockStack>
    </Banner>
  );
}

/**
 * Feature Gate Wrapper Component
 *
 * Wraps content that should only be visible on certain plans.
 * Shows an upgrade banner if the feature is not available.
 *
 * Usage:
 *   <FeatureGate feature="csvExport" featureName="CSV Export">
 *     <ExportButton />
 *   </FeatureGate>
 */
export function FeatureGate({
  feature,
  featureName,
  requiredPlan,
  description,
  children,
  fallback,
}: {
  feature: keyof PlanFeatures;
  featureName: string;
  requiredPlan?: string;
  description?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { hasFeature: checkFeature } = useFeatureGate();

  if (checkFeature(feature)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <UpgradeBanner
      feature={featureName}
      requiredPlan={requiredPlan || getRequiredPlan(feature)}
      description={description}
    />
  );
}
