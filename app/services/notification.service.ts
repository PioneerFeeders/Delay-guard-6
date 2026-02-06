/**
 * Notification Service (Server-side)
 *
 * Handles sending notification emails to customers via Resend and logging to database.
 *
 * NOTE: Template rendering utilities are in ~/lib/notification-templates.ts
 * to allow client-side usage. Re-exported here for backwards compatibility.
 */

import { Resend } from "resend";
import { prisma } from "~/db.server";
import type { MerchantSettings } from "~/lib/validation";

// Re-export client-safe utilities for backwards compatibility with server code
export {
  TEMPLATE_VARIABLES,
  REQUIRED_TEMPLATE_VARIABLES,
  type TemplateContext,
  getCarrierTrackingUrl,
  formatCarrierName,
  extractFirstName,
  renderTemplate,
  validateTemplate,
  buildTemplateContext,
  formatShopName,
} from "~/lib/notification-templates";

// Import for local use
import { buildTemplateContext, renderTemplate } from "~/lib/notification-templates";

// ============================================================
// Email Sending via Resend
// ============================================================

/**
 * Resend client singleton
 */
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Result of sending a notification email
 */
export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a notification email via Resend
 *
 * @param to - Recipient email address
 * @param subject - Email subject
 * @param body - Email body (plain text)
 * @param fromEmail - Optional custom from email (defaults to noreply@delayguard.app)
 * @returns SendEmailResult with success status and optional message ID or error
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
  fromEmail?: string | null
): Promise<SendEmailResult> {
  try {
    const resend = getResendClient();

    // Use custom from email if provided, otherwise use default
    const from = fromEmail || process.env.RESEND_FROM_EMAIL || "DelayGuard <noreply@delayguard.app>";

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text: body,
    });

    if (error) {
      console.error("[notification] Failed to send email:", error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[notification] Exception sending email:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================================
// Notification Log
// ============================================================

/**
 * Create a notification log entry in the database
 *
 * @param params - Parameters for the notification log
 * @returns The created NotificationLog record
 */
export async function createNotificationLog(params: {
  shipmentId: string;
  merchantId: string;
  sentBy: string;
  recipientEmail: string;
  emailSubject: string;
  emailBody: string;
  status: "SENT" | "FAILED";
}) {
  return prisma.notificationLog.create({
    data: {
      shipmentId: params.shipmentId,
      merchantId: params.merchantId,
      sentBy: params.sentBy,
      recipientEmail: params.recipientEmail,
      emailSubject: params.emailSubject,
      emailBodyPreview: params.emailBody.substring(0, 500), // Store preview only
      status: params.status,
    },
  });
}

/**
 * Mark a shipment as notified
 *
 * @param shipmentId - The shipment ID to mark as notified
 */
export async function markShipmentNotified(shipmentId: string): Promise<void> {
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      notificationSent: true,
      notificationSentAt: new Date(),
    },
  });
}

// ============================================================
// High-Level Notification Functions
// ============================================================

/**
 * Send a notification for a shipment and log the result
 *
 * This is the main function used by the notification worker.
 * It sends the email, creates a log entry, and updates the shipment status.
 *
 * @param params - Notification parameters
 * @returns Result of the notification send operation
 */
export async function sendAndLogNotification(params: {
  shipmentId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sentBy: string;
}): Promise<SendEmailResult> {
  const { shipmentId, recipientEmail, subject, body, sentBy } = params;

  // Load shipment to get merchant info
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      merchantId: true,
      merchant: {
        select: {
          settings: true,
        },
      },
    },
  });

  if (!shipment) {
    return {
      success: false,
      error: `Shipment not found: ${shipmentId}`,
    };
  }

  // Get from email from merchant settings if available
  const settings = shipment.merchant.settings as MerchantSettings | null;
  const fromEmail = settings?.fromEmail || null;

  // Send the email
  const result = await sendNotificationEmail(recipientEmail, subject, body, fromEmail);

  // Log the notification
  await createNotificationLog({
    shipmentId,
    merchantId: shipment.merchantId,
    sentBy,
    recipientEmail,
    emailSubject: subject,
    emailBody: body,
    status: result.success ? "SENT" : "FAILED",
  });

  // If successful, mark shipment as notified
  if (result.success) {
    await markShipmentNotified(shipmentId);
  }

  return result;
}

/**
 * Prepare a notification email with rendered template for preview
 *
 * This is used by the API endpoint to prepare the notification modal content.
 *
 * @param shipmentId - The shipment to prepare notification for
 * @param merchantId - The merchant ID for validation
 * @returns Prepared notification data or null if shipment not found
 */
export async function prepareNotification(
  shipmentId: string,
  merchantId: string
): Promise<{
  recipientEmail: string;
  subject: string;
  body: string;
  shipment: {
    id: string;
    orderNumber: string;
    trackingNumber: string;
    customerName: string;
    customerEmail: string;
    carrier: string;
  };
} | null> {
  // Load shipment with merchant info
  const shipment = await prisma.shipment.findFirst({
    where: {
      id: shipmentId,
      merchantId,
    },
    include: {
      merchant: {
        select: {
          shopDomain: true,
          settings: true,
        },
      },
    },
  });

  if (!shipment) {
    return null;
  }

  // Parse merchant settings
  const settings = shipment.merchant.settings as MerchantSettings;

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
    shipment.merchant.shopDomain
  );

  // Render subject and body
  const subject = renderTemplate(settings.notificationTemplate.subject, context);
  const body = renderTemplate(settings.notificationTemplate.body, context);

  return {
    recipientEmail: shipment.customerEmail,
    subject,
    body,
    shipment: {
      id: shipment.id,
      orderNumber: shipment.orderNumber,
      trackingNumber: shipment.trackingNumber,
      customerName: shipment.customerName,
      customerEmail: shipment.customerEmail,
      carrier: shipment.carrier,
    },
  };
}
