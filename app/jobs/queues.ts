/**
 * BullMQ Queue Name Constants
 *
 * This file defines all queue names used by DelayGuard's background job system.
 * Queue names are shared between the web process (which enqueues jobs) and
 * the worker process (which processes jobs).
 */

/** Queue for the poll scheduler - runs every 15 min, enqueues carrier-poll jobs */
export const QUEUE_POLL_SCHEDULER = "poll-scheduler";

/** Queue for carrier polling - calls carrier APIs, updates shipment status */
export const QUEUE_CARRIER_POLL = "carrier-poll";

/** Queue for fulfillment sync - syncs fulfillments from Shopify */
export const QUEUE_FULFILLMENT_SYNC = "fulfillment-sync";

/** Queue for sending notification emails via Resend */
export const QUEUE_SEND_NOTIFICATION = "send-notification";

/** Queue for data cleanup - archives delivered, purges uninstalled merchant data */
export const QUEUE_DATA_CLEANUP = "data-cleanup";

/** All queue names for iteration */
export const ALL_QUEUES = [
  QUEUE_POLL_SCHEDULER,
  QUEUE_CARRIER_POLL,
  QUEUE_FULFILLMENT_SYNC,
  QUEUE_SEND_NOTIFICATION,
  QUEUE_DATA_CLEANUP,
] as const;

export type QueueName = (typeof ALL_QUEUES)[number];

/**
 * Queue concurrency settings
 * Based on spec section 8.1
 */
export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  [QUEUE_POLL_SCHEDULER]: 1,
  [QUEUE_CARRIER_POLL]: 10,
  [QUEUE_FULFILLMENT_SYNC]: 3,
  [QUEUE_SEND_NOTIFICATION]: 5,
  [QUEUE_DATA_CLEANUP]: 2,
};

/**
 * Job ID prefixes for deduplication
 */
export const JOB_ID_PREFIX = {
  CARRIER_POLL: "poll",
  FULFILLMENT_SYNC: "sync",
  SEND_NOTIFICATION: "notify",
  DATA_CLEANUP: "cleanup",
} as const;
