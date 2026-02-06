/**
 * Notification Service
 *
 * Handles rendering email templates with shipment data and sending notification
 * emails to customers via Resend.
 */

import { Resend } from "resend";
import { prisma } from "~/db.server";
import type { MerchantSettings } from "~/lib/validation";

// ============================================================
// Template Variables
// ============================================================

/**
 * Template variable names and their descriptions
 * Used for validation and reference
 */
export const TEMPLATE_VARIABLES = [
  "{customer_first_name}",
  "{customer_full_name}",
  "{order_number}",
  "{tracking_number}",
  "{carrier_name}",
  "{carrier_status}",
  "{tracking_url}",
  "{expected_delivery_date}",
  "{shop_name}",
] as const;

/**
 * Required variables that must be present in templates
 */
export const REQUIRED_TEMPLATE_VARIABLES = [
  "{tracking_number}",
  "{order_number}",
] as const;

/**
 * Data context for rendering email templates
 */
export interface TemplateContext {
  customerFirstName: string;
  customerFullName: string;
  orderNumber: string;
  trackingNumber: string;
  carrierName: string;
  carrierStatus: string;
  trackingUrl: string;
  expectedDeliveryDate: string;
  shopName: string;
}

// ============================================================
// Template Rendering
// ============================================================

/**
 * Get carrier tracking URL based on carrier and tracking number
 */
export function getCarrierTrackingUrl(
  carrier: string,
  trackingNumber: string
): string {
  switch (carrier.toUpperCase()) {
    case "UPS":
      return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`;
    case "FEDEX":
      return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
    case "USPS":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`;
    default:
      return "";
  }
}

/**
 * Format carrier name for display
 */
export function formatCarrierName(carrier: string): string {
  switch (carrier.toUpperCase()) {
    case "UPS":
      return "UPS";
    case "FEDEX":
      return "FedEx";
    case "USPS":
      return "USPS";
    case "UNKNOWN":
      return "Unknown Carrier";
    default:
      return carrier;
  }
}

/**
 * Extract first name from a full name string
 */
export function extractFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || fullName;
}

/**
 * Render an email template by replacing variables with actual values
 *
 * @param template - The template string with {variable} placeholders
 * @param context - The data context for variable replacement
 * @returns The rendered string with all variables replaced
 */
export function renderTemplate(
  template: string,
  context: TemplateContext
): string {
  const replacements: Record<string, string> = {
    "{customer_first_name}": context.customerFirstName,
    "{customer_full_name}": context.customerFullName,
    "{order_number}": context.orderNumber,
    "{tracking_number}": context.trackingNumber,
    "{carrier_name}": context.carrierName,
    "{carrier_status}": context.carrierStatus,
    "{tracking_url}": context.trackingUrl,
    "{expected_delivery_date}": context.expectedDeliveryDate,
    "{shop_name}": context.shopName,
  };

  let result = template;
  for (const [variable, value] of Object.entries(replacements)) {
    result = result.replaceAll(variable, value);
  }

  return result;
}

/**
 * Validate that a template contains all required variables
 *
 * @param template - The template string to validate
 * @returns Object with isValid boolean and missing variables array
 */
export function validateTemplate(template: string): {
  isValid: boolean;
  missingVariables: string[];
} {
  const missingVariables: string[] = [];

  for (const variable of REQUIRED_TEMPLATE_VARIABLES) {
    if (!template.includes(variable)) {
      missingVariables.push(variable);
    }
  }

  return {
    isValid: missingVariables.length === 0,
    missingVariables,
  };
}

/**
 * Build a template context from shipment data
 *
 * @param shipment - The shipment to build context for
 * @param shopDomain - The merchant's shop domain for shop name
 * @returns TemplateContext for rendering templates
 */
export function buildTemplateContext(
  shipment: {
    customerName: string;
    orderNumber: string;
    trackingNumber: string;
    carrier: string;
    currentStatus: string;
    lastCarrierStatus: string | null;
    expectedDeliveryDate: Date | null;
  },
  shopDomain: string
): TemplateContext {
  const carrierStatus = shipment.lastCarrierStatus || shipment.currentStatus;
  const expectedDate = shipment.expectedDeliveryDate
    ? shipment.expectedDeliveryDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Not available";

  return {
    customerFirstName: extractFirstName(shipment.customerName),
    customerFullName: shipment.customerName,
    orderNumber: shipment.orderNumber,
    trackingNumber: shipment.trackingNumber,
    carrierName: formatCarrierName(shipment.carrier),
    carrierStatus,
    trackingUrl: getCarrierTrackingUrl(shipment.carrier, shipment.trackingNumber),
    expectedDeliveryDate: expectedDate,
    shopName: formatShopName(shopDomain),
  };
}

/**
 * Format shop domain to a nice shop name
 * e.g., "my-store.myshopify.com" -> "My Store"
 */
function formatShopName(shopDomain: string): string {
  // Remove .myshopify.com suffix if present
  let name = shopDomain.replace(/\.myshopify\.com$/i, "");

  // Replace hyphens with spaces and capitalize words
  name = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return name;
}

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
