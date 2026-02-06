import { describe, it, expect } from "vitest";
import {
  detectCarrierFromCompany,
  detectCarrierFromTrackingNumber,
  detectCarrier,
  normalizeServiceLevel,
  buildTrackingUrl,
  isValidTrackingNumber,
  extractServiceLevelFromCompany,
} from "../carrier.service";

describe("carrier.service", () => {
  describe("detectCarrierFromCompany", () => {
    it("should return UNKNOWN for null or undefined", () => {
      expect(detectCarrierFromCompany(null)).toBe("UNKNOWN");
      expect(detectCarrierFromCompany(undefined)).toBe("UNKNOWN");
      expect(detectCarrierFromCompany("")).toBe("UNKNOWN");
    });

    it("should detect UPS from company name variations", () => {
      expect(detectCarrierFromCompany("UPS")).toBe("UPS");
      expect(detectCarrierFromCompany("ups")).toBe("UPS");
      expect(detectCarrierFromCompany("UPS Ground")).toBe("UPS");
      expect(detectCarrierFromCompany("UPS Next Day Air")).toBe("UPS");
      expect(detectCarrierFromCompany("United Parcel Service")).toBe("UPS");
    });

    it("should detect FedEx from company name variations", () => {
      expect(detectCarrierFromCompany("FedEx")).toBe("FEDEX");
      expect(detectCarrierFromCompany("fedex")).toBe("FEDEX");
      expect(detectCarrierFromCompany("FedEx Ground")).toBe("FEDEX");
      expect(detectCarrierFromCompany("FedEx Express")).toBe("FEDEX");
      expect(detectCarrierFromCompany("Federal Express")).toBe("FEDEX");
      expect(detectCarrierFromCompany("FedEx Home Delivery")).toBe("FEDEX");
    });

    it("should detect USPS from company name variations", () => {
      expect(detectCarrierFromCompany("USPS")).toBe("USPS");
      expect(detectCarrierFromCompany("usps")).toBe("USPS");
      expect(detectCarrierFromCompany("USPS Priority Mail")).toBe("USPS");
      expect(detectCarrierFromCompany("United States Postal Service")).toBe("USPS");
      expect(detectCarrierFromCompany("US Postal Service")).toBe("USPS");
    });

    it("should return UNKNOWN for unrecognized carriers", () => {
      expect(detectCarrierFromCompany("DHL")).toBe("UNKNOWN");
      expect(detectCarrierFromCompany("Amazon Logistics")).toBe("UNKNOWN");
      expect(detectCarrierFromCompany("OnTrac")).toBe("UNKNOWN");
    });
  });

  describe("detectCarrierFromTrackingNumber", () => {
    it("should return UNKNOWN for null or undefined", () => {
      expect(detectCarrierFromTrackingNumber(null)).toBe("UNKNOWN");
      expect(detectCarrierFromTrackingNumber(undefined)).toBe("UNKNOWN");
      expect(detectCarrierFromTrackingNumber("")).toBe("UNKNOWN");
    });

    describe("UPS tracking numbers", () => {
      it("should detect standard 1Z tracking numbers", () => {
        expect(detectCarrierFromTrackingNumber("1Z999AA10123456784")).toBe("UPS");
        expect(detectCarrierFromTrackingNumber("1Z12345E0205271688")).toBe("UPS");
        expect(detectCarrierFromTrackingNumber("1z999aa10123456784")).toBe("UPS"); // lowercase
      });

      it("should detect UPS with spaces or dashes", () => {
        expect(detectCarrierFromTrackingNumber("1Z 999 AA1 0123 4567 84")).toBe("UPS");
        expect(detectCarrierFromTrackingNumber("1Z-999-AA1-0123-4567-84")).toBe("UPS");
      });
    });

    describe("FedEx tracking numbers", () => {
      it("should detect 12-digit FedEx Express numbers", () => {
        expect(detectCarrierFromTrackingNumber("123456789012")).toBe("FEDEX");
      });

      it("should detect 15-digit FedEx Ground numbers", () => {
        expect(detectCarrierFromTrackingNumber("123456789012345")).toBe("FEDEX");
      });

      it("should detect FedEx SmartPost (96 prefix)", () => {
        expect(detectCarrierFromTrackingNumber("9612345678901234567890")).toBe("FEDEX");
        expect(detectCarrierFromTrackingNumber("961234567890")).toBe("FEDEX"); // 12 digits after 96
      });
    });

    describe("USPS tracking numbers", () => {
      it("should detect 22-digit USPS numbers starting with 94", () => {
        expect(detectCarrierFromTrackingNumber("9400111899223033317615")).toBe("USPS");
      });

      it("should detect 22-digit USPS numbers starting with 92", () => {
        expect(detectCarrierFromTrackingNumber("9200111899223033317615")).toBe("USPS");
      });

      it("should detect 22-digit USPS numbers starting with 93", () => {
        expect(detectCarrierFromTrackingNumber("9300111899223033317615")).toBe("USPS");
      });

      it("should detect international format", () => {
        expect(detectCarrierFromTrackingNumber("EC123456789US")).toBe("USPS");
        expect(detectCarrierFromTrackingNumber("LB123456789US")).toBe("USPS");
      });
    });

    it("should return UNKNOWN for unrecognized formats", () => {
      expect(detectCarrierFromTrackingNumber("ABC123")).toBe("UNKNOWN");
      expect(detectCarrierFromTrackingNumber("12345")).toBe("UNKNOWN");
    });
  });

  describe("detectCarrier", () => {
    it("should prefer company name over tracking number", () => {
      // Even though tracking looks like USPS, company says FedEx
      expect(
        detectCarrier("FedEx", "9400111899223033317615")
      ).toBe("FEDEX");
    });

    it("should fall back to tracking number when company is unknown", () => {
      expect(
        detectCarrier(null, "1Z999AA10123456784")
      ).toBe("UPS");
      expect(
        detectCarrier("Some Unknown Carrier", "1Z999AA10123456784")
      ).toBe("UPS");
    });

    it("should return UNKNOWN when both are unrecognized", () => {
      expect(detectCarrier("DHL", "ABC123")).toBe("UNKNOWN");
      expect(detectCarrier(null, null)).toBe("UNKNOWN");
    });
  });

  describe("normalizeServiceLevel", () => {
    it("should return null for null or undefined", () => {
      expect(normalizeServiceLevel(null)).toBe(null);
      expect(normalizeServiceLevel(undefined)).toBe(null);
      expect(normalizeServiceLevel("")).toBe(null);
    });

    it("should normalize service level strings", () => {
      expect(normalizeServiceLevel("UPS Ground")).toBe("ups_ground");
      expect(normalizeServiceLevel("FedEx 2Day")).toBe("fedex_2day");
      expect(normalizeServiceLevel("USPS Priority Mail")).toBe("usps_priority_mail");
    });

    it("should handle extra whitespace", () => {
      expect(normalizeServiceLevel("  UPS Ground  ")).toBe("ups_ground");
    });

    it("should handle special characters", () => {
      expect(normalizeServiceLevel("FedEx Home-Delivery")).toBe("fedex_home_delivery");
      expect(normalizeServiceLevel("UPS 2nd Day Air®")).toBe("ups_2nd_day_air");
    });
  });

  describe("buildTrackingUrl", () => {
    it("should build UPS tracking URL", () => {
      expect(buildTrackingUrl("UPS", "1Z999AA10123456784")).toBe(
        "https://www.ups.com/track?tracknum=1Z999AA10123456784"
      );
    });

    it("should build FedEx tracking URL", () => {
      expect(buildTrackingUrl("FEDEX", "123456789012")).toBe(
        "https://www.fedex.com/fedextrack/?trknbr=123456789012"
      );
    });

    it("should build USPS tracking URL", () => {
      expect(buildTrackingUrl("USPS", "9400111899223033317615")).toBe(
        "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223033317615"
      );
    });

    it("should return null for UNKNOWN carrier", () => {
      expect(buildTrackingUrl("UNKNOWN", "ABC123")).toBe(null);
    });

    it("should URL encode tracking numbers", () => {
      expect(buildTrackingUrl("UPS", "1Z 999 AA1")).toBe(
        "https://www.ups.com/track?tracknum=1Z%20999%20AA1"
      );
    });
  });

  describe("isValidTrackingNumber", () => {
    it("should return false for null, undefined, or empty", () => {
      expect(isValidTrackingNumber(null)).toBe(false);
      expect(isValidTrackingNumber(undefined)).toBe(false);
      expect(isValidTrackingNumber("")).toBe(false);
    });

    it("should return false for too short tracking numbers", () => {
      expect(isValidTrackingNumber("ABC123")).toBe(false);
      expect(isValidTrackingNumber("123456789")).toBe(false);
    });

    it("should return true for valid length tracking numbers", () => {
      expect(isValidTrackingNumber("1Z999AA10123456784")).toBe(true);
      expect(isValidTrackingNumber("123456789012")).toBe(true);
      expect(isValidTrackingNumber("9400111899223033317615")).toBe(true);
    });

    it("should handle spaces and dashes", () => {
      expect(isValidTrackingNumber("1Z 999 AA1 0123 4567 84")).toBe(true);
      expect(isValidTrackingNumber("1Z-999-AA1-0123-4567-84")).toBe(true);
    });

    it("should return false for non-alphanumeric characters", () => {
      expect(isValidTrackingNumber("1Z999AA!0123456784")).toBe(false);
    });

    it("should return false for too long tracking numbers", () => {
      expect(isValidTrackingNumber("1".repeat(35))).toBe(false);
    });
  });

  describe("extractServiceLevelFromCompany", () => {
    it("should return null for null or undefined", () => {
      expect(extractServiceLevelFromCompany(null)).toBe(null);
      expect(extractServiceLevelFromCompany(undefined)).toBe(null);
    });

    it("should extract UPS service levels", () => {
      expect(extractServiceLevelFromCompany("UPS Ground")).toBe("ups_ground");
      expect(extractServiceLevelFromCompany("UPS Next Day Air")).toBe("ups_next_day_air");
      expect(extractServiceLevelFromCompany("UPS 2nd Day Air")).toBe("ups_2nd_day_air");
    });

    it("should extract FedEx service levels", () => {
      expect(extractServiceLevelFromCompany("FedEx Ground")).toBe("fedex_ground");
      expect(extractServiceLevelFromCompany("FedEx Express")).toBe("fedex_express");
      expect(extractServiceLevelFromCompany("FedEx 2Day")).toBe("fedex_2day");
      expect(extractServiceLevelFromCompany("FedEx Overnight")).toBe("fedex_overnight");
    });

    it("should extract USPS service levels", () => {
      expect(extractServiceLevelFromCompany("USPS Priority Mail")).toBe("usps_priority_mail");
      expect(extractServiceLevelFromCompany("USPS Priority Mail Express")).toBe("usps_priority_mail_express");
      expect(extractServiceLevelFromCompany("USPS Ground Advantage")).toBe("usps_ground_advantage");
    });

    it("should return null for plain carrier names", () => {
      expect(extractServiceLevelFromCompany("UPS")).toBe(null);
      expect(extractServiceLevelFromCompany("FedEx")).toBe(null);
      expect(extractServiceLevelFromCompany("USPS")).toBe(null);
    });
  });
});
