import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";

// Mandatory compliance webhook: customers/data_request
// Shopify sends this when a customer requests their data.
// You must respond with the customer's data that your app has stored,
// or confirm that you don't store any customer data.
// See: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: If your app stores customer data, implement data export here.
  // For now, DelayGuard primarily tracks shipment/fulfillment data.
  // If you store customer PII, you'll need to query and return it.

  return json({ success: true });
};
