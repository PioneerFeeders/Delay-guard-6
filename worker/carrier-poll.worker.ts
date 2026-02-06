/**
 * Carrier Poll Worker
 *
 * This worker processes individual shipment tracking updates.
 * It calls the appropriate carrier API, updates the shipment status,
 * and runs delay detection logic.
 *
 * Flow:
 * 1. Load shipment and merchant from DB
 * 2. Skip if carrier === UNKNOWN
 * 3. Call carrier adapter
 * 4. Upsert tracking events into TrackingEvent table
 * 5. Update shipment fields (currentStatus, lastScanLocation, etc.)
 * 6. Run delay detection, update isDelayed/delayFlaggedAt
 * 7. Handle delivery (isDelivered, deliveredAt)
 * 8. Calculate nextPollAt using smart scheduling
 * 9. Error handling with pollErrorCount
 */

import type { Job } from "bullmq";
import type { CarrierPollJobData } from "../app/jobs/types";
import type {
  CarrierPollJobResult,
} from "../app/jobs/carrier-poll.job";
import type { TrackingEvent as CarrierTrackingEvent, TrackingResult } from "../app/services/carriers/carrier.interface";
import type { Prisma } from "@prisma/client";
import { prisma } from "../app/db.server";
import { trackShipment } from "../app/services/carriers/carrier.service";
import {
  evaluateDelay,
  toShipmentData,
  getDelayUpdateFields,
} from "../app/services/delay-detection.service";
import { canRecordFirstScan } from "../app/services/billing.service";
import { MerchantSettingsSchema } from "../app/lib/validation";
import { calculateNextPollAt } from "../app/jobs/carrier-poll.job";

/**
 * Maximum number of consecutive poll errors before flagging for dashboard warning
 */
const MAX_POLL_ERROR_COUNT = 2;

/**
 * Process a carrier poll job
 *
 * @param job - The BullMQ job containing shipment ID
 * @returns Job result with poll outcome
 */
