/**
 * Carrier Adapter Interface
 *
 * Defines the common interface that all carrier adapters (UPS, FedEx, USPS)
 * must implement. This allows the carrier service to delegate to the correct
 * adapter based on the shipment's carrier field.
 */

import type { Carrier } from "@prisma/client";

/**
 * A single tracking event from a carrier's tracking history.
 * Represents one scan or status update during the shipment's journey.
 */
export interface TrackingEvent {
  /** When the event occurred */
  timestamp: Date;
  /** Event type code (e.g., "I", "D", "X" for UPS) */
  type: string;
  /** Human-readable description of the event */
  description: string;
  /** City where the event occurred */
  city: string | null;
  /** State/province where the event occurred */
  state: string | null;
  /** Country where the event occurred */
  country: string | null;
  /** Raw carrier data for debugging and future parsing improvements */
  rawData: unknown;
}

/**
 * The result of a tracking request to a carrier API.
 * Contains the current status, delivery information, and event history.
 */
export interface TrackingResult {
  /** The tracking number that was queried */
  trackingNumber: string;
  /** The carrier that provided this tracking data */
  carrier: Carrier;
  /** Current human-readable status (e.g., "In Transit", "Delivered", "Exception") */
  currentStatus: string;
  /** Whether the carrier reports an exception/delay condition */
  isException: boolean;
  /** Carrier-specific exception code (e.g., "X1" for UPS) */
  exceptionCode: string | null;
  /** Human-readable exception reason (e.g., "Weather delay") */
  exceptionReason: string | null;
  /** Expected delivery date from carrier, if available */
  expectedDeliveryDate: Date | null;
  /** New expected delivery date if carrier rescheduled, if available */
  rescheduledDeliveryDate: Date | null;
  /** Whether the package has been delivered */
  isDelivered: boolean;
  /** Delivery timestamp, if delivered */
  deliveredAt: Date | null;
  /** Last known location as a formatted string */
  lastScanLocation: string | null;
  /** Timestamp of the last scan */
  lastScanTime: Date | null;
  /** Complete event history from the carrier */
  events: TrackingEvent[];
}

/**
 * Result type for carrier API calls that may fail.
 * Provides structured error handling without throwing exceptions.
 */
export type CarrierTrackingResponse =
  | { success: true; data: TrackingResult }
  | { success: false; error: CarrierError };

/**
 * Structured error information from carrier API calls.
 */
export interface CarrierError {
  /** Error category for handling logic */
  code:
    | "TRACKING_NOT_FOUND" // Tracking number doesn't exist in carrier system
    | "INVALID_TRACKING_NUMBER" // Malformed tracking number
    | "RATE_LIMITED" // Hit carrier API rate limits (429)
    | "AUTH_FAILED" // OAuth token refresh failed or credentials invalid
    | "API_ERROR" // Carrier API returned an error response
    | "NETWORK_ERROR" // Connection timeout or network failure
    | "PARSE_ERROR"; // Failed to parse carrier response
  /** Human-readable error message */
  message: string;
  /** Whether this error should trigger a retry */
  retryable: boolean;
  /** Raw error data for debugging */
  rawError?: unknown;
}

/**
 * Interface that all carrier adapters must implement.
 * Each carrier (UPS, FedEx, USPS) has its own adapter that handles
 * the carrier-specific API format and authentication.
 */
export interface CarrierAdapter {
  /** The carrier this adapter handles */
  readonly carrier: Carrier;

  /**
   * Fetch tracking info for a single tracking number.
   * Returns a structured result that includes either success data or error info.
   *
   * @param trackingNumber - The carrier tracking number to look up
   * @returns Tracking result with status, events, and delivery info, or error
   */
  track(trackingNumber: string): Promise<CarrierTrackingResponse>;

  /**
   * Build a public tracking URL that customers can use to track their package.
   *
   * @param trackingNumber - The carrier tracking number
   * @returns Full URL to the carrier's public tracking page
   */
  getTrackingUrl(trackingNumber: string): string;
}

/**
 * OAuth token response from UPS/FedEx APIs.
 * Both carriers use similar OAuth 2.0 client credentials flow.
 */
export interface OAuthTokenResponse {
  /** The access token to use in API requests */
  access_token: string;
  /** Token type (usually "Bearer") */
  token_type: string;
  /** Token validity in seconds */
  expires_in: number;
  /** When this token was obtained (for cache TTL calculation) */
  issued_at?: number;
}

/**
 * Cached token structure stored in Redis.
 */
export interface CachedToken {
  /** The access token */
  accessToken: string;
  /** Expiration timestamp (Unix milliseconds) */
  expiresAt: number;
}
