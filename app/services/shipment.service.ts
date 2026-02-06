/**
 * Shipment Service
 *
 * Handles creation and management of shipment records from Shopify fulfillments.
 */

import { prisma } from "~/db.server";
import type { Shipment, Carrier } from "@prisma/client";
import type { FulfillmentWebhookPayload, OrderPartial, ShippingAddress } from "~/lib/validation";
import {
  detectCarrier,
  normalizeServiceLevel,
  extractServiceLevelFromCompany,
} from "./carriers/carrier.service";

/**
 * Data required to create a shipment from a fulfillment
 */
export interface CreateShipmentFromFulfillmentParams {
  merchantId: string;
  fulfillment: FulfillmentWebhookPayload;
  order: OrderPartial;
  locationName?: string | null;
}

/**
 * Result of checking for duplicate tracking numbers
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingShipment?: Shipment;
  existingOrderNumber?: string;
}

/**
 * Format shipping address from Shopify format to JSON for storage
 */
function formatShippingAddress(address: ShippingAddress | null | undefined): object {
  if (!address) {
    return {};
  }

  return {
    firstName: address.first_name ?? null,
    lastName: address.last_name ?? null,
    name: address.name ?? null,
    address1: address.address1 ?? null,
    address2: address.address2 ?? null,
    city: address.city ?? null,
    province: address.province ?? null,
    provinceCode: address.province_code ?? null,
    country: address.country ?? null,
    countryCode: address.country_code ?? null,
    zip: address.zip ?? null,
    phone: address.phone ?? null,
    company: address.company ?? null,
  };
}

/**
 * Extract customer name from order data
 */
function extractCustomerName(order: OrderPartial): string {
  // Try shipping address first
  if (order.shipping_address) {
    const addr = order.shipping_address;
    if (addr.name) return addr.name;
    if (addr.first_name || addr.last_name) {
      return `${addr.first_name || ""} ${addr.last_name || ""}`.trim();
    }
  }

  // Fall back to customer info
  if (order.customer) {
    const cust = order.customer;
    if (cust.first_name || cust.last_name) {
      return `${cust.first_name || ""} ${cust.last_name || ""}`.trim();
    }
  }

  return "Unknown Customer";
}

/**
 * Extract customer email from order data
 */
function extractCustomerEmail(order: OrderPartial): string {
  // Try order-level email first
  if (order.email) return order.email;

  // Fall back to customer email
  if (order.customer?.email) return order.customer.email;

  return "";
}

/**
 * Extract customer phone from order data
 */
function extractCustomerPhone(order: OrderPartial): string | null {
  // Try order-level phone first
  if (order.phone) return order.phone;

  // Try shipping address phone
  if (order.shipping_address?.phone) return order.shipping_address.phone;

  // Fall back to customer phone
  if (order.customer?.phone) return order.customer.phone;

  return null;
}

/**
 * Parse order value from order data
 */
function parseOrderValue(order: OrderPartial): number | null {
  if (!order.total_price) return null;

  const value = parseFloat(order.total_price);
  return isNaN(value) ? null : value;
}

/**
 * Get the primary tracking number from a fulfillment
 */
function getPrimaryTrackingNumber(fulfillment: FulfillmentWebhookPayload): string | null {
  // Prefer single tracking_number if available
  if (fulfillment.tracking_number) {
    return fulfillment.tracking_number;
  }

  // Fall back to first tracking number in array
  if (fulfillment.tracking_numbers && fulfillment.tracking_numbers.length > 0) {
    return fulfillment.tracking_numbers[0];
  }

  return null;
}

/**
 * Check if a tracking number already exists for this merchant
 */
export async function checkDuplicateTrackingNumber(
  merchantId: string,
  trackingNumber: string,
  excludeFulfillmentId?: string
): Promise<DuplicateCheckResult> {
  const existing = await prisma.shipment.findFirst({
    where: {
      merchantId,
      trackingNumber,
      ...(excludeFulfillmentId && {
        NOT: { shopifyFulfillmentId: excludeFulfillmentId },
      }),
    },
  });

  if (existing) {
    return {
      isDuplicate: true,
      existingShipment: existing,
      existingOrderNumber: existing.orderNumber,
    };
  }

  return { isDuplicate: false };
}

/**
 * Create a new shipment record from a Shopify fulfillment webhook payload.
 * Returns existing shipment if one already exists for this fulfillment.
 */
