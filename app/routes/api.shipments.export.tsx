/**
 * API Route: /api/shipments/export
 *
 * GET: Export shipments to CSV format.
 * Supports the same query parameters as /api/shipments for filtering,
 * plus optional shipmentIds parameter for exporting specific shipments.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import type { Prisma, Carrier } from "@prisma/client";
import { startOfDay, endOfDay, parseISO } from "date-fns";
import { generateCSV, generateCSVFilename, type ShipmentExportData } from "~/lib/csv";
import { safeParseShipmentsQueryParams } from "~/lib/validation";

/**
 * Build where clause from query parameters (same logic as api.shipments.tsx)
 */
function buildWhereClause(
  merchantId: string,
  params: ReturnType<typeof safeParseShipmentsQueryParams>,
  shipmentIds?: string[]
): Prisma.ShipmentWhereInput {
  const where: Prisma.ShipmentWhereInput = {
    merchantId,
  };

  // If specific shipment IDs are provided, filter to those
  if (shipmentIds && shipmentIds.length > 0) {
    where.id = { in: shipmentIds };
    return where; // When exporting specific IDs, ignore other filters
  }

  // Base condition: exclude archived unless viewing all/delivered
  where.isArchived = false;

  // Tab-based filtering
  switch (params.tab) {
    case "delayed":
      where.isDelayed = true;
      where.isResolved = false;
      where.isDelivered = false;
      break;
    case "pending":
      where.currentStatus = "pending";
      where.hasCarrierScan = false;
      where.isDelivered = false;
      break;
    case "resolved":
      where.isResolved = true;
      break;
    case "delivered":
      where.isDelivered = true;
      break;
    case "all":
    default:
      break;
  }

  // Carrier filter
  if (params.carrier) {
    where.carrier = params.carrier as Carrier;
  }

  // Service level filter
  if (params.serviceLevel) {
    where.serviceLevel = params.serviceLevel;
  }

  // Delay status filter
  if (params.delayStatus) {
    switch (params.delayStatus) {
      case "delayed":
        where.isDelayed = true;
        break;
      case "on_time":
        where.isDelayed = false;
        where.isDelivered = false;
        break;
      case "pending":
        where.hasCarrierScan = false;
        break;
    }
  }

  // Order value range
  if (params.orderValueMin !== undefined || params.orderValueMax !== undefined) {
    where.orderValue = {};
    if (params.orderValueMin !== undefined) {
      where.orderValue.gte = params.orderValueMin;
    }
    if (params.orderValueMax !== undefined) {
      where.orderValue.lte = params.orderValueMax;
    }
  }

  // Ship date range
  if (params.shipDateFrom || params.shipDateTo) {
    where.shipDate = {};
    if (params.shipDateFrom) {
      const fromDate = parseISO(params.shipDateFrom);
      where.shipDate.gte = startOfDay(fromDate);
    }
    if (params.shipDateTo) {
      const toDate = parseISO(params.shipDateTo);
      where.shipDate.lte = endOfDay(toDate);
    }
  }

  // Fulfillment location filter
  if (params.locationId) {
    where.fulfillmentLocationId = params.locationId;
  }

  return where;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: { id: true },
  });

  if (!merchant) {
    return new Response("Merchant not found", { status: 404 });
  }

  // Parse query parameters
  const url = new URL(request.url);
  const params = safeParseShipmentsQueryParams(url.searchParams);

  // Check for specific shipment IDs (comma-separated)
  const shipmentIdsParam = url.searchParams.get("shipmentIds");
  const shipmentIds = shipmentIdsParam
    ? shipmentIdsParam.split(",").filter((id) => id.trim())
    : undefined;

  // Build where clause
  const where = buildWhereClause(merchant.id, params, shipmentIds);

  // Fetch all matching shipments (no pagination for export)
  // Limit to 10,000 rows to prevent memory issues
  const shipments = await prisma.shipment.findMany({
    where,
    orderBy: { shipDate: "desc" },
    take: 10000,
    select: {
      id: true,
      orderNumber: true,
      trackingNumber: true,
      carrier: true,
      serviceLevel: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      shipDate: true,
      expectedDeliveryDate: true,
      currentStatus: true,
      isDelayed: true,
      daysDelayed: true,
      isDelivered: true,
      deliveredAt: true,
      isResolved: true,
      resolvedAt: true,
      resolutionReason: true,
      notificationSent: true,
      notificationSentAt: true,
      orderValue: true,
      lastScanLocation: true,
      lastScanTime: true,
      fulfillmentLocationName: true,
      shippingAddress: true,
    },
  });

  // Transform to export format
  const exportData: ShipmentExportData[] = shipments.map((s) => ({
    id: s.id,
    orderNumber: s.orderNumber,
    trackingNumber: s.trackingNumber,
    carrier: s.carrier,
    serviceLevel: s.serviceLevel,
    customerName: s.customerName,
    customerEmail: s.customerEmail,
    customerPhone: s.customerPhone,
    shipDate: s.shipDate,
    expectedDeliveryDate: s.expectedDeliveryDate,
    currentStatus: s.currentStatus,
    isDelayed: s.isDelayed,
    daysDelayed: s.daysDelayed,
    isDelivered: s.isDelivered,
    deliveredAt: s.deliveredAt,
    isResolved: s.isResolved,
    resolvedAt: s.resolvedAt,
    resolutionReason: s.resolutionReason,
    notificationSent: s.notificationSent,
    notificationSentAt: s.notificationSentAt,
    orderValue: s.orderValue?.toString() || null,
    lastScanLocation: s.lastScanLocation,
    lastScanTime: s.lastScanTime,
    fulfillmentLocationName: s.fulfillmentLocationName,
    shippingAddress: s.shippingAddress as ShipmentExportData["shippingAddress"],
  }));

  // Generate CSV content
  const csvContent = generateCSV(exportData);
  const filename = generateCSVFilename("shipments");

  // Return CSV response
  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
};
