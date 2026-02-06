/**
 * USPS API Response Schemas
 *
 * Zod schemas for validating USPS Web Tools API responses.
 * USPS uses XML API, so these schemas validate the parsed XML structure.
 *
 * @see https://www.usps.com/business/web-tools-apis/track-and-confirm-api.htm
 */

import { z } from "zod";

/**
 * USPS Track Detail (single tracking event) schema.
 */
export const UspsTrackDetailSchema = z
  .object({
    EventTime: z.string().nullable().optional(),
    EventDate: z.string().nullable().optional(),
    Event: z.string().nullable().optional(),
    EventCity: z.string().nullable().optional(),
    EventState: z.string().nullable().optional(),
    EventZIPCode: z.string().nullable().optional(),
    EventCountry: z.string().nullable().optional(),
    FirmName: z.string().nullable().optional(),
    Name: z.string().nullable().optional(),
    AuthorizedAgent: z.string().nullable().optional(),
    EventCode: z.string().nullable().optional(),
    DeliveryAttributeCode: z.string().nullable().optional(),
    MPDATE: z.string().nullable().optional(),
    MPSUFFIX: z.string().nullable().optional(),
  })
  .passthrough();

export type UspsTrackDetail = z.infer<typeof UspsTrackDetailSchema>;

/**
 * USPS Track Info schema (main tracking data for one package).
 */
export const UspsTrackInfoSchema = z
  .object({
    // Tracking number - could be attribute or element
    _ID: z.string().nullable().optional(),
    ID: z.string().nullable().optional(),
    // Summary is the most recent status
    TrackSummary: z.union([UspsTrackDetailSchema, z.string()]).nullable().optional(),
    // Detail contains historical events
    TrackDetail: z
      .union([z.array(UspsTrackDetailSchema), UspsTrackDetailSchema])
      .nullable()
      .optional(),
    // Expected delivery info
    ExpectedDeliveryDate: z.string().nullable().optional(),
    ExpectedDeliveryTime: z.string().nullable().optional(),
    GuaranteedDeliveryDate: z.string().nullable().optional(),
    // Additional status info
    Status: z.string().nullable().optional(),
    StatusCategory: z.string().nullable().optional(),
    StatusSummary: z.string().nullable().optional(),
    // Destination info
    DestinationCity: z.string().nullable().optional(),
    DestinationState: z.string().nullable().optional(),
    DestinationZip: z.string().nullable().optional(),
    // Class/service info
    Class: z.string().nullable().optional(),
    ClassOfMailCode: z.string().nullable().optional(),
    // Delivery notification
    DeliveryNotificationDate: z.string().nullable().optional(),
    RestoreDate: z.string().nullable().optional(),
    // Error message if tracking fails
    Error: z
      .object({
        Number: z.string().nullable().optional(),
        Description: z.string().nullable().optional(),
        Source: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type UspsTrackInfo = z.infer<typeof UspsTrackInfoSchema>;

/**
 * USPS Track Response schema (response wrapper).
 */
export const UspsTrackResponseSchema = z
  .object({
    TrackResponse: z
      .object({
        TrackInfo: z.union([z.array(UspsTrackInfoSchema), UspsTrackInfoSchema]).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type UspsTrackResponse = z.infer<typeof UspsTrackResponseSchema>;

/**
 * USPS Error Response schema.
 */
export const UspsErrorResponseSchema = z
  .object({
    Error: z
      .object({
        Number: z.string().nullable().optional(),
        Description: z.string().nullable().optional(),
        Source: z.string().nullable().optional(),
        HelpFile: z.string().nullable().optional(),
        HelpContext: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type UspsErrorResponse = z.infer<typeof UspsErrorResponseSchema>;

/**
 * Combined schema that can be either a track response or error.
 */
export const UspsApiResponseSchema = z.union([UspsTrackResponseSchema, UspsErrorResponseSchema]);

export type UspsApiResponse = z.infer<typeof UspsApiResponseSchema>;

/**
 * Helper function to normalize TrackDetail to array.
 */
export function normalizeTrackDetails(
  details: UspsTrackDetail | UspsTrackDetail[] | null | undefined
): UspsTrackDetail[] {
  if (!details) {
    return [];
  }
  return Array.isArray(details) ? details : [details];
}

/**
 * Helper function to extract TrackSummary as detail object.
 */
export function normalizeTrackSummary(
  summary: UspsTrackDetail | string | null | undefined
): UspsTrackDetail | null {
  if (!summary) {
    return null;
  }
  // If it's a string, wrap it as an event description
  if (typeof summary === "string") {
    return {
      Event: summary,
    };
  }
  return summary;
}
