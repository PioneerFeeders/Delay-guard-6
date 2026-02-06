import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FedexTrackingResponse } from "../fedex.schemas";

// Mock Redis connection
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

vi.mock("~/queue.server", () => ({
  getRedisConnection: () => mockRedis,
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Now import the adapter after mocks are set up
const { FedexAdapter, getFedexAdapter } = await import("../fedex.adapter");

describe("FedexAdapter", () => {
  let adapter: InstanceType<typeof FedexAdapter>;

  // Sample successful FedEx response - in transit
  const sampleInTransitResponse: FedexTrackingResponse = {
    transactionId: "test-transaction-123",
    output: {
      completeTrackResults: [
        {
          trackingNumber: "794644790218",
          trackResults: [
            {
              trackingNumberInfo: {
                trackingNumber: "794644790218",
                carrierCode: "FDXG",
              },
              latestStatusDetail: {
                code: "IT",
                derivedCode: "IT",
                statusByLocale: "In transit",
                description: "In transit",
                scanLocation: {
                  address: {
                    city: "Memphis",
                    stateOrProvinceCode: "TN",
                    countryCode: "US",
                  },
                },
              },
              dateAndTimes: [
                {
                  type: "ESTIMATED_DELIVERY",
                  dateTime: "2026-02-10T17:00:00-05:00",
                },
                {
                  type: "SHIP",
                  dateTime: "2026-02-05T08:00:00-05:00",
                },
              ],
              estimatedDeliveryTimeWindow: {
                type: "ESTIMATED_DELIVERY",
                window: {
                  begins: "2026-02-10T09:00:00-05:00",
                  ends: "2026-02-10T17:00:00-05:00",
                },
              },
              serviceDetail: {
                type: "GROUND",
                description: "FedEx Ground",
                shortDescription: "FG",
              },
              scanEvents: [
                {
                  date: "2026-02-06T14:30:00-06:00",
                  derivedStatus: "In transit",
                  eventDescription: "Departed FedEx location",
                  eventType: "DP",
                  scanLocation: {
                    address: {
                      city: "Memphis",
                      stateOrProvinceCode: "TN",
                      countryCode: "US",
                    },
                  },
                },
                {
                  date: "2026-02-06T06:00:00-06:00",
                  derivedStatus: "In transit",
                  eventDescription: "Arrived at FedEx location",
                  eventType: "AR",
                  scanLocation: {
                    address: {
                      city: "Memphis",
                      stateOrProvinceCode: "TN",
                      countryCode: "US",
                    },
                  },
                },
                {
                  date: "2026-02-05T08:00:00-05:00",
                  derivedStatus: "Picked up",
                  eventDescription: "Picked up",
                  eventType: "PU",
                  scanLocation: {
                    address: {
                      city: "Chicago",
                      stateOrProvinceCode: "IL",
                      countryCode: "US",
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  // Sample delivered response
  const sampleDeliveredResponse: FedexTrackingResponse = {
    transactionId: "test-transaction-456",
    output: {
      completeTrackResults: [
        {
          trackingNumber: "794644790218",
          trackResults: [
            {
              trackingNumberInfo: {
                trackingNumber: "794644790218",
                carrierCode: "FDXG",
              },
              latestStatusDetail: {
                code: "DL",
                derivedCode: "DL",
                statusByLocale: "Delivered",
                description: "Delivered",
                scanLocation: {
                  address: {
                    city: "Miami",
                    stateOrProvinceCode: "FL",
                    countryCode: "US",
                  },
                },
              },
              dateAndTimes: [
                {
                  type: "ACTUAL_DELIVERY",
                  dateTime: "2026-02-10T10:25:00-05:00",
                },
              ],
              scanEvents: [
                {
                  date: "2026-02-10T10:25:00-05:00",
                  derivedStatus: "Delivered",
                  eventDescription: "Delivered",
                  eventType: "DL",
                  scanLocation: {
                    address: {
                      city: "Miami",
                      stateOrProvinceCode: "FL",
                      countryCode: "US",
                    },
                  },
                },
              ],
              deliveryDetails: {
                receivedByName: "JSMITH",
              },
            },
          ],
        },
      ],
    },
  };

  // Sample exception response
  const sampleExceptionResponse: FedexTrackingResponse = {
    transactionId: "test-transaction-789",
    output: {
      completeTrackResults: [
        {
          trackingNumber: "794644790218",
          trackResults: [
            {
              trackingNumberInfo: {
                trackingNumber: "794644790218",
                carrierCode: "FDXE",
              },
              latestStatusDetail: {
                code: "DE",
                derivedCode: "DE",
                statusByLocale: "Delivery exception",
                description: "Delivery exception - Customer not available or business closed",
                scanLocation: {
                  address: {
                    city: "Boston",
                    stateOrProvinceCode: "MA",
                    countryCode: "US",
                  },
                },
                ancillaryDetails: [
                  {
                    reason: "CUSTOMER_UNAVAILABLE",
                    reasonDescription: "Customer not available",
                    actionDescription: "Delivery will be attempted next business day",
                  },
                ],
              },
              delayDetail: {
                type: "WEATHER",
                subType: "SEVERE_WEATHER",
                status: "DELAYED",
              },
              scanEvents: [
                {
                  date: "2026-02-10T15:00:00-05:00",
                  derivedStatus: "Exception",
                  eventDescription: "Delivery exception",
                  eventType: "DE",
                  exceptionCode: "A1",
                  exceptionDescription: "Customer not available",
                  scanLocation: {
                    address: {
                      city: "Boston",
                      stateOrProvinceCode: "MA",
                      countryCode: "US",
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  beforeEach(() => {
    adapter = new FedexAdapter();
    vi.clearAllMocks();

    // Setup environment variables
    process.env.FEDEX_CLIENT_ID = "test-client-id";
    process.env.FEDEX_CLIENT_SECRET = "test-client-secret";

    // Default: No cached token
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
  });

  afterEach(() => {
    delete process.env.FEDEX_CLIENT_ID;
    delete process.env.FEDEX_CLIENT_SECRET;
  });

  describe("track", () => {
    it("should track a package successfully", async () => {
      // Mock token response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        // Mock track API response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleInTransitResponse,
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trackingNumber).toBe("794644790218");
        expect(result.data.carrier).toBe("FEDEX");
        expect(result.data.currentStatus).toBe("In transit");
        expect(result.data.isDelivered).toBe(false);
        expect(result.data.isException).toBe(false);
        expect(result.data.events).toHaveLength(3);
        expect(result.data.lastScanLocation).toBe("Memphis, TN, US");
      }
    });

    it("should detect delivered status", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleDeliveredResponse,
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDelivered).toBe(true);
        expect(result.data.currentStatus).toBe("Delivered");
        expect(result.data.deliveredAt).toBeInstanceOf(Date);
      }
    });

    it("should detect exception status from delayDetail", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleExceptionResponse,
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isException).toBe(true);
        expect(result.data.exceptionCode).toBeTruthy();
        expect(result.data.exceptionReason).toBeTruthy();
      }
    });

    it("should detect exception status from status keywords", async () => {
      const exceptionByKeywordResponse: FedexTrackingResponse = {
        transactionId: "test",
        output: {
          completeTrackResults: [
            {
              trackingNumber: "794644790218",
              trackResults: [
                {
                  latestStatusDetail: {
                    code: "SE",
                    statusByLocale: "Package delayed - weather conditions",
                  },
                  scanEvents: [],
                },
              ],
            },
          ],
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => exceptionByKeywordResponse,
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isException).toBe(true);
      }
    });

    it("should use cached token when available", async () => {
      const cachedToken = JSON.stringify({
        accessToken: "cached-token",
        expiresAt: Date.now() + 3600000,
      });
      mockRedis.get.mockResolvedValue(cachedToken);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleInTransitResponse,
      });

      await adapter.track("794644790218");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("track/v1/trackingnumbers"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer cached-token",
          }),
        })
      );
    });

    it("should refresh token when cache is expired", async () => {
      const expiredToken = JSON.stringify({
        accessToken: "expired-token",
        expiresAt: Date.now() - 1000,
      });
      mockRedis.get.mockResolvedValue(expiredToken);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "new-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleInTransitResponse,
        });

      await adapter.track("794644790218");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should handle rate limiting with retryable error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "Rate limit exceeded",
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("RATE_LIMITED");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("should handle tracking not found from alerts", async () => {
      const notFoundResponse: FedexTrackingResponse = {
        transactionId: "test",
        alerts: [
          {
            code: "TRACKING.TRACKINGNUMBER.NOTFOUND",
            message: "Tracking number cannot be found",
            alertType: "ERROR",
          },
        ],
        output: {
          completeTrackResults: [],
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => notFoundResponse,
        });

      const result = await adapter.track("INVALID123");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle auth failure and clear token cache", async () => {
      const cachedToken = JSON.stringify({
        accessToken: "invalid-token",
        expiresAt: Date.now() + 3600000,
      });
      mockRedis.get.mockResolvedValue(cachedToken);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTH_FAILED");
        expect(result.error.retryable).toBe(true);
      }
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it("should handle API errors with retryable flag for server errors", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("API_ERROR");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("should handle invalid JSON response", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("Invalid JSON");
          },
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PARSE_ERROR");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle missing credentials", async () => {
      delete process.env.FEDEX_CLIENT_ID;
      delete process.env.FEDEX_CLIENT_SECRET;

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTH_FAILED");
      }
    });

    it("should handle OAuth token fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Invalid credentials",
      });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTH_FAILED");
      }
    });

    it("should handle empty track results", async () => {
      const emptyResponse: FedexTrackingResponse = {
        transactionId: "test",
        output: {
          completeTrackResults: [
            {
              trackingNumber: "794644790218",
              trackResults: [],
            },
          ],
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => emptyResponse,
        });

      const result = await adapter.track("794644790218");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
      }
    });

    it("should parse expected delivery date correctly", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleInTransitResponse,
        });

      const result = await adapter.track("794644790218");

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
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleInTransitResponse,
        });

      const result = await adapter.track("794644790218");

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

    it("should send correct request body", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "test-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => sampleInTransitResponse,
        });

      await adapter.track("794644790218");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const trackCall = mockFetch.mock.calls[1];
      const body = JSON.parse(trackCall[1].body);
      expect(body.includeDetailedScans).toBe(true);
      expect(body.trackingInfo[0].trackingNumberInfo.trackingNumber).toBe("794644790218");
    });
  });

  describe("getTrackingUrl", () => {
    it("should return correct FedEx tracking URL", () => {
      const url = adapter.getTrackingUrl("794644790218");
      expect(url).toBe("https://www.fedex.com/fedextrack/?trknbr=794644790218");
    });

    it("should URL encode tracking number", () => {
      const url = adapter.getTrackingUrl("794 644 790218");
      expect(url).toBe("https://www.fedex.com/fedextrack/?trknbr=794%20644%20790218");
    });
  });

  describe("getFedexAdapter singleton", () => {
    it("should return the same instance", () => {
      const adapter1 = getFedexAdapter();
      const adapter2 = getFedexAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it("should return an instance with carrier FEDEX", () => {
      const adapter = getFedexAdapter();
      expect(adapter.carrier).toBe("FEDEX");
    });
  });
});
