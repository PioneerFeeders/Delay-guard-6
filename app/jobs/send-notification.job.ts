/**
 * Send Notification Job Definition
 *
 * This file defines the job data structure and helper functions for
 * enqueuing send-notification jobs. The actual processing is done
 * by the worker in worker/send-notification.worker.ts
 */

import { z } from "zod";
import { QUEUE_SEND_NOTIFICATION, JOB_ID_PREFIX } from "./queues";
import { getQueue } from "~/queue.server";

/**
 * Schema for validating send notification job data
 */
export const SendNotificationJobDataSchema = z.object({
  shipmentId: z.string().cuid(),
  recipientEmail: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  sentBy: z.string().email(),
});

export type SendNotificationJobData = z.infer<typeof SendNotificationJobDataSchema>;

/**
 * Create a job ID for notification deduplication
 *
 * Format: notify-{shipmentId}-{timestamp}
 * Timestamp is included because we allow re-sending notifications
 */
export function createNotificationJobId(shipmentId: string): string {
  return `${JOB_ID_PREFIX.SEND_NOTIFICATION}-${shipmentId}-${Date.now()}`;
}

/**
 * Add a send notification job to the queue
 *
 * @param data - The notification data
 * @returns The created job
 */
export async function addSendNotificationJob(data: SendNotificationJobData) {
  // Validate data before enqueuing
  const validatedData = SendNotificationJobDataSchema.parse(data);

  const queue = getQueue(QUEUE_SEND_NOTIFICATION);

  return queue.add("send", validatedData, {
    jobId: createNotificationJobId(data.shipmentId),
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // Start with 5 second delay, then 10s, 20s
    },
  });
}

/**
 * Add multiple send notification jobs to the queue (bulk action)
 *
 * @param jobs - Array of notification data
 * @returns The created jobs
 */
export async function addBulkSendNotificationJobs(jobs: SendNotificationJobData[]) {
  const queue = getQueue(QUEUE_SEND_NOTIFICATION);

  // Validate all jobs before enqueuing
  const validatedJobs = jobs.map((job) => SendNotificationJobDataSchema.parse(job));

  return queue.addBulk(
    validatedJobs.map((data) => ({
      name: "send",
      data,
      opts: {
        jobId: createNotificationJobId(data.shipmentId),
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      },
    }))
  );
}
