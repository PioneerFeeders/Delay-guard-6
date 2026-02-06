import { json } from "@remix-run/node";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner, Page, BlockStack, Text } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { createOrUpdateMerchant, updateShopStatus } from "~/services/merchant.service";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

interface LoaderData {
  apiKey: string;
  shopFrozen: boolean;
  shopPlanName: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Create or update merchant record on first load after OAuth
  // This ensures merchant exists before any other operations
  const shopifyShopId = session.shop;
  const shopDomain = session.shop;

  // Fetch shop details from Shopify to get email and shop status
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

    // Check if shop is frozen/paused
    // A shop is considered frozen if:
    // - It's on a paused/frozen plan (checkoutApiSupported is false for frozen shops)
    // - The plan indicates it's dormant
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
    }
  } catch (error) {
    // Log error but don't fail the request - merchant creation can be retried
    console.error("Error creating/updating merchant:", error);
    // Still try to create with basic info
    await createOrUpdateMerchant({
      shopifyShopId,
      shopDomain,
      email,
    });
  }

  return json<LoaderData>({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopFrozen,
    shopPlanName,
  });
};

export default function App() {
  const { apiKey, shopFrozen } = useLoaderData<LoaderData>();

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
            <Outlet />
          </BlockStack>
        </Page>
      ) : (
        <Outlet />
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
