import { z } from "zod";

/**
 * Merchant settings schema - validates the JSON stored in Merchant.settings
 */
export const MerchantSettingsSchema = z.object({
  delayThresholdHours: z.number().min(0).max(72).default(8),
  autoArchiveDays: z.number().min(1).max(365).default(30),
  deliveryWindows: z.record(z.string(), z.number()).default({}),
  columnVisibility: z.array(z.string()).default([
    "orderNumber",
    "trackingNumber",
    "carrier",
    "serviceLevel",
    "customerName",
    "shipDate",
    "expectedDeliveryDate",
    "daysDelayed",
    "orderValue",
  ]),
  columnOrder: z.array(z.string()).default([
    "orderNumber",
    "trackingNumber",
    "carrier",
    "serviceLevel",
    "customerName",
    "shipDate",
    "expectedDeliveryDate",
    "daysDelayed",
    "orderValue",
  ]),
  defaultSortColumn: z.string().default("daysDelayed"),
  defaultSortDirection: z.enum(["asc", "desc"]).default("desc"),
  notificationTemplate: z
    .object({
      subject: z.string().default("Update on your order #{order_number}"),
      body: z.string().default(`Hi {customer_first_name},

We wanted to let you know that your recent order (#{order_number}) is experiencing a slight delay in transit.

Current Status: {carrier_status}
Carrier: {carrier_name}
Tracking Number: {tracking_number}
Track your package: {tracking_url}

We apologize for any inconvenience and are monitoring your shipment closely. If you have any questions, please don't hesitate to reach out.

Thank you for your patience!

{shop_name}`),
    })
    .default({}),
  fromEmail: z.string().email().nullable().default(null),
});

export type MerchantSettings = z.infer<typeof MerchantSettingsSchema>;

/**
 * Default merchant settings
 */
export const DEFAULT_MERCHANT_SETTINGS: MerchantSettings = MerchantSettingsSchema.parse({});

/**
 * Resolution reason enum values for validation
 */
export const ResolutionReasonSchema = z.enum([
  "CONTACTED_CUSTOMER",
  "SENT_NOTIFICATION",
  "PARTIAL_REFUND",
  "FULL_REFUND",
  "RESHIPPED",
  "DELIVERED_FALSE_ALARM",
  "CUSTOMER_CANCELLED",
  "OTHER",
]);

export type ResolutionReasonType = z.infer<typeof ResolutionReasonSchema>;

/**
 * Carrier enum values for validation
 */
export const CarrierSchema = z.enum(["UPS", "FEDEX", "USPS", "UNKNOWN"]);

export type CarrierType = z.infer<typeof CarrierSchema>;
