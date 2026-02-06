import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { XMLBuilder } from "fast-xml-parser";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Now import the adapter after mocks are set up
const { UspsAdapter, getUspsAdapter } = await import("../usps.adapter");

// Helper to build USPS XML response
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "_",
});

function buildUspsXmlResponse(trackInfo: object): string {
  return xmlBuilder.build({
    TrackResponse: {
      TrackInfo: trackInfo,
    },
  });
}

function buildUspsErrorResponse(errorNumber: string, errorDescription: string): string {
  return xmlBuilder.build({
    Error: {
      Number: errorNumber,
      Description: errorDescription,
      Source: "USPS Web Tools API",
    },
  });
}

describe("UspsAdapter", () => {
  let adapter: InstanceType<typeof UspsAdapter>;

  // Sample successful in-transit response
  const sampleInTransitTrackInfo = {
    _ID: "9400111899223456789012",
    Status: "In Transit to Next Facility",
    StatusCategory: "In Transit",
    StatusSummary: "Your item is in transit to the next facility.",
    ExpectedDeliveryDate: "February 10, 2026",
    ExpectedDeliveryTime: "3:00 pm",
    DestinationCity: "MIAMI",
    DestinationState: "FL",
    DestinationZip: "33101",
    Class: "Priority Mail",
    TrackSummary: {
      EventTime: "2:30 pm",
      EventDate: "February 6, 2026",
      Event: "Departed USPS Regional Origin Facility",
      EventCity: "MEMPHIS",
      EventState: "TN",
      EventZIPCode: "38118",
      EventCountry: "",
      EventCode: "RH",
    },
    TrackDetail: [
      {
        EventTime: "8:00 am",
        EventDate: "February 6, 2026",
        Event: "Arrived at USPS Regional Origin Facility",
        EventCity: "MEMPHIS",
        EventState: "TN",
        EventZIPCode: "38118",
        EventCountry: "",
        EventCode: "10",
      },
      {
        EventTime: "5:00 pm",
        EventDate: "February 5, 2026",
        Event: "Accepted at USPS Origin Facility",
        EventCity: "CHICAGO",
        EventState: "IL",
        EventZIPCode: "60601",
        EventCountry: "",
        EventCode: "03",
      },
    ],
  };

  // Sample delivered response
  const sampleDeliveredTrackInfo = {
    _ID: "9400111899223456789012",
    Status: "Delivered",
    StatusCategory: "Delivered",
    StatusSummary: "Your item was delivered.",
    DeliveryNotificationDate: "February 10, 2026",
    DestinationCity: "MIAMI",
    DestinationState: "FL",
    DestinationZip: "33101",
    Class: "Priority Mail",
    TrackSummary: {
      EventTime: "10:25 am",
      EventDate: "February 10, 2026",
      Event: "Delivered, In/At Mailbox",
      EventCity: "MIAMI",
      EventState: "FL",
      EventZIPCode: "33101",
      EventCountry: "",
      EventCode: "01",
    },
    TrackDetail: [
      {
        EventTime: "6:30 am",
        EventDate: "February 10, 2026",
        Event: "Out for Delivery",
        EventCity: "MIAMI",
        EventState: "FL",
        EventZIPCode: "33101",
        EventCountry: "",
        EventCode: "OF",
      },
    ],
  };

  // Sample exception/delay response
  const sampleExceptionTrackInfo = {
    _ID: "9400111899223456789012",
    Status: "Arriving Late",
    StatusCategory: "Alert",
    StatusSummary: "Your package is arriving late.",
    ExpectedDeliveryDate: "February 12, 2026",
    DestinationCity: "MIAMI",
    DestinationState: "FL",
    DestinationZip: "33101",
    Class: "Priority Mail",
    TrackSummary: {
      EventTime: "8:00 am",
      EventDate: "February 10, 2026",
      Event: "Arriving Late - Severe weather causing delays",
      EventCity: "ATLANTA",
      EventState: "GA",
      EventZIPCode: "30301",
      EventCountry: "",
      EventCode: "AL",
    },
    TrackDetail: [
      {
        EventTime: "3:00 pm",
        EventDate: "February 9, 2026",
        Event: "In Transit to Next Facility",
        EventCity: "CHARLOTTE",
        EventState: "NC",
        EventZIPCode: "28201",
        EventCountry: "",
        EventCode: "RH",
      },
    ],
  };

  beforeEach(() => {
    adapter = new UspsAdapter();
    vi.clearAllMocks();

    // Setup environment variables
    process.env.USPS_USER_ID = "test-user-id";
  });

  afterEach(() => {
    delete process.env.USPS_USER_ID;
  });

  describe("track", () => {
    it("should track a package successfully", async () => {
      const xmlResponse = buildUspsXmlResponse(sampleInTransitTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trackingNumber).toBe("9400111899223456789012");
        expect(result.data.carrier).toBe("USPS");
        expect(result.data.currentStatus).toBe("In Transit to Next Facility");
        expect(result.data.isDelivered).toBe(false);
        expect(result.data.isException).toBe(false);
        expect(result.data.events).toHaveLength(3); // 1 summary + 2 details
        expect(result.data.lastScanLocation).toBe("MEMPHIS, TN");
      }
    });

    it("should detect delivered status", async () => {
      const xmlResponse = buildUspsXmlResponse(sampleDeliveredTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDelivered).toBe(true);
        expect(result.data.currentStatus).toBe("Delivered");
        expect(result.data.deliveredAt).toBeInstanceOf(Date);
      }
    });

    it("should detect exception status from Arriving Late keyword", async () => {
      const xmlResponse = buildUspsXmlResponse(sampleExceptionTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isException).toBe(true);
        expect(result.data.exceptionReason).toContain("Arriving Late");
      }
    });

    it("should detect exception from StatusCategory Alert", async () => {
      const alertTrackInfo = {
        ...sampleInTransitTrackInfo,
        StatusCategory: "Alert",
        Status: "Notice Left",
      };
      const xmlResponse = buildUspsXmlResponse(alertTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isException).toBe(true);
      }
    });

    it("should handle HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("API_ERROR");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("should handle top-level USPS error response", async () => {
      const xmlResponse = buildUspsErrorResponse("-2147219302", "Tracking number not found");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("INVALIDTRACKING");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle per-tracking-number error", async () => {
      const trackInfoWithError = {
        _ID: "INVALIDTRACKING",
        Error: {
          Number: "-2147219302",
          Description: "A valid tracking number was not provided.",
        },
      };
      const xmlResponse = buildUspsXmlResponse(trackInfoWithError);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("INVALIDTRACKING");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
      }
    });

    it("should handle missing credentials", async () => {
      delete process.env.USPS_USER_ID;

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTH_FAILED");
        expect(result.error.message).toContain("USPS_USER_ID");
      }
    });

    it("should handle invalid XML response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "not valid xml <><><<",
      });

      const result = await adapter.track("9400111899223456789012");

      // fast-xml-parser may parse some invalid XML, but the schema validation should fail
      expect(result.success).toBe(false);
    });

    it("should handle empty TrackInfo", async () => {
      const emptyResponse = xmlBuilder.build({
        TrackResponse: {
          TrackInfo: null,
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => emptyResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
      }
    });

    it("should parse expected delivery date correctly", async () => {
      const xmlResponse = buildUspsXmlResponse(sampleInTransitTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expectedDeliveryDate).toBeInstanceOf(Date);
        const expected = result.data.expectedDeliveryDate!;
        expect(expected.getFullYear()).toBe(2026);
        expect(expected.getMonth()).toBe(1); // February
        expect(expected.getDate()).toBe(10);
      }
    });

    it("should sort events by timestamp descending (most recent first)", async () => {
      const xmlResponse = buildUspsXmlResponse(sampleInTransitTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        const events = result.data.events;
        expect(events.length).toBeGreaterThan(1);

        for (let i = 0; i < events.length - 1; i++) {
          expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            events[i + 1].timestamp.getTime()
          );
        }
      }
    });

    it("should handle single TrackDetail (not array)", async () => {
      const singleDetailTrackInfo = {
        ...sampleInTransitTrackInfo,
        TrackDetail: sampleInTransitTrackInfo.TrackDetail[0], // Single object, not array
      };
      const xmlResponse = buildUspsXmlResponse(singleDetailTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.events).toHaveLength(2); // 1 summary + 1 detail
      }
    });

    it("should handle TrackSummary as string", async () => {
      const stringTrackSummary = {
        ...sampleInTransitTrackInfo,
        TrackSummary: "Your item departed MEMPHIS, TN at 2:30 pm on February 6, 2026",
      };
      const xmlResponse = buildUspsXmlResponse(stringTrackSummary);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      // Should still succeed, using Status field for current status
      expect(result.success).toBe(true);
    });

    it("should handle Available for Pickup as delivered", async () => {
      const pickupTrackInfo = {
        ...sampleInTransitTrackInfo,
        Status: "Available for Pickup",
        StatusCategory: "Delivered",
      };
      const xmlResponse = buildUspsXmlResponse(pickupTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDelivered).toBe(true);
      }
    });

    it("should include correct URL parameters in request", async () => {
      const xmlResponse = buildUspsXmlResponse(sampleInTransitTrackInfo);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      await adapter.track("9400111899223456789012");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("API=TrackV2");
      expect(calledUrl).toContain("XML=");
      expect(calledUrl).toContain("9400111899223456789012");
    });

    it("should parse dates with AM/PM correctly", async () => {
      const trackInfoWithAMPM = {
        ...sampleInTransitTrackInfo,
        TrackSummary: {
          EventTime: "10:30 am",
          EventDate: "February 6, 2026",
          Event: "Morning event",
          EventCity: "MEMPHIS",
          EventState: "TN",
          EventCode: "RH",
        },
      };
      const xmlResponse = buildUspsXmlResponse(trackInfoWithAMPM);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => xmlResponse,
      });

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(true);
      if (result.success) {
        const lastEvent = result.data.events[0];
        expect(lastEvent.timestamp.getHours()).toBe(10);
        expect(lastEvent.timestamp.getMinutes()).toBe(30);
      }
    });

    it("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed: Network unreachable"));

      const result = await adapter.track("9400111899223456789012");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.retryable).toBe(true);
      }
    });
  });

  describe("getTrackingUrl", () => {
    it("should return correct USPS tracking URL", () => {
      const url = adapter.getTrackingUrl("9400111899223456789012");
      expect(url).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223456789012");
    });

    it("should URL encode tracking number", () => {
      const url = adapter.getTrackingUrl("9400 1118 9922 3456 7890 12");
      expect(url).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=9400%201118%209922%203456%207890%2012");
    });
  });

  describe("getUspsAdapter singleton", () => {
    it("should return the same instance", () => {
      const adapter1 = getUspsAdapter();
      const adapter2 = getUspsAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it("should return an instance with carrier USPS", () => {
      const adapter = getUspsAdapter();
      expect(adapter.carrier).toBe("USPS");
    });
  });
});

