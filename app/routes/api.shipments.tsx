/**
 * API Route: /api/shipments
 *
 * GET: Query shipments for the authenticated merchant with filtering,
 * sorting, and pagination.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { data } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import type { Prisma, Carrier } from "@prisma/client";
import { startOfDay, endOfDay, parseISO } from "date-fns";
import {
  safeParseShipmentsQueryParams,
  type ShipmentsApiResponse,
  type ShipmentListItem,
  type ShipmentsQueryParams,
} from "~/lib/validation";

/**
 * Build Prisma where clause from query parameters
 */
function buildWhereClause(
  merchantId: string,
  params: ShipmentsQueryParams
): Prisma.ShipmentWhereInput {
  const where: Prisma.ShipmentWhereInput = {
    merchantId,
    // Base condition: exclude archived unless viewing all/delivered
    isArchived: false,
  };

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
      // No additional tab filtering
      break;
  }

  // Carrier filter
  if (params.carrier) {
    where.carrier = params.carrier as Carrier;
  }

  // Service level filter (exact match, case-insensitive handled at DB level)
  if (params.serviceLevel) {
    where.serviceLevel = params.serviceLevel;
  }

  // Delay status filter (additional to tab filter)
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

/**
 * Build Prisma orderBy clause from query parameters
 */
function buildOrderByClause(
  params: ShipmentsQueryParams
): Prisma.ShipmentOrderByWithRelationInput {
  const direction = params.sortDir;

  // Map sortBy column to Prisma field
  const sortFieldMap: Record<string, keyof Prisma.ShipmentOrderByWithRelationInput> = {
    orderNumber: "orderNumber",
    trackingNumber: "trackingNumber",
    carrier: "carrier",
    serviceLevel: "serviceLevel",
    customerName: "customerName",
    shipDate: "shipDate",
    expectedDeliveryDate: "expectedDeliveryDate",
    daysDelayed: "daysDelayed",
    orderValue: "orderValue",
    currentStatus: "currentStatus",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  };

  const field = sortFieldMap[params.sortBy] || "daysDelayed";

  return { [field]: direction };
}

/**
 * Transform Prisma shipment to API response format
 */
