/**
 * Delay Detection Service
 *
 * Evaluates whether a shipment is delayed based on:
 * 1. Carrier-reported exceptions (explicit delay flag from carrier API)
 * 2. Past expected delivery date + grace period
 *
 * Uses a cascade of expected delivery date sources:
 * 1. Carrier-provided expected delivery date (from tracking API)
 * 2. Previously calculated expected delivery date (stored on shipment)
 * 3. Default delivery window based on service level + ship date
 *
 * Merchants can override default delivery windows in their settings.
 */

import type { Carrier, Shipment, DeliverySource, Prisma } from "@prisma/client";
import type { TrackingResult } from "./carriers/carrier.interface";
import type { MerchantSettings } from "~/lib/validation";
import {
  calculateExpectedDeliveryDate,
  calculateDaysDelayed,
  isPastDeadline,
} from "~/lib/business-days";

/**
 * Result of delay evaluation
 */
export interface DelayEvaluationResult {
  /** Whether the shipment should be flagged as delayed */
  isDelayed: boolean;
  /** Reason for delay (null if not delayed) */
  delayReason: DelayReason | null;
  /** Number of days past expected delivery (0 if not delayed) */
  daysDelayed: number;
  /** The expected delivery date used for evaluation */
  expectedDeliveryDate: Date | null;
  /** Source of the expected delivery date */
  expectedDeliverySource: DeliverySource;
}

/**
 * Possible reasons for delay
 */
export type DelayReason =
  | "CARRIER_EXCEPTION" // Carrier explicitly reported exception status
  | "PAST_EXPECTED_DELIVERY"; // Past expected delivery + grace period

/**
 * Default delivery windows in business days by normalized service level key.
 * These are used when the carrier doesn't provide an expected delivery date.
 */
export const DEFAULT_DELIVERY_WINDOWS: Record<string, number> = {
  // UPS
  ups_next_day_air: 1,
  ups_next_day_air_early: 1,
  ups_next_day_air_saver: 1,
  ups_2nd_day_air: 2,
  ups_2nd_day_air_am: 2,
  ups_3_day_select: 3,
  ups_ground: 5,
  ups_standard: 5,
  // FedEx
  fedex_first_overnight: 1,
  fedex_priority_overnight: 1,
  fedex_standard_overnight: 1,
  fedex_overnight: 1,
  fedex_2day: 2,
  fedex_2day_am: 2,
  fedex_express_saver: 3,
  fedex_ground: 5,
  fedex_home_delivery: 5,
  // USPS
  usps_priority_mail_express: 2,
  usps_priority_express: 2,
  usps_priority_mail: 3,
  usps_priority: 3,
  usps_ground_advantage: 7,
  usps_first_class: 5,
  usps_parcel_select: 7,
  usps_retail_ground: 7,
  // Generic fallbacks
  overnight: 1,
  express: 2,
  priority: 3,
  standard: 5,
  ground: 5,
  economy: 7,
};

/**
 * Fallback delivery windows by carrier when service level is unknown.
 */
export const DEFAULT_CARRIER_WINDOWS: Record<Carrier, number> = {
  UPS: 5,
  FEDEX: 5,
  USPS: 7,
  UNKNOWN: 7,
};

/**
 * Normalize a service level string to a standard key format.
 * Handles various formats like:
 * - "UPS GROUND" -> "ups_ground"
 * - "UPS® Ground" -> "ups_ground"
 * - "Ground" (with UPS carrier) -> "ups_ground"
 * - "FedEx Home Delivery" -> "fedex_home_delivery"
 * - "Priority Mail Express" -> "usps_priority_mail_express"
 *
 * @param serviceLevel - The raw service level string from Shopify/carrier
 * @param carrier - The carrier (used for prefix when not in service level)
 * @returns Normalized service level key
 */
export function normalizeServiceLevel(
  serviceLevel: string | null | undefined,
  carrier: Carrier
): string | null {
  if (!serviceLevel) {
    return null;
  }

  // Convert to lowercase, remove special characters, normalize whitespace
  let normalized = serviceLevel
    .toLowerCase()
    .replace(/®|™|©/g, "") // Remove trademark symbols
    .replace(/[^\w\s]/g, " ") // Replace non-word chars with spaces
    .replace(/\s+/g, " ") // Normalize multiple spaces
    .trim();

  // If the service level doesn't already contain the carrier prefix,
  // add it based on the carrier enum
  const carrierPrefix = carrier.toLowerCase();
  if (carrier !== "UNKNOWN" && !normalized.startsWith(carrierPrefix)) {
    normalized = `${carrierPrefix} ${normalized}`;
  }

  // Convert spaces to underscores
  normalized = normalized.replace(/\s+/g, "_");

  return normalized;
}