export async function processCarrierPoll(
  job: Job<CarrierPollJobData>
): Promise<CarrierPollJobResult> {
  const { shipmentId } = job.data;
  const startTime = Date.now();

  console.log(
    `[carrier-poll] Processing job ${job.id} for shipment ${shipmentId}`
  );

  try {
    // Load shipment with merchant
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { merchant: true },
    });

    if (!shipment) {
      console.warn(`[carrier-poll] Shipment ${shipmentId} not found, skipping`);
      return createSkippedResult(shipmentId, startTime, "Shipment not found");
    }

    // Skip if already delivered or archived
    if (shipment.isDelivered) {
      console.log(`[carrier-poll] Shipment ${shipmentId} already delivered, skipping`);
      return createSkippedResult(shipmentId, startTime, "Already delivered");
    }

    if (shipment.isArchived) {
      console.log(`[carrier-poll] Shipment ${shipmentId} is archived, skipping`);
      return createSkippedResult(shipmentId, startTime, "Archived");
    }

    // Skip if carrier is UNKNOWN (needs merchant review)
    if (shipment.carrier === "UNKNOWN") {
      console.log(
        `[carrier-poll] Shipment ${shipmentId} has UNKNOWN carrier, skipping`
      );
      return createSkippedResult(
        shipmentId,
        startTime,
        "Unknown carrier - needs merchant review"
      );
    }

    // Check merchant is active
    if (shipment.merchant.billingStatus === "CANCELLED") {
      console.log(
        `[carrier-poll] Merchant ${shipment.merchantId} is cancelled, skipping`
      );
      return createSkippedResult(
        shipmentId,
        startTime,
        "Merchant subscription cancelled"
      );
    }

    // Parse merchant settings
    const merchantSettings = MerchantSettingsSchema.parse(
      shipment.merchant.settings
    );

    // Call carrier API
    console.log(
      `[carrier-poll] Calling ${shipment.carrier} API for tracking number ${shipment.trackingNumber}`
    );
    const trackingResponse = await trackShipment(
      shipment.carrier,
      shipment.trackingNumber
    );

    const now = new Date();

    if (!trackingResponse.success) {
      // Handle carrier API failure
      const error = trackingResponse.error;
      console.error(
        `[carrier-poll] Carrier API failed for shipment ${shipmentId}: ${error.code} - ${error.message}`
      );

      // Increment error count
      const newErrorCount = shipment.pollErrorCount + 1;

      // Calculate next poll time (with backoff if rate limited)
      let nextPollAt = calculateNextPollAt(shipment, shipment.merchant, now);
      if (error.code === "RATE_LIMITED") {
        // Add extra delay for rate limit errors
        nextPollAt = nextPollAt
          ? new Date(nextPollAt.getTime() + 30 * 60 * 1000) // Add 30 minutes
          : null;
      }

      await prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          pollErrorCount: newErrorCount,
          lastPolledAt: now,
          nextPollAt,
        },
      });

      if (newErrorCount >= MAX_POLL_ERROR_COUNT) {
        console.warn(
          `[carrier-poll] Shipment ${shipmentId} has ${newErrorCount} consecutive errors, flagged for review`
        );
      }

      // Throw if retryable to trigger BullMQ retry
      if (error.retryable) {
        throw new Error(`${error.code}: ${error.message}`);
      }

      return {
        shipmentId,
        success: false,
        isDelayed: shipment.isDelayed,
        isDelivered: false,
        newEventsCount: 0,
        durationMs: Date.now() - startTime,
        error: `${error.code}: ${error.message}`,
      };
    }

    // Carrier API succeeded
    const trackingResult = trackingResponse.data;
    console.log(
      `[carrier-poll] Got ${trackingResult.events.length} events from carrier for shipment ${shipmentId}`
    );

    // Upsert tracking events
    const newEventsCount = await upsertTrackingEvents(
      shipmentId,
      trackingResult.events
    );
    console.log(
      `[carrier-poll] Added ${newEventsCount} new tracking events for shipment ${shipmentId}`
    );

    // Check if this is the first carrier scan for billing purposes
    // If shipment doesn't have hasCarrierScan yet and we got new events,
    // this will count toward the plan limit
    let allowFirstScan = true;
    if (!shipment.hasCarrierScan && newEventsCount > 0) {
      allowFirstScan = await canRecordFirstScan(
        shipment.merchantId,
        shipment.merchant.installedAt
      );
      if (!allowFirstScan) {
        console.warn(
          `[carrier-poll] Merchant ${shipment.merchantId} at plan limit. ` +
          `Shipment ${shipmentId} tracking events recorded but won't count toward limit until upgraded.`
        );
      }
    }

    // Run delay detection
    const delayResult = evaluateDelay(
      toShipmentData(shipment),
      trackingResult,
      merchantSettings,
      now
    );

    // Calculate next poll time (null if delivered)
    const isNowDelivered = trackingResult.isDelivered;
    const nextPollAt = isNowDelivered
      ? null
      : calculateNextPollAt(
          {
            isDelivered: isNowDelivered,
            isArchived: shipment.isArchived,
            expectedDeliveryDate:
              delayResult.expectedDeliveryDate ?? shipment.expectedDeliveryDate,
            rescheduledDeliveryDate:
              trackingResult.rescheduledDeliveryDate ??
              shipment.rescheduledDeliveryDate,
          },
          shipment.merchant,
          now
        );

    // Build update data
    // Only set hasCarrierScan if merchant is under plan limit
    const updateData = buildShipmentUpdate(
      shipment,
      trackingResult,
      delayResult,
      newEventsCount > 0 && allowFirstScan, // Only count if allowed by plan
      now,
      nextPollAt
    );

    // Update shipment
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: updateData,
    });

    const durationMs = Date.now() - startTime;
    console.log(
      `[carrier-poll] Completed poll for shipment ${shipmentId} in ${durationMs}ms ` +
        `(delayed: ${delayResult.isDelayed}, delivered: ${isNowDelivered})`
    );

    return {
      shipmentId,
      success: true,
      isDelayed: delayResult.isDelayed,
      isDelivered: isNowDelivered,
      newEventsCount,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(
      `[carrier-poll] Failed job ${job.id} for shipment ${shipmentId} after ${durationMs}ms:`,
      errorMessage
    );

    // Re-throw to trigger BullMQ retry
    throw error;
  }
}

