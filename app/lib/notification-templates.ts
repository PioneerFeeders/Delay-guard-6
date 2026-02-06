/**
 * Notification Template Utilities
 *
 * Client-safe utilities for rendering and validating email templates.
 * This file contains NO server-only imports and can be used in client components.
 */

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
 * Format shop domain to a nice shop name
 * e.g., "my-store.myshopify.com" -> "My Store"
 */
export function formatShopName(shopDomain: string): string {
  // Remove .myshopify.com suffix if present
  let name = shopDomain.replace(/\.myshopify\.com$/i, "");

  // Replace hyphens with spaces and capitalize words
  name = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return name;
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
