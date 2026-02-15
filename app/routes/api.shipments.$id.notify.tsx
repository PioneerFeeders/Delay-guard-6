/**
 * API Route: /api/shipments/:id/notify
 *
 * GET: Prepare notification data (rendered template) for preview
 * POST: Send notification email to customer
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { data } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { enqueueNotificationJob } from "../queue.server";
import { prepareNotification, validateTemplate } from "../services/notification.service";

/**
 * Request body schema for sending notification
 */
const SendNotificationSchema = z.object({
  recipientEmail: z.string().email("Invalid email address"),
  subject: z.string().min(1, "Subject is required").max(200, "Subject too long"),
  body: z.string().min(1, "Body is required").max(10000, "Body too long"),
});

/**
 * GET: Prepare notification data for preview
 *
 * Returns the rendered email template with shipment data filled in,
 * ready for display in the notification modal.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return data({ error: "Shipment ID is required" }, { status: 400 });
  }

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: { id: true },
  });

  if (!merchant) {
    return data({ error: "Merchant not found" }, { status: 404 });
  }

  // Prepare notification data
  const notification = await prepareNotification(id, merchant.id);

  if (!notification) {
    return data({ error: "Shipment not found" }, { status: 404 });
  }

  return data({ notification });
};

/**
 * POST: Send notification email
 *
 * Validates the request, enqueues a notification job, and returns immediately.
 * The actual email is sent asynchronously by the worker.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return data({ error: "Shipment ID is required" }, { status: 400 });
  }

  // Parse and validate request body
  let body: z.infer<typeof SendNotificationSchema>;
  try {
    const rawBody = await request.json();
    body = SendNotificationSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return data(
        { error: "Validation failed", details: err.errors },
        { status: 400 }
      );
    }
    return data({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate template still has required variables
  const templateValidation = validateTemplate(body.body);
  if (!templateValidation.isValid) {
    return data(
      {
        error: "Template missing required variables",
        missingVariables: templateValidation.missingVariables,
      },
      { status: 400 }
    );
  }

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: { id: true, email: true },
  });

  if (!merchant) {
    return data({ error: "Merchant not found" }, { status: 404 });
  }

  // Verify shipment exists and belongs to merchant
  const shipment = await prisma.shipment.findFirst({
    where: {
      id,
      merchantId: merchant.id,
    },
    select: { id: true, notificationSent: true },
  });

  if (!shipment) {
    return data({ error: "Shipment not found" }, { status: 404 });
  }

  // Enqueue notification job
  // The worker will send the email and update the shipment status
  await enqueueNotificationJob(id, {
    recipientEmail: body.recipientEmail,
    subject: body.subject,
    body: body.body,
    sentBy: merchant.email, // Use merchant email as sender identifier
  });

  return data({
    success: true,
    message: "Notification queued for delivery",
    alreadySent: shipment.notificationSent,
  });
};
