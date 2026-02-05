/**
 * Poll Scheduler Worker
 *
 * This worker runs as a repeatable job every 15 minutes.
 * It queries the database for shipments that are due for polling
 * and enqueues carrier-poll jobs for each one.
 *
 * Implemented in Phase 3: Carrier Integration & Delay Detection
 */

import type { Job } from "bullmq";

export interface PollSchedulerJobData {
  // No data needed for scheduler job
}

/**
 * Process a poll scheduler job
 *
 * TODO: Implement in Phase 3
 * - Query shipments where nextPollAt <= now(), not archived/delivered, merchant active
 * - Enqueue carrier-poll jobs with deduplication (jobId = poll-{shipment.id})
 * - Priority based on urgency (past-due = higher)
 */
export async function processPollScheduler(
  job: Job<PollSchedulerJobData>
): Promise<void> {
  console.log(`[poll-scheduler] Processing job ${job.id}`);

  // Placeholder implementation
  // Will be implemented in Phase 3: Carrier Integration & Delay Detection
  console.log("[poll-scheduler] Placeholder: Would query due shipments and enqueue poll jobs");
}
