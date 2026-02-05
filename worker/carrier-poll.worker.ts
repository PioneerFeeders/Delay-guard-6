/**
 * Carrier Poll Worker
 *
 * This worker processes individual shipment tracking updates.
 * It calls the appropriate carrier API, updates the shipment status,
 * and runs delay detection logic.
 *
 * Implemented in Phase 3: Carrier Integration & Delay Detection
 */

import type { Job } from "bullmq";

export interface CarrierPollJobData {
  shipmentId: string;
}

/**
 * Process a carrier poll job
 *
 * TODO: Implement in Phase 3
 * - Load shipment and merchant from DB
 * - Skip if carrier === UNKNOWN
 * - Call carrier adapter
 * - Upsert tracking events into TrackingEvent table
 * - Update shipment fields (currentStatus, lastScanLocation, etc.)
 * - Run delay detection, update isDelayed/delayFlaggedAt
 * - Handle delivery (isDelivered, deliveredAt)
 * - Calculate nextPollAt using smart scheduling
 * - Error handling with pollErrorCount
 */
export async function processCarrierPoll(
  job: Job<CarrierPollJobData>
): Promise<void> {
  const { shipmentId } = job.data;
  console.log(`[carrier-poll] Processing job ${job.id} for shipment ${shipmentId}`);

  // Placeholder implementation
  // Will be implemented in Phase 3: Carrier Integration & Delay Detection
  console.log(`[carrier-poll] Placeholder: Would poll carrier API for shipment ${shipmentId}`);
}
