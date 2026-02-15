/**
 * Billing Paywall Route
 *
 * Shown when a merchant hasn't selected and authorized a billing plan.
 * They must accept a plan (with 7-day free trial) before accessing the app.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Divider,
  Icon,
  Banner,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { getAllPlans, PLAN_LIMITS } from "~/services/billing.service";
import type { PlanTier } from "@prisma/client";

interface LoaderData {
  plans: ReturnType<typeof getAllPlans>;
  apiKey: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { billing } = await authenticate.admin(request);

  // If they already have an active subscription, redirect to app
  try {
    const billingCheck = await billing.check({
      plans: ["Starter", "Professional", "Business", "Enterprise"],
      isTest: process.env.NODE_ENV !== "production",
    });

    if (billingCheck.hasActivePayment) {
      return redirect("/app");
    }
  } catch {
    // No subscription - show paywall
  }

  return json<LoaderData>({
    plans: getAllPlans(),
    apiKey: process.env.SHOPIFY_API_KEY || "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);

  const formData = await request.formData();
  const planName = formData.get("planName") as string;

  const validPlans = ["Starter", "Professional", "Business", "Enterprise"] as const;
  if (!planName || !validPlans.includes(planName as typeof validPlans[number])) {
    return json({ error: "Please select a valid plan" }, { status: 400 });
  }

  // Request billing through Shopify - this will redirect to Shopify's approval page
  await billing.request({
    plan: planName as typeof validPlans[number],
    isTest: process.env.NODE_ENV !== "production",
  });

  // billing.request throws a redirect response, so we won't reach here
  return null;
}

const PLAN_FEATURE_LIST: Record<string, string[]> = {
  STARTER: [
    "Up to 100 shipments/month",
    "Dashboard with shipment tracking",
    "Manual delay notifications",
    "Basic filtering",
  ],
  PROFESSIONAL: [
    "Up to 500 shipments/month",
    "Everything in Starter",
    "Multi-carrier display",
    "Full filtering & sorting",
    "Bulk actions",
    "CSV export",
  ],
  BUSINESS: [
    "Up to 2,000 shipments/month",
    "Everything in Professional",
    "Analytics & metrics",
    "Priority carrier polling",
  ],
  ENTERPRISE: [
    "Unlimited shipments",
    "Everything in Business",
    "Dedicated support",
    "Custom integrations",
  ],
};

export default function BillingPaywall() {
  const { plans } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<{ error?: string }>();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const isSubmitting = fetcher.state === "submitting";

  const handleSelectPlan = useCallback(
    (planName: string) => {
      setSelectedPlan(planName);
      fetcher.submit({ planName }, { method: "POST" });
    },
    [fetcher]
  );

  return (
    <Page narrowWidth>
      <BlockStack gap="600">
        <BlockStack gap="200" inlineAlign="center">
          <Text as="h1" variant="headingXl" alignment="center">
            Welcome to DelayGuard
          </Text>
          <Text as="p" variant="bodyLg" alignment="center" tone="subdued">
            Proactive shipment delay detection for your Shopify store.
            Choose a plan to get started — all plans include a{" "}
            <Text as="span" fontWeight="semibold" tone="success">
              free 7-day trial
            </Text>
            .
          </Text>
        </BlockStack>

        {fetcher.data?.error && (
          <Banner tone="critical" title="Error">
            <p>{fetcher.data.error}</p>
          </Banner>
        )}

        <Layout>
          {plans.map((plan) => {
            const isPopular = plan.isPopular;
            const features = PLAN_FEATURE_LIST[plan.tier] || [];
            const isLoading = isSubmitting && selectedPlan === plan.name;

            return (
              <Layout.Section key={plan.tier} variant="oneHalf">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        {plan.name}
                      </Text>
                      {isPopular && <Badge tone="info">Popular</Badge>}
                    </InlineStack>

                    <InlineStack blockAlign="baseline" gap="100">
                      <Text as="span" variant="heading2xl">
                        ${plan.price}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        /month
                      </Text>
                    </InlineStack>

                    <Text as="p" variant="bodySm" tone="success">
                      7-day free trial included
                    </Text>

                    <Divider />

                    <BlockStack gap="200">
                      {features.map((feature, i) => (
                        <InlineStack key={i} gap="200" blockAlign="start">
                          <Box minWidth="20px">
                            <Icon source={CheckIcon} tone="success" />
                          </Box>
                          <Text as="span" variant="bodySm">
                            {feature}
                          </Text>
                        </InlineStack>
                      ))}
                    </BlockStack>

                    <Button
                      variant={isPopular ? "primary" : "secondary"}
                      fullWidth
                      onClick={() => handleSelectPlan(plan.name)}
                      loading={isLoading}
                      disabled={isSubmitting}
                    >
                      Start Free Trial
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          All plans are billed through Shopify. You won't be charged until your
          7-day trial ends. Cancel anytime.
        </Text>
      </BlockStack>
    </Page>
  );
}
