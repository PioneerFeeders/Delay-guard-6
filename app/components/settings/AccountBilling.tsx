/**
 * Account & Billing Component
 *
 * Displays:
 * - Current plan details
 * - Usage meter (shipments this cycle vs limit)
 * - Upgrade/downgrade options
 * - Feature comparison
 */

import {
  Card,
  BlockStack,
  Text,
  Box,
  Button,
  InlineStack,
  Badge,
  ProgressBar,
  Divider,
  Icon,
  Banner,
  Modal,
} from "@shopify/polaris";
import { CheckIcon, XIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo } from "react";
import type { PlanTier } from "@prisma/client";
import type { PlanFeatures, BillingInfo as ServiceBillingInfo, PlanInfo as ServicePlanInfo } from "~/services/billing.service";

/**
 * Re-export types from billing service for external use.
 * Using the service types ensures consistency.
 */
export type BillingInfo = ServiceBillingInfo;
export type PlanInfo = ServicePlanInfo;

/**
 * Usage information (same shape as service, but with serialized dates for JSON)
 */
export interface SerializedUsageInfo {
  used: number;
  limit: number;
  isAtLimit: boolean;
  percentUsed: number;
  remaining: number;
  billingCycle: {
    start: string | Date;
    end: string | Date;
  };
}

/**
 * Serialized billing info for JSON responses (dates as strings)
 */
export interface SerializedBillingInfo {
  planTier: PlanTier;
  planName: string;
  planPrice: number;
  billingStatus: string;
  usage: SerializedUsageInfo;
  features: PlanFeatures;
  nextPlanTier: PlanTier | null;
  nextPlanName: string | null;
  nextPlanPrice: number | null;
  nextPlanLimit: number | null;
}

interface AccountBillingProps {
  billingInfo: SerializedBillingInfo;
  allPlans: PlanInfo[];
  hasActiveSubscription: boolean;
  onSelectPlan: (planTier: PlanTier) => void;
  isChangingPlan?: boolean;
}

/**
 * Feature labels for display
 */
const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  dashboard: "Dashboard access",
  manualNotifications: "Manual customer notifications",
  multiCarrierDisplay: "Multi-carrier display",
  basicFiltering: "Basic filtering",
  fullFiltering: "Advanced filtering",
  bulkActions: "Bulk actions",
  csvExport: "CSV export",
  analyticsMetrics: "Analytics & metrics",
  priorityPolling: "Priority polling",
};

