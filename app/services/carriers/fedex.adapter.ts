/**
 * FedEx Carrier Adapter
 *
 * Implements the CarrierAdapter interface for FedEx Track API.
 * Uses OAuth 2.0 client credentials for authentication with token caching in Redis.
 *
 * @see https://developer.fedex.com/api/en-us/catalog/track.html
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
  FEDEX_DELIVERED_CODES,
  FEDEX_EXCEPTION_KEYWORDS,
  formatLocation,
} from "./carrier.types";
import {
  FedexTrackingResponseSchema,
  type FedexTrackingInfo,
  type FedexScanEvent,
} from "./fedex.schemas";

/**
 * Redis key for FedEx OAuth token cache.
 */
const FEDEX_TOKEN_CACHE_KEY = `${CARRIER_TOKEN_CACHE_PREFIX}fedex`;

/**
 * FedEx OAuth token endpoint.
 */
const FEDEX_TOKEN_URL = CARRIER_CONFIGS.FEDEX.tokenUrl!;

/**
 * FedEx Track API endpoint.
 */
const FEDEX_TRACK_URL = `${CARRIER_CONFIGS.FEDEX.baseUrl}/track/v1/trackingnumbers`;

/**
 * FedEx Tracking URL base for customer-facing links.
 */
const FEDEX_TRACKING_URL_BASE = CARRIER_CONFIGS.FEDEX.trackingUrlBase;

/**
 * Get FedEx API credentials from environment variables.
 */
function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET environment variables are required");
  }

  return { clientId, clientSecret };
}

/**
 * Get a valid OAuth token, using cache or refreshing if needed.
 */