function transformShipment(
  shipment: {
    id: string;
    orderNumber: string;
    trackingNumber: string;
    carrier: Carrier;
    serviceLevel: string | null;
    customerName: string;
    customerEmail: string;
    shipDate: Date;
    expectedDeliveryDate: Date | null;
    daysDelayed: number;
    orderValue: Prisma.Decimal | null;
    currentStatus: string;
    isDelayed: boolean;
    isResolved: boolean;
    isDelivered: boolean;
    notificationSent: boolean;
    lastScanLocation: string | null;
    lastScanTime: Date | null;
    fulfillmentLocationId: string | null;
    fulfillmentLocationName: string | null;
    shopifyOrderId: string;
    isTestData: boolean;
  },
  isDuplicateTracking: boolean = false
): ShipmentListItem {
  return {
    id: shipment.id,
    orderNumber: shipment.orderNumber,
    trackingNumber: shipment.trackingNumber,
    carrier: shipment.carrier,
    serviceLevel: shipment.serviceLevel,
    customerName: shipment.customerName,
    customerEmail: shipment.customerEmail,
    shipDate: shipment.shipDate.toISOString(),
    expectedDeliveryDate: shipment.expectedDeliveryDate?.toISOString() ?? null,
    daysDelayed: shipment.daysDelayed,
    orderValue: shipment.orderValue?.toString() ?? null,
    currentStatus: shipment.currentStatus,
    isDelayed: shipment.isDelayed,
    isResolved: shipment.isResolved,
    isDelivered: shipment.isDelivered,
    notificationSent: shipment.notificationSent,
    lastScanLocation: shipment.lastScanLocation,
    lastScanTime: shipment.lastScanTime?.toISOString() ?? null,
    fulfillmentLocationId: shipment.fulfillmentLocationId,
    fulfillmentLocationName: shipment.fulfillmentLocationName,
    shopifyOrderId: shipment.shopifyOrderId,
    isTestData: shipment.isTestData,
    isDuplicateTracking,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: { id: true },
  });

  if (!merchant) {
    return data(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  // Parse query parameters
  const url = new URL(request.url);
  const params = safeParseShipmentsQueryParams(url.searchParams);

  // Build query
  const where = buildWhereClause(merchant.id, params);
  const orderBy = buildOrderByClause(params);

  // Calculate pagination
  const skip = (params.page - 1) * params.pageSize;
  const take = params.pageSize;

  // Get today's date range for summary
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // Execute queries in parallel
  const [shipments, total, summaryData] = await Promise.all([
    // Main shipments query
    prisma.shipment.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        orderNumber: true,
        trackingNumber: true,
        carrier: true,
        serviceLevel: true,
        customerName: true,
        customerEmail: true,
        shipDate: true,
        expectedDeliveryDate: true,
        daysDelayed: true,
        orderValue: true,
        currentStatus: true,
        isDelayed: true,
        isResolved: true,
        isDelivered: true,
        notificationSent: true,
        lastScanLocation: true,
        lastScanTime: true,
        fulfillmentLocationId: true,
        fulfillmentLocationName: true,
        shopifyOrderId: true,
        isTestData: true,
      },
    }),

    // Total count for pagination
    prisma.shipment.count({ where }),

    // Summary statistics
    Promise.all([
      // Total active (not delivered, not archived)
      prisma.shipment.count({
        where: {
          merchantId: merchant.id,
          isDelivered: false,
          isArchived: false,
        },
      }),
      // Delayed (is delayed, not resolved)
      prisma.shipment.count({
        where: {
          merchantId: merchant.id,
          isDelayed: true,
          isResolved: false,
          isArchived: false,
        },
      }),
      // Delivered today
      prisma.shipment.count({
        where: {
          merchantId: merchant.id,
          isDelivered: true,
          deliveredAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      }),
      // Average delivery times by carrier
      prisma.$queryRaw<{ carrier: Carrier; avg_days: number | null }[]>`
        SELECT
          carrier,
          AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "shipDate")) / 86400)::numeric as avg_days
        FROM "Shipment"
        WHERE "merchantId" = ${merchant.id}
          AND "isDelivered" = true
          AND "deliveredAt" IS NOT NULL
          AND carrier IN ('UPS', 'FEDEX', 'USPS')
        GROUP BY carrier
      `,
    ]),
  ]);

  // Process summary data
  const [totalActive, delayed, deliveredToday, avgDeliveryTimes] = summaryData;

  const avgDeliveryTimeByCarrier: Record<string, number | null> = {
    UPS: null,
    FEDEX: null,
    USPS: null,
  };

  for (const row of avgDeliveryTimes) {
    if (row.avg_days !== null) {
      avgDeliveryTimeByCarrier[row.carrier] = Number(row.avg_days);
    }
  }

  // Detect duplicate tracking numbers
  const trackingNumbers = shipments.map((s) => s.trackingNumber).filter(Boolean);
  const duplicateTrackingNumbers = new Set<string>();

  if (trackingNumbers.length > 0) {
    // Find tracking numbers that appear more than once
    const trackingCounts = await prisma.shipment.groupBy({
      by: ["trackingNumber"],
      where: {
        merchantId: merchant.id,
        trackingNumber: { in: trackingNumbers },
        isArchived: false,
      },
      _count: { trackingNumber: true },
      having: {
        trackingNumber: { _count: { gt: 1 } },
      },
    });

    for (const group of trackingCounts) {
      if (group.trackingNumber) {
        duplicateTrackingNumbers.add(group.trackingNumber);
      }
    }
  }

  // Build response
  const response: ShipmentsApiResponse = {
    shipments: shipments.map((s) =>
      transformShipment(s, duplicateTrackingNumbers.has(s.trackingNumber))
    ),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
    },
    summary: {
      totalActive,
      delayed,
      deliveredToday,
      avgDeliveryTimeByCarrier,
    },
  };

  return data(response);
};
