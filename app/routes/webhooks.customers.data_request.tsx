import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook: customers/data_request
// Shopify sends this when a customer requests their data.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: If your app stores customer data, implement data export here.

  return json({ success: true });
};
