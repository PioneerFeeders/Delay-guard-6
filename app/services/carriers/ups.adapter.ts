/**
 * UPS Carrier Adapter
 *
 * Implements the CarrierAdapter interface for UPS Track API.
 * Uses OAuth 2.0 for authentication with token caching in Redis.
 *
 * @see https://developer.ups.com/api/reference/tracking
 */

import { getRedisConnection } from "~/queue.server";
import type {
  CarrierAdapter,
  CarrierError,
  CarrierTrackingResponse,
  CachedToken,
  TrackingEvent,
  TrackingResult,
} from "./carrier.interface";
import {
  CARRIER_CONFIGS,
  CARRIER_TOKEN_CACHE_PREFIX,
  TOKEN_REFRESH_BUFFER_SECONDS,
  UPS_STATUS_TYPES,
  formatLocation,
  parseCarrierDateTime,
  parseCarrierDate,
} from "./carrier.types";
import {
  UpsTrackingResponseSchema,
  type UpsTrackingResponse,
  type UpsActivity,
  type UpsPackage,
} from "./ups.schemas";

/**
 * Redis key for UPS OAuth token cache.
 */
const UPS_TOKEN_CACHE_KEY = `${CARRIER_TOKEN_CACHE_PREFIX}ups`;

/**
 * UPS OAuth token endpoint.
 */
const UPS_TOKEN_URL = CARRIER_CONFIGS.UPS.tokenUrl!;

/**
 * UPS Track API base URL.
 */
const UPS_TRACK_URL = `${CARRIER_CONFIGS.UPS.baseUrl}/track/v1/details`;

/**
 * UPS Tracking URL base for customer-facing links.
 */
const UPS_TRACKING_URL_BASE = CARRIER_CONFIGS.UPS.trackingUrlBase;

/**
 * Get UPS API credentials from environment variables.
 */
function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("UPS_CLIENT_ID and UPS_CLIENT_SECRET environment variables are required");
  }

  return { clientId, clientSecret };
}

/**
 * Get a valid OAuth token, using cache or refreshing if needed.
 */
async function getAccessToken(): Promise<string> {
  const redis = getRedisConnection();

  // Try to get cached token
  const cachedTokenStr = await redis.get(UPS_TOKEN_CACHE_KEY);
  if (cachedTokenStr) {
    try {
      const cachedToken: CachedToken = JSON.parse(cachedTokenStr);
      // Check if token is still valid (with buffer)
      if (cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_SECONDS * 1000) {
        return cachedToken.accessToken;
      }
    } catch {
      // Invalid cached token, will refresh
    }
  }

  // Refresh token
  const { clientId, clientSecret } = getCredentials();

  const response = await fetch(UPS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`UPS OAuth token request failed: ${response.status} ${errorText}`);
  }

  const tokenData = (await response.json()) as { access_token: string; expires_in: number };
  const { access_token, expires_in } = tokenData;

  // Cache the token with TTL
  const expiresAt = Date.now() + expires_in * 1000;
  const cachedToken: CachedToken = { accessToken: access_token, expiresAt };
  const ttlSeconds = expires_in - TOKEN_REFRESH_BUFFER_SECONDS;

  await redis.set(UPS_TOKEN_CACHE_KEY, JSON.stringify(cachedToken), "EX", ttlSeconds);

  return access_token;
}

/**
 * Map UPS status type to human-readable status.
 */
function mapStatusType(statusType: string | null | undefined): string {
  switch (statusType) {
    case UPS_STATUS_TYPES.MANIFEST:
      return "Label Created";
    case UPS_STATUS_TYPES.IN_TRANSIT:
      return "In Transit";
    case UPS_STATUS_TYPES.DELIVERED:
      return "Delivered";
    case UPS_STATUS_TYPES.EXCEPTION:
      return "Exception";
    case UPS_STATUS_TYPES.PICKUP:
      return "Picked Up";
    default:
      return "Unknown";
  }
}

/**
 * Extract the latest package from the UPS response.
 */
function extractPackage(response: UpsTrackingResponse): UpsPackage | null {
  const shipment = response.trackResponse?.shipment?.[0];
  if (!shipment) {
    return null;
  }

  return shipment.package?.[0] ?? null;
}