/**
 * Get the delivery window (in business days) for a given service level.
 * Checks in order:
 * 1. Merchant overrides from settings
 * 2. Default delivery windows by normalized service level
 * 3. Default carrier window as fallback
 *
 * @param serviceLevel - The raw service level string
 * @param carrier - The carrier
 * @param merchantOverrides - Merchant's custom delivery window overrides
 * @returns Number of business days for delivery
 */
export function getDeliveryWindow(
  serviceLevel: string | null | undefined,
  carrier: Carrier,
  merchantOverrides?: Record<string, number>
): number {
  const normalizedKey = normalizeServiceLevel(serviceLevel, carrier);

  // Check merchant overrides first
  if (normalizedKey && merchantOverrides && normalizedKey in merchantOverrides) {
    return merchantOverrides[normalizedKey];
  }

  // Check default delivery windows
  if (normalizedKey && normalizedKey in DEFAULT_DELIVERY_WINDOWS) {
    return DEFAULT_DELIVERY_WINDOWS[normalizedKey];
  }

  // Fallback to carrier default
  return DEFAULT_CARRIER_WINDOWS[carrier];
}

/**
 * Calculate the expected delivery date for a shipment.
 *
 * @param shipDate - When the shipment was created/shipped
 * @param serviceLevel - The shipping service level
 * @param carrier - The carrier
 * @param merchantOverrides - Merchant's custom delivery window overrides
 * @returns The calculated expected delivery date
 */
export function calculateDefaultExpectedDelivery(
  shipDate: Date,
  serviceLevel: string | null | undefined,
  carrier: Carrier,
  merchantOverrides?: Record<string, number>
): Date {
  const businessDays = getDeliveryWindow(serviceLevel, carrier, merchantOverrides);
  return calculateExpectedDeliveryDate(shipDate, businessDays);
}

/**
 * Data needed to evaluate delay for a shipment
 */
export interface ShipmentData {
  shipDate: Date;
  expectedDeliveryDate: Date | null;
  expectedDeliverySource: DeliverySource;
  serviceLevel: string | null;
  carrier: Carrier;
  rescheduledDeliveryDate: Date | null;
  isDelivered: boolean;
}

/**
 * Evaluate whether a shipment is delayed based on tracking result and shipment data.
 *
 * The evaluation follows this logic:
 * 1. If delivered, not delayed
 * 2. If carrier reports exception, delayed (reason: CARRIER_EXCEPTION)
 * 3. If past expected delivery + grace period, delayed (reason: PAST_EXPECTED_DELIVERY)
 * 4. Otherwise, not delayed
 *
 * Expected delivery date is determined from:
 * 1. Carrier-provided date from tracking result (if available)
 * 2. Rescheduled date from tracking result (if carrier rescheduled)
 * 3. Previously stored expected delivery date on shipment
 * 4. Default calculation based on ship date + service level window
 *
 * @param shipment - The shipment data
 * @param trackingResult - The result from carrier tracking API (optional)
 * @param merchantSettings - The merchant's settings (for delay threshold and overrides)
 * @param now - Current date/time (optional, for testing)
 * @returns Delay evaluation result
 */
export function evaluateDelay(
  shipment: ShipmentData,
  trackingResult: TrackingResult | null,
  merchantSettings: MerchantSettings,
  now: Date = new Date()
): DelayEvaluationResult {
  // If already delivered, not delayed
  if (shipment.isDelivered || trackingResult?.isDelivered) {
    return {
      isDelayed: false,
      delayReason: null,
      daysDelayed: 0,
      expectedDeliveryDate: shipment.expectedDeliveryDate,
      expectedDeliverySource: shipment.expectedDeliverySource,
    };
  }

  // Rule 1: Carrier explicitly reports exception
  if (trackingResult?.isException) {
    // Still need to determine expected delivery for daysDelayed calculation
    const { expectedDeliveryDate, expectedDeliverySource } = determineExpectedDeliveryDate(
      shipment,
      trackingResult,
      merchantSettings
    );

    const daysDelayed = expectedDeliveryDate
      ? calculateDaysDelayed(expectedDeliveryDate, now)
      : 0;

    return {
      isDelayed: true,
      delayReason: "CARRIER_EXCEPTION",
      daysDelayed,
      expectedDeliveryDate,
      expectedDeliverySource,
    };
  }

  // Determine the expected delivery date from available sources
  const { expectedDeliveryDate, expectedDeliverySource } = determineExpectedDeliveryDate(
    shipment,
    trackingResult,
    merchantSettings
  );

  // If we can't determine expected delivery, we can't evaluate delay
  if (!expectedDeliveryDate) {
    return {
      isDelayed: false,
      delayReason: null,
      daysDelayed: 0,
      expectedDeliveryDate: null,
      expectedDeliverySource: "DEFAULT",
    };
  }

  // Rule 2: Past expected delivery + grace period
  const graceHours = merchantSettings.delayThresholdHours;

  // If carrier rescheduled delivery, use that date for evaluation
  const dateToCheck = trackingResult?.rescheduledDeliveryDate ?? expectedDeliveryDate;

  if (isPastDeadline(dateToCheck, graceHours, now)) {
    return {
      isDelayed: true,
      delayReason: "PAST_EXPECTED_DELIVERY",
      daysDelayed: calculateDaysDelayed(expectedDeliveryDate, now),
      expectedDeliveryDate,
      expectedDeliverySource,
    };
  }

  // Not delayed
  return {
    isDelayed: false,
    delayReason: null,
    daysDelayed: 0,
    expectedDeliveryDate,
    expectedDeliverySource,
  };
}

