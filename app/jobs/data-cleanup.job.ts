/**
 * Data Cleanup Job Definition
 *
 * This file defines the job configuration for the data cleanup worker.
 * The data cleanup job runs daily to:
 * 1. Archive delivered shipments that are past the auto-archive threshold
 * 2. Purge data for merchants who uninstalled more than 30 days ago
 *
 * The actual processing logic is in worker/data-cleanup.worker.ts
 */

import type { JobsOptions } from "bullmq";

/**
 * Job name for data cleanup jobs
 */
export const DATA_CLEANUP_JOB_NAME = "cleanup";

/**
 * Default job options for data cleanup jobs
 */
export const DATA_CLEANUP_JOB_OPTIONS: JobsOptions = {
  // Retry a couple times for transient database errors
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // Start with 5 seconds
  },
  // Keep completed jobs for a day for audit purposes
  removeOnComplete: {
    age: 24 * 60 * 60, // 24 hours
    count: 30, // Keep last 30 runs
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60, // Keep failed for 7 days
    count: 100,
  },
};

/**
 * Repeatable job configuration
 * Runs daily at 3:00 AM UTC
 */
export const DATA_CLEANUP_REPEAT_OPTIONS = {
  pattern: "0 3 * * *", // Cron: every day at 3:00 AM UTC
};

/**
 * Batch size for cleanup operations
 * Process in batches to avoid long-running transactions
 */
export const DATA_CLEANUP_BATCH_SIZE = 500;

/**
 * Default retention period for uninstalled merchant data (in days)
 * Per spec: data retained for 30 days after uninstall
 */
export const MERCHANT_DATA_RETENTION_DAYS = 30;

/**
 * Data cleanup job result type
 */
export interface DataCleanupJobResult {
  /** Number of shipments archived */
  shipmentsArchived: number;
  /** Number of merchants purged (uninstalled > 30 days) */
  merchantsPurged: number;
  /** Number of shipments deleted (from purged merchants) */
  shipmentsDeleted: number;
  /** Number of tracking events deleted */
  trackingEventsDeleted: number;
  /** Number of notification logs deleted */
  notificationLogsDeleted: number;
  /** Number of resolution logs deleted */
  resolutionLogsDeleted: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Any errors encountered (cleanup continues on error) */
  errors?: string[];
}
