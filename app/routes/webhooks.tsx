import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Catch-all webhook handler for /webhooks
// This handles all webhook topics including mandatory compliance webhooks:
// - customers/data_request
// - customers/redact
// - shop/redact
// - app/uninstalled
//
// The authenticate.webhook() call validates the HMAC signature automatically.
// If the HMAC is invalid, it throws a 401 Unauthorized response.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      // Clean up app installations / session data
      console.log(`App uninstalled from ${shop}`);
      break;

    case "CUSTOMERS_DATA_REQUEST":
      // Shopify sends this when a customer requests their data.
      // If your app stores customer PII, return it to the store owner.
      console.log(`Customer data request from ${shop}`);
      break;

    case "CUSTOMERS_REDACT":
      // Shopify sends this when a store owner requests deletion of customer data.
      // Delete any stored customer data from your database.
      console.log(`Customer redact request from ${shop}`);
      break;

    case "SHOP_REDACT":
      // Shopify sends this 48 hours after a store uninstalls your app.
      // Delete ALL data associated with that store.
      console.log(`Shop redact request from ${shop}`);
      break;

    case "FULFILLMENTS_CREATE":
      console.log(`Fulfillment created in ${shop}`);
      break;

    case "FULFILLMENTS_UPDATE":
      console.log(`Fulfillment updated in ${shop}`);
      break;

    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return new Response("OK", { status: 200 });
};
