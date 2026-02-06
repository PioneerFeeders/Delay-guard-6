import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateNextPollAt,
  calculatePollPriority,
  createCarrierPollJobData,
  createCarrierPollJobId,
  POLL_INTERVALS,
  POLL_PRIORITY,
  CARRIER_POLL_JOB_NAME,
  CARRIER_POLL_JOB_OPTIONS,
} from "../carrier-poll.job";

/**
 * Helper to create a UTC date at midnight
 */
function utcDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00.000Z");
}

describe("carrier-poll.job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set to Wednesday, February 4, 2026 at noon UTC
    vi.setSystemTime(new Date("2026-02-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constants", () => {
    it("should have correct job name", () => {
      expect(CARRIER_POLL_JOB_NAME).toBe("poll");
    });

    it("should have correct job options", () => {
      expect(CARRIER_POLL_JOB_OPTIONS.attempts).toBe(3);
      expect(CARRIER_POLL_JOB_OPTIONS.backoff).toEqual({
        type: "exponential",
        delay: 2000,
      });
    });

    it("should have correct poll intervals", () => {
      expect(POLL_INTERVALS.IMMINENT).toBe(4);
      expect(POLL_INTERVALS.UPCOMING).toBe(6);
      expect(POLL_INTERVALS.FUTURE).toBe(8);
      expect(POLL_INTERVALS.PAST_DUE).toBe(2);
      expect(POLL_INTERVALS.RESCHEDULED).toBe(4);
      expect(POLL_INTERVALS.UNKNOWN).toBe(6);
    });

    it("should have correct poll priorities", () => {
      expect(POLL_PRIORITY.URGENT).toBe(1);
      expect(POLL_PRIORITY.HIGH).toBe(2);
      expect(POLL_PRIORITY.NORMAL).toBe(3);
      expect(POLL_PRIORITY.LOW).toBe(4);
    });
  });

  describe("createCarrierPollJobData", () => {
    it("should create job data with shipment ID", () => {
      const data = createCarrierPollJobData("shipment-123");
      expect(data).toEqual({ shipmentId: "shipment-123" });
    });
  });

  describe("createCarrierPollJobId", () => {
    it("should create deduplication job ID", () => {
      const jobId = createCarrierPollJobId("shipment-123");
      expect(jobId).toBe("poll-shipment-123");
    });
  });

  describe("calculateNextPollAt", () => {
    const merchant = { randomPollOffset: 15 }; // 15 minute offset

    describe("stop polling scenarios", () => {
      it("should return null for delivered shipments", () => {
        const shipment = {
          isDelivered: true,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-09"),
          rescheduledDeliveryDate: null,
        };

        const result = calculateNextPollAt(shipment, merchant);
        expect(result).toBeNull();
      });

      it("should return null for archived shipments", () => {
        const shipment = {
          isDelivered: false,
          isArchived: true,
          expectedDeliveryDate: utcDate("2026-02-09"),
          rescheduledDeliveryDate: null,
        };

        const result = calculateNextPollAt(shipment, merchant);
        expect(result).toBeNull();
      });
    });

    describe("imminent delivery (today or tomorrow)", () => {
      it("should use 4 hour interval for delivery expected tomorrow", () => {
        // Note: differenceInCalendarDays is timezone-sensitive
        // Using a date that is clearly in the future (2 days out in any timezone)
        // to test imminent delivery behavior for daysUntil = 1
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: new Date("2026-02-05T12:00:00Z"), // Tomorrow at noon
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // differenceInCalendarDays gives 1 -> imminent (<=1)
        // 4 hours + 15 min offset = 4:15 from now
        const expectedTime = new Date("2026-02-04T16:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should use 4 hour interval for delivery expected same day", () => {
        // Use same time on expected day to avoid timezone issues
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: new Date("2026-02-04T18:00:00Z"), // Later today
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // daysUntil = 0 -> imminent (<=1)
        // 4 hours + 15 min offset
        const expectedTime = new Date("2026-02-04T16:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });
    });

    describe("upcoming delivery (2-5 days)", () => {
      it("should use 6 hour interval for delivery 2 days out", () => {
        // Use same time to avoid timezone issues with differenceInCalendarDays
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: new Date("2026-02-06T12:00:00Z"), // 2 days from now at same time
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 6 hours + 15 min offset
        const expectedTime = new Date("2026-02-04T18:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should use 6 hour interval for delivery 5 days out", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: new Date("2026-02-09T12:00:00Z"), // 5 days from now at same time
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 6 hours + 15 min offset
        const expectedTime = new Date("2026-02-04T18:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });
    });

    describe("future delivery (6+ days)", () => {
      it("should use 8 hour interval for delivery 6 days out", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: new Date("2026-02-10T12:00:00Z"), // 6 days from now
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 8 hours + 15 min offset
        const expectedTime = new Date("2026-02-04T20:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should use 8 hour interval for delivery 10+ days out", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: new Date("2026-02-15T12:00:00Z"), // 11 days from now
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 8 hours + 15 min offset
        const expectedTime = new Date("2026-02-04T20:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });
    });

    describe("past due delivery", () => {
      it("should use 2 hour interval for past due shipments", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-02"), // 2 days ago
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 2 hours + 15 min offset
        const expectedTime = new Date("2026-02-04T14:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should use 4 hour interval when carrier has rescheduled to future date", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-02"), // Originally 2 days ago
          rescheduledDeliveryDate: utcDate("2026-02-06"), // Carrier rescheduled to future
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 4 hours (RESCHEDULED) + 15 min offset
        const expectedTime = new Date("2026-02-04T16:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should use 2 hour interval when rescheduled date is also past", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-02"),
          rescheduledDeliveryDate: utcDate("2026-02-03"), // Rescheduled but also past
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 2 hours (PAST_DUE) + 15 min offset
        const expectedTime = new Date("2026-02-04T14:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });
    });

    describe("unknown expected delivery", () => {
      it("should use 6 hour interval when no expected delivery date", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: null,
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const result = calculateNextPollAt(shipment, merchant, now);

        // 6 hours (UNKNOWN) + 15 min offset
        const expectedTime = new Date("2026-02-04T18:15:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });
    });

    describe("merchant offset", () => {
      it("should add merchant random offset to poll time", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-09"),
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        // Merchant with 120 minute offset
        const merchantHighOffset = { randomPollOffset: 120 };
        const result = calculateNextPollAt(shipment, merchantHighOffset, now);

        // 6 hours + 120 min offset = 8 hours
        const expectedTime = new Date("2026-02-04T20:00:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should handle zero offset", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-09"),
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const merchantZeroOffset = { randomPollOffset: 0 };
        const result = calculateNextPollAt(shipment, merchantZeroOffset, now);

        // 6 hours + 0 offset
        const expectedTime = new Date("2026-02-04T18:00:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });

      it("should handle max offset (239 minutes)", () => {
        const shipment = {
          isDelivered: false,
          isArchived: false,
          expectedDeliveryDate: utcDate("2026-02-09"),
          rescheduledDeliveryDate: null,
        };
        const now = new Date("2026-02-04T12:00:00Z");

        const merchantMaxOffset = { randomPollOffset: 239 };
        const result = calculateNextPollAt(shipment, merchantMaxOffset, now);

        // 6 hours + 239 min = 6h + 3h59m = 9h59m from now
        const expectedTime = new Date("2026-02-04T21:59:00Z");
        expect(result?.toISOString()).toBe(expectedTime.toISOString());
      });
    });
  });

  describe("calculatePollPriority", () => {
    describe("priority levels", () => {
      it("should return URGENT priority for past due shipments", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-02T12:00:00Z") }; // 2 days ago
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.URGENT);
      });

      it("should return HIGH priority for delivery expected same day", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-04T18:00:00Z") }; // Later today
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.HIGH);
      });

      it("should return HIGH priority for delivery expected tomorrow", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-05T12:00:00Z") }; // Tomorrow
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.HIGH);
      });

      it("should return NORMAL priority for delivery 2-5 days out", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-08T12:00:00Z") }; // 4 days
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.NORMAL);
      });

      it("should return LOW priority for delivery 6+ days out", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-15T12:00:00Z") }; // 11 days
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.LOW);
      });

      it("should return NORMAL priority when no expected delivery date", () => {
        const shipment = { expectedDeliveryDate: null };
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.NORMAL);
      });
    });

    describe("edge cases", () => {
      it("should handle expected delivery on boundary (exactly 1 day)", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-05T12:00:00Z") };
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.HIGH);
      });

      it("should handle expected delivery on boundary (exactly 5 days)", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-09T12:00:00Z") };
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.NORMAL);
      });

      it("should handle expected delivery on boundary (exactly 6 days)", () => {
        const shipment = { expectedDeliveryDate: new Date("2026-02-10T12:00:00Z") };
        const now = new Date("2026-02-04T12:00:00Z");

        const priority = calculatePollPriority(shipment, now);
        expect(priority).toBe(POLL_PRIORITY.LOW);
      });
    });
  });
});
