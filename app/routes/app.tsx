import { json, redirect } from "@remix-run/node";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner, Page, BlockStack, Text } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { createOrUpdateMerchant, updateShopStatus } from "~/services/merchant.service";
import { updateMerchantBilling } from "~/services/merchant.service";
import { planNameToTier } from "~/services/billing.service";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

interface LoaderData {
  apiKey: string;
  shopFrozen: boolean;
  shopPlanName: string | null;
  planTier: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);

  // ── Billing gate: require active subscription ──────────────
  // Skip billing check when already on the billing page to avoid redirect loop
  const url = new URL(request.url);
  const isBillingPage = url.pathname === "/app/billing";

  let hasActiveSubscription = false;
  let activePlanName: string | null = null;

  try {
    const billingCheck = await billing.check({
      plans: ["Starter", "Professional", "Business", "Enterprise"],
      isTest: process.env.NODE_ENV !== "production",
    });

    hasActiveSubscription = billingCheck.hasActivePayment;
    activePlanName = billingCheck.appSubscriptions?.[0]?.name ?? null;
  } catch {
    // billing.check can fail if no subscription exists
  }

  if (!hasActiveSubscription && !isBillingPage) {
    // Redirect to billing paywall
    throw redirect("/app/billing");
  }

  // On the billing page without a subscription, return minimal data
  // to render the layout wrapper (AppProvider) for the billing child route
  if (!hasActiveSubscription && isBillingPage) {
    return json<LoaderData>({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      shopFrozen: false,
      shopPlanName: null,
      planTier: "STARTER",
    });
  }

  // ── Create/update merchant record ──────────────────────────
  const shopifyShopId = session.shop;
  const shopDomain = session.shop;

  let email = "";
  let shopFrozen = false;
  let shopPlanName: string | null = null;

  try {
    const response = await admin.graphql(`
      query {
        shop {
          email
          ianaTimezone
          plan {
            displayName
            partnerDevelopment
            shopifyPlus
          }
          checkoutApiSupported
        }
      }
    `);
    const data = await response.json();
    email = data.data?.shop?.email ?? "";
    const timezone = data.data?.shop?.ianaTimezone;
    const plan = data.data?.shop?.plan;

    const checkoutApiSupported = data.data?.shop?.checkoutApiSupported ?? true;
    shopFrozen = !checkoutApiSupported;
    shopPlanName = plan?.displayName ?? null;

    const merchant = await createOrUpdateMerchant({
      shopifyShopId,
      shopDomain,
      email,
      timezone,
    });

    // Update shop status if it has changed
    if (merchant) {
      await updateShopStatus(merchant.id, {
        shopFrozen,
        shopPlanName,
      });

      // Sync billing status with Shopify subscription
      // This ensures the merchant record reflects the actual plan they're paying for
      if (activePlanName) {
        const tier = planNameToTier(activePlanName);
        if (tier && (merchant.planTier !== tier || merchant.billingStatus !== "ACTIVE")) {
          await updateMerchantBilling(merchant.id, tier, "ACTIVE");
        }
      }
    }
  } catch (error) {
    console.error("Error creating/updating merchant:", error);
    await createOrUpdateMerchant({
      shopifyShopId,
      shopDomain,
      email,
    });
  }

  // Determine the plan tier for feature gating
  const planTier = activePlanName
    ? planNameToTier(activePlanName) || "STARTER"
    : "STARTER";

  return json<LoaderData>({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopFrozen,
    shopPlanName,
    planTier,
  });
};

export default function App() {
  const { apiKey, shopFrozen, planTier } = useLoaderData<LoaderData>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      {shopFrozen ? (
        <Page>
          <BlockStack gap="400">
            <Banner
              title="Your store is paused"
              tone="warning"
            >
              <Text as="p" variant="bodyMd">
                Your Shopify store is currently paused or frozen. DelayGuard
                has temporarily stopped tracking shipments to conserve
                resources. Tracking will automatically resume when your store
                is reactivated.
              </Text>
            </Banner>
            <Outlet context={{ planTier }} />
          </BlockStack>
        </Page>
      ) : (
        <Outlet context={{ planTier }} />
      )}
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
