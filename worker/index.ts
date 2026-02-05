/**
 * Worker Entry Point
 *
 * This is the main entry point for the BullMQ worker process.
 * It runs separately from the web process and handles all background jobs.
 *
 * Start with: npm run worker
 */

import { Worker } from "bullmq";
import Redis from "ioredis";
import {
  ALL_QUEUES,
  QUEUE_CARRIER_POLL,
  QUEUE_CONCURRENCY,
  QUEUE_DATA_CLEANUP,
  QUEUE_FULFILLMENT_SYNC,
  QUEUE_POLL_SCHEDULER,
  QUEUE_SEND_NOTIFICATION,
  type QueueName,
} from "../app/jobs/queues";

// Import worker handlers (placeholder implementations for now)
import { processCarrierPoll } from "./carrier-poll.worker";
import { processDataCleanup } from "./data-cleanup.worker";
import { processFulfillmentSync } from "./fulfillment-sync.worker";
import { processPollScheduler } from "./poll-scheduler.worker";
import { processSendNotification } from "./send-notification.worker";

// Worker instances for graceful shutdown
const workers: Worker[] = [];

// Redis connection for workers
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

    redisConnection.on("error", (error) => {
      console.error("[Worker] Redis connection error:", error);
    });

    redisConnection.on("connect", () => {
      console.log("[Worker] Connected to Redis");
    });
  }
  return redisConnection;
}

/**
 * Create and start a worker for a specific queue
 */
function createWorker(
  queueName: QueueName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: (job: any) => Promise<any>
): Worker {
  const worker = new Worker(queueName, processor, {
    connection: getRedisConnection(),
    concurrency: QUEUE_CONCURRENCY[queueName],
  });

  worker.on("completed", (job) => {
    console.log(`[${queueName}] Job ${job.id} completed`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[${queueName}] Job ${job?.id} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error(`[${queueName}] Worker error:`, error);
  });

  workers.push(worker);
  console.log(
    `[Worker] Started ${queueName} worker with concurrency ${QUEUE_CONCURRENCY[queueName]}`
  );

  return worker;
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Worker] Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new jobs and wait for current jobs to finish
  const closePromises = workers.map(async (worker) => {
    try {
      await worker.close();
      console.log(`[Worker] Closed worker for queue: ${worker.name}`);
    } catch (error) {
      console.error(`[Worker] Error closing worker ${worker.name}:`, error);
    }
  });

  await Promise.all(closePromises);

  // Close Redis connection
  if (redisConnection) {
    await redisConnection.quit();
    console.log("[Worker] Redis connection closed");
  }

  console.log("[Worker] Graceful shutdown complete");
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log("[Worker] Starting DelayGuard worker process...");
  console.log(`[Worker] Node.js version: ${process.version}`);
  console.log(`[Worker] Environment: ${process.env.NODE_ENV || "development"}`);

  // Validate required environment variables
  if (!process.env.REDIS_URL) {
    console.error("[Worker] ERROR: REDIS_URL environment variable is not set");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "[Worker] ERROR: DATABASE_URL environment variable is not set"
    );
    process.exit(1);
  }

  try {
    // Test Redis connection
    const redis = getRedisConnection();
    await redis.ping();
    console.log("[Worker] Redis connection verified");

    // Start workers for all queues
    createWorker(QUEUE_POLL_SCHEDULER, processPollScheduler);
    createWorker(QUEUE_CARRIER_POLL, processCarrierPoll);
    createWorker(QUEUE_FULFILLMENT_SYNC, processFulfillmentSync);
    createWorker(QUEUE_SEND_NOTIFICATION, processSendNotification);
    createWorker(QUEUE_DATA_CLEANUP, processDataCleanup);

    console.log(`[Worker] All ${ALL_QUEUES.length} workers started`);
    console.log("[Worker] Waiting for jobs...");
  } catch (error) {
    console.error("[Worker] Failed to start workers:", error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("[Worker] Uncaught exception:", error);
  shutdown("uncaughtException").catch(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  console.error("[Worker] Unhandled rejection:", reason);
  // Don't exit on unhandled rejection, just log it
});

// Start the worker
main().catch((error) => {
  console.error("[Worker] Fatal error:", error);
  process.exit(1);
});
