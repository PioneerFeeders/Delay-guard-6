/**
 * Carrier Service
 *
 * Provides carrier detection and normalization logic for tracking numbers.
 * Detects carrier from either the Shopify-provided tracking_company or
 * by analyzing the tracking number format.
 *
 * Also provides a unified interface to route tracking requests to the
 * appropriate carrier adapter (UPS, FedEx, USPS).
 */

import type { Carrier } from "@prisma/client";
import type { CarrierAdapter, CarrierTrackingResponse, CarrierError } from "./carrier.interface";
import { getUpsAdapter } from "./ups.adapter";
import { getFedexAdapter } from "./fedex.adapter";
import { getUspsAdapter } from "./usps.adapter";

/**
 * Carrier tracking number patterns based on spec section 6.2
 *
 * Pattern matching order is critical - more specific patterns must be checked first.
 * Using a flat ordered list where each entry is checked in sequence.
 */
const CARRIER_PATTERN_ORDER: Array<{ carrier: Exclude<Carrier, "UNKNOWN">; pattern: RegExp }> = [
  // === HIGHLY SPECIFIC PATTERNS (prefix-based) ===

  // UPS - very distinctive 1Z prefix
  { carrier: "UPS", pattern: /^1Z[A-Z0-9]{16}$/i }, // Standard 1Z tracking number
  { carrier: "UPS", pattern: /^T[A-Z0-9]{10}$/i }, // UPS Mail Innovations

  // USPS - specific prefixes
  { carrier: "USPS", pattern: /^94[0-9]{20}$/ }, // Priority Mail Express (22 digits, starts with 94)
  { carrier: "USPS", pattern: /^92[0-9]{20}$/ }, // Priority Mail (22 digits, starts with 92)
  { carrier: "USPS", pattern: /^93[0-9]{20}$/ }, // Certified Mail (22 digits, starts with 93)
  { carrier: "USPS", pattern: /^420[0-9]{5,9}[0-9]{16,22}$/ }, // USPS with ZIP prefix
  { carrier: "USPS", pattern: /^[A-Z]{2}[0-9]{9}US$/i }, // International format

  // FedEx - specific prefixes
  { carrier: "FEDEX", pattern: /^96[0-9]{10,22}$/ }, // SmartPost (starts with 96)
  { carrier: "FEDEX", pattern: /^61[0-9]{18}$/ }, // FedEx Ground 96

  // === LENGTH-BASED PATTERNS (less specific, checked last) ===
  // These are fallbacks when no specific prefix matches

  { carrier: "FEDEX", pattern: /^[0-9]{12}$/ }, // Express (12 digits)
  { carrier: "FEDEX", pattern: /^[0-9]{15}$/ }, // Ground (15 digits)
  { carrier: "USPS", pattern: /^[0-9]{20}$/ }, // USPS Standard 20 digits
  { carrier: "FEDEX", pattern: /^[0-9]{22}$/ }, // Ground/Home Delivery (22 digits) - FedEx uses 22 digits too
];

/**
 * Mapping of common carrier name variations to our Carrier enum
 */
const CARRIER_NAME_MAP: Record<string, Carrier> = {
  // UPS variants
  ups: "UPS",
  "united parcel service": "UPS",
  "ups ground": "UPS",
  "ups next day air": "UPS",
  "ups 2nd day air": "UPS",
  "ups surepost": "UPS",
  "ups mail innovations": "UPS",

  // FedEx variants
  fedex: "FEDEX",
  "federal express": "FEDEX",
  "fedex ground": "FEDEX",
  "fedex express": "FEDEX",
  "fedex home delivery": "FEDEX",
  "fedex smartpost": "FEDEX",
  "fedex 2day": "FEDEX",
  "fedex overnight": "FEDEX",

  // USPS variants
  usps: "USPS",
  "usps priority mail": "USPS",
  "usps priority mail express": "USPS",
  "usps ground advantage": "USPS",
  "usps first class": "USPS",
  "united states postal service": "USPS",
  "us postal service": "USPS",
};

/**
 * Detect carrier from tracking company name provided by Shopify.
 * Falls back to UNKNOWN if no match found.
 */
export function detectCarrierFromCompany(trackingCompany: string | null | undefined): Carrier {
  if (!trackingCompany) {
    return "UNKNOWN";
  }

  const normalized = trackingCompany.toLowerCase().trim();

  // Direct lookup
  const directMatch = CARRIER_NAME_MAP[normalized];
  if (directMatch) {
    return directMatch;
  }

  // Partial match - check if any key is contained in the company name
  for (const [key, carrier] of Object.entries(CARRIER_NAME_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return carrier;
    }
  }

  return "UNKNOWN";
}

/**
 * Detect carrier from tracking number format.
 * Falls back to UNKNOWN if no pattern matches.
 */
export function detectCarrierFromTrackingNumber(trackingNumber: string | null | undefined): Carrier {
  if (!trackingNumber) {
    return "UNKNOWN";
  }

  const cleaned = trackingNumber.replace(/[\s-]/g, "").toUpperCase();

  // Check patterns in order - more specific patterns are first in the list
  for (const { carrier, pattern } of CARRIER_PATTERN_ORDER) {
    if (pattern.test(cleaned)) {
      return carrier;
    }
  }

  return "UNKNOWN";
}