/**
 * Create a skipped result for early-exit scenarios
 */
function createSkippedResult(
  shipmentId: string,
  startTime: number,
  reason: string
): CarrierPollJobResult {
  return {
    shipmentId,
    success: true,
    isDelayed: false,
    isDelivered: false,
    newEventsCount: 0,
    durationMs: Date.now() - startTime,
    skipped: true,
    skipReason: reason,
  };
}

/**
 * Upsert tracking events from carrier response.
 * Returns the count of newly inserted events.
 */
async function upsertTrackingEvents(
  shipmentId: string,
  events: CarrierTrackingEvent[]
): Promise<number> {
  if (events.length === 0) {
    return 0;
  }

  // Get existing events for this shipment to avoid duplicates
  const existingEvents = await prisma.trackingEvent.findMany({
    where: { shipmentId },
    select: { eventTimestamp: true, eventType: true, eventDescription: true },
  });

  // Create a set of existing event keys for fast lookup
  const existingKeys = new Set(
    existingEvents.map(
      (e) => `${e.eventTimestamp.getTime()}-${e.eventType}-${e.eventDescription}`
    )
  );

  // Filter to only new events
  const newEvents = events.filter((event) => {
    const key = `${event.timestamp.getTime()}-${event.type}-${event.description}`;
    return !existingKeys.has(key);
  });

  if (newEvents.length === 0) {
    return 0;
  }

  // Insert new events
  await prisma.trackingEvent.createMany({
    data: newEvents.map((event) => ({
      shipmentId,
      eventTimestamp: event.timestamp,
      eventType: event.type,
      eventDescription: event.description,
      locationCity: event.city,
      locationState: event.state,
      locationCountry: event.country,
      rawCarrierData: event.rawData as Prisma.InputJsonValue,
    })),
  });

  return newEvents.length;
}

/**
 * Build the Prisma update object for the shipment
 */
function buildShipmentUpdate(
  shipment: {
    isDelayed: boolean;
    hasCarrierScan: boolean;
  },
  trackingResult: TrackingResult,
  delayResult: ReturnType<typeof evaluateDelay>,
  hasNewEvents: boolean,
  now: Date,
  nextPollAt: Date | null
): Prisma.ShipmentUpdateInput {
  const update: Prisma.ShipmentUpdateInput = {
    // Tracking status
    currentStatus: trackingResult.currentStatus,
    lastCarrierStatus: trackingResult.currentStatus,
    lastPolledAt: now,
    nextPollAt,
    pollErrorCount: 0, // Reset on success

    // Last scan info
    lastScanLocation: trackingResult.lastScanLocation,
    lastScanTime: trackingResult.lastScanTime,

    // Exception info
    carrierExceptionCode: trackingResult.exceptionCode,
    carrierExceptionReason: trackingResult.exceptionReason,

    // Rescheduled date if carrier provided one
    rescheduledDeliveryDate: trackingResult.rescheduledDeliveryDate,
  };

  // Update hasCarrierScan if we got new events
  if (!shipment.hasCarrierScan && hasNewEvents) {
    update.hasCarrierScan = true;
  }

  // Handle delivery
  if (trackingResult.isDelivered) {
    update.isDelivered = true;
    update.deliveredAt = trackingResult.deliveredAt ?? now;
    // Clear delay flag on delivery
    update.isDelayed = false;
    update.daysDelayed = 0;
  } else {
    // Apply delay detection updates
    const delayUpdates = getDelayUpdateFields(
      delayResult,
      shipment.isDelayed,
      now
    );
    Object.assign(update, delayUpdates);
  }

  return update;
}
