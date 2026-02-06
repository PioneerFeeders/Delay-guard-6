/**
 * Poll Scheduler Job Definition
 *
 * This file defines the job configuration for the poll scheduler.
 * The poll scheduler runs as a repeatable job every 15 minutes,
 * querying for shipments due for polling and enqueuing carrier-poll jobs.
 *
 * The actual processing logic is in worker/poll-scheduler.worker.ts
 */

import type { JobsOptions } from "bullmq";

/**
 * Job name for poll scheduler jobs
 */
export const POLL_SCHEDULER_JOB_NAME = "schedule";

/**
 * Default job options for poll scheduler jobs
 */
export const POLL_SCHEDULER_JOB_OPTIONS: JobsOptions = {
  // No retries needed for scheduler - if it fails, the next iteration will run
  attempts: 1,
  // Remove completed jobs quickly
  removeOnComplete: {
    age: 15 * 60, // Keep for 15 minutes (until next run)
    count: 10,
  },
  removeOnFail: {
    age: 60 * 60, // Keep failed for 1 hour for debugging
    count: 50,
  },
};

/**
 * Repeatable job configuration
 * Runs every 15 minutes
 */
export const POLL_SCHEDULER_REPEAT_OPTIONS = {
  every: 15 * 60 * 1000, // 15 minutes in milliseconds
};

/**
 * Batch size for querying shipments due for polling
 * Process in batches to avoid overwhelming the database
 */
export const POLL_SCHEDULER_BATCH_SIZE = 500;

/**
 * Maximum number of poll jobs to enqueue per scheduler run
 * Prevents runaway job creation if something goes wrong
 */
export const POLL_SCHEDULER_MAX_JOBS_PER_RUN = 10000;

/**
 * Poll scheduler job result type
 */
export interface PollSchedulerJobResult {
  /** Number of shipments found due for polling */
  shipmentsFound: number;
  /** Number of poll jobs enqueued */
  jobsEnqueued: number;
  /** Number of jobs skipped (already queued) */
  jobsSkipped: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether the run was truncated due to max jobs limit */
  truncated: boolean;
  /** Any errors encountered */
  errors?: string[];
}
