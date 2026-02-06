/**
 * Fulfillment Sync Job Definition
 *
 * This file defines the job configuration for fulfillment sync jobs.
 * The actual processing logic is in worker/fulfillment-sync.worker.ts
 */

import type { JobsOptions } from "bullmq";
import type { FulfillmentSyncJobData } from "./types";

/**
 * Job name for fulfillment sync jobs
 */
export const FULFILLMENT_SYNC_JOB_NAME = "sync";

/**
 * Default job options for fulfillment sync jobs
 */
export const FULFILLMENT_SYNC_JOB_OPTIONS: JobsOptions = {
  // Retry up to 3 times with exponential backoff
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // Start with 5 seconds (sync is slow, give more time between retries)
  },
  // Don't remove on complete immediately - useful for checking status
  removeOnComplete: {
    age: 60 * 60, // Keep for 1 hour
    count: 100, // Keep last 100
  },
  removeOnFail: {
    age: 24 * 60 * 60, // Keep failed for 24 hours for debugging
    count: 500,
  },
};

/**
 * Create job data for a fulfillment sync job
 */
export function createFulfillmentSyncJobData(
  merchantId: string,
  fullSync: boolean = false
): FulfillmentSyncJobData {
  return {
    merchantId,
    fullSync,
  };
}

/**
 * Create the job ID for a fulfillment sync job
 * Using a consistent job ID enables deduplication
 */
export function createFulfillmentSyncJobId(merchantId: string): string {
  return `sync-${merchantId}`;
}

/**
 * Sync job result type (stored in job.returnvalue)
 */
export interface FulfillmentSyncJobResult {
  /** Total fulfillments found */
  total: number;
  /** New shipments created */
  created: number;
  /** Already-existing shipments skipped */
  skipped: number;
  /** Fulfillments that errored */
  errors: number;
  /** Shipments with duplicate tracking numbers */
  duplicates: number;
  /** Poll jobs enqueued for new shipments */
  pollJobsEnqueued: number;
  /** Duration in milliseconds */
  durationMs: number;
}
