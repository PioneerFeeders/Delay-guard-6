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

  // ── BILLING GATE TEMPORARILY BYPASSED FOR TESTING ──────────
  // TODO: Re-enable once Managed Pricing plans are configured in Partner Dashboard
  // 
  // let hasActiveSubscription = false;
  // let activePlanName: string | null = null;
  //
  // try {
  //   const billingCheck = await billing.check();
  //   hasActiveSubscription = billingCheck.hasActivePayment;
  //   activePlanName = billingCheck.appSubscriptions?.[0]?.name ?? null;
  // } catch {}
  //
  // if (!hasActiveSubscription) {
  //   throw redirect("/app/billing");
  // }

  let activePlanName: string | null = "Starter"; // Fake plan for testing

  // — Create/update merchant record —
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

    if (merchant) {
      await updateShopStatus(merchant.id, {
        shopFrozen,
        shopPlanName,
      });

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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
