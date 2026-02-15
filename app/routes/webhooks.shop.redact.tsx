import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";

// Mandatory compliance webhook: shop/redact
// Shopify sends this 48 hours after a store uninstalls your app.
// Your app must delete all data associated with that store.
// See: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // TODO: Delete all stored data for this shop.
  // Example:
  //   const merchant = await prisma.merchant.findUnique({ where: { shopDomain: shop } });
  //   if (merchant) {
  //     await prisma.shipment.deleteMany({ where: { merchantId: merchant.id } });
  //     await prisma.merchant.delete({ where: { id: merchant.id } });
  //   }

  return json({ success: true });
};