/**
 * Determine the expected delivery date from available sources.
 * Priority:
 * 1. Carrier-provided date from tracking result
 * 2. Previously stored date on shipment (if source was CARRIER or MERCHANT_OVERRIDE)
 * 3. Default calculation from ship date + service level
 */
function determineExpectedDeliveryDate(
  shipment: ShipmentData,
  trackingResult: TrackingResult | null,
  merchantSettings: MerchantSettings
): { expectedDeliveryDate: Date | null; expectedDeliverySource: DeliverySource } {
  // 1. Carrier-provided from tracking result
  if (trackingResult?.expectedDeliveryDate) {
    return {
      expectedDeliveryDate: trackingResult.expectedDeliveryDate,
      expectedDeliverySource: "CARRIER",
    };
  }

  // 2. If shipment has a stored date from carrier or merchant override, use it
  if (
    shipment.expectedDeliveryDate &&
    (shipment.expectedDeliverySource === "CARRIER" ||
      shipment.expectedDeliverySource === "MERCHANT_OVERRIDE")
  ) {
    return {
      expectedDeliveryDate: shipment.expectedDeliveryDate,
      expectedDeliverySource: shipment.expectedDeliverySource,
    };
  }

  // 3. Calculate from ship date + service level window
  const calculatedDate = calculateDefaultExpectedDelivery(
    shipment.shipDate,
    shipment.serviceLevel,
    shipment.carrier,
    merchantSettings.deliveryWindows
  );

  return {
    expectedDeliveryDate: calculatedDate,
    expectedDeliverySource: "DEFAULT",
  };
}

/**
 * Convert a full Prisma Shipment to ShipmentData for evaluation.
 * This allows evaluateDelay to work with both full Prisma models
 * and lighter-weight data objects.
 */
export function toShipmentData(shipment: Shipment): ShipmentData {
  return {
    shipDate: shipment.shipDate,
    expectedDeliveryDate: shipment.expectedDeliveryDate,
    expectedDeliverySource: shipment.expectedDeliverySource,
    serviceLevel: shipment.serviceLevel,
    carrier: shipment.carrier,
    rescheduledDeliveryDate: shipment.rescheduledDeliveryDate,
    isDelivered: shipment.isDelivered,
  };
}

/**
 * Generate the database update fields from delay evaluation result.
 * This is used by the carrier-poll worker to update the shipment record.
 */
export function getDelayUpdateFields(
  result: DelayEvaluationResult,
  wasDelayed: boolean,
  now: Date = new Date()
): Prisma.ShipmentUpdateInput {
  const update: Prisma.ShipmentUpdateInput = {
    isDelayed: result.isDelayed,
    daysDelayed: result.daysDelayed,
  };

  // Update expected delivery date if we determined one
  if (result.expectedDeliveryDate) {
    update.expectedDeliveryDate = result.expectedDeliveryDate;
    update.expectedDeliverySource = result.expectedDeliverySource;
  }

  // If newly flagged as delayed, set delayFlaggedAt
  if (result.isDelayed && !wasDelayed) {
    update.delayFlaggedAt = now;
  }

  return update;
}

/**
 * Get all supported service level keys for a carrier.
 * Useful for displaying options in settings.
 */
export function getCarrierServiceLevels(carrier: Carrier): string[] {
  const prefix = carrier.toLowerCase() + "_";
  return Object.keys(DEFAULT_DELIVERY_WINDOWS).filter((key) =>
    key.startsWith(prefix)
  );
}

/**
 * Get a human-readable label for a service level key.
 */
export function getServiceLevelLabel(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