async function getAccessToken(): Promise<string> {
  const redis = getRedisConnection();

  // Try to get cached token
  const cachedTokenStr = await redis.get(FEDEX_TOKEN_CACHE_KEY);
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

  // Refresh token using client credentials grant
  const { clientId, clientSecret } = getCredentials();

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  const response = await fetch(FEDEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FedEx OAuth token request failed: ${response.status} ${errorText}`);
  }

  const tokenData = (await response.json()) as { access_token: string; expires_in: number };
  const { access_token, expires_in } = tokenData;

  // Cache the token with TTL
  const expiresAt = Date.now() + expires_in * 1000;
  const cachedToken: CachedToken = { accessToken: access_token, expiresAt };
  const ttlSeconds = expires_in - TOKEN_REFRESH_BUFFER_SECONDS;

  await redis.set(FEDEX_TOKEN_CACHE_KEY, JSON.stringify(cachedToken), "EX", ttlSeconds);

  return access_token;
}

/**
 * Parse ISO 8601 date string to Date object.
 */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) {
    return null;
  }

  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Check if a status indicates an exception based on keywords.
 */
function isExceptionStatus(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }

  const lowerStatus = status.toLowerCase();
  return FEDEX_EXCEPTION_KEYWORDS.some((keyword) => lowerStatus.includes(keyword));
}

/**
 * Check if a status code indicates delivery.
 */
function isDeliveredStatus(code: string | null | undefined): boolean {
  if (!code) {
    return false;
  }

  return FEDEX_DELIVERED_CODES.includes(code as (typeof FEDEX_DELIVERED_CODES)[number]);
}

/**
 * Map FedEx status to human-readable status.
 */
function mapStatus(trackingInfo: FedexTrackingInfo): string {
  const latestStatus = trackingInfo.latestStatusDetail;

  if (!latestStatus) {
    return "Unknown";
  }

  // Use statusByLocale if available, otherwise description
  return latestStatus.statusByLocale ?? latestStatus.description ?? "Unknown";
}

/**
 * Parse FedEx scan events into TrackingEvents.
 */
function parseScanEvents(events: FedexScanEvent[] | null | undefined): TrackingEvent[] {
  if (!events) {
    return [];
  }

  return events
    .map((event): TrackingEvent | null => {
      const timestamp = parseDate(event.date);
      if (!timestamp) {
        return null;
      }

      const location = event.scanLocation?.address;

      return {
        timestamp,
        type: event.eventType ?? "UNKNOWN",
        description: event.eventDescription ?? event.derivedStatus ?? "Status update",
        city: location?.city ?? null,
        state: location?.stateOrProvinceCode ?? null,
        country: location?.countryCode ?? location?.countryName ?? null,
        rawData: event,
      };
    })
    .filter((event): event is TrackingEvent => event !== null)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Most recent first
}

/**
 * Extract expected delivery date from FedEx response.
 */
function extractExpectedDeliveryDate(trackingInfo: FedexTrackingInfo): Date | null {
  // Try estimatedDeliveryTimeWindow first
  const estimatedWindow = trackingInfo.estimatedDeliveryTimeWindow?.window;
  if (estimatedWindow?.ends) {
    return parseDate(estimatedWindow.ends);
  }

  // Try standardTransitTimeWindow
  const standardWindow = trackingInfo.standardTransitTimeWindow?.window;
  if (standardWindow?.ends) {
    return parseDate(standardWindow.ends);
  }

  // Try dateAndTimes array for ESTIMATED_DELIVERY type
  if (trackingInfo.dateAndTimes) {
    for (const dt of trackingInfo.dateAndTimes) {
      if (dt.type === "ESTIMATED_DELIVERY" || dt.type === "SCHEDULED_DELIVERY") {
        return parseDate(dt.dateTime);
      }
    }
  }

  return null;
}

/**
 * Extract rescheduled delivery date from FedEx response.
 */
function extractRescheduledDeliveryDate(trackingInfo: FedexTrackingInfo): Date | null {
  // Check delayDetail status for rescheduling info
  const delayDetail = trackingInfo.delayDetail;
  if (delayDetail?.status && delayDetail.status !== "ON_TIME") {
    // If there's a delay, check dateAndTimes for updated delivery
    if (trackingInfo.dateAndTimes) {
      for (const dt of trackingInfo.dateAndTimes) {
        if (dt.type === "APPOINTMENT_DELIVERY" || dt.type === "ACTUAL_TENDER") {
          return parseDate(dt.dateTime);
        }
      }
    }
  }

  return null;
}

/**
 * Extract delivery timestamp from FedEx response.
 */
function extractDeliveredAt(trackingInfo: FedexTrackingInfo): Date | null {
  // Check dateAndTimes for ACTUAL_DELIVERY
  if (trackingInfo.dateAndTimes) {
    for (const dt of trackingInfo.dateAndTimes) {
      if (dt.type === "ACTUAL_DELIVERY") {
        return parseDate(dt.dateTime);
      }
    }
  }

  // Fallback to latest status timestamp if delivered
  const latestStatus = trackingInfo.latestStatusDetail;
  if (latestStatus && isDeliveredStatus(latestStatus.code)) {
    // Try to find delivery event in scan events
    const scanEvents = trackingInfo.scanEvents;
    if (scanEvents && scanEvents.length > 0) {
      const deliveryEvent = scanEvents.find(
        (e) => e.eventType === "DL" || e.derivedStatus?.toLowerCase().includes("delivered")
      );
      if (deliveryEvent?.date) {
        return parseDate(deliveryEvent.date);
      }
    }
  }

  return null;
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
 * FedEx Carrier Adapter Implementation
 */
export class FedexAdapter implements CarrierAdapter {
  readonly carrier = "FEDEX" as const;

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
            "Failed to obtain FedEx OAuth token",
            true,
            error
          ),
        };
      }

      // Build request body
      const requestBody = {
        includeDetailedScans: true,
        trackingInfo: [
          {
            trackingNumberInfo: {
              trackingNumber: trackingNumber,
            },
          },
        ],
      };

      // Call FedEx Track API
      const response = await fetch(FEDEX_TRACK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-locale": "en_US",
        },
        body: JSON.stringify(requestBody),
      });

      // Handle rate limiting
      if (response.status === 429) {
        return {
          success: false,
          error: createError(
            "RATE_LIMITED",
            "FedEx API rate limit exceeded",
            true
          ),
        };
      }

      // Handle auth errors (token may have been revoked)
      if (response.status === 401) {
        // Clear cached token
        const redis = getRedisConnection();
        await redis.del(FEDEX_TOKEN_CACHE_KEY);

        return {
          success: false,
          error: createError(
            "AUTH_FAILED",
            "FedEx authentication failed, token may have expired",
            true
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
            `FedEx API error: ${response.status} ${errorText}`,
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
            "Failed to parse FedEx API response as JSON",
            false
          ),
        };
      }

      // Validate response schema
      const parseResult = FedexTrackingResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return {
          success: false,
          error: createError(
            "PARSE_ERROR",
            `Invalid FedEx API response format: ${parseResult.error.message}`,
            false,
            { raw: rawResponse, zodError: parseResult.error }
          ),
        };
      }

      const fedexResponse = parseResult.data;

      // Check for tracking errors in response alerts
      if (fedexResponse.alerts && fedexResponse.alerts.length > 0) {
        const errorAlert = fedexResponse.alerts.find(
          (a) => a.alertType === "ERROR" || a.code === "TRACKING.TRACKINGNUMBER.NOTFOUND"
        );
        if (errorAlert) {
          return {
            success: false,
            error: createError(
              "TRACKING_NOT_FOUND",
              errorAlert.message ?? `Tracking number ${trackingNumber} not found`,
              false,
              rawResponse
            ),
          };
        }
      }

      // Extract tracking info
      const completeTrackResults = fedexResponse.output?.completeTrackResults;
      if (!completeTrackResults || completeTrackResults.length === 0) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `No tracking data returned for tracking number ${trackingNumber}`,
            false,
            rawResponse
          ),
        };
      }

      const trackResults = completeTrackResults[0].trackResults;
      if (!trackResults || trackResults.length === 0) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `No tracking results for tracking number ${trackingNumber}`,
            false,
            rawResponse
          ),
        };
      }

      const trackingInfo = trackResults[0];

      // Parse tracking events
      const events = parseScanEvents(trackingInfo.scanEvents);

      // Get current status
      const latestStatus = trackingInfo.latestStatusDetail;
      const statusCode = latestStatus?.code ?? null;
      const statusDescription = mapStatus(trackingInfo);

      // Check for exception
      const delayDetail = trackingInfo.delayDetail;
      const hasDelayException =
        delayDetail && delayDetail.status && delayDetail.status !== "ON_TIME" && delayDetail.status !== "EARLY";
      const hasStatusException = isExceptionStatus(statusDescription);
      const isException = hasDelayException || hasStatusException;

      // Extract exception details
      let exceptionCode: string | null = null;
      let exceptionReason: string | null = null;

      if (isException) {
        if (latestStatus?.ancillaryDetails && latestStatus.ancillaryDetails.length > 0) {
          const ancillary = latestStatus.ancillaryDetails[0];
          exceptionCode = ancillary.reason ?? null;
          exceptionReason = ancillary.reasonDescription ?? ancillary.actionDescription ?? null;
        } else if (delayDetail) {
          exceptionCode = delayDetail.subType ?? delayDetail.type ?? null;
          exceptionReason = delayDetail.status ?? null;
        } else {
          exceptionReason = statusDescription;
        }
      }

      // Check for delivery
      const isDelivered = isDeliveredStatus(statusCode);
      const deliveredAt = isDelivered ? extractDeliveredAt(trackingInfo) : null;

      // Get last scan info
      const lastEvent = events[0];
      const lastScanLocation = lastEvent
        ? formatLocation(lastEvent.city, lastEvent.state, lastEvent.country)
        : null;
      const lastScanTime = lastEvent?.timestamp ?? null;

      // Build result
      const result: TrackingResult = {
        trackingNumber,
        carrier: "FEDEX",
        currentStatus: statusDescription,
        isException,
        exceptionCode,
        exceptionReason,
        expectedDeliveryDate: extractExpectedDeliveryDate(trackingInfo),
        rescheduledDeliveryDate: extractRescheduledDeliveryDate(trackingInfo),
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
            "Network error connecting to FedEx API",
            true,
            error
          ),
        };
      }

      return {
        success: false,
        error: createError(
          "API_ERROR",
          `Unexpected error tracking FedEx package: ${error instanceof Error ? error.message : String(error)}`,
          true,
          error
        ),
      };
    }
  }

  getTrackingUrl(trackingNumber: string): string {
    return `${FEDEX_TRACKING_URL_BASE}${encodeURIComponent(trackingNumber)}`;
  }
}

/**
 * Singleton instance of the FedEx adapter.
 */
let fedexAdapterInstance: FedexAdapter | null = null;

/**
 * Get the FedEx adapter singleton.
 */
export function getFedexAdapter(): FedexAdapter {
  if (!fedexAdapterInstance) {
    fedexAdapterInstance = new FedexAdapter();
  }
  return fedexAdapterInstance;
}
