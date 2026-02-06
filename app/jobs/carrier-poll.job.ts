/**
 * Carrier Poll Job Definition
 *
 * This file defines the job configuration for carrier poll jobs.
 * The actual processing logic is in worker/carrier-poll.worker.ts
 */

import type { JobsOptions } from "bullmq";
import type { CarrierPollJobData } from "./types";
import type { Shipment, Merchant } from "@prisma/client";
import { differenceInCalendarDays, addHours, addMinutes } from "date-fns";

/**
 * Job name for carrier poll jobs
 */
export const CARRIER_POLL_JOB_NAME = "poll";

/**
 * Default job options for carrier poll jobs
 */
export const CARRIER_POLL_JOB_OPTIONS: JobsOptions = {
  // Retry up to 3 times with exponential backoff
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000, // Start with 2 seconds
  },
  // Remove completed jobs relatively quickly to avoid memory bloat
  removeOnComplete: {
    age: 30 * 60, // Keep for 30 minutes
    count: 500, // Keep last 500
  },
  removeOnFail: {
    age: 24 * 60 * 60, // Keep failed for 24 hours for debugging
    count: 1000,
  },
};

/**
 * Job options for rate-limited retries (429 errors)
 */
export const RATE_LIMITED_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 30000, // Start with 30 seconds for rate limit retries
  },
};

/**
 * Create job data for a carrier poll job
 */
export function createCarrierPollJobData(shipmentId: string): CarrierPollJobData {
  return {
    shipmentId,
  };
}

/**
 * Create the job ID for a carrier poll job
 * Using a consistent job ID enables deduplication
 */
export function createCarrierPollJobId(shipmentId: string): string {
  return `poll-${shipmentId}`;
}

/**
 * Poll interval configuration in hours based on delivery proximity
 */
export const POLL_INTERVALS = {
  /** Expected delivery today or tomorrow */
  IMMINENT: 4,
  /** Expected delivery 2-5 days out */
  UPCOMING: 6,
  /** Expected delivery 6+ days out */
  FUTURE: 8,
  /** Past expected delivery (already late) */
  PAST_DUE: 2,
  /** Past expected but carrier rescheduled to tomorrow+ */
  RESCHEDULED: 4,
  /** Default when expected delivery is unknown */
  UNKNOWN: 6,
} as const;

/**
 * Priority levels for poll jobs
 * Lower number = higher priority in BullMQ
 */
export const POLL_PRIORITY = {
  /** Past due shipments - poll most urgently */
  URGENT: 1,
  /** Delivery expected today/tomorrow */
  HIGH: 2,
  /** Delivery expected 2-5 days */
  NORMAL: 3,
  /** Delivery expected 6+ days */
  LOW: 4,
} as const;

/**
 * Calculate the next poll time for a shipment using smart scheduling.
 * Based on spec section 8.4
 *
 * Intervals:
 * - Past due (no reschedule): every 2 hours
 * - Past due (carrier rescheduled to tomorrow+): every 4 hours
 * - Expected today/tomorrow: every 4 hours
 * - Expected 2-5 days: every 6 hours
 * - Expected 6+ days: every 8 hours
 * - Unknown expected date: every 6 hours
 *
 * A random merchant offset (0-239 minutes) is added to prevent thundering herd.
 *
 * @param shipment - The shipment record
 * @param merchant - The merchant record (for randomPollOffset)
 * @param now - Current time (optional, for testing)
 * @returns The next poll time, or null if polling should stop
 */
export function calculateNextPollAt(
  shipment: Pick<
    Shipment,
    "isDelivered" | "isArchived" | "expectedDeliveryDate" | "rescheduledDeliveryDate"
  >,
  merchant: Pick<Merchant, "randomPollOffset">,
  now: Date = new Date()
): Date | null {
  // Stop polling for delivered or archived shipments
  if (shipment.isDelivered || shipment.isArchived) {
    return null;
  }

  let intervalHours: number;

  const expected = shipment.expectedDeliveryDate;
  if (!expected) {
    intervalHours = POLL_INTERVALS.UNKNOWN;
  } else {
    const daysUntil = differenceInCalendarDays(expected, now);
    const isPastDue = daysUntil < 0;

    if (isPastDue) {
      // Check if carrier has rescheduled to a future date
      const hasRescheduled =
        shipment.rescheduledDeliveryDate &&
        shipment.rescheduledDeliveryDate > now;
      intervalHours = hasRescheduled
        ? POLL_INTERVALS.RESCHEDULED
        : POLL_INTERVALS.PAST_DUE;
    } else if (daysUntil <= 1) {
      intervalHours = POLL_INTERVALS.IMMINENT;
    } else if (daysUntil <= 5) {
      intervalHours = POLL_INTERVALS.UPCOMING;
    } else {
      intervalHours = POLL_INTERVALS.FUTURE;
    }
  }

  // Add merchant offset to stagger polls across merchants
  const offsetMinutes = merchant.randomPollOffset;
  return addMinutes(addHours(now, intervalHours), offsetMinutes);
}

/**
 * Calculate the priority for a poll job.
 * Past-due shipments get higher priority.
 *
 * @param shipment - The shipment record
 * @param now - Current time (optional, for testing)
 * @returns Priority value (lower = higher priority)
 */
export function calculatePollPriority(
  shipment: Pick<Shipment, "expectedDeliveryDate">,
  now: Date = new Date()
): number {
  const expected = shipment.expectedDeliveryDate;
  if (!expected) {
    return POLL_PRIORITY.NORMAL;
  }

  const daysUntil = differenceInCalendarDays(expected, now);

  if (daysUntil < 0) {
    return POLL_PRIORITY.URGENT;
  } else if (daysUntil <= 1) {
    return POLL_PRIORITY.HIGH;
  } else if (daysUntil <= 5) {
    return POLL_PRIORITY.NORMAL;
  } else {
    return POLL_PRIORITY.LOW;
  }
}

/**
 * Carrier poll job result type (stored in job.returnvalue)
 */
export interface CarrierPollJobResult {
  /** Shipment ID that was polled */
  shipmentId: string;
  /** Whether the poll was successful */
  success: boolean;
  /** Whether the shipment is now flagged as delayed */
  isDelayed: boolean;
  /** Whether the shipment was delivered */
  isDelivered: boolean;
  /** Number of new tracking events added */
  newEventsCount: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Whether this was skipped (e.g., carrier = UNKNOWN) */
  skipped?: boolean;
  /** Reason for skip */
  skipReason?: string;
}
