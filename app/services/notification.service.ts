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
import { MerchantSettingsSchema } from "~/lib/validation";
import { renderHtmlEmail, extractBranding, hasBranding } from "~/lib/email-html";

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

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a notification email via Resend
 *
 * Automatically sends as HTML if the merchant has branding configured
 * (logo or footer contact info). Falls back to plain text otherwise.
 *
 * @param to - Recipient email address
 * @param subject - Email subject
 * @param body - Email body (plain text - will be wrapped in HTML if branding exists)
 * @param fromEmail - Optional custom from email
 * @param settings - Merchant settings (used for branding)
 * @returns SendEmailResult
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
  fromEmail?: string | null,
  settings?: MerchantSettings | null
): Promise<SendEmailResult> {
  try {
    const resend = getResendClient();

    const from =
      fromEmail ||
      process.env.RESEND_FROM_EMAIL ||
      "DelayGuard <noreply@delayguard.app>";

    // Build email payload — HTML if branding exists, plain text otherwise
    const parsedSettings = settings
      ? MerchantSettingsSchema.parse(settings)
      : null;

    const useBranding = parsedSettings && hasBranding(parsedSettings);

    const emailPayload: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
    } = {
      from,
      to,
      subject,
      text: body, // Always include plain text as fallback
    };

    if (useBranding) {
      const branding = extractBranding(parsedSettings);
      emailPayload.html = renderHtmlEmail(body, branding);
    }

    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error("[notification] Failed to send email:", error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[notification] Exception sending email:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

// ============================================================
// Notification Log
// ============================================================

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
      emailBodyPreview: params.emailBody.substring(0, 500),
      status: params.status,
    },
  });
}

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
 * Now passes merchant settings through so the email renderer
 * can apply logo header and contact footer branding.
 */
export async function sendAndLogNotification(params: {
  shipmentId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sentBy: string;
}): Promise<SendEmailResult> {
  const { shipmentId, recipientEmail, subject, body, sentBy } = params;

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
    return { success: false, error: `Shipment not found: ${shipmentId}` };
  }

  const settings = shipment.merchant.settings as MerchantSettings | null;
  const fromEmail = settings?.fromEmail || null;

  // Send the email — settings are passed so branding can be applied
  const result = await sendNotificationEmail(
    recipientEmail,
    subject,
    body,
    fromEmail,
    settings
  );

  await createNotificationLog({
    shipmentId,
    merchantId: shipment.merchantId,
    sentBy,
    recipientEmail,
    emailSubject: subject,
    emailBody: body,
    status: result.success ? "SENT" : "FAILED",
  });

  if (result.success) {
    await markShipmentNotified(shipmentId);
  }

  return result;
}

/**
 * Prepare a notification email with rendered template for preview
 */
export async function prepareNotification(
  shipmentId: string,
  merchantId: string
): Promise<{
  recipientEmail: string;
  subject: string;
  body: string;
  htmlPreview: string | null;
  shipment: {
    id: string;
    orderNumber: string;
    trackingNumber: string;
    customerName: string;
    customerEmail: string;
    carrier: string;
  };
} | null> {
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

  const settings = shipment.merchant.settings as MerchantSettings;
  const parsedSettings = MerchantSettingsSchema.parse(settings);

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

  const subject = renderTemplate(parsedSettings.notificationTemplate.subject, context);
  const body = renderTemplate(parsedSettings.notificationTemplate.body, context);

  // Generate HTML preview if branding is configured
  let htmlPreview: string | null = null;
  if (hasBranding(parsedSettings)) {
    const branding = extractBranding(parsedSettings);
    htmlPreview = renderHtmlEmail(body, branding);
  }

  return {
    recipientEmail: shipment.customerEmail,
    subject,
    body,
    htmlPreview,
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
