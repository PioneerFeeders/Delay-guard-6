/**
 * API Route: /api/shipments/:id
 *
 * GET: Fetch detailed shipment information including tracking events,
 * notification logs, and resolution logs.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { data } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return data({ error: "Shipment ID is required" }, { status: 400 });
  }

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: { id: true },
  });

  if (!merchant) {
    return data({ error: "Merchant not found" }, { status: 404 });
  }

  // Fetch shipment with related data
  const shipment = await prisma.shipment.findFirst({
    where: {
      id,
      merchantId: merchant.id,
    },
    include: {
      trackingEvents: {
        orderBy: { eventTimestamp: "desc" },
      },
      notificationLogs: {
        orderBy: { sentAt: "desc" },
      },
      resolutionLogs: {
        orderBy: { resolvedAt: "desc" },
      },
    },
  });

  if (!shipment) {
    return data({ error: "Shipment not found" }, { status: 404 });
  }

  // Transform to API response format
  const response = {
    shipment: {
      id: shipment.id,
      orderNumber: shipment.orderNumber,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      serviceLevel: shipment.serviceLevel,
      customerName: shipment.customerName,
      customerEmail: shipment.customerEmail,
      customerPhone: shipment.customerPhone,
      shippingAddress: shipment.shippingAddress,
      shipDate: shipment.shipDate.toISOString(),
      expectedDeliveryDate: shipment.expectedDeliveryDate?.toISOString() ?? null,
      expectedDeliverySource: shipment.expectedDeliverySource,
      currentStatus: shipment.currentStatus,
      isDelayed: shipment.isDelayed,
      delayFlaggedAt: shipment.delayFlaggedAt?.toISOString() ?? null,
      daysDelayed: shipment.daysDelayed,
      lastCarrierStatus: shipment.lastCarrierStatus,
      lastScanLocation: shipment.lastScanLocation,
      lastScanTime: shipment.lastScanTime?.toISOString() ?? null,
      carrierExceptionCode: shipment.carrierExceptionCode,
      carrierExceptionReason: shipment.carrierExceptionReason,
      rescheduledDeliveryDate: shipment.rescheduledDeliveryDate?.toISOString() ?? null,
      isResolved: shipment.isResolved,
      resolvedAt: shipment.resolvedAt?.toISOString() ?? null,
      resolutionReason: shipment.resolutionReason,
      resolutionNotes: shipment.resolutionNotes,
      notificationSent: shipment.notificationSent,
      notificationSentAt: shipment.notificationSentAt?.toISOString() ?? null,
      isDelivered: shipment.isDelivered,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      orderValue: shipment.orderValue?.toString() ?? null,
      shopifyOrderId: shipment.shopifyOrderId,
      fulfillmentLocationName: shipment.fulfillmentLocationName,
      trackingEvents: shipment.trackingEvents.map((event) => ({
        id: event.id,
        eventTimestamp: event.eventTimestamp.toISOString(),
        eventType: event.eventType,
        eventDescription: event.eventDescription,
        locationCity: event.locationCity,
        locationState: event.locationState,
        locationCountry: event.locationCountry,
      })),
      notificationLogs: shipment.notificationLogs.map((log) => ({
        id: log.id,
        sentAt: log.sentAt.toISOString(),
        sentBy: log.sentBy,
        recipientEmail: log.recipientEmail,
        emailSubject: log.emailSubject,
        status: log.status,
      })),
      resolutionLogs: shipment.resolutionLogs.map((log) => ({
        id: log.id,
        resolvedAt: log.resolvedAt.toISOString(),
        resolvedBy: log.resolvedBy,
        resolutionReason: log.resolutionReason,
        notes: log.notes,
      })),
    },
  };

  return data(response);
};
