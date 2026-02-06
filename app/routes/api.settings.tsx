import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import {
  getMerchantByShopId,
  updateMerchantSettings,
} from "~/services/merchant.service";
import { MerchantSettingsSchema } from "~/lib/validation";

/**
 * Schema for partial settings update (all fields optional)
 */
const SettingsUpdateSchema = MerchantSettingsSchema.partial();

/**
 * GET /api/settings
 * Returns the current merchant's settings
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);

  if (!merchant) {
    return json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  return json({
    settings: merchant.settings,
  });
}

/**
 * POST /api/settings
 * Updates the merchant's settings with a partial update
 *
 * Request body should be a JSON object with any subset of MerchantSettings fields.
 * Only provided fields will be updated; others will remain unchanged.
 *
 * Also supports special actions via _action field:
 * - clearTestData: Removes all test shipments for the merchant
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  const { session } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);

  if (!merchant) {
    return json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Handle special actions
  if (body._action === "clearTestData") {
    try {
      // Delete all test shipments and their related records
      // First delete tracking events and notification logs for test shipments
      const testShipments = await prisma.shipment.findMany({
        where: {
          merchantId: merchant.id,
          isTestData: true,
        },
        select: { id: true },
      });

      const testShipmentIds = testShipments.map((s) => s.id);

      if (testShipmentIds.length > 0) {
        // Delete in order due to foreign keys: tracking events, resolution logs, notification logs, then shipments
        await prisma.trackingEvent.deleteMany({
          where: { shipmentId: { in: testShipmentIds } },
        });

        await prisma.resolutionLog.deleteMany({
          where: { shipmentId: { in: testShipmentIds } },
        });

        await prisma.notificationLog.deleteMany({
          where: { shipmentId: { in: testShipmentIds } },
        });

        await prisma.shipment.deleteMany({
          where: { id: { in: testShipmentIds } },
        });
      }

      return json({
        success: true,
        message: `Cleared ${testShipmentIds.length} test shipment(s)`,
        count: testShipmentIds.length,
      });
    } catch (error) {
      console.error("Failed to clear test data:", error);
      return json(
        { error: "Failed to clear test data" },
        { status: 500 }
      );
    }
  }

  // Validate the settings update
  const parseResult = SettingsUpdateSchema.safeParse(body);

  if (!parseResult.success) {
    return json(
      {
        error: "Invalid settings",
        details: parseResult.error.flatten(),
      },
      { status: 400 }
    );
  }

  // Update the settings
  try {
    const updated = await updateMerchantSettings(merchant.id, parseResult.data);

    return json({
      success: true,
      settings: updated.settings,
    });
  } catch (error) {
    console.error("Failed to update merchant settings:", error);
    return json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
