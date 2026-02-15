import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
// Mandatory compliance webhook: shop/redact
// Shopify sends this 48 hours after a store uninstalls your app.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: Delete all stored data for this shop.

  return json({ success: true });
};
