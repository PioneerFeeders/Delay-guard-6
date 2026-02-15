import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";

// Mandatory compliance webhook: customers/redact
// Shopify sends this when a store owner requests deletion of customer data
// (e.g., GDPR right to erasure). Your app must delete any stored customer data.
// See: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: If your app stores customer data, implement deletion here.
  // Example:
  //   const customerId = payload.customer.id;
  //   await prisma.customerData.deleteMany({ where: { customerId } });

  return json({ success: true });
};