/**
 * Parse UPS activity events into TrackingEvents.
 */
function parseActivities(activities: UpsActivity[] | null | undefined): TrackingEvent[] {
  if (!activities) {
    return [];
  }

  return activities
    .map((activity): TrackingEvent | null => {
      const timestamp = parseCarrierDateTime(activity.date, activity.time);
      if (!timestamp) {
        return null;
      }

      const location = activity.location?.address;

      return {
        timestamp,
        type: activity.status?.type ?? "UNKNOWN",
        description: activity.status?.description ?? "Status update",
        city: location?.city ?? null,
        state: location?.stateProvince ?? null,
        country: location?.country ?? null,
        rawData: activity,
      };
    })
    .filter((event): event is TrackingEvent => event !== null)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Most recent first
}

/**
 * Extract expected delivery date from UPS response.
 */
function extractExpectedDeliveryDate(pkg: UpsPackage): Date | null {
  // Try deliveryDate array first
  if (pkg.deliveryDate && pkg.deliveryDate.length > 0) {
    const deliveryInfo = pkg.deliveryDate[0];
    return parseCarrierDate(deliveryInfo.date);
  }

  // Try scheduledDeliveryDate
  if (pkg.packageAddress) {
    for (const addr of pkg.packageAddress) {
      if (addr.address?.scheduledDeliveryDate) {
        return parseCarrierDate(addr.address.scheduledDeliveryDate);
      }
    }
  }

  return null;
}

/**
 * Extract rescheduled delivery date from UPS response.
 */
function extractRescheduledDeliveryDate(pkg: UpsPackage): Date | null {
  // Check if there's a rescheduled date in deliveryDate array
  if (pkg.deliveryDate && pkg.deliveryDate.length > 1) {
    // If there are multiple delivery dates, the later ones are rescheduled
    const rescheduled = pkg.deliveryDate[pkg.deliveryDate.length - 1];
    return parseCarrierDate(rescheduled.date);
  }

  return null;
}

/**
 * Extract delivery timestamp from activities.
 */
function extractDeliveredAt(activities: TrackingEvent[]): Date | null {
  const deliveryEvent = activities.find((e) => e.type === UPS_STATUS_TYPES.DELIVERED);
  return deliveryEvent?.timestamp ?? null;
}

/**
 * Create a CarrierError from various error conditions.
 */
function createError(
  code: CarrierError["code"],
  message: string,
  retryable: boolean,
  rawError?: unknown
): CarrierError {
  return { code, message, retryable, rawError };
}

/**
 * UPS Carrier Adapter Implementation
 */
export class UpsAdapter implements CarrierAdapter {
  readonly carrier = "UPS" as const;

  async track(trackingNumber: string): Promise<CarrierTrackingResponse> {
    try {
      // Get OAuth token
      let accessToken: string;
      try {
        accessToken = await getAccessToken();
      } catch (error) {
        return {
          success: false,
          error: createError(
            "AUTH_FAILED",
            "Failed to obtain UPS OAuth token",
            true,
            error
          ),
        };
      }

      // Call UPS Track API
      const trackUrl = `${UPS_TRACK_URL}/${encodeURIComponent(trackingNumber)}`;
      const response = await fetch(trackUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          transId: `delayguard-${Date.now()}`,
          transactionSrc: "DelayGuard",
        },
      });

      // Handle rate limiting
      if (response.status === 429) {
        return {
          success: false,
          error: createError(
            "RATE_LIMITED",
            "UPS API rate limit exceeded",
            true
          ),
        };
      }

      // Handle auth errors (token may have been revoked)
      if (response.status === 401) {
        // Clear cached token and retry once
        const redis = getRedisConnection();
        await redis.del(UPS_TOKEN_CACHE_KEY);

        return {
          success: false,
          error: createError(
            "AUTH_FAILED",
            "UPS authentication failed, token may have expired",
            true
          ),
        };
      }

