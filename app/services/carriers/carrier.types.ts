/**
 * Carrier Types
 *
 * Shared types and constants used across carrier adapters.
 */

import type { Carrier } from "@prisma/client";

/**
 * Configuration for carrier API endpoints.
 */
export interface CarrierApiConfig {
  /** Base URL for the carrier's API */
  baseUrl: string;
  /** OAuth token endpoint (for UPS/FedEx) */
  tokenUrl?: string;
  /** Public tracking URL base for customer-facing links */
  trackingUrlBase: string;
}

/**
 * Carrier API configurations.
 */
export const CARRIER_CONFIGS: Record<Exclude<Carrier, "UNKNOWN">, CarrierApiConfig> = {
  UPS: {
    baseUrl: "https://onlinetools.ups.com/api",
    tokenUrl: "https://onlinetools.ups.com/security/v1/oauth/token",
    trackingUrlBase: "https://www.ups.com/track?tracknum=",
  },
  FEDEX: {
    baseUrl: "https://apis.fedex.com",
    tokenUrl: "https://apis.fedex.com/oauth/token",
    trackingUrlBase: "https://www.fedex.com/fedextrack/?trknbr=",
  },
  USPS: {
    baseUrl: "https://secure.shippingapis.com",
    trackingUrlBase: "https://tools.usps.com/go/TrackConfirmAction?tLabels=",
  },
};

/**
 * Redis key prefix for cached carrier OAuth tokens.
 */
export const CARRIER_TOKEN_CACHE_PREFIX = "carrier_token:";

/**
 * Buffer time to subtract from token expiration (in seconds).
 * Refresh tokens 60 seconds before they expire.
 */
export const TOKEN_REFRESH_BUFFER_SECONDS = 60;

/**
 * UPS status type codes.
 * @see https://developer.ups.com/api/reference/tracking
 */
export const UPS_STATUS_TYPES = {
  /** Manifest - Package info received, not yet picked up */
  MANIFEST: "M",
  /** In Transit */
  IN_TRANSIT: "I",
  /** Delivered */
  DELIVERED: "D",
  /** Exception - Delay or problem */
  EXCEPTION: "X",
  /** Pickup */
  PICKUP: "P",
  /** Unknown */
  UNKNOWN: "NA",
} as const;

/**
 * FedEx status codes that indicate delivery.
 */
export const FEDEX_DELIVERED_CODES = ["DL", "DE"] as const;

/**
 * FedEx status keywords that indicate an exception.
 */
export const FEDEX_EXCEPTION_KEYWORDS = [
  "exception",
  "delay",
  "undeliverable",
  "hold",
  "unable",
  "incorrect",
  "damaged",
  "customs",
] as const;

/**
 * USPS status keywords that indicate an exception/delay.
 */
export const USPS_EXCEPTION_KEYWORDS = ["Arriving Late", "Alert", "Exception", "Notice Left"] as const;

/**
 * USPS status keywords that indicate delivery.
 */
export const USPS_DELIVERED_KEYWORDS = ["Delivered", "Available for Pickup"] as const;

/**
 * Format a location from city, state, and country components.
 */
export function formatLocation(
  city: string | null | undefined,
  state: string | null | undefined,
  country: string | null | undefined
): string | null {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Parse a date string from carrier APIs.
 * Handles various formats: ISO 8601, MM/DD/YYYY, YYYYMMDD, etc.
 */
export function parseCarrierDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) {
    return null;
  }

  // Try ISO 8601 format first
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try YYYYMMDD format (common in UPS)
  if (/^\d{8}$/.test(dateStr)) {
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(4, 6), 10) - 1;
    const day = parseInt(dateStr.substring(6, 8), 10);
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try MM/DD/YYYY format
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const date = new Date(
      parseInt(mdyMatch[3], 10),
      parseInt(mdyMatch[1], 10) - 1,
      parseInt(mdyMatch[2], 10)
    );
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

/**
 * Parse a time string and combine with a date.
 * Handles formats: HH:MM, HHMMSS, HH:MM:SS
 */
export function parseCarrierDateTime(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined
): Date | null {
  const date = parseCarrierDate(dateStr);
  if (!date) {
    return null;
  }

  if (!timeStr) {
    return date;
  }

  // Try HHMMSS format (common in UPS)
  if (/^\d{6}$/.test(timeStr)) {
    const hours = parseInt(timeStr.substring(0, 2), 10);
    const minutes = parseInt(timeStr.substring(2, 4), 10);
    const seconds = parseInt(timeStr.substring(4, 6), 10);
    date.setHours(hours, minutes, seconds);
    return date;
  }

  // Try HH:MM:SS or HH:MM format
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    date.setHours(
      parseInt(timeMatch[1], 10),
      parseInt(timeMatch[2], 10),
      timeMatch[3] ? parseInt(timeMatch[3], 10) : 0
    );
    return date;
  }

  return date;
}
