/**
 * BullMQ Queue Registry Singleton
 *
 * This module provides a singleton pattern for BullMQ queues, ensuring that
 * the web process reuses the same queue instances across requests.
 * The worker process uses a separate connection setup in worker/index.ts.
 */

import { Queue, type QueueOptions } from "bullmq";
import Redis from "ioredis";
import {
  ALL_QUEUES,
  QUEUE_CARRIER_POLL,
  QUEUE_DATA_CLEANUP,
  QUEUE_FULFILLMENT_SYNC,
  QUEUE_POLL_SCHEDULER,
  QUEUE_SEND_NOTIFICATION,
  type QueueName,
} from "./jobs/queues";

// Singleton pattern for Redis connection (web process)
let redisConnection: Redis | null = null;

function getRedisConnection(): Redis {
  if (!redisConnection) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable is not set");
    }
    redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    });
  }
  return redisConnection;
}

// Singleton pattern for queues
const queues = new Map<QueueName, Queue>();

function getDefaultQueueOptions(): QueueOptions {
  return {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: {
        count: 1000, // Keep last 1000 completed jobs
        age: 24 * 60 * 60, // Keep jobs for 24 hours
      },
      removeOnFail: {
        count: 5000, // Keep last 5000 failed jobs for debugging
        age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
      },
    },
  };
}

/**
 * Get a queue by name, creating it if it doesn't exist.
 * This is used by the web process to enqueue jobs.
 */
export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, getDefaultQueueOptions());
    queues.set(name, queue);
  }
  return queue;
}

/**
 * Get all queues (useful for health checks)
 */
export function getAllQueues(): Map<QueueName, Queue> {
  // Initialize all queues if not already done
  for (const name of ALL_QUEUES) {
    getQueue(name);
  }
  return queues;
}

/**
 * Close all queue connections (for graceful shutdown)
 */
export async function closeAllQueues(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  for (const queue of queues.values()) {
    closePromises.push(queue.close());
  }

  await Promise.all(closePromises);

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  queues.clear();
}

/**
 * Check if Redis connection is healthy
 */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

// ============================================================
// Convenience functions for enqueuing jobs to specific queues
// ============================================================

/**
 * Enqueue a carrier poll job for a specific shipment
 */
export async function enqueuePollJob(
  shipmentId: string,
  options?: { priority?: number; delay?: number }
) {
  const queue = getQueue(QUEUE_CARRIER_POLL);
  return queue.add(
    "poll",
    { shipmentId },
    {
      jobId: `poll-${shipmentId}`, // Deduplication
      priority: options?.priority,
      delay: options?.delay,
    }
  );
}

/**
 * Enqueue a fulfillment sync job for a merchant
 */
export async function enqueueFulfillmentSyncJob(
  merchantId: string,
  options?: { fullSync?: boolean }
) {
  const queue = getQueue(QUEUE_FULFILLMENT_SYNC);
  return queue.add(
    "sync",
    { merchantId, fullSync: options?.fullSync ?? false },
    {
      jobId: `sync-${merchantId}`, // Deduplication - only one sync per merchant at a time
    }
  );
}

/**
 * Enqueue a notification email job
 */
export async function enqueueNotificationJob(
  shipmentId: string,
  data: {
    recipientEmail: string;
    subject: string;
    body: string;
    sentBy: string;
  }
) {
  const queue = getQueue(QUEUE_SEND_NOTIFICATION);
  return queue.add("send", {
    shipmentId,
    ...data,
  });
}

/**
 * Enqueue multiple notification jobs (for bulk actions)
 */
export async function enqueueBulkNotificationJobs(
  jobs: Array<{
    shipmentId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    sentBy: string;
  }>
) {
  const queue = getQueue(QUEUE_SEND_NOTIFICATION);
  return queue.addBulk(
    jobs.map((job) => ({
      name: "send",
      data: job,
    }))
  );
}

/**
 * Setup repeatable jobs (poll scheduler and data cleanup)
 * This should be called once during worker startup
 */
export async function setupRepeatableJobs(): Promise<void> {
  // Poll scheduler runs every 15 minutes
  const pollSchedulerQueue = getQueue(QUEUE_POLL_SCHEDULER);
  await pollSchedulerQueue.add(
    "schedule",
    {},
    {
      repeat: {
        every: 15 * 60 * 1000, // 15 minutes in milliseconds
      },
      jobId: "poll-scheduler-repeatable",
    }
  );

  // Data cleanup runs daily at 3 AM UTC
  const dataCleanupQueue = getQueue(QUEUE_DATA_CLEANUP);
  await dataCleanupQueue.add(
    "cleanup",
    {},
    {
      repeat: {
        pattern: "0 3 * * *", // Every day at 3:00 AM UTC
      },
      jobId: "data-cleanup-repeatable",
    }
  );
}
