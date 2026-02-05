import { json } from "@remix-run/node";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { createOrUpdateMerchant } from "~/services/merchant.service";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Create or update merchant record on first load after OAuth
  // This ensures merchant exists before any other operations
  const shopifyShopId = session.shop;
  const shopDomain = session.shop;

  // Fetch shop details from Shopify to get email
  let email = "";
  try {
    const response = await admin.graphql(`
      query {
        shop {
          email
          ianaTimezone
        }
      }
    `);
    const data = await response.json();
    email = data.data?.shop?.email ?? "";
    const timezone = data.data?.shop?.ianaTimezone;

    await createOrUpdateMerchant({
      shopifyShopId,
      shopDomain,
      email,
      timezone,
    });
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

  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
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
