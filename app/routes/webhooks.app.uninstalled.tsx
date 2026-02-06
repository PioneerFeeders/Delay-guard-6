/**
 * Webhook Handler: app/uninstalled
 *
 * Triggered when a merchant uninstalls the app from their Shopify store.
 * Marks the merchant as uninstalled and schedules data purge.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { markMerchantUninstalled } from "~/services/merchant.service";
import { safeParseAppUninstalledPayload } from "~/lib/validation";
import { getQueue } from "~/queue.server";
import { QUEUE_DATA_CLEANUP } from "~/jobs/queues";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload } = await authenticate.webhook(request);

  console.log(`[Webhook] app/uninstalled received for shop: ${shop}`);

  // Validate the webhook payload
  const parseResult = safeParseAppUninstalledPayload(payload);
  if (!parseResult.success) {
    console.error("Invalid app uninstalled webhook payload:", parseResult.error);
    // Still return 200 to prevent retries
    return new Response(null, { status: 200 });
  }

  try {
    // Mark merchant as uninstalled (sets billingStatus to CANCELLED)
    const merchant = await markMerchantUninstalled(shop);

    if (!merchant) {
      console.log(`No merchant found to uninstall for shop: ${shop}`);
      return new Response(null, { status: 200 });
    }

    console.log(`Marked merchant ${merchant.id} as uninstalled`);

    // Schedule data purge job for 30 days from now
    // The data-cleanup worker will handle the actual deletion
    const dataCleanupQueue = getQueue(QUEUE_DATA_CLEANUP);
    await dataCleanupQueue.add(
      "purge-merchant",
      {
        merchantId: merchant.id,
        shopDomain: shop,
        uninstalledAt: new Date().toISOString(),
      },
      {
        delay: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
        jobId: `purge-${merchant.id}`, // Deduplicate
      }
    );

    console.log(`Scheduled data purge for merchant ${merchant.id} in 30 days`);

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Error processing app/uninstalled webhook:", error);
    // Return 200 to prevent infinite retries
    return new Response(null, { status: 200 });
  }
}
