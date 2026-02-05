import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Text, Card, BlockStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Check if merchant exists and has completed onboarding
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
  });

  if (!merchant) {
    // Will be created by merchant service in Phase 2
    // For now, just show the dashboard
  } else if (!merchant.onboardingDone) {
    return redirect("/app/onboarding");
  }

  // Get summary statistics (placeholder for Phase 4)
  const summary = {
    totalActive: 0,
    delayed: 0,
    deliveredToday: 0,
    avgDeliveryTime: 0,
  };

  return json({ shop: session.shop, summary });
};

export default function Index() {
  const { shop, summary } = useLoaderData<typeof loader>();

  return (
    <Page title="DelayGuard Dashboard">
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Welcome to DelayGuard
                </Text>
                <Text variant="bodyMd" as="p">
                  Proactive shipment delay detection for {shop}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Active Shipments
                </Text>
                <Text variant="headingLg" as="p">
                  {summary.totalActive}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Delayed
                </Text>
                <Text variant="headingLg" as="p" tone="critical">
                  {summary.delayed}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Delivered Today
                </Text>
                <Text variant="headingLg" as="p" tone="success">
                  {summary.deliveredToday}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
