import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isBusinessDay,
  addBusinessDays,
  differenceInBusinessDays,
  nextBusinessDay,
  calculateExpectedDeliveryDate,
  isPastDeadline,
  calculateDaysDelayed,
} from "../business-days";

/**
 * Helper to create a UTC date at midnight
 */
function utcDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00.000Z");
}

describe("business-days", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isBusinessDay", () => {
    it("should return true for Monday", () => {
      // February 2, 2026 is a Monday
      expect(isBusinessDay(utcDate("2026-02-02"))).toBe(true);
    });

    it("should return true for Tuesday", () => {
      expect(isBusinessDay(utcDate("2026-02-03"))).toBe(true);
    });

    it("should return true for Wednesday", () => {
      expect(isBusinessDay(utcDate("2026-02-04"))).toBe(true);
    });

    it("should return true for Thursday", () => {
      expect(isBusinessDay(utcDate("2026-02-05"))).toBe(true);
    });

    it("should return true for Friday", () => {
      expect(isBusinessDay(utcDate("2026-02-06"))).toBe(true);
    });

    it("should return false for Saturday", () => {
      expect(isBusinessDay(utcDate("2026-02-07"))).toBe(false);
    });

    it("should return false for Sunday", () => {
      expect(isBusinessDay(utcDate("2026-02-08"))).toBe(false);
    });
  });

  describe("addBusinessDays", () => {
    it("should add 1 business day to Monday (returns Tuesday)", () => {
      const monday = utcDate("2026-02-02");
      const result = addBusinessDays(monday, 1);
      expect(result.toISOString()).toBe("2026-02-03T00:00:00.000Z");
    });

    it("should add 1 business day to Friday (returns Monday)", () => {
      const friday = utcDate("2026-02-06");
      const result = addBusinessDays(friday, 1);
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z");
    });

    it("should add 5 business days to Monday (returns next Monday)", () => {
      const monday = utcDate("2026-02-02");
      const result = addBusinessDays(monday, 5);
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z");
    });

    it("should add 0 business days (returns same day)", () => {
      const wednesday = utcDate("2026-02-04");
      const result = addBusinessDays(wednesday, 0);
      expect(result.toISOString()).toBe("2026-02-04T00:00:00.000Z");
    });

    it("should skip weekend when starting from Saturday", () => {
      const saturday = utcDate("2026-02-07");
      const result = addBusinessDays(saturday, 1);
      // Saturday -> Monday, then +1 = Tuesday
      expect(result.toISOString()).toBe("2026-02-10T00:00:00.000Z");
    });

    it("should skip weekend when starting from Sunday", () => {
      const sunday = utcDate("2026-02-08");
      const result = addBusinessDays(sunday, 1);
      // Sunday -> Monday, then +1 = Tuesday
      expect(result.toISOString()).toBe("2026-02-10T00:00:00.000Z");
    });

    it("should handle 10 business days (2 weeks)", () => {
      const monday = utcDate("2026-02-02");
      const result = addBusinessDays(monday, 10);
      // 5 days first week, 5 days second week = Monday + 2 weeks = Feb 16
      expect(result.toISOString()).toBe("2026-02-16T00:00:00.000Z");
    });

    it("should throw for negative business days", () => {
      const date = utcDate("2026-02-04");
      expect(() => addBusinessDays(date, -1)).toThrow("businessDays must be non-negative");
    });
  });

  describe("differenceInBusinessDays", () => {
    it("should return 0 for same date", () => {
      const date = utcDate("2026-02-04");
      expect(differenceInBusinessDays(date, date)).toBe(0);
    });

    it("should return 1 for Monday to Tuesday", () => {
      const monday = utcDate("2026-02-02");
      const tuesday = utcDate("2026-02-03");
      expect(differenceInBusinessDays(monday, tuesday)).toBe(1);
    });

    it("should return 4 for Monday to Friday (Mon, Tue, Wed, Thu)", () => {
      const monday = utcDate("2026-02-02");
      const friday = utcDate("2026-02-06");
      expect(differenceInBusinessDays(monday, friday)).toBe(4);
    });

    it("should return 5 for Monday to Monday (next week)", () => {
      const monday1 = utcDate("2026-02-02");
      const monday2 = utcDate("2026-02-09");
      expect(differenceInBusinessDays(monday1, monday2)).toBe(5);
    });

    it("should skip weekends in count (Friday to Monday)", () => {
      const friday = utcDate("2026-02-06");
      const monday = utcDate("2026-02-09");
      expect(differenceInBusinessDays(friday, monday)).toBe(1); // Only Friday counts
    });

    it("should return negative for backwards dates", () => {
      const tuesday = utcDate("2026-02-03");
      const monday = utcDate("2026-02-02");
      expect(differenceInBusinessDays(tuesday, monday)).toBe(-1);
    });
  });

  describe("nextBusinessDay", () => {
    it("should return same day for Monday", () => {
      const monday = utcDate("2026-02-02");
      const result = nextBusinessDay(monday);
      expect(result.toISOString()).toBe("2026-02-02T00:00:00.000Z");
    });

    it("should return same day for Friday", () => {
      const friday = utcDate("2026-02-06");
      const result = nextBusinessDay(friday);
      expect(result.toISOString()).toBe("2026-02-06T00:00:00.000Z");
    });

    it("should return Monday for Saturday", () => {
      const saturday = utcDate("2026-02-07");
      const result = nextBusinessDay(saturday);
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z");
    });

    it("should return Monday for Sunday", () => {
      const sunday = utcDate("2026-02-08");
      const result = nextBusinessDay(sunday);
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z");
    });
  });

  describe("calculateExpectedDeliveryDate", () => {
    it("should add business days from ship date", () => {
      const shipDate = utcDate("2026-02-02"); // Monday
      const result = calculateExpectedDeliveryDate(shipDate, 5);
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z"); // Next Monday
    });

    it("should handle overnight delivery (1 business day)", () => {
      const shipDate = utcDate("2026-02-02"); // Monday
      const result = calculateExpectedDeliveryDate(shipDate, 1);
      expect(result.toISOString()).toBe("2026-02-03T00:00:00.000Z"); // Tuesday
    });

    it("should handle overnight delivery on Friday (Monday)", () => {
      const shipDate = utcDate("2026-02-06"); // Friday
      const result = calculateExpectedDeliveryDate(shipDate, 1);
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z"); // Monday
    });
  });

  describe("isPastDeadline", () => {
    it("should return false when before expected delivery date", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-05T12:00:00Z");
      expect(isPastDeadline(expected, 8, now)).toBe(false);
    });

    it("should return false when on expected delivery date within business hours", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-06T16:00:00Z");
      expect(isPastDeadline(expected, 8, now)).toBe(false);
    });

    it("should return false when on expected delivery date at end of day", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-06T23:59:59Z");
      expect(isPastDeadline(expected, 8, now)).toBe(false);
    });

    it("should return false when within grace period after expected delivery date", () => {
      const expected = utcDate("2026-02-06");
      // End of day is 23:59:59.999, + 8 hours = 07:59:59.999 next day
      const now = new Date("2026-02-07T06:00:00Z"); // Still within grace
      expect(isPastDeadline(expected, 8, now)).toBe(false);
    });

    it("should return true when past grace period after expected delivery date", () => {
      const expected = utcDate("2026-02-06");
      // End of day 23:59:59.999 + 8 hours = 07:59:59.999 next day
      const now = new Date("2026-02-07T09:00:00Z"); // Past grace period
      expect(isPastDeadline(expected, 8, now)).toBe(true);
    });

    it("should respect custom grace period", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-07T06:00:00Z"); // 6 hours after midnight

      // With 4 hour grace, deadline is 03:59:59.999 on Feb 7 - now is past it
      expect(isPastDeadline(expected, 4, now)).toBe(true);

      // With 12 hour grace, deadline is 11:59:59.999 on Feb 7 - still within it
      expect(isPastDeadline(expected, 12, now)).toBe(false);
    });

    it("should return true when well past deadline", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-10T12:00:00Z"); // 4 days later
      expect(isPastDeadline(expected, 8, now)).toBe(true);
    });
  });

  describe("calculateDaysDelayed", () => {
    it("should return 0 when before expected delivery", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-05T12:00:00Z");
      expect(calculateDaysDelayed(expected, now)).toBe(0);
    });

    it("should return 0 when on expected delivery date", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-06T23:59:59Z");
      expect(calculateDaysDelayed(expected, now)).toBe(0);
    });

    it("should return 1 when 1 day past expected", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-07T12:00:00Z");
      expect(calculateDaysDelayed(expected, now)).toBe(1);
    });

    it("should return 5 when 5 days past expected", () => {
      const expected = utcDate("2026-02-06");
      const now = new Date("2026-02-11T12:00:00Z");
      expect(calculateDaysDelayed(expected, now)).toBe(5);
    });

    it("should use current time if now not provided", () => {
      vi.setSystemTime(new Date("2026-02-11T12:00:00Z"));
      const expected = utcDate("2026-02-06");
      expect(calculateDaysDelayed(expected)).toBe(5);
    });
  });
});