      // Handle not found
      if (response.status === 404) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `Tracking number ${trackingNumber} not found in UPS system`,
            false
          ),
        };
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: createError(
            "API_ERROR",
            `UPS API error: ${response.status} ${errorText}`,
            response.status >= 500,
            { status: response.status, body: errorText }
          ),
        };
      }

      // Parse response
      let rawResponse: unknown;
      try {
        rawResponse = await response.json();
      } catch {
        return {
          success: false,
          error: createError(
            "PARSE_ERROR",
            "Failed to parse UPS API response as JSON",
            false
          ),
        };
      }

      // Validate response schema
      const parseResult = UpsTrackingResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return {
          success: false,
          error: createError(
            "PARSE_ERROR",
            `Invalid UPS API response format: ${parseResult.error.message}`,
            false,
            { raw: rawResponse, zodError: parseResult.error }
          ),
        };
      }

      const upsResponse = parseResult.data;

      // Check for tracking errors in response
      const shipment = upsResponse.trackResponse?.shipment?.[0];
      if (!shipment) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `No shipment data returned for tracking number ${trackingNumber}`,
            false,
            rawResponse
          ),
        };
      }

      // Check for warnings/errors
      if (shipment.warnings && shipment.warnings.length > 0) {
        const warning = shipment.warnings[0];
        if (warning.code === "TW0001" || warning.message?.includes("not found")) {
          return {
            success: false,
            error: createError(
              "TRACKING_NOT_FOUND",
              warning.message ?? `Tracking number ${trackingNumber} not found`,
              false,
              rawResponse
            ),
          };
        }
      }

      // Extract package data
      const pkg = extractPackage(upsResponse);
      if (!pkg) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `No package data for tracking number ${trackingNumber}`,
            false,
            rawResponse
          ),
        };
      }

      // Parse tracking events
      const events = parseActivities(pkg.activity);

      // Get current status
      const currentActivity = pkg.currentStatus ?? pkg.activity?.[0];
      const statusType = currentActivity?.status?.type;
      const statusDescription = currentActivity?.status?.description ?? "Unknown";

      // Check for exception
      const isException = statusType === UPS_STATUS_TYPES.EXCEPTION;
      const exceptionCode = isException ? currentActivity?.status?.code ?? null : null;
      const exceptionReason = isException ? statusDescription : null;

      // Check for delivery
      const isDelivered = statusType === UPS_STATUS_TYPES.DELIVERED;
      const deliveredAt = isDelivered ? extractDeliveredAt(events) : null;

      // Get last scan info
      const lastEvent = events[0];
      const lastScanLocation = lastEvent
        ? formatLocation(lastEvent.city, lastEvent.state, lastEvent.country)
        : null;
      const lastScanTime = lastEvent?.timestamp ?? null;

      // Build result
      const result: TrackingResult = {
        trackingNumber,
        carrier: "UPS",
        currentStatus: mapStatusType(statusType) || statusDescription,
        isException,
        exceptionCode,
        exceptionReason,
        expectedDeliveryDate: extractExpectedDeliveryDate(pkg),
        rescheduledDeliveryDate: extractRescheduledDeliveryDate(pkg),
        isDelivered,
        deliveredAt,
        lastScanLocation,
        lastScanTime,
        events,
      };

      return { success: true, data: result };
    } catch (error) {
      // Handle network errors
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return {
          success: false,
          error: createError(
            "NETWORK_ERROR",
            "Network error connecting to UPS API",
            true,
            error
          ),
        };
      }

      return {
        success: false,
        error: createError(
          "API_ERROR",
          `Unexpected error tracking UPS package: ${error instanceof Error ? error.message : String(error)}`,
          true,
          error
        ),
      };
    }
  }

  getTrackingUrl(trackingNumber: string): string {
    return `${UPS_TRACKING_URL_BASE}${encodeURIComponent(trackingNumber)}`;
  }
}

/**
 * Singleton instance of the UPS adapter.
 */
let upsAdapterInstance: UpsAdapter | null = null;

/**
 * Get the UPS adapter singleton.
 */
export function getUpsAdapter(): UpsAdapter {
  if (!upsAdapterInstance) {
    upsAdapterInstance = new UpsAdapter();
  }
  return upsAdapterInstance;
}
