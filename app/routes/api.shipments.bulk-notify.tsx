/**
 * API Route: /api/shipments/bulk-notify
 *
 * POST: Enqueue notification emails for multiple shipments.
 * Jobs are queued and processed in the background.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { enqueueBulkNotificationJobs } from "~/queue.server";
import {
  buildTemplateContext,
  renderTemplate,
} from "~/services/notification.service";
import { parseMerchantSettings } from "~/services/merchant.service";

/**
 * Request body schema for bulk notify
 */
const BulkNotifyRequestSchema = z.object({
  shipmentIds: z.array(z.string().uuid()).min(1).max(100),
  skipAlreadyNotified: z.boolean().default(true),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  // Only allow POST
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: {
      id: true,
      shopDomain: true,
      email: true,
      settings: true,
    },
  });

  if (!merchant) {
    return json({ error: "Merchant not found" }, { status: 404 });
  }

  // Parse and validate request body
  let body: z.infer<typeof BulkNotifyRequestSchema>;
  try {
    const rawBody = await request.json();
    body = BulkNotifyRequestSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json(
        { error: "Invalid request body", details: err.errors },
        { status: 400 }
      );
    }
    return json({ error: "Failed to parse request body" }, { status: 400 });
  }

  const { shipmentIds, skipAlreadyNotified } = body;

  // Build where clause for fetching shipments
  const whereClause: {
    id: { in: string[] };
    merchantId: string;
    notificationSent?: boolean;
  } = {
    id: { in: shipmentIds },
    merchantId: merchant.id,
  };

  // If skipping already notified, filter them out
  if (skipAlreadyNotified) {
    whereClause.notificationSent = false;
  }

  // Fetch shipments
  const shipments = await prisma.shipment.findMany({
    where: whereClause,
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      orderNumber: true,
      trackingNumber: true,
      carrier: true,
      currentStatus: true,
      lastCarrierStatus: true,
      expectedDeliveryDate: true,
      notificationSent: true,
    },
  });

  // If no shipments found
  if (shipments.length === 0) {
    return json({
      success: true,
      queuedCount: 0,
      skippedCount: shipmentIds.length,
      message: skipAlreadyNotified
        ? "All selected shipments have already been notified"
        : "No matching shipments found",
    });
  }

  // Parse merchant settings for template
  const settings = parseMerchantSettings(merchant.settings);

  // Prepare notification jobs
  const notificationJobs: Array<{
    shipmentId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    sentBy: string;
  }> = [];

  for (const shipment of shipments) {
    // Build template context
    const context = buildTemplateContext(
      {
        customerName: shipment.customerName,
        orderNumber: shipment.orderNumber,
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier,
        currentStatus: shipment.currentStatus,
        lastCarrierStatus: shipment.lastCarrierStatus,
        expectedDeliveryDate: shipment.expectedDeliveryDate,
      },
      merchant.shopDomain
    );

    // Render subject and body
    const subject = renderTemplate(settings.notificationTemplate.subject, context);
    const body = renderTemplate(settings.notificationTemplate.body, context);

    notificationJobs.push({
      shipmentId: shipment.id,
      recipientEmail: shipment.customerEmail,
      subject,
      body,
      sentBy: merchant.email || "bulk-action",
    });
  }

  // Enqueue all notification jobs
  try {
    await enqueueBulkNotificationJobs(notificationJobs);
  } catch (err) {
    console.error("[bulk-notify] Failed to enqueue notification jobs:", err);
    return json(
      { error: "Failed to queue notifications" },
      { status: 500 }
    );
  }

  const skippedCount = shipmentIds.length - shipments.length;

  return json({
    success: true,
    queuedCount: notificationJobs.length,
    skippedCount,
    message: `${notificationJobs.length} notification${notificationJobs.length === 1 ? "" : "s"} queued for delivery`,
  });
};
