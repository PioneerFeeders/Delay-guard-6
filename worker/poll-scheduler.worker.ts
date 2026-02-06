/**
 * Poll Scheduler Worker
 *
 * This worker runs as a repeatable job every 15 minutes.
 * It queries the database for shipments that are due for polling
 * and enqueues carrier-poll jobs for each one.
 *
 * Logic:
 * 1. Query shipments where nextPollAt <= now(), not archived/delivered, merchant active
 * 2. Enqueue carrier-poll jobs with deduplication (jobId = poll-{shipment.id})
 * 3. Priority based on urgency (past-due = higher)
 */

import type { Job } from "bullmq";
import type { PollSchedulerJobData } from "../app/jobs/types";
import type { PollSchedulerJobResult } from "../app/jobs/poll-scheduler.job";
import { prisma } from "../app/db.server";
import { getQueue } from "../app/queue.server";
import { QUEUE_CARRIER_POLL } from "../app/jobs/queues";
import {
  POLL_SCHEDULER_BATCH_SIZE,
  POLL_SCHEDULER_MAX_JOBS_PER_RUN,
} from "../app/jobs/poll-scheduler.job";
import {
  calculatePollPriority,
  CARRIER_POLL_JOB_OPTIONS,
} from "../app/jobs/carrier-poll.job";

/**
 * Process a poll scheduler job
 *
 * @param job - The BullMQ job
 * @returns Job result with statistics
 */
export async function processPollScheduler(
  job: Job<PollSchedulerJobData>
): Promise<PollSchedulerJobResult> {
  const startTime = Date.now();
  console.log(`[poll-scheduler] Processing job ${job.id}`);

  const result: PollSchedulerJobResult = {
    shipmentsFound: 0,
    jobsEnqueued: 0,
    jobsSkipped: 0,
    durationMs: 0,
    truncated: false,
    errors: [],
  };

  try {
    const now = new Date();
    const carrierPollQueue = getQueue(QUEUE_CARRIER_POLL);

    let cursor: string | undefined;
    let totalProcessed = 0;

    // Process in batches to avoid overwhelming memory
    while (totalProcessed < POLL_SCHEDULER_MAX_JOBS_PER_RUN) {
      // Query shipments due for polling
      // Criteria:
      // - nextPollAt <= now (due for poll)
      // - Not delivered (still in transit)
      // - Not archived (still active)
      // - Merchant has active billing status (not cancelled)
      // - Merchant shop is not frozen/paused
      // - Has a valid carrier (not UNKNOWN)
      const shipments = await prisma.shipment.findMany({
        where: {
          nextPollAt: {
            lte: now,
          },
          isDelivered: false,
          isArchived: false,
          carrier: {
            not: "UNKNOWN",
          },
          merchant: {
            billingStatus: {
              not: "CANCELLED",
            },
            shopFrozen: false,
          },
        },
        select: {
          id: true,
          expectedDeliveryDate: true,
        },
        orderBy: {
          // Process most urgent shipments first (by expected delivery date)
          expectedDeliveryDate: "asc",
        },
        take: POLL_SCHEDULER_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (shipments.length === 0) {
        break;
      }

      result.shipmentsFound += shipments.length;
      cursor = shipments[shipments.length - 1].id;

      // Prepare bulk job data
      const jobsToAdd = shipments.map((shipment) => ({
        name: "poll",
        data: { shipmentId: shipment.id },
        opts: {
          ...CARRIER_POLL_JOB_OPTIONS,
          jobId: `poll-${shipment.id}`, // Deduplication key
          priority: calculatePollPriority(shipment, now),
        },
      }));

      // Add jobs in bulk
      // BullMQ's addBulk handles deduplication based on jobId
      try {
        const addedJobs = await carrierPollQueue.addBulk(jobsToAdd);

        // Count successful additions vs skipped (duplicates)
        // Jobs with duplicate IDs will still return a job object but won't be re-added
        for (const _addedJob of addedJobs) {
          // If the job already exists, it will have the same ID but we can't easily detect
          // if it was newly added or already existed. We'll count all as enqueued for simplicity.
          result.jobsEnqueued++;
        }

        console.log(
          `[poll-scheduler] Enqueued ${addedJobs.length} poll jobs (batch)`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[poll-scheduler] Error enqueuing batch:`,
          errorMessage
        );
        result.errors?.push(`Batch enqueue error: ${errorMessage}`);
      }

      totalProcessed += shipments.length;

      // Check if we hit the limit
      if (totalProcessed >= POLL_SCHEDULER_MAX_JOBS_PER_RUN) {
        result.truncated = true;
        console.warn(
          `[poll-scheduler] Hit max jobs limit (${POLL_SCHEDULER_MAX_JOBS_PER_RUN}), some shipments may be delayed`
        );
      }

      // If this batch was smaller than the batch size, we've reached the end
      if (shipments.length < POLL_SCHEDULER_BATCH_SIZE) {
        break;
      }
    }

    result.durationMs = Date.now() - startTime;

    console.log(
      `[poll-scheduler] Completed in ${result.durationMs}ms: ` +
        `found=${result.shipmentsFound}, enqueued=${result.jobsEnqueued}, ` +
        `truncated=${result.truncated}`
    );

    return result;
  } catch (error) {
    result.durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    result.errors?.push(errorMessage);

    console.error(
      `[poll-scheduler] Failed after ${result.durationMs}ms:`,
      errorMessage
    );

    // Re-throw to mark job as failed
    throw error;
  }
}