export function AccountBilling({
  billingInfo,
  allPlans,
  hasActiveSubscription: _hasActiveSubscription,
  onSelectPlan,
  isChangingPlan = false,
}: AccountBillingProps) {
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanTier | null>(null);

  // Format date for display (accepts Date or ISO string)
  const formatDate = (date: Date | string) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(typeof date === "string" ? new Date(date) : date);
  };

  // Calculate usage percentage for display
  const usagePercentage = useMemo(() => {
    if (billingInfo.usage.limit === Infinity) return 0;
    return Math.round(billingInfo.usage.percentUsed);
  }, [billingInfo.usage]);

  // Determine progress bar tone based on usage
  const progressTone = useMemo((): "critical" | "highlight" | "primary" | "success" | undefined => {
    if (usagePercentage >= 90) return "critical";
    if (usagePercentage >= 75) return "highlight"; // Use highlight instead of warning
    return "primary";
  }, [usagePercentage]);

  // Handle plan selection
  const handleSelectPlan = useCallback((tier: PlanTier) => {
    setSelectedPlan(tier);
    setShowPlanModal(true);
  }, []);

  // Confirm plan change
  const handleConfirmPlanChange = useCallback(() => {
    if (selectedPlan) {
      onSelectPlan(selectedPlan);
      setShowPlanModal(false);
    }
  }, [selectedPlan, onSelectPlan]);

  // Get billing status badge
  const statusBadge = useMemo(() => {
    switch (billingInfo.billingStatus) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "PENDING":
        return <Badge tone="warning">Pending</Badge>;
      case "CANCELLED":
        return <Badge tone="critical">Cancelled</Badge>;
      default:
        return null;
    }
  }, [billingInfo.billingStatus]);

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Account & Billing
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Manage your subscription and view usage details.
            </Text>
          </BlockStack>

          {/* Current Plan */}
          <Box
            padding="400"
            background="bg-surface-secondary"
            borderRadius="200"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingLg">
                    {billingInfo.planName}
                  </Text>
                  {statusBadge}
                </InlineStack>
                <Text as="p" variant="headingMd">
                  ${billingInfo.planPrice.toFixed(2)}
                  <Text as="span" variant="bodySm" tone="subdued">
                    /month
                  </Text>
                </Text>
              </InlineStack>

              <Text as="p" variant="bodySm" tone="subdued">
                {billingInfo.usage.limit === Infinity
                  ? "Unlimited shipments"
                  : `${billingInfo.usage.limit.toLocaleString()} shipments per month`}
              </Text>
            </BlockStack>
          </Box>

          {/* Usage Meter */}
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Usage This Billing Cycle
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {formatDate(billingInfo.usage.billingCycle.start)} - {formatDate(billingInfo.usage.billingCycle.end)}
              </Text>
            </InlineStack>

            {billingInfo.usage.limit === Infinity ? (
              <Text as="p" variant="bodyMd">
                <strong>{billingInfo.usage.used.toLocaleString()}</strong> shipments tracked
              </Text>
            ) : (
              <>
                <ProgressBar progress={usagePercentage} tone={progressTone} size="small" />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm">
                    <strong>{billingInfo.usage.used.toLocaleString()}</strong> of{" "}
                    {billingInfo.usage.limit.toLocaleString()} shipments
                  </Text>
                  <Text as="p" variant="bodySm" tone={usagePercentage >= 90 ? "critical" : "subdued"}>
                    {billingInfo.usage.remaining === Infinity
                      ? "Unlimited remaining"
                      : `${billingInfo.usage.remaining.toLocaleString()} remaining`}
                  </Text>
                </InlineStack>
              </>
            )}

            {billingInfo.usage.isAtLimit && (
              <Banner tone="critical">
                <p>
                  You've reached your plan limit. Upgrade to continue tracking new shipments.
                  Existing shipments will continue to be tracked.
                </p>
              </Banner>
            )}

            {!billingInfo.usage.isAtLimit && usagePercentage >= 75 && (
              <Banner tone="warning">
                <p>
                  You're approaching your plan limit. Consider upgrading to avoid interruptions.
                </p>
              </Banner>
            )}
          </BlockStack>

          <Divider />

          {/* Plan Features */}
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Your Plan Features
            </Text>
            <Box
              padding="300"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <BlockStack gap="100">
                {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                  const featureKey = key as keyof PlanFeatures;
                  const hasFeature = billingInfo.features[featureKey];
                  return (
                    <InlineStack key={key} gap="200" blockAlign="center">
                      <Icon
                        source={hasFeature ? CheckIcon : XIcon}
                        tone={hasFeature ? "success" : "subdued"}
                      />
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={hasFeature ? undefined : "subdued"}
                      >
                        {label}
                      </Text>
                    </InlineStack>
                  );
                })}
              </BlockStack>
            </Box>
          </BlockStack>

          <Divider />

          {/* Upgrade/Downgrade Options */}
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Change Plan
            </Text>
            <InlineStack gap="300" wrap>
              {allPlans.map((plan) => {
                const isCurrent = plan.tier === billingInfo.planTier;
                const isUpgrade =
                  ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"].indexOf(plan.tier) >
                  ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"].indexOf(billingInfo.planTier);

                return (
                  <Box
                    key={plan.tier}
                    padding="300"
                    background={isCurrent ? "bg-surface-selected" : "bg-surface"}
                    borderWidth="025"
                    borderColor={isCurrent ? "border-success" : "border"}
                    borderRadius="200"
                    minWidth="150px"
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h4" variant="headingSm">
                          {plan.name}
                        </Text>
                        {plan.isPopular && !isCurrent && (
                          <Badge tone="info">Popular</Badge>
                        )}
                        {isCurrent && <Badge tone="success">Current</Badge>}
                      </InlineStack>
                      <Text as="p" variant="headingMd">
                        ${plan.price.toFixed(2)}
                        <Text as="span" variant="bodySm" tone="subdued">
                          /mo
                        </Text>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {plan.limit === Infinity
                          ? "Unlimited"
                          : plan.limit.toLocaleString()}{" "}
                        shipments
                      </Text>
                      {!isCurrent && (
                        <Button
                          variant={isUpgrade ? "primary" : "secondary"}
                          onClick={() => handleSelectPlan(plan.tier)}
                          loading={isChangingPlan && selectedPlan === plan.tier}
                          disabled={isChangingPlan}
                          size="slim"
                          fullWidth
                        >
                          {isUpgrade ? "Upgrade" : "Downgrade"}
                        </Button>
                      )}
                    </BlockStack>
                  </Box>
                );
              })}
            </InlineStack>
          </BlockStack>

          {/* Billing History Note */}
          <Text as="p" variant="bodySm" tone="subdued">
            Billing is managed through Shopify. View your complete billing history in your{" "}
            <a
              href="https://admin.shopify.com/store/settings/billing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Shopify admin billing settings
            </a>
            .
          </Text>
        </BlockStack>
      </Card>

      {/* Plan Change Confirmation Modal */}
      <Modal
        open={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        title="Change Plan"
        primaryAction={{
          content: "Confirm Change",
          onAction: handleConfirmPlanChange,
          loading: isChangingPlan,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowPlanModal(false),
          },
        ]}
      >
        <Modal.Section>
          {selectedPlan && (
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">
                You are about to change your plan to{" "}
                <strong>
                  {allPlans.find((p) => p.tier === selectedPlan)?.name}
                </strong>
                .
              </Text>

              {["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"].indexOf(selectedPlan) <
              ["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"].indexOf(billingInfo.planTier) ? (
                <Banner tone="warning">
                  <p>
                    Downgrading will take effect immediately. If you're over the new plan's
                    shipment limit, new shipments won't be tracked until your usage resets.
                  </p>
                </Banner>
              ) : (
                <Banner tone="info">
                  <p>
                    Upgrading will take effect immediately. You'll be charged the prorated
                    difference for the remainder of your billing cycle.
                  </p>
                </Banner>
              )}

              <Text as="p" variant="bodySm" tone="subdued">
                You'll be redirected to Shopify to confirm the billing change.
              </Text>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
