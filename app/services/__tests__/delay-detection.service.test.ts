import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TrackingResult } from "../carriers/carrier.interface";
import type { MerchantSettings } from "~/lib/validation";
import { DEFAULT_MERCHANT_SETTINGS } from "~/lib/validation";
import {
  evaluateDelay,
  normalizeServiceLevel,
  getDeliveryWindow,
  calculateDefaultExpectedDelivery,
  DEFAULT_DELIVERY_WINDOWS,
  DEFAULT_CARRIER_WINDOWS,
  getDelayUpdateFields,
  getCarrierServiceLevels,
  getServiceLevelLabel,
  type ShipmentData,
} from "../delay-detection.service";

/**
 * Helper to create a UTC date at midnight
 */
function utcDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00.000Z");
}

describe("delay-detection.service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set to Wednesday, February 4, 2026 at noon
    vi.setSystemTime(new Date("2026-02-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("normalizeServiceLevel", () => {
    describe("UPS service levels", () => {
      it('should normalize "UPS GROUND" to "ups_ground"', () => {
        expect(normalizeServiceLevel("UPS GROUND", "UPS")).toBe("ups_ground");
      });

      it('should normalize "Ground" with UPS carrier to "ups_ground"', () => {
        expect(normalizeServiceLevel("Ground", "UPS")).toBe("ups_ground");
      });

      it('should normalize "UPS® Ground" to "ups_ground"', () => {
        expect(normalizeServiceLevel("UPS® Ground", "UPS")).toBe("ups_ground");
      });

      it('should normalize "UPS Next Day Air" to "ups_next_day_air"', () => {
        expect(normalizeServiceLevel("UPS Next Day Air", "UPS")).toBe("ups_next_day_air");
      });

      it('should normalize "2nd Day Air" with UPS carrier to "ups_2nd_day_air"', () => {
        expect(normalizeServiceLevel("2nd Day Air", "UPS")).toBe("ups_2nd_day_air");
      });

      it('should normalize "UPS 3 Day Select" to "ups_3_day_select"', () => {
        expect(normalizeServiceLevel("UPS 3 Day Select", "UPS")).toBe("ups_3_day_select");
      });
    });

    describe("FedEx service levels", () => {
      it('should normalize "FedEx Ground" to "fedex_ground"', () => {
        expect(normalizeServiceLevel("FedEx Ground", "FEDEX")).toBe("fedex_ground");
      });

      it('should normalize "Home Delivery" with FedEx carrier to "fedex_home_delivery"', () => {
        expect(normalizeServiceLevel("Home Delivery", "FEDEX")).toBe("fedex_home_delivery");
      });

      it('should normalize "FedEx Priority Overnight" to "fedex_priority_overnight"', () => {
        expect(normalizeServiceLevel("FedEx Priority Overnight", "FEDEX")).toBe(
          "fedex_priority_overnight"
        );
      });

      it('should normalize "FedEx 2Day AM" to "fedex_2day_am"', () => {
        expect(normalizeServiceLevel("FedEx 2Day AM", "FEDEX")).toBe("fedex_2day_am");
      });
    });

    describe("USPS service levels", () => {
      it('should normalize "USPS Priority Mail" to "usps_priority_mail"', () => {
        expect(normalizeServiceLevel("USPS Priority Mail", "USPS")).toBe("usps_priority_mail");
      });

      it('should normalize "Priority Mail Express" with USPS carrier to "usps_priority_mail_express"', () => {
        expect(normalizeServiceLevel("Priority Mail Express", "USPS")).toBe(
          "usps_priority_mail_express"
        );
      });

      it('should normalize "Ground Advantage" with USPS carrier to "usps_ground_advantage"', () => {
        expect(normalizeServiceLevel("Ground Advantage", "USPS")).toBe("usps_ground_advantage");
      });
    });

    describe("edge cases", () => {
      it("should return null for null service level", () => {
        expect(normalizeServiceLevel(null, "UPS")).toBeNull();
      });

      it("should return null for undefined service level", () => {
        expect(normalizeServiceLevel(undefined, "UPS")).toBeNull();
      });

      it("should return null for empty string service level", () => {
        expect(normalizeServiceLevel("", "UPS")).toBeNull();
      });

      it("should handle extra whitespace", () => {
        expect(normalizeServiceLevel("  UPS   Ground  ", "UPS")).toBe("ups_ground");
      });

      it("should handle trademark symbols", () => {
        expect(normalizeServiceLevel("FedEx™ Ground®", "FEDEX")).toBe("fedex_ground");
      });

      it("should not add carrier prefix for UNKNOWN", () => {
        expect(normalizeServiceLevel("Ground", "UNKNOWN")).toBe("ground");
      });
    });
  });

  describe("getDeliveryWindow", () => {
    describe("UPS defaults", () => {
      it("should return 1 for UPS Next Day Air", () => {
        expect(getDeliveryWindow("Next Day Air", "UPS")).toBe(1);
      });

      it("should return 2 for UPS 2nd Day Air", () => {
        expect(getDeliveryWindow("2nd Day Air", "UPS")).toBe(2);
      });

      it("should return 5 for UPS Ground", () => {
        expect(getDeliveryWindow("Ground", "UPS")).toBe(5);
      });
    });

    describe("FedEx defaults", () => {
      it("should return 1 for FedEx Overnight", () => {
        expect(getDeliveryWindow("Overnight", "FEDEX")).toBe(1);
      });

      it("should return 2 for FedEx 2Day", () => {
        expect(getDeliveryWindow("2Day", "FEDEX")).toBe(2);
      });

      it("should return 5 for FedEx Ground", () => {
        expect(getDeliveryWindow("Ground", "FEDEX")).toBe(5);
      });
    });

    describe("USPS defaults", () => {
      it("should return 2 for USPS Priority Express", () => {
        expect(getDeliveryWindow("Priority Express", "USPS")).toBe(2);
      });

      it("should return 3 for USPS Priority Mail", () => {
        expect(getDeliveryWindow("Priority Mail", "USPS")).toBe(3);
      });

      it("should return 7 for USPS Ground Advantage", () => {
        expect(getDeliveryWindow("Ground Advantage", "USPS")).toBe(7);
      });
    });

    describe("carrier fallbacks", () => {
      it("should return 5 for unknown UPS service level", () => {
        expect(getDeliveryWindow("Unknown Service", "UPS")).toBe(5);
      });

      it("should return 5 for unknown FedEx service level", () => {
        expect(getDeliveryWindow("Unknown Service", "FEDEX")).toBe(5);
      });

      it("should return 7 for unknown USPS service level", () => {
        expect(getDeliveryWindow("Unknown Service", "USPS")).toBe(7);
      });

      it("should return generic ground window for UNKNOWN carrier with Ground service", () => {
        // "Ground" normalizes to "ground" which matches generic DEFAULT_DELIVERY_WINDOWS.ground
        expect(getDeliveryWindow("Ground", "UNKNOWN")).toBe(5);
      });

      it("should return carrier fallback for UNKNOWN carrier with unrecognized service", () => {
        expect(getDeliveryWindow("Unknown Service XYZ", "UNKNOWN")).toBe(7);
      });
    });

    describe("merchant overrides", () => {
      it("should use merchant override when available", () => {
        const overrides = { ups_ground: 7 };
        expect(getDeliveryWindow("Ground", "UPS", overrides)).toBe(7);
      });

      it("should use default when override not present", () => {
        const overrides = { ups_next_day_air: 1 };
        expect(getDeliveryWindow("Ground", "UPS", overrides)).toBe(5);
      });

      it("should handle empty overrides object", () => {
        expect(getDeliveryWindow("Ground", "UPS", {})).toBe(5);
      });
    });
  });

  describe("calculateDefaultExpectedDelivery", () => {
    it("should calculate expected delivery from ship date and service level", () => {
      // Monday + 5 business days = next Monday
      const shipDate = utcDate("2026-02-02");
      const result = calculateDefaultExpectedDelivery(shipDate, "Ground", "UPS");
      expect(result.toISOString()).toBe("2026-02-09T00:00:00.000Z");
    });

    it("should calculate overnight delivery", () => {
      // Monday + 1 business day = Tuesday
      const shipDate = utcDate("2026-02-02");
      const result = calculateDefaultExpectedDelivery(shipDate, "Next Day Air", "UPS");
      expect(result.toISOString()).toBe("2026-02-03T00:00:00.000Z");
    });

    it("should handle shipment on Friday", () => {
      // Friday + 5 business days = next Friday (skipping weekends)
      const shipDate = utcDate("2026-02-06");
      const result = calculateDefaultExpectedDelivery(shipDate, "Ground", "UPS");
      expect(result.toISOString()).toBe("2026-02-13T00:00:00.000Z");
    });

    it("should respect merchant overrides", () => {
      const shipDate = utcDate("2026-02-02");
      const overrides = { ups_ground: 3 };
      const result = calculateDefaultExpectedDelivery(shipDate, "Ground", "UPS", overrides);
      expect(result.toISOString()).toBe("2026-02-05T00:00:00.000Z"); // Monday + 3 = Thursday
    });
  });

  describe("evaluateDelay", () => {
    const createShipmentData = (overrides: Partial<ShipmentData> = {}): ShipmentData => ({
      shipDate: utcDate("2026-02-02"), // Monday
      expectedDeliveryDate: null,
      expectedDeliverySource: "DEFAULT",
      serviceLevel: "Ground",
      carrier: "UPS",
      rescheduledDeliveryDate: null,
      isDelivered: false,
      ...overrides,
    });

    const createTrackingResult = (overrides: Partial<TrackingResult> = {}): TrackingResult => ({
      trackingNumber: "1Z999AA10123456784",
      carrier: "UPS",
      currentStatus: "In Transit",
      isException: false,
      exceptionCode: null,
      exceptionReason: null,
      expectedDeliveryDate: null,
      rescheduledDeliveryDate: null,
      isDelivered: false,
      deliveredAt: null,
      lastScanLocation: "Louisville, KY",
      lastScanTime: new Date("2026-02-04T08:00:00Z"),
      events: [],
      ...overrides,
    });

    const merchantSettings: MerchantSettings = DEFAULT_MERCHANT_SETTINGS;

    describe("not delayed scenarios", () => {
      it("should return not delayed when shipment is delivered", () => {
        const shipment = createShipmentData({ isDelivered: true });

        const result = evaluateDelay(shipment, null, merchantSettings);

        expect(result.isDelayed).toBe(false);
        expect(result.delayReason).toBeNull();
        expect(result.daysDelayed).toBe(0);
      });

      it("should return not delayed when tracking result shows delivered", () => {
        const shipment = createShipmentData();
        const tracking = createTrackingResult({ isDelivered: true });

        const result = evaluateDelay(shipment, tracking, merchantSettings);

        expect(result.isDelayed).toBe(false);
        expect(result.delayReason).toBeNull();
      });

      it("should return not delayed when before expected delivery", () => {
        const shipment = createShipmentData({
          shipDate: utcDate("2026-02-02"),
        });
        // Current time is Feb 4, expected delivery is Feb 9 (5 business days from Feb 2)
        const now = new Date("2026-02-04T12:00:00Z");

        const result = evaluateDelay(shipment, null, merchantSettings, now);

        expect(result.isDelayed).toBe(false);
        expect(result.delayReason).toBeNull();
      });

      it("should return not delayed when on expected delivery date", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-04"),
          expectedDeliverySource: "CARRIER",
        });
        const now = new Date("2026-02-04T18:00:00Z");

        const result = evaluateDelay(shipment, null, merchantSettings, now);

        expect(result.isDelayed).toBe(false);
        expect(result.delayReason).toBeNull();
      });

      it("should return not delayed when within grace period", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-03"),
          expectedDeliverySource: "CARRIER",
        });
        // Feb 3 end of day + 8 hours = Feb 4 07:59:59.999
        const now = new Date("2026-02-04T06:00:00Z"); // Within grace period

        const result = evaluateDelay(shipment, null, merchantSettings, now);

        expect(result.isDelayed).toBe(false);
      });
    });

    describe("delayed due to carrier exception", () => {
      it("should return delayed when carrier reports exception", () => {
        const shipment = createShipmentData();
        const tracking = createTrackingResult({
          isException: true,
          exceptionCode: "X1",
          exceptionReason: "Weather delay",
        });

        const result = evaluateDelay(shipment, tracking, merchantSettings);

        expect(result.isDelayed).toBe(true);
        expect(result.delayReason).toBe("CARRIER_EXCEPTION");
      });

      it("should calculate days delayed when carrier exception", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-02"),
          expectedDeliverySource: "CARRIER",
        });
        const tracking = createTrackingResult({ isException: true });
        const now = new Date("2026-02-04T12:00:00Z"); // 2 days after expected

        const result = evaluateDelay(shipment, tracking, merchantSettings, now);

        expect(result.isDelayed).toBe(true);
        expect(result.delayReason).toBe("CARRIER_EXCEPTION");
        expect(result.daysDelayed).toBe(2);
      });

      it("should use carrier expected delivery date for exception", () => {
        const shipment = createShipmentData();
        const tracking = createTrackingResult({
          isException: true,
          expectedDeliveryDate: utcDate("2026-02-05"),
        });

        const result = evaluateDelay(shipment, tracking, merchantSettings);

        expect(result.expectedDeliveryDate?.toISOString()).toBe("2026-02-05T00:00:00.000Z");
        expect(result.expectedDeliverySource).toBe("CARRIER");
      });
    });

    describe("delayed due to past expected delivery", () => {
      it("should return delayed when past expected delivery + grace period", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-02"),
          expectedDeliverySource: "CARRIER",
        });
        // Feb 2 end of day + 8 hours = Feb 3 07:59:59.999
        const now = new Date("2026-02-04T12:00:00Z"); // Well past grace period

        const result = evaluateDelay(shipment, null, merchantSettings, now);

        expect(result.isDelayed).toBe(true);
        expect(result.delayReason).toBe("PAST_EXPECTED_DELIVERY");
        expect(result.daysDelayed).toBe(2);
      });

      it("should respect custom grace period from merchant settings", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-03"),
          expectedDeliverySource: "CARRIER",
        });
        // Feb 3 end of day + 24 hours = Feb 4 23:59:59.999
        const now = new Date("2026-02-04T12:00:00Z");
        const customSettings: MerchantSettings = {
          ...DEFAULT_MERCHANT_SETTINGS,
          delayThresholdHours: 24,
        };

        const result = evaluateDelay(shipment, null, customSettings, now);

        expect(result.isDelayed).toBe(false); // Within 24-hour grace period
      });

      it("should use calculated default when no expected delivery available", () => {
        const shipment = createShipmentData({
          shipDate: utcDate("2026-01-27"), // Monday
          serviceLevel: "Ground",
          carrier: "UPS",
        });
        // Expected: Jan 27 + 5 business days = Feb 3
        // Feb 3 end of day + 8 hours = Feb 4 07:59:59.999
        const now = new Date("2026-02-04T12:00:00Z"); // Past grace period

        const result = evaluateDelay(shipment, null, merchantSettings, now);

        expect(result.isDelayed).toBe(true);
        expect(result.delayReason).toBe("PAST_EXPECTED_DELIVERY");
        expect(result.expectedDeliverySource).toBe("DEFAULT");
      });
    });

    describe("expected delivery date determination", () => {
      it("should prefer carrier-provided date from tracking result", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-10"),
          expectedDeliverySource: "DEFAULT",
        });
        const tracking = createTrackingResult({
          expectedDeliveryDate: utcDate("2026-02-05"),
        });

        const result = evaluateDelay(shipment, tracking, merchantSettings);

        expect(result.expectedDeliveryDate?.toISOString()).toBe("2026-02-05T00:00:00.000Z");
        expect(result.expectedDeliverySource).toBe("CARRIER");
      });

      it("should use stored carrier date if tracking result has none", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-05"),
          expectedDeliverySource: "CARRIER",
        });
        const tracking = createTrackingResult({
          expectedDeliveryDate: null,
        });

        const result = evaluateDelay(shipment, tracking, merchantSettings);

        expect(result.expectedDeliveryDate?.toISOString()).toBe("2026-02-05T00:00:00.000Z");
        expect(result.expectedDeliverySource).toBe("CARRIER");
      });

      it("should use merchant override date if available", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-15"),
          expectedDeliverySource: "MERCHANT_OVERRIDE",
        });
        const tracking = createTrackingResult({
          expectedDeliveryDate: null,
        });

        const result = evaluateDelay(shipment, tracking, merchantSettings);

        expect(result.expectedDeliveryDate?.toISOString()).toBe("2026-02-15T00:00:00.000Z");
        expect(result.expectedDeliverySource).toBe("MERCHANT_OVERRIDE");
      });

      it("should calculate from service level when no dates available", () => {
        const shipment = createShipmentData({
          shipDate: utcDate("2026-02-02"), // Monday
          serviceLevel: "Next Day Air",
          carrier: "UPS",
          expectedDeliveryDate: null,
          expectedDeliverySource: "DEFAULT",
        });

        const result = evaluateDelay(shipment, null, merchantSettings);

        // Monday + 1 business day = Tuesday Feb 3
        expect(result.expectedDeliveryDate?.toISOString()).toBe("2026-02-03T00:00:00.000Z");
        expect(result.expectedDeliverySource).toBe("DEFAULT");
      });
    });

    describe("rescheduled delivery handling", () => {
      it("should use rescheduled date for deadline check when carrier rescheduled", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-02"), // Original expected
        });
        const tracking = createTrackingResult({
          expectedDeliveryDate: utcDate("2026-02-02"),
          rescheduledDeliveryDate: utcDate("2026-02-05"), // Rescheduled to later
        });
        // If we were checking against Feb 2, would be delayed
        // But rescheduled to Feb 5, so within grace period
        const now = new Date("2026-02-04T12:00:00Z");

        const result = evaluateDelay(shipment, tracking, merchantSettings, now);

        expect(result.isDelayed).toBe(false);
        // Expected delivery date should still be the original
        expect(result.expectedDeliveryDate?.toISOString()).toBe("2026-02-02T00:00:00.000Z");
      });

      it("should still report delayed if past rescheduled date", () => {
        const shipment = createShipmentData({
          expectedDeliveryDate: utcDate("2026-02-02"),
        });
        const tracking = createTrackingResult({
          expectedDeliveryDate: utcDate("2026-02-02"),
          rescheduledDeliveryDate: utcDate("2026-02-03"),
        });
        // Past even the rescheduled date + grace period
        const now = new Date("2026-02-04T12:00:00Z");

        const result = evaluateDelay(shipment, tracking, merchantSettings, now);

        expect(result.isDelayed).toBe(true);
        expect(result.delayReason).toBe("PAST_EXPECTED_DELIVERY");
      });
    });
  });

  describe("getDelayUpdateFields", () => {
    it("should set basic delay fields", () => {
      const result = {
        isDelayed: true,
        delayReason: "CARRIER_EXCEPTION" as const,
        daysDelayed: 2,
        expectedDeliveryDate: utcDate("2026-02-02"),
        expectedDeliverySource: "CARRIER" as const,
      };

      const update = getDelayUpdateFields(result, false);

      expect(update.isDelayed).toBe(true);
      expect(update.daysDelayed).toBe(2);
      expect(update.expectedDeliveryDate).toEqual(utcDate("2026-02-02"));
      expect(update.expectedDeliverySource).toBe("CARRIER");
    });

    it("should set delayFlaggedAt when newly delayed", () => {
      const result = {
        isDelayed: true,
        delayReason: "CARRIER_EXCEPTION" as const,
        daysDelayed: 1,
        expectedDeliveryDate: utcDate("2026-02-02"),
        expectedDeliverySource: "CARRIER" as const,
      };
      const now = new Date("2026-02-04T12:00:00Z");

      const update = getDelayUpdateFields(result, false, now);

      expect(update.delayFlaggedAt).toEqual(now);
    });

    it("should not set delayFlaggedAt when already delayed", () => {
      const result = {
        isDelayed: true,
        delayReason: "CARRIER_EXCEPTION" as const,
        daysDelayed: 2,
        expectedDeliveryDate: utcDate("2026-02-02"),
        expectedDeliverySource: "CARRIER" as const,
      };

      const update = getDelayUpdateFields(result, true);

      expect(update.delayFlaggedAt).toBeUndefined();
    });

    it("should not set delayFlaggedAt when not delayed", () => {
      const result = {
        isDelayed: false,
        delayReason: null,
        daysDelayed: 0,
        expectedDeliveryDate: utcDate("2026-02-05"),
        expectedDeliverySource: "CARRIER" as const,
      };

      const update = getDelayUpdateFields(result, false);

      expect(update.delayFlaggedAt).toBeUndefined();
    });

    it("should not update expected delivery date when null", () => {
      const result = {
        isDelayed: false,
        delayReason: null,
        daysDelayed: 0,
        expectedDeliveryDate: null,
        expectedDeliverySource: "DEFAULT" as const,
      };

      const update = getDelayUpdateFields(result, false);

      expect(update.expectedDeliveryDate).toBeUndefined();
      expect(update.expectedDeliverySource).toBeUndefined();
    });
  });

  describe("getCarrierServiceLevels", () => {
    it("should return UPS service levels", () => {
      const levels = getCarrierServiceLevels("UPS");
      expect(levels).toContain("ups_ground");
      expect(levels).toContain("ups_next_day_air");
      expect(levels).toContain("ups_2nd_day_air");
      expect(levels).not.toContain("fedex_ground");
    });

    it("should return FedEx service levels", () => {
      const levels = getCarrierServiceLevels("FEDEX");
      expect(levels).toContain("fedex_ground");
      expect(levels).toContain("fedex_overnight");
      expect(levels).toContain("fedex_2day");
      expect(levels).not.toContain("ups_ground");
    });

    it("should return USPS service levels", () => {
      const levels = getCarrierServiceLevels("USPS");
      expect(levels).toContain("usps_priority_mail");
      expect(levels).toContain("usps_ground_advantage");
      expect(levels).not.toContain("ups_ground");
    });

    it("should return empty array for UNKNOWN carrier", () => {
      const levels = getCarrierServiceLevels("UNKNOWN");
      expect(levels).toEqual([]);
    });
  });

  describe("getServiceLevelLabel", () => {
    it("should convert ups_ground to Ups Ground", () => {
      expect(getServiceLevelLabel("ups_ground")).toBe("Ups Ground");
    });

    it("should convert fedex_home_delivery to Fedex Home Delivery", () => {
      expect(getServiceLevelLabel("fedex_home_delivery")).toBe("Fedex Home Delivery");
    });

    it("should convert usps_priority_mail_express to Usps Priority Mail Express", () => {
      expect(getServiceLevelLabel("usps_priority_mail_express")).toBe("Usps Priority Mail Express");
    });
  });

  describe("DEFAULT_DELIVERY_WINDOWS constants", () => {
    it("should have correct UPS window values", () => {
      expect(DEFAULT_DELIVERY_WINDOWS.ups_next_day_air).toBe(1);
      expect(DEFAULT_DELIVERY_WINDOWS.ups_2nd_day_air).toBe(2);
      expect(DEFAULT_DELIVERY_WINDOWS.ups_ground).toBe(5);
    });

    it("should have correct FedEx window values", () => {
      expect(DEFAULT_DELIVERY_WINDOWS.fedex_overnight).toBe(1);
      expect(DEFAULT_DELIVERY_WINDOWS.fedex_2day).toBe(2);
      expect(DEFAULT_DELIVERY_WINDOWS.fedex_ground).toBe(5);
    });

    it("should have correct USPS window values", () => {
      expect(DEFAULT_DELIVERY_WINDOWS.usps_priority_mail_express).toBe(2);
      expect(DEFAULT_DELIVERY_WINDOWS.usps_priority_mail).toBe(3);
      expect(DEFAULT_DELIVERY_WINDOWS.usps_ground_advantage).toBe(7);
    });
  });

  describe("DEFAULT_CARRIER_WINDOWS constants", () => {
    it("should have correct carrier fallback values", () => {
      expect(DEFAULT_CARRIER_WINDOWS.UPS).toBe(5);
      expect(DEFAULT_CARRIER_WINDOWS.FEDEX).toBe(5);
      expect(DEFAULT_CARRIER_WINDOWS.USPS).toBe(7);
      expect(DEFAULT_CARRIER_WINDOWS.UNKNOWN).toBe(7);
    });
  });
});
