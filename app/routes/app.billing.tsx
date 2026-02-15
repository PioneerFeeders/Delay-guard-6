import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const appHandle = "delayguard-dev";
  const storeHandle = session.shop.replace(".myshopify.com", "");

  return json({
    redirectUrl: `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`,
  });
};

export default function Billing() {
  const { redirectUrl } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  useEffect(() => {
    // Use App Bridge to navigate outside the iframe
    open(redirectUrl, "_top");
  }, [redirectUrl]);

  return null;
}
