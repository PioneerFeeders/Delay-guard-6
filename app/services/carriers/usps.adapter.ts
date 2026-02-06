/**
 * USPS Carrier Adapter
 *
 * Implements the CarrierAdapter interface for USPS Web Tools Track API.
 * USPS uses a simple User ID authentication (no OAuth) and XML API format.
 *
 * @see https://www.usps.com/business/web-tools-apis/track-and-confirm-api.htm
 */

import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type {
  CarrierAdapter,
  CarrierError,
  CarrierTrackingResponse,
  TrackingEvent,
  TrackingResult,
} from "./carrier.interface";
import {
  CARRIER_CONFIGS,
  USPS_EXCEPTION_KEYWORDS,
  USPS_DELIVERED_KEYWORDS,
  formatLocation,
} from "./carrier.types";
import {
  UspsApiResponseSchema,
  type UspsApiResponse,
  type UspsTrackResponse,
  type UspsErrorResponse,
  type UspsTrackInfo,
  type UspsTrackDetail,
  normalizeTrackDetails,
  normalizeTrackSummary,
} from "./usps.schemas";

/**
 * Type guard to check if response is an error response.
 */
function isErrorResponse(response: UspsApiResponse): response is UspsErrorResponse & { Error: NonNullable<UspsErrorResponse["Error"]> } {
  return "Error" in response && response.Error != null;
}

/**
 * Type guard to check if response is a track response with TrackInfo.
 */
function isTrackResponse(response: UspsApiResponse): response is UspsTrackResponse & { TrackResponse: NonNullable<UspsTrackResponse["TrackResponse"]> } {
  return "TrackResponse" in response && response.TrackResponse != null;
}

/**
 * USPS Web Tools API endpoint.
 */
const USPS_API_URL = `${CARRIER_CONFIGS.USPS.baseUrl}/ShippingAPI.dll`;

/**
 * USPS Tracking URL base for customer-facing links.
 */
const USPS_TRACKING_URL_BASE = CARRIER_CONFIGS.USPS.trackingUrlBase;

/**
 * XML Parser configuration for USPS responses.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "_",
  textNodeName: "_text",
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * XML Builder for creating USPS request XML.
 */
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "_",
  textNodeName: "_text",
});

/**
 * Get USPS API User ID from environment variables.
 */
function getUserId(): string {
  const userId = process.env.USPS_USER_ID;

  if (!userId) {
    throw new Error("USPS_USER_ID environment variable is required");
  }

  return userId;
}

/**
 * Parse USPS date format (Month Day, Year or similar).
 * USPS returns dates in formats like "February 5, 2026" or "02/05/2026"
 */
function parseUspsDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) {
    return null;
  }

  // Try parsing as Date object first
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try MM/DD/YYYY format
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const parsed = new Date(
      parseInt(mdyMatch[3], 10),
      parseInt(mdyMatch[1], 10) - 1,
      parseInt(mdyMatch[2], 10)
    );
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

/**
 * Parse USPS time format (HH:MM am/pm).
 */
function parseUspsTime(timeStr: string | null | undefined): { hours: number; minutes: number } | null {
  if (!timeStr) {
    return null;
  }

  // Match formats like "10:30 am", "2:15 pm", "14:30"
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i);
  if (!timeMatch) {
    return null;
  }

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3]?.toLowerCase();

  if (meridiem === "pm" && hours !== 12) {
    hours += 12;
  } else if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

/**
 * Combine USPS date and time strings into a Date object.
 */
function parseUspsDateTime(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined
): Date | null {
  const date = parseUspsDate(dateStr);
  if (!date) {
    return null;
  }

  const time = parseUspsTime(timeStr);
  if (time) {
    date.setHours(time.hours, time.minutes, 0, 0);
  }

  return date;
}

/**
 * Check if a status indicates an exception/delay.
 */
function isExceptionStatus(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }

  return USPS_EXCEPTION_KEYWORDS.some((keyword) =>
    status.toLowerCase().includes(keyword.toLowerCase())
  );
}

/**
 * Check if a status indicates delivery.
 */
function isDeliveredStatus(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }

  return USPS_DELIVERED_KEYWORDS.some((keyword) =>
    status.toLowerCase().includes(keyword.toLowerCase())
  );
}

/**
 * Parse USPS track detail into TrackingEvent.
 */
