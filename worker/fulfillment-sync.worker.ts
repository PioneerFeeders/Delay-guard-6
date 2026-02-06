/**
 * Fulfillment Sync Worker
 *
 * This worker syncs fulfillments from Shopify for a merchant.
 * It's used for the initial sync during onboarding and for manual re-syncs.
 */

import type { Job } from "bullmq";
import type { FulfillmentSyncJobData } from "../app/jobs/types";
import type { FulfillmentSyncJobResult } from "../app/jobs/fulfillment-sync.job";
import { syncFulfillments } from "../app/services/sync.service";

/**
 * Process a fulfillment sync job
 *
 * This worker:
 * - Loads merchant and session from DB
 * - Queries Shopify for fulfillments from last 5 days (or full history if fullSync)
 * - Handles GraphQL pagination
 * - Creates Shipment records for each fulfillment
 * - Skips already-synced fulfillments (by shopifyFulfillmentId)
 * - Tracks progress for UI feedback
 */
export async function processFulfillmentSync(
  job: Job<FulfillmentSyncJobData>
): Promise<FulfillmentSyncJobResult> {
  const { merchantId, fullSync } = job.data;
  const startTime = Date.now();

  console.log(
    `[fulfillment-sync] Starting job ${job.id} for merchant ${merchantId} (fullSync: ${fullSync})`
  );

  try {
    // Run the sync with progress tracking
    const result = await syncFulfillments(merchantId, fullSync ?? false, async (progress) => {
      // Update job progress for monitoring
      await job.updateProgress({
        processed: progress.processed,
        total: progress.total,
        percentage: progress.percentage,
      });

      // Log progress at intervals
      if (progress.processed % 10 === 0 || progress.processed === progress.total) {
        console.log(
          `[fulfillment-sync] Progress: ${progress.processed}/${progress.total} (${progress.percentage}%)`
        );
      }
    });

    const durationMs = Date.now() - startTime;

    console.log(
      `[fulfillment-sync] Completed job ${job.id} in ${durationMs}ms: ` +
        `${result.created} created, ${result.skipped} skipped, ${result.errors} errors`
    );

    // Return result to be stored in job.returnvalue
    return {
      total: result.total,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      duplicates: result.duplicates,
      pollJobsEnqueued: result.pollJobsEnqueued,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(
      `[fulfillment-sync] Failed job ${job.id} after ${durationMs}ms:`,
      error
    );

    // Re-throw to trigger BullMQ retry logic
    throw error;
  }
}