/**
 * Detect carrier using both tracking company and tracking number.
 * Priority: tracking_company from Shopify > tracking number pattern detection
 */
export function detectCarrier(
  trackingCompany: string | null | undefined,
  trackingNumber: string | null | undefined
): Carrier {
  // First try to detect from the company name (more reliable)
  const fromCompany = detectCarrierFromCompany(trackingCompany);
  if (fromCompany !== "UNKNOWN") {
    return fromCompany;
  }

  // Fallback to tracking number pattern detection
  return detectCarrierFromTrackingNumber(trackingNumber);
}

/**
 * Normalize service level string to a standard format.
 * Examples: "UPS GROUND" -> "ups_ground", "FedEx Home Delivery" -> "fedex_home_delivery"
 */
export function normalizeServiceLevel(serviceLevel: string | null | undefined): string | null {
  if (!serviceLevel) {
    return null;
  }

  return serviceLevel
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Build tracking URL for a given carrier and tracking number.
 */
export function buildTrackingUrl(carrier: Carrier, trackingNumber: string): string | null {
  const encodedNumber = encodeURIComponent(trackingNumber);

  switch (carrier) {
    case "UPS":
      return `https://www.ups.com/track?tracknum=${encodedNumber}`;
    case "FEDEX":
      return `https://www.fedex.com/fedextrack/?trknbr=${encodedNumber}`;
    case "USPS":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedNumber}`;
    case "UNKNOWN":
    default:
      return null;
  }
}

/**
 * Validate that a tracking number appears to be in a valid format.
 * This is a basic validation, not a guarantee that the number exists.
 */
export function isValidTrackingNumber(trackingNumber: string | null | undefined): boolean {
  if (!trackingNumber) {
    return false;
  }

  const cleaned = trackingNumber.replace(/[\s-]/g, "");

  // Basic validation: must be alphanumeric and reasonable length
  if (!/^[A-Z0-9]+$/i.test(cleaned)) {
    return false;
  }

  // Minimum length of 10 for any carrier
  if (cleaned.length < 10) {
    return false;
  }

  // Maximum reasonable length
  if (cleaned.length > 34) {
    return false;
  }

  return true;
}

/**
 * Extract service level from tracking company if embedded.
 * Some Shopify stores return "UPS Ground" or "FedEx 2Day" as tracking_company.
 */
export function extractServiceLevelFromCompany(trackingCompany: string | null | undefined): string | null {
  if (!trackingCompany) {
    return null;
  }

  // Common patterns where service level is embedded in company name
  const serviceLevelPatterns: Record<string, string> = {
    // UPS
    "ups ground": "ups_ground",
    "ups next day air": "ups_next_day_air",
    "ups 2nd day air": "ups_2nd_day_air",
    "ups surepost": "ups_surepost",
    "ups mail innovations": "ups_mail_innovations",
    // FedEx
    "fedex ground": "fedex_ground",
    "fedex express": "fedex_express",
    "fedex home delivery": "fedex_home_delivery",
    "fedex smartpost": "fedex_smartpost",
    "fedex 2day": "fedex_2day",
    "fedex overnight": "fedex_overnight",
    // USPS
    "usps priority mail express": "usps_priority_mail_express",
    "usps priority mail": "usps_priority_mail",
    "usps ground advantage": "usps_ground_advantage",
    "usps first class": "usps_first_class",
  };

  const normalized = trackingCompany.toLowerCase().trim();

  for (const [pattern, serviceLevel] of Object.entries(serviceLevelPatterns)) {
    if (normalized.includes(pattern)) {
      return serviceLevel;
    }
  }

  return null;
}

/**
 * Get the appropriate carrier adapter for a given carrier.
 * Returns null for UNKNOWN carrier.
 */
export function getCarrierAdapter(carrier: Carrier): CarrierAdapter | null {
  switch (carrier) {
    case "UPS":
      return getUpsAdapter();
    case "FEDEX":
      return getFedexAdapter();
    case "USPS":
      return getUspsAdapter();
    case "UNKNOWN":
    default:
      return null;
  }
}

/**
 * Track a shipment using the appropriate carrier adapter.
 * Automatically routes to the correct adapter based on carrier.
 *
 * @param carrier - The carrier to use for tracking
 * @param trackingNumber - The tracking number to look up
 * @returns Tracking result or error
 */
export async function trackShipment(
  carrier: Carrier,
  trackingNumber: string
): Promise<CarrierTrackingResponse> {
  const adapter = getCarrierAdapter(carrier);

  if (!adapter) {
    const error: CarrierError = {
      code: "INVALID_TRACKING_NUMBER",
      message: `Cannot track shipment: unsupported carrier "${carrier}"`,
      retryable: false,
    };
    return { success: false, error };
  }

  return adapter.track(trackingNumber);
}

/**
 * Get tracking URL for a shipment using the appropriate carrier adapter.
 *
 * @param carrier - The carrier
 * @param trackingNumber - The tracking number
 * @returns Public tracking URL or null for unknown carriers
 */
export function getTrackingUrlFromAdapter(carrier: Carrier, trackingNumber: string): string | null {
  const adapter = getCarrierAdapter(carrier);
  return adapter?.getTrackingUrl(trackingNumber) ?? null;
}