function parseTrackDetail(detail: UspsTrackDetail): TrackingEvent | null {
  const timestamp = parseUspsDateTime(detail.EventDate, detail.EventTime);
  if (!timestamp) {
    return null;
  }

  return {
    timestamp,
    type: detail.EventCode ?? "UNKNOWN",
    description: detail.Event ?? "Status update",
    city: detail.EventCity ?? null,
    state: detail.EventState ?? null,
    country: detail.EventCountry ?? null,
    rawData: detail,
  };
}

/**
 * Parse all tracking events from USPS response.
 */
function parseTrackingEvents(trackInfo: UspsTrackInfo): TrackingEvent[] {
  const events: TrackingEvent[] = [];

  // Add track summary as most recent event
  const summary = normalizeTrackSummary(trackInfo.TrackSummary);
  if (summary) {
    const summaryEvent = parseTrackDetail(summary);
    if (summaryEvent) {
      events.push(summaryEvent);
    }
  }

  // Add detail events
  const details = normalizeTrackDetails(trackInfo.TrackDetail);
  for (const detail of details) {
    const event = parseTrackDetail(detail);
    if (event) {
      events.push(event);
    }
  }

  // Sort by timestamp (most recent first)
  return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Extract the current status from USPS response.
 */
function extractCurrentStatus(trackInfo: UspsTrackInfo): string {
  // Try Status field first
  if (trackInfo.Status) {
    return trackInfo.Status;
  }

  // Try StatusSummary
  if (trackInfo.StatusSummary) {
    return trackInfo.StatusSummary;
  }

  // Try TrackSummary.Event
  const summary = normalizeTrackSummary(trackInfo.TrackSummary);
  if (summary?.Event) {
    return summary.Event;
  }

  return "Unknown";
}

/**
 * Extract expected delivery date from USPS response.
 */
function extractExpectedDeliveryDate(trackInfo: UspsTrackInfo): Date | null {
  // Try ExpectedDeliveryDate first
  if (trackInfo.ExpectedDeliveryDate) {
    const date = parseUspsDate(trackInfo.ExpectedDeliveryDate);
    if (date && trackInfo.ExpectedDeliveryTime) {
      const time = parseUspsTime(trackInfo.ExpectedDeliveryTime);
      if (time) {
        date.setHours(time.hours, time.minutes, 0, 0);
      }
    }
    return date;
  }

  // Try GuaranteedDeliveryDate
  if (trackInfo.GuaranteedDeliveryDate) {
    return parseUspsDate(trackInfo.GuaranteedDeliveryDate);
  }

  return null;
}

/**
 * Extract delivered timestamp from events.
 */
function extractDeliveredAt(events: TrackingEvent[], trackInfo: UspsTrackInfo): Date | null {
  // Check DeliveryNotificationDate
  if (trackInfo.DeliveryNotificationDate) {
    return parseUspsDate(trackInfo.DeliveryNotificationDate);
  }

  // Find delivery event
  const deliveryEvent = events.find((e) => isDeliveredStatus(e.description));
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
 * USPS Carrier Adapter Implementation
 */
export class UspsAdapter implements CarrierAdapter {
  readonly carrier = "USPS" as const;

  async track(trackingNumber: string): Promise<CarrierTrackingResponse> {
    try {
      // Get User ID
      let userId: string;
      try {
        userId = getUserId();
      } catch (error) {
        return {
          success: false,
          error: createError(
            "AUTH_FAILED",
            "USPS_USER_ID not configured",
            false,
            error
          ),
        };
      }

      // Build XML request
      const requestXml = xmlBuilder.build({
        TrackFieldRequest: {
          _USERID: userId,
          Revision: "1",
          ClientIp: "127.0.0.1",
          SourceId: "DelayGuard",
          TrackID: {
            _ID: trackingNumber,
          },
        },
      });

      // Build URL with XML parameter
      const url = new URL(USPS_API_URL);
      url.searchParams.set("API", "TrackV2");
      url.searchParams.set("XML", requestXml);

      // Call USPS API
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/xml",
        },
      });

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: createError(
            "API_ERROR",
            `USPS API error: ${response.status} ${errorText}`,
            response.status >= 500,
            { status: response.status, body: errorText }
          ),
        };
      }

      // Parse XML response
      let rawXml: string;
      try {
        rawXml = await response.text();
      } catch {
        return {
          success: false,
          error: createError(
            "PARSE_ERROR",
            "Failed to read USPS API response",
            false
          ),
        };
      }

      // Parse XML to JS object
      let parsedResponse: unknown;
      try {
        parsedResponse = xmlParser.parse(rawXml);
      } catch {
        return {
          success: false,
          error: createError(
            "PARSE_ERROR",
            "Failed to parse USPS XML response",
            false,
            { rawXml }
          ),
        };
      }

      // Validate response schema
      const parseResult = UspsApiResponseSchema.safeParse(parsedResponse);
      if (!parseResult.success) {
        return {
          success: false,
          error: createError(
            "PARSE_ERROR",
            `Invalid USPS API response format: ${parseResult.error.message}`,
            false,
            { raw: parsedResponse, zodError: parseResult.error }
          ),
        };
      }

      const uspsResponse = parseResult.data;

      // Check for top-level error
      if (isErrorResponse(uspsResponse)) {
        const errorNumber = uspsResponse.Error.Number;
        const errorDesc = uspsResponse.Error.Description ?? "Unknown error";

        // Check if it's a "not found" type error
        if (errorNumber === "-2147219302" || errorDesc.toLowerCase().includes("not found")) {
          return {
            success: false,
            error: createError(
              "TRACKING_NOT_FOUND",
              `Tracking number ${trackingNumber} not found: ${errorDesc}`,
              false,
              uspsResponse
            ),
          };
        }

        return {
          success: false,
          error: createError(
            "API_ERROR",
            `USPS API error: ${errorDesc}`,
            false,
            uspsResponse
          ),
        };
      }

      // Extract TrackInfo - check if we have a valid track response
      if (!isTrackResponse(uspsResponse) || !uspsResponse.TrackResponse.TrackInfo) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `No tracking data returned for ${trackingNumber}`,
            false,
            uspsResponse
          ),
        };
      }

      const trackResponseData = uspsResponse.TrackResponse;

      // Handle array or single TrackInfo
      const trackInfoArray = Array.isArray(trackResponseData.TrackInfo)
        ? trackResponseData.TrackInfo
        : [trackResponseData.TrackInfo];

      const trackInfo = trackInfoArray[0];
      if (!trackInfo) {
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `No tracking info for ${trackingNumber}`,
            false,
            uspsResponse
          ),
        };
      }

      // Check for per-tracking-number error
      if (trackInfo.Error) {
        const errorDesc = trackInfo.Error.Description ?? "Tracking number not found";
        return {
          success: false,
          error: createError(
            "TRACKING_NOT_FOUND",
            `${errorDesc}`,
            false,
            uspsResponse
          ),
        };
      }

      // Parse tracking events
      const events = parseTrackingEvents(trackInfo);

      // Get current status
      const currentStatus = extractCurrentStatus(trackInfo);

      // Check for exception
      const isException = isExceptionStatus(currentStatus) || isExceptionStatus(trackInfo.StatusCategory);
      const exceptionReason = isException ? currentStatus : null;

      // Check for delivery
      const isDelivered = isDeliveredStatus(currentStatus) || trackInfo.StatusCategory === "Delivered";
      const deliveredAt = isDelivered ? extractDeliveredAt(events, trackInfo) : null;

      // Get last scan info
      const lastEvent = events[0];
      const lastScanLocation = lastEvent
        ? formatLocation(lastEvent.city, lastEvent.state, lastEvent.country)
        : null;
      const lastScanTime = lastEvent?.timestamp ?? null;

      // Build result
      const result: TrackingResult = {
        trackingNumber,
        carrier: "USPS",
        currentStatus,
        isException,
        exceptionCode: isException ? trackInfo.StatusCategory ?? null : null,
        exceptionReason,
        expectedDeliveryDate: extractExpectedDeliveryDate(trackInfo),
        rescheduledDeliveryDate: null, // USPS doesn't typically provide this
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
            "Network error connecting to USPS API",
            true,
            error
          ),
        };
      }

      return {
        success: false,
        error: createError(
          "API_ERROR",
          `Unexpected error tracking USPS package: ${error instanceof Error ? error.message : String(error)}`,
          true,
          error
        ),
      };
    }
  }

  getTrackingUrl(trackingNumber: string): string {
    return `${USPS_TRACKING_URL_BASE}${encodeURIComponent(trackingNumber)}`;
  }
}

/**
 * Singleton instance of the USPS adapter.
 */
let uspsAdapterInstance: UspsAdapter | null = null;

/**
 * Get the USPS adapter singleton.
 */
export function getUspsAdapter(): UspsAdapter {
  if (!uspsAdapterInstance) {
    uspsAdapterInstance = new UspsAdapter();
  }
  return uspsAdapterInstance;
}
