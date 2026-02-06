/**
 * Business Days Utility
 *
 * Provides functions for calculating business days between dates,
 * adding business days to dates, and checking if a date is a business day.
 * Business days exclude weekends (Saturday and Sunday).
 *
 * Note: This implementation does not account for federal holidays.
 * For most shipping calculations, this is acceptable as carriers
 * have their own holiday schedules.
 *
 * All functions work in UTC to avoid timezone issues.
 */

import {
  addDays,
  differenceInCalendarDays,
  isBefore,
  isEqual,
} from "date-fns";

/**
 * Get the UTC day of week (0 = Sunday, 6 = Saturday)
 */
function getUTCDayOfWeek(date: Date): number {
  return date.getUTCDay();
}

/**
 * Check if a date is a weekend (Saturday or Sunday) in UTC.
 */
function isWeekendUTC(date: Date): boolean {
  const day = getUTCDayOfWeek(date);
  return day === 0 || day === 6;
}

/**
 * Get the start of day in UTC.
 */
function startOfDayUTC(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Check if a given date is a business day (Monday-Friday) in UTC.
 */
export function isBusinessDay(date: Date): boolean {
  return !isWeekendUTC(date);
}

/**
 * Add a specified number of business days to a date.
 * If the starting date is a weekend, it first moves to the next business day
 * before starting to count.
 *
 * @param startDate - The starting date
 * @param businessDays - Number of business days to add (must be >= 0)
 * @returns The resulting date after adding business days
 *
 * @example
 * // Friday + 1 business day = Monday
 * addBusinessDays(new Date('2026-02-06'), 1) // Friday -> Monday
 *
 * // Monday + 5 business days = Monday (next week)
 * addBusinessDays(new Date('2026-02-02'), 5) // Monday -> Monday
 */
export function addBusinessDays(startDate: Date, businessDays: number): Date {
  if (businessDays < 0) {
    throw new Error("businessDays must be non-negative");
  }

  if (businessDays === 0) {
    return startOfDayUTC(startDate);
  }

  let currentDate = startOfDayUTC(startDate);
  let daysToAdd = businessDays;

  // If starting on a weekend, move to next business day without counting it
  while (isWeekendUTC(currentDate)) {
    currentDate = addDays(currentDate, 1);
  }

  // Now add the required number of business days
  while (daysToAdd > 0) {
    currentDate = addDays(currentDate, 1);
    if (isBusinessDay(currentDate)) {
      daysToAdd--;
    }
  }

  return currentDate;
}

/**
 * Calculate the number of business days between two dates.
 * The start date is included, the end date is excluded.
 *
 * @param startDate - The start date
 * @param endDate - The end date
 * @returns Number of business days between the dates
 *
 * @example
 * // Monday to Friday = 4 business days (Mon, Tue, Wed, Thu)
 * differenceInBusinessDays(new Date('2026-02-02'), new Date('2026-02-06'))
 */
export function differenceInBusinessDays(startDate: Date, endDate: Date): number {
  const start = startOfDayUTC(startDate);
  const end = startOfDayUTC(endDate);

  // If dates are equal, return 0
  if (isEqual(start, end)) {
    return 0;
  }

  // Determine if we're counting forward or backward
  const isForward = isBefore(start, end);
  const [from, to] = isForward ? [start, end] : [end, start];

  let businessDays = 0;
  let current = from;

  while (isBefore(current, to)) {
    if (isBusinessDay(current)) {
      businessDays++;
    }
    current = addDays(current, 1);
  }

  return isForward ? businessDays : -businessDays;
}

/**
 * Get the next business day from a given date.
 * If the given date is a business day, returns that date.
 *
 * @param date - The starting date
 * @returns The next business day (or the same day if it's a business day)
 */
export function nextBusinessDay(date: Date): Date {
  let current = startOfDayUTC(date);
  while (!isBusinessDay(current)) {
    current = addDays(current, 1);
  }
  return current;
}

/**
 * Calculate the expected delivery date from a ship date and number of business days.
 * This is the primary function used for delay detection.
 *
 * @param shipDate - The date the package was shipped
 * @param businessDays - Number of business days for delivery
 * @returns The expected delivery date
 *
 * @example
 * // Shipped Monday, 5 business day delivery = delivery by end of next Monday
 * calculateExpectedDeliveryDate(new Date('2026-02-02'), 5)
 */
export function calculateExpectedDeliveryDate(shipDate: Date, businessDays: number): Date {
  return addBusinessDays(shipDate, businessDays);
}

/**
 * Check if a shipment is past its expected delivery date plus grace period.
 * This is used for delay detection when no carrier exception is present.
 *
 * @param expectedDeliveryDate - The expected delivery date
 * @param graceHours - Hours of grace period after expected delivery (default: 8)
 * @param now - Current date/time (optional, defaults to now)
 * @returns Whether the shipment is past the deadline
 */
export function isPastDeadline(
  expectedDeliveryDate: Date,
  graceHours: number = 8,
  now: Date = new Date()
): boolean {
  // Calculate deadline: end of expected delivery day + grace hours (in UTC)
  const deadline = new Date(expectedDeliveryDate);
  // Set to end of day in UTC (23:59:59.999)
  deadline.setUTCHours(23, 59, 59, 999);
  // Add grace hours
  deadline.setTime(deadline.getTime() + graceHours * 60 * 60 * 1000);

  return now > deadline;
}

/**
 * Calculate days delayed from expected delivery date.
 * Returns 0 if not yet past expected delivery.
 *
 * @param expectedDeliveryDate - The expected delivery date
 * @param now - Current date (optional, defaults to now)
 * @returns Number of calendar days delayed (0 if not delayed)
 */
export function calculateDaysDelayed(
  expectedDeliveryDate: Date,
  now: Date = new Date()
): number {
  const expected = startOfDayUTC(expectedDeliveryDate);
  const current = startOfDayUTC(now);

  const diff = differenceInCalendarDays(current, expected);
  return Math.max(0, diff);
}
