/**
 * UPS API Response Schemas
 *
 * Zod schemas for validating UPS Track API responses.
 * Based on the UPS Track API v1 response structure.
 *
 * @see https://developer.ups.com/api/reference/tracking
 */

import { z } from "zod";

/**
 * UPS Address schema.
 */
export const UpsAddressSchema = z
  .object({
    city: z.string().nullable().optional(),
    stateProvince: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
    scheduledDeliveryDate: z.string().nullable().optional(),
  })
  .passthrough(); // Allow additional fields

export type UpsAddress = z.infer<typeof UpsAddressSchema>;

/**
 * UPS Location schema.
 */
export const UpsLocationSchema = z
  .object({
    address: UpsAddressSchema.optional(),
  })
  .passthrough();

export type UpsLocation = z.infer<typeof UpsLocationSchema>;

/**
 * UPS Status schema.
 */
export const UpsStatusSchema = z
  .object({
    type: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    statusCode: z.string().nullable().optional(),
  })
  .passthrough();

export type UpsStatus = z.infer<typeof UpsStatusSchema>;

/**
 * UPS Activity (tracking event) schema.
 */
export const UpsActivitySchema = z
  .object({
    date: z.string().nullable().optional(),
    time: z.string().nullable().optional(),
    location: UpsLocationSchema.nullable().optional(),
    status: UpsStatusSchema.nullable().optional(),
    document: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

export type UpsActivity = z.infer<typeof UpsActivitySchema>;

/**
 * UPS Delivery Date schema.
 */
export const UpsDeliveryDateSchema = z
  .object({
    type: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
  })
  .passthrough();

export type UpsDeliveryDate = z.infer<typeof UpsDeliveryDateSchema>;

/**
 * UPS Package Address schema.
 */
export const UpsPackageAddressSchema = z
  .object({
    type: z.string().nullable().optional(),
    address: UpsAddressSchema.nullable().optional(),
  })
  .passthrough();

export type UpsPackageAddress = z.infer<typeof UpsPackageAddressSchema>;

/**
 * UPS Package Weight schema.
 */
export const UpsPackageWeightSchema = z
  .object({
    unitOfMeasurement: z.string().nullable().optional(),
    weight: z.string().nullable().optional(),
  })
  .passthrough();

export type UpsPackageWeight = z.infer<typeof UpsPackageWeightSchema>;

/**
 * UPS Reference Number schema.
 */
export const UpsReferenceNumberSchema = z
  .object({
    type: z.string().nullable().optional(),
    number: z.string().nullable().optional(),
  })
  .passthrough();

export type UpsReferenceNumber = z.infer<typeof UpsReferenceNumberSchema>;

/**
 * UPS Package schema.
 */
export const UpsPackageSchema = z
  .object({
    trackingNumber: z.string().nullable().optional(),
    deliveryDate: z.array(UpsDeliveryDateSchema).nullable().optional(),
    deliveryTime: z
      .object({
        type: z.string().nullable().optional(),
        startTime: z.string().nullable().optional(),
        endTime: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    activity: z.array(UpsActivitySchema).nullable().optional(),
    currentStatus: UpsActivitySchema.nullable().optional(),
    packageAddress: z.array(UpsPackageAddressSchema).nullable().optional(),
    weight: UpsPackageWeightSchema.nullable().optional(),
    referenceNumber: z.array(UpsReferenceNumberSchema).nullable().optional(),
    service: z
      .object({
        code: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    packageCount: z.number().nullable().optional(),
  })
  .passthrough();

export type UpsPackage = z.infer<typeof UpsPackageSchema>;

/**
 * UPS Warning schema.
 */
export const UpsWarningSchema = z
  .object({
    code: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .passthrough();

export type UpsWarning = z.infer<typeof UpsWarningSchema>;

/**
 * UPS Shipment schema.
 */
export const UpsShipmentSchema = z
  .object({
    inquiryNumber: z.string().nullable().optional(),
    package: z.array(UpsPackageSchema).nullable().optional(),
    shipmentType: z
      .object({
        code: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    shipperNumber: z.string().nullable().optional(),
    service: z
      .object({
        code: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    referenceNumber: z.array(UpsReferenceNumberSchema).nullable().optional(),
    pickupDate: z.string().nullable().optional(),
    warnings: z.array(UpsWarningSchema).nullable().optional(),
  })
  .passthrough();

export type UpsShipment = z.infer<typeof UpsShipmentSchema>;

/**
 * UPS Track Response schema.
 */
export const UpsTrackResponseSchema = z
  .object({
    shipment: z.array(UpsShipmentSchema).nullable().optional(),
  })
  .passthrough();

export type UpsTrackResponse = z.infer<typeof UpsTrackResponseSchema>;

/**
 * Full UPS API Tracking Response schema.
 */
export const UpsTrackingResponseSchema = z
  .object({
    trackResponse: UpsTrackResponseSchema.nullable().optional(),
  })
  .passthrough();

export type UpsTrackingResponse = z.infer<typeof UpsTrackingResponseSchema>;

/**
 * UPS OAuth Token Response schema.
 */
export const UpsOAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  issued_at: z.string().optional(),
  client_id: z.string().optional(),
  status: z.string().optional(),
});

export type UpsOAuthTokenResponse = z.infer<typeof UpsOAuthTokenResponseSchema>;

/**
 * UPS API Error Response schema.
 */
export const UpsErrorResponseSchema = z
  .object({
    response: z
      .object({
        errors: z
          .array(
            z.object({
              code: z.string().optional(),
              message: z.string().optional(),
            })
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type UpsErrorResponse = z.infer<typeof UpsErrorResponseSchema>;
