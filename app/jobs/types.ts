/**
 * Job Data Type Definitions
 *
 * This file defines the data structures for all BullMQ job payloads.
 * These types are shared between the web process (which enqueues jobs)
 * and the worker process (which processes jobs).
 */

/**
 * Poll scheduler job data
 * The scheduler job doesn't need any input data
 */
export interface PollSchedulerJobData {
  // No data needed
}

/**
 * Carrier poll job data
 */
export interface CarrierPollJobData {
  shipmentId: string;
}

/**
 * Fulfillment sync job data
 */
export interface FulfillmentSyncJobData {
  merchantId: string;
  /** If true, sync all fulfillments; otherwise sync last 5 days */
  fullSync?: boolean;
}

/**
 * Send notification job data
 */
export interface SendNotificationJobData {
  shipmentId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  /** Email address of staff member who triggered the notification */
  sentBy: string;
}

/**
 * Data cleanup job data
 * The cleanup job doesn't need any input data
 */
export interface DataCleanupJobData {
  // No data needed
}

/**
 * Union type for all job data types
 */
export type JobData =
  | PollSchedulerJobData
  | CarrierPollJobData
  | FulfillmentSyncJobData
  | SendNotificationJobData
  | DataCleanupJobData;
