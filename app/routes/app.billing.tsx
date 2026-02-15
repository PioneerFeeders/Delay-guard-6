import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// This route acts as a passthrough to Shopify's Managed Pricing plan selection page.
// It's needed because embedded apps run in an iframe and can't do top-level redirects
// using Remix's throw redirect(). The authenticate.admin redirect utility handles
// the iframe breakout properly via App Bridge.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const appHandle = "delayguard-dev";
  const storeHandle = session.shop.replace(".myshopify.com", "");

  return redirect(
    `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`,
    { target: "_top" },
  );
};