// Import schema helpers for testing
const { normalizeTrackDetails, normalizeTrackSummary } = await import("../usps.schemas");

describe("USPS schema helper functions", () => {
  describe("normalizeTrackDetails", () => {
    it("should return empty array for null/undefined", () => {
      expect(normalizeTrackDetails(null)).toEqual([]);
      expect(normalizeTrackDetails(undefined)).toEqual([]);
    });

    it("should wrap single object in array", () => {
      const single = { Event: "Test" };
      expect(normalizeTrackDetails(single)).toEqual([single]);
    });

    it("should return array as-is", () => {
      const array = [{ Event: "Test1" }, { Event: "Test2" }];
      expect(normalizeTrackDetails(array)).toEqual(array);
    });
  });

  describe("normalizeTrackSummary", () => {
    it("should return null for null/undefined", () => {
      expect(normalizeTrackSummary(null)).toBe(null);
      expect(normalizeTrackSummary(undefined)).toBe(null);
    });

    it("should wrap string in object with Event field", () => {
      const result = normalizeTrackSummary("Test summary");
      expect(result).toEqual({ Event: "Test summary" });
    });

    it("should return object as-is", () => {
      const obj = { Event: "Test", EventCity: "NYC" };
      expect(normalizeTrackSummary(obj)).toBe(obj);
    });
  });
});
