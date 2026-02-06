/**
 * CSV Generation Utility
 *
 * Functions for generating CSV files from shipment data.
 */

import { format, parseISO } from "date-fns";

/**
 * Shipment data structure for CSV export
 */
export interface ShipmentExportData {
  id: string;
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  serviceLevel: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shipDate: Date;
  expectedDeliveryDate: Date | null;
  currentStatus: string;
  isDelayed: boolean;
  daysDelayed: number;
  isDelivered: boolean;
  deliveredAt: Date | null;
  isResolved: boolean;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  notificationSent: boolean;
  notificationSentAt: Date | null;
  orderValue: string | null;
  lastScanLocation: string | null;
  lastScanTime: Date | null;
  fulfillmentLocationName: string | null;
  shippingAddress: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
}

/**
 * CSV column definitions with headers and value extractors
 */
const CSV_COLUMNS: Array<{
  header: string;
  getValue: (shipment: ShipmentExportData) => string;
}> = [
  { header: "Order Number", getValue: (s) => s.orderNumber },
  { header: "Tracking Number", getValue: (s) => s.trackingNumber },
  { header: "Carrier", getValue: (s) => formatCarrier(s.carrier) },
  { header: "Service Level", getValue: (s) => s.serviceLevel || "" },
  { header: "Customer Name", getValue: (s) => s.customerName },
  { header: "Customer Email", getValue: (s) => s.customerEmail },
  { header: "Customer Phone", getValue: (s) => s.customerPhone || "" },
  { header: "Ship Date", getValue: (s) => formatDate(s.shipDate) },
  { header: "Expected Delivery", getValue: (s) => formatDate(s.expectedDeliveryDate) },
  { header: "Current Status", getValue: (s) => s.currentStatus },
  { header: "Delayed", getValue: (s) => s.isDelayed ? "Yes" : "No" },
  { header: "Days Delayed", getValue: (s) => s.isDelayed ? String(s.daysDelayed) : "0" },
  { header: "Delivered", getValue: (s) => s.isDelivered ? "Yes" : "No" },
  { header: "Delivered At", getValue: (s) => formatDate(s.deliveredAt) },
  { header: "Resolved", getValue: (s) => s.isResolved ? "Yes" : "No" },
  { header: "Resolved At", getValue: (s) => formatDate(s.resolvedAt) },
  { header: "Resolution Reason", getValue: (s) => formatResolutionReason(s.resolutionReason) },
  { header: "Notification Sent", getValue: (s) => s.notificationSent ? "Yes" : "No" },
  { header: "Notification Sent At", getValue: (s) => formatDate(s.notificationSentAt) },
  { header: "Order Value", getValue: (s) => formatCurrency(s.orderValue) },
  { header: "Last Scan Location", getValue: (s) => s.lastScanLocation || "" },
  { header: "Last Scan Time", getValue: (s) => formatDateTime(s.lastScanTime) },
  { header: "Fulfillment Location", getValue: (s) => s.fulfillmentLocationName || "" },
  { header: "Shipping Address", getValue: (s) => formatAddress(s.shippingAddress) },
];

/**
 * Format carrier name for display
 */
function formatCarrier(carrier: string): string {
  switch (carrier.toUpperCase()) {
    case "UPS":
      return "UPS";
    case "FEDEX":
      return "FedEx";
    case "USPS":
      return "USPS";
    case "UNKNOWN":
      return "Unknown";
    default:
      return carrier;
  }
}

/**
 * Format date for CSV (YYYY-MM-DD)
 */
function formatDate(date: Date | string | null): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? parseISO(date) : date;
    return format(d, "yyyy-MM-dd");
  } catch {
    return "";
  }
}

/**
 * Format date and time for CSV (YYYY-MM-DD HH:mm)
 */
function formatDateTime(date: Date | string | null): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? parseISO(date) : date;
    return format(d, "yyyy-MM-dd HH:mm");
  } catch {
    return "";
  }
}

/**
 * Format resolution reason for display
 */
function formatResolutionReason(reason: string | null): string {
  if (!reason) return "";
  const labels: Record<string, string> = {
    CONTACTED_CUSTOMER: "Contacted Customer",
    SENT_NOTIFICATION: "Sent Notification",
    PARTIAL_REFUND: "Partial Refund",
    FULL_REFUND: "Full Refund",
    RESHIPPED: "Reshipped",
    DELIVERED_FALSE_ALARM: "Delivered (False Alarm)",
    CUSTOMER_CANCELLED: "Customer Cancelled",
    OTHER: "Other",
  };
  return labels[reason] || reason;
}

/**
 * Format currency value
 */
function formatCurrency(value: string | null): string {
  if (!value) return "";
  try {
    const num = parseFloat(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);
  } catch {
    return value;
  }
}

/**
 * Format shipping address as a single line
 */
function formatAddress(
  address: ShipmentExportData["shippingAddress"]
): string {
  if (!address) return "";
  const parts = [
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Escape a value for CSV
 * - Wraps in quotes if contains comma, quote, or newline
 * - Escapes quotes by doubling them
 */
export function escapeCSVValue(value: string): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);

  // Check if we need to quote the value
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    // Escape quotes by doubling them and wrap in quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Generate CSV content from shipment data
 *
 * @param shipments - Array of shipment data to export
 * @returns CSV content as a string
 */
export function generateCSV(shipments: ShipmentExportData[]): string {
  // Header row
  const headerRow = CSV_COLUMNS.map((col) => escapeCSVValue(col.header)).join(",");

  // Data rows
  const dataRows = shipments.map((shipment) => {
    return CSV_COLUMNS.map((col) => escapeCSVValue(col.getValue(shipment))).join(",");
  });

  // Combine header and data rows with proper line endings (CRLF for Windows compatibility)
  return [headerRow, ...dataRows].join("\r\n");
}

/**
 * Generate a filename for the CSV export
 *
 * @param prefix - Prefix for the filename (default: "shipments")
 * @returns Filename with timestamp
 */
export function generateCSVFilename(prefix: string = "shipments"): string {
  const timestamp = format(new Date(), "yyyy-MM-dd_HH-mm-ss");
  return `${prefix}_export_${timestamp}.csv`;
}
