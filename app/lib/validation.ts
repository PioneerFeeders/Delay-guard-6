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

// ============================================================
// Shopify Webhook Payload Schemas
// ============================================================

/**
 * Shipping address schema from Shopify
 */
export const ShippingAddressSchema = z.object({
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  province_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
});

export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;

/**
 * Fulfillment line item schema
 */
export const FulfillmentLineItemSchema = z.object({
  id: z.number(),
  variant_id: z.number().nullable().optional(),
  title: z.string().optional(),
  quantity: z.number().optional(),
  sku: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
});

/**
 * Fulfillment webhook payload schema (fulfillments/create, fulfillments/update)
 * Based on Shopify Fulfillment API webhook payload
 */
export const FulfillmentWebhookPayloadSchema = z.object({
  id: z.number(),
  order_id: z.number(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  tracking_company: z.string().nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  tracking_numbers: z.array(z.string()).optional(),
  tracking_url: z.string().nullable().optional(),
  tracking_urls: z.array(z.string()).optional(),
  shipment_status: z.string().nullable().optional(),
  location_id: z.number().nullable().optional(),
  origin_address: z.record(z.unknown()).nullable().optional(),
  destination: ShippingAddressSchema.nullable().optional(),
  line_items: z.array(FulfillmentLineItemSchema).optional(),
  name: z.string().optional(), // Fulfillment name, e.g., "#1001-F1"
  service: z.string().nullable().optional(), // Service level
  receipt: z.record(z.unknown()).nullable().optional(),
  admin_graphql_api_id: z.string().optional(),
});

export type FulfillmentWebhookPayload = z.infer<typeof FulfillmentWebhookPayloadSchema>;

/**
 * Order data schema (partial - fields we need from fulfillment webhook context)
 * Note: The full order is not included in fulfillment webhooks, but we may need
 * to fetch it separately for customer info and order value.
 */
export const OrderPartialSchema = z.object({
  id: z.number(),
  name: z.string(), // Order number like "#1001"
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  total_price: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  shipping_address: ShippingAddressSchema.nullable().optional(),
  customer: z
    .object({
      id: z.number(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      first_name: z.string().nullable().optional(),
      last_name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type OrderPartial = z.infer<typeof OrderPartialSchema>;

/**
 * App uninstalled webhook payload schema
 */
export const AppUninstalledWebhookPayloadSchema = z.object({
  id: z.number(),
  name: z.string().optional(), // Shop name
  email: z.string().optional(), // Shop email
  domain: z.string().optional(), // myshopify domain
  myshopify_domain: z.string().optional(),
});

export type AppUninstalledWebhookPayload = z.infer<typeof AppUninstalledWebhookPayloadSchema>;

/**
 * Validate and parse fulfillment webhook payload with helpful error messages
 */
export function parseFulfillmentPayload(data: unknown): FulfillmentWebhookPayload {
  return FulfillmentWebhookPayloadSchema.parse(data);
}

/**
 * Safe parse for fulfillment webhook payload
 */
export function safeParseFulfillmentPayload(data: unknown) {
  return FulfillmentWebhookPayloadSchema.safeParse(data);
}

/**
 * Validate and parse app uninstalled webhook payload
 */
export function parseAppUninstalledPayload(data: unknown): AppUninstalledWebhookPayload {
  return AppUninstalledWebhookPayloadSchema.parse(data);
}

/**
 * Safe parse for app uninstalled webhook payload
 */
export function safeParseAppUninstalledPayload(data: unknown) {
  return AppUninstalledWebhookPayloadSchema.safeParse(data);
}

// ============================================================
// API Query Parameter Schemas
// ============================================================

/**
 * Tab filter values for shipment list
 */
export const ShipmentTabSchema = z.enum(["all", "delayed", "pending", "resolved", "delivered"]);
export type ShipmentTab = z.infer<typeof ShipmentTabSchema>;

/**
 * Delay status filter values
 */
export const DelayStatusSchema = z.enum(["delayed", "on_time", "pending"]);
export type DelayStatus = z.infer<typeof DelayStatusSchema>;

/**
 * Sort direction
 */
export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/**
 * Valid columns for sorting shipments
 */
export const ShipmentSortColumnSchema = z.enum([
  "orderNumber",
  "trackingNumber",
  "carrier",
  "serviceLevel",
  "customerName",
  "shipDate",
  "expectedDeliveryDate",
  "daysDelayed",
  "orderValue",
  "currentStatus",
  "createdAt",
  "updatedAt",
]);
export type ShipmentSortColumn = z.infer<typeof ShipmentSortColumnSchema>;

/**
 * Query parameters for the shipments API endpoint
 */
export const ShipmentsQueryParamsSchema = z.object({
  // Tab filter (maps to status-based filters)
  tab: ShipmentTabSchema.default("all"),

  // Carrier filter
  carrier: CarrierSchema.optional(),

  // Service level filter (free text, exact match)
  serviceLevel: z.string().optional(),

  // Delay status filter
  delayStatus: DelayStatusSchema.optional(),

  // Order value range filters
  orderValueMin: z.coerce.number().min(0).optional(),
  orderValueMax: z.coerce.number().min(0).optional(),

  // Ship date range filters (ISO date strings)
  shipDateFrom: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  shipDateTo: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),

  // Fulfillment location filter
  locationId: z.string().optional(),

  // Sorting
  sortBy: ShipmentSortColumnSchema.default("daysDelayed"),
  sortDir: SortDirectionSchema.default("desc"),

  // Pagination
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type ShipmentsQueryParams = z.infer<typeof ShipmentsQueryParamsSchema>;

/**
 * Parse and validate shipments query parameters from URL search params
 */
export function parseShipmentsQueryParams(searchParams: URLSearchParams): ShipmentsQueryParams {
  const rawParams: Record<string, string | undefined> = {};

  // Extract all relevant params
  const paramNames = [
    "tab", "carrier", "serviceLevel", "delayStatus",
    "orderValueMin", "orderValueMax",
    "shipDateFrom", "shipDateTo",
    "locationId",
    "sortBy", "sortDir",
    "page", "pageSize"
  ];

  for (const name of paramNames) {
    const value = searchParams.get(name);
    if (value !== null && value !== "") {
      rawParams[name] = value;
    }
  }

  return ShipmentsQueryParamsSchema.parse(rawParams);
}

/**
 * Safe parse for shipments query parameters (returns default values on invalid input)
 */
export function safeParseShipmentsQueryParams(searchParams: URLSearchParams): ShipmentsQueryParams {
  try {
    return parseShipmentsQueryParams(searchParams);
  } catch {
    // Return defaults on any parse error
    return ShipmentsQueryParamsSchema.parse({});
  }
}

/**
 * Response shape for the shipments API endpoint
 */
export interface ShipmentsApiResponse {
  shipments: ShipmentListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalActive: number;
    delayed: number;
    deliveredToday: number;
    avgDeliveryTimeByCarrier: Record<string, number | null>;
  };
}

/**
 * Shipment data returned in list view
 */
export interface ShipmentListItem {
  id: string;
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  serviceLevel: string | null;
  customerName: string;
  customerEmail: string;
  shipDate: string;
  expectedDeliveryDate: string | null;
  daysDelayed: number;
  orderValue: string | null;
  currentStatus: string;
  isDelayed: boolean;
  isResolved: boolean;
  isDelivered: boolean;
  notificationSent: boolean;
  lastScanLocation: string | null;
  lastScanTime: string | null;
  fulfillmentLocationId: string | null;
  fulfillmentLocationName: string | null;
  shopifyOrderId: string;
  isTestData: boolean;
  isDuplicateTracking?: boolean;
}
