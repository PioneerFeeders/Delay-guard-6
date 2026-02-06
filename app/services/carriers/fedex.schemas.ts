/**
 * FedEx API Response Schemas
 *
 * Zod schemas for validating FedEx Track API responses.
 * Based on the FedEx Track API v1 response structure.
 *
 * @see https://developer.fedex.com/api/en-us/catalog/track.html
 */

import { z } from "zod";

/**
 * FedEx Address schema.
 */
export const FedexAddressSchema = z
  .object({
    city: z.string().nullable().optional(),
    stateOrProvinceCode: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
    countryName: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    residential: z.boolean().nullable().optional(),
  })
  .passthrough();

export type FedexAddress = z.infer<typeof FedexAddressSchema>;

/**
 * FedEx Contact schema.
 */
export const FedexContactSchema = z
  .object({
    companyName: z.string().nullable().optional(),
    personName: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexContact = z.infer<typeof FedexContactSchema>;

/**
 * FedEx Location schema.
 */
export const FedexLocationSchema = z
  .object({
    address: FedexAddressSchema.nullable().optional(),
    contact: FedexContactSchema.nullable().optional(),
    locationType: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexLocation = z.infer<typeof FedexLocationSchema>;

/**
 * FedEx Scan Event schema.
 */
export const FedexScanEventSchema = z
  .object({
    date: z.string().nullable().optional(),
    derivedStatus: z.string().nullable().optional(),
    scanLocation: FedexLocationSchema.nullable().optional(),
    eventDescription: z.string().nullable().optional(),
    eventType: z.string().nullable().optional(),
    exceptionDescription: z.string().nullable().optional(),
    exceptionCode: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexScanEvent = z.infer<typeof FedexScanEventSchema>;

/**
 * FedEx Date/Time info schema.
 */
export const FedexDateTimeSchema = z
  .object({
    dateTime: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexDateTime = z.infer<typeof FedexDateTimeSchema>;

/**
 * FedEx Delivery Time Window schema.
 */
export const FedexDeliveryWindowSchema = z
  .object({
    type: z.string().nullable().optional(),
    window: z
      .object({
        begins: z.string().nullable().optional(),
        ends: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type FedexDeliveryWindow = z.infer<typeof FedexDeliveryWindowSchema>;

/**
 * FedEx Status Detail schema.
 */
export const FedexStatusDetailSchema = z
  .object({
    code: z.string().nullable().optional(),
    derivedCode: z.string().nullable().optional(),
    statusByLocale: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    scanLocation: FedexLocationSchema.nullable().optional(),
    ancillaryDetails: z
      .array(
        z
          .object({
            reason: z.string().nullable().optional(),
            reasonDescription: z.string().nullable().optional(),
            action: z.string().nullable().optional(),
            actionDescription: z.string().nullable().optional(),
          })
          .passthrough()
      )
      .nullable()
      .optional(),
  })
  .passthrough();

export type FedexStatusDetail = z.infer<typeof FedexStatusDetailSchema>;

/**
 * FedEx Delay Detail schema.
 */
export const FedexDelayDetailSchema = z
  .object({
    type: z.string().nullable().optional(),
    subType: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexDelayDetail = z.infer<typeof FedexDelayDetailSchema>;

/**
 * FedEx Service Detail schema.
 */
export const FedexServiceDetailSchema = z
  .object({
    type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    shortDescription: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexServiceDetail = z.infer<typeof FedexServiceDetailSchema>;

/**
 * FedEx Weight schema.
 */
export const FedexWeightSchema = z
  .object({
    unit: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexWeight = z.infer<typeof FedexWeightSchema>;

/**
 * FedEx Tracking Info schema (main tracking data).
 */
export const FedexTrackingInfoSchema = z
  .object({
    trackingNumberInfo: z
      .object({
        trackingNumber: z.string().nullable().optional(),
        carrierCode: z.string().nullable().optional(),
        trackingNumberUniqueId: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    latestStatusDetail: FedexStatusDetailSchema.nullable().optional(),
    dateAndTimes: z.array(FedexDateTimeSchema).nullable().optional(),
    availableNotifications: z.array(z.string()).nullable().optional(),
    specialHandlings: z
      .array(
        z
          .object({
            type: z.string().nullable().optional(),
            description: z.string().nullable().optional(),
          })
          .passthrough()
      )
      .nullable()
      .optional(),
    packageDetails: z
      .object({
        packagingDescription: z
          .object({
            type: z.string().nullable().optional(),
            description: z.string().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        count: z.string().nullable().optional(),
        weightAndDimensions: z
          .object({
            weight: z.array(FedexWeightSchema).nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    shipperInformation: z
      .object({
        address: FedexAddressSchema.nullable().optional(),
        contact: FedexContactSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    recipientInformation: z
      .object({
        address: FedexAddressSchema.nullable().optional(),
        contact: FedexContactSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    originLocation: FedexLocationSchema.nullable().optional(),
    destinationLocation: FedexLocationSchema.nullable().optional(),
    scanEvents: z.array(FedexScanEventSchema).nullable().optional(),
    estimatedDeliveryTimeWindow: FedexDeliveryWindowSchema.nullable().optional(),
    standardTransitTimeWindow: FedexDeliveryWindowSchema.nullable().optional(),
    serviceDetail: FedexServiceDetailSchema.nullable().optional(),
    delayDetail: FedexDelayDetailSchema.nullable().optional(),
    deliveryDetails: z
      .object({
        actualDeliveryAddress: FedexAddressSchema.nullable().optional(),
        deliveryAttempts: z.string().nullable().optional(),
        receivedByName: z.string().nullable().optional(),
        deliveryOptionEligibilityDetails: z.array(z.unknown()).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    goodsClassificationCode: z.string().nullable().optional(),
    returnDetail: z.unknown().nullable().optional(),
  })
  .passthrough();

export type FedexTrackingInfo = z.infer<typeof FedexTrackingInfoSchema>;

/**
 * FedEx Complete Track Result schema.
 */
export const FedexCompleteTrackResultSchema = z
  .object({
    trackingNumber: z.string().nullable().optional(),
    trackResults: z.array(FedexTrackingInfoSchema).nullable().optional(),
  })
  .passthrough();

export type FedexCompleteTrackResult = z.infer<typeof FedexCompleteTrackResultSchema>;

/**
 * FedEx Output schema.
 */
export const FedexOutputSchema = z
  .object({
    completeTrackResults: z.array(FedexCompleteTrackResultSchema).nullable().optional(),
  })
  .passthrough();

export type FedexOutput = z.infer<typeof FedexOutputSchema>;

/**
 * FedEx Alert schema for errors/notifications.
 */
export const FedexAlertSchema = z
  .object({
    code: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    alertType: z.string().nullable().optional(),
  })
  .passthrough();

export type FedexAlert = z.infer<typeof FedexAlertSchema>;

/**
 * Full FedEx API Tracking Response schema.
 */
export const FedexTrackingResponseSchema = z
  .object({
    transactionId: z.string().nullable().optional(),
    output: FedexOutputSchema.nullable().optional(),
    alerts: z.array(FedexAlertSchema).nullable().optional(),
  })
  .passthrough();

export type FedexTrackingResponse = z.infer<typeof FedexTrackingResponseSchema>;

/**
 * FedEx OAuth Token Response schema.
 */
export const FedexOAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

export type FedexOAuthTokenResponse = z.infer<typeof FedexOAuthTokenResponseSchema>;

/**
 * FedEx API Error Response schema.
 */
export const FedexErrorResponseSchema = z
  .object({
    transactionId: z.string().nullable().optional(),
    errors: z
      .array(
        z.object({
          code: z.string().optional(),
          message: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export type FedexErrorResponse = z.infer<typeof FedexErrorResponseSchema>;