export async function createShipmentFromFulfillment(
  params: CreateShipmentFromFulfillmentParams
): Promise<{ shipment: Shipment; isNew: boolean; isDuplicate?: boolean }> {
  const { merchantId, fulfillment, order, locationName } = params;

  const shopifyFulfillmentId = String(fulfillment.id);
  const shopifyOrderId = String(fulfillment.order_id);
  const trackingNumber = getPrimaryTrackingNumber(fulfillment);

  // If no tracking number, we still create the shipment but mark carrier as UNKNOWN
  // This allows us to track it when a tracking number is added later

  // Check if shipment already exists for this fulfillment
  const existingShipment = await prisma.shipment.findUnique({
    where: {
      merchantId_shopifyFulfillmentId: {
        merchantId,
        shopifyFulfillmentId,
      },
    },
  });

  if (existingShipment) {
    return { shipment: existingShipment, isNew: false };
  }

  // Detect carrier from company name and tracking number
  const carrier: Carrier = trackingNumber
    ? detectCarrier(fulfillment.tracking_company, trackingNumber)
    : "UNKNOWN";

  // Determine service level
  let serviceLevel = normalizeServiceLevel(fulfillment.service);
  if (!serviceLevel && fulfillment.tracking_company) {
    serviceLevel = extractServiceLevelFromCompany(fulfillment.tracking_company);
  }

  // Check for duplicate tracking number (different fulfillment with same tracking)
  let isDuplicate = false;
  if (trackingNumber) {
    const duplicateCheck = await checkDuplicateTrackingNumber(
      merchantId,
      trackingNumber,
      shopifyFulfillmentId
    );
    isDuplicate = duplicateCheck.isDuplicate;
  }

  // Calculate initial next poll time (poll soon for new shipments)
  const now = new Date();
  const nextPollAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes from now

  // Create the shipment
  const shipment = await prisma.shipment.create({
    data: {
      merchantId,
      shopifyOrderId,
      shopifyFulfillmentId,
      orderNumber: order.name,
      trackingNumber: trackingNumber || "",
      carrier,
      serviceLevel,
      customerName: extractCustomerName(order),
      customerEmail: extractCustomerEmail(order),
      customerPhone: extractCustomerPhone(order),
      shippingAddress: formatShippingAddress(order.shipping_address),
      shipDate: new Date(fulfillment.created_at),
      currentStatus: fulfillment.shipment_status || "pending",
      fulfillmentLocationId: fulfillment.location_id ? String(fulfillment.location_id) : null,
      fulfillmentLocationName: locationName || null,
      orderValue: parseOrderValue(order),
      nextPollAt: trackingNumber ? nextPollAt : null, // Only poll if we have a tracking number
    },
  });

  return { shipment, isNew: true, isDuplicate };
}

/**
 * Update an existing shipment when fulfillment is updated.
 * Mainly handles tracking number or carrier changes.
 */
export async function updateShipmentFromFulfillment(
  merchantId: string,
  fulfillment: FulfillmentWebhookPayload
): Promise<Shipment | null> {
  const shopifyFulfillmentId = String(fulfillment.id);
  const trackingNumber = getPrimaryTrackingNumber(fulfillment);

  // Find the existing shipment
  const existing = await prisma.shipment.findUnique({
    where: {
      merchantId_shopifyFulfillmentId: {
        merchantId,
        shopifyFulfillmentId,
      },
    },
  });

  if (!existing) {
    return null;
  }

  // Check if tracking number changed
  const trackingChanged = trackingNumber && trackingNumber !== existing.trackingNumber;

  // Only update if tracking info has changed
  if (!trackingChanged && fulfillment.tracking_company === undefined) {
    return existing;
  }

  // Re-detect carrier if tracking number or company changed
  let newCarrier = existing.carrier;
  if (trackingChanged || fulfillment.tracking_company) {
    newCarrier = detectCarrier(
      fulfillment.tracking_company ?? null,
      trackingNumber ?? existing.trackingNumber
    );
  }

  // Determine updated service level
  let newServiceLevel = existing.serviceLevel;
  if (fulfillment.service) {
    newServiceLevel = normalizeServiceLevel(fulfillment.service);
  } else if (trackingChanged && fulfillment.tracking_company) {
    newServiceLevel = extractServiceLevelFromCompany(fulfillment.tracking_company);
  }

  // Calculate next poll time if tracking number was just added
  const shouldStartPolling = trackingNumber && !existing.trackingNumber;
  const nextPollAt = shouldStartPolling
    ? new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
    : existing.nextPollAt;

  // Update the shipment
  const updated = await prisma.shipment.update({
    where: { id: existing.id },
    data: {
      trackingNumber: trackingNumber || existing.trackingNumber,
      carrier: newCarrier,
      serviceLevel: newServiceLevel,
      currentStatus: fulfillment.shipment_status || existing.currentStatus,
      nextPollAt,
      // Reset poll error count if tracking number changed
      pollErrorCount: trackingChanged ? 0 : existing.pollErrorCount,
    },
  });

  return updated;
}

/**
 * Get a shipment by ID
 */
export async function getShipmentById(id: string): Promise<Shipment | null> {
  return prisma.shipment.findUnique({
    where: { id },
  });
}

/**
 * Get a shipment by merchant ID and Shopify fulfillment ID
 */
export async function getShipmentByFulfillmentId(
  merchantId: string,
  shopifyFulfillmentId: string
): Promise<Shipment | null> {
  return prisma.shipment.findUnique({
    where: {
      merchantId_shopifyFulfillmentId: {
        merchantId,
        shopifyFulfillmentId,
      },
    },
  });
}

/**
 * Mark a shipment's next poll time
 */
export async function scheduleNextPoll(
  shipmentId: string,
  nextPollAt: Date
): Promise<Shipment> {
  return prisma.shipment.update({
    where: { id: shipmentId },
    data: { nextPollAt },
  });
}

/**
 * Mark a shipment as having a carrier scan (counts toward billing)
 */
export async function markShipmentHasCarrierScan(shipmentId: string): Promise<Shipment> {
  return prisma.shipment.update({
    where: { id: shipmentId },
    data: { hasCarrierScan: true },
  });
}

/**
 * Archive delivered shipments that have exceeded the auto-archive days threshold
 */
export async function archiveOldDeliveredShipments(
  merchantId: string,
  autoArchiveDays: number
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - autoArchiveDays);

  const result = await prisma.shipment.updateMany({
    where: {
      merchantId,
      isDelivered: true,
      deliveredAt: { lte: cutoffDate },
      isArchived: false,
    },
    data: { isArchived: true },
  });

  return result.count;
}
