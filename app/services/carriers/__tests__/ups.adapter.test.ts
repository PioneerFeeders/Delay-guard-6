import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UpsTrackingResponse } from "../ups.schemas";
import { formatLocation, parseCarrierDate, parseCarrierDateTime } from "../carrier.types";

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
const { UpsAdapter, getUpsAdapter } = await import("../ups.adapter");

describe("UpsAdapter", () => {
  let adapter: InstanceType<typeof UpsAdapter>;

  // Sample successful UPS response
  const sampleSuccessResponse: UpsTrackingResponse = {
    trackResponse: {
      shipment: [
        {
          inquiryNumber: "1Z999AA10123456784",
          package: [
            {
              trackingNumber: "1Z999AA10123456784",
              deliveryDate: [{ type: "ESTIMATED", date: "20260210" }],
              activity: [
                {
                  date: "20260205",
                  time: "143000",
                  location: {
                    address: {
                      city: "Louisville",
                      stateProvince: "KY",
                      country: "US",
                    },
                  },
                  status: {
                    type: "I",
                    code: "DP",
                    description: "Departed Facility",
                  },
                },
                {
                  date: "20260205",
                  time: "100000",
                  location: {
                    address: {
                      city: "Columbus",
                      stateProvince: "OH",
                      country: "US",
                    },
                  },
                  status: {
                    type: "I",
                    code: "AR",
                    description: "Arrived at Facility",
                  },
                },
                {
                  date: "20260204",
                  time: "180000",
                  location: {
                    address: {
                      city: "New York",
                      stateProvince: "NY",
                      country: "US",
                    },
                  },
                  status: {
                    type: "P",
                    code: "PU",
                    description: "Picked Up",
                  },
                },
              ],
              currentStatus: {
                date: "20260205",
                time: "143000",
                location: {
                  address: {
                    city: "Louisville",
                    stateProvince: "KY",
                    country: "US",
                  },
                },
                status: {
                  type: "I",
                  code: "DP",
                  description: "Departed Facility",
                },
              },
            },
          ],
        },
      ],
    },
  };

  // Sample delivered response
  const sampleDeliveredResponse: UpsTrackingResponse = {
    trackResponse: {
      shipment: [
        {
          inquiryNumber: "1Z999AA10123456784",
          package: [
            {
              trackingNumber: "1Z999AA10123456784",
              deliveryDate: [{ type: "ACTUAL", date: "20260210" }],
              activity: [
                {
                  date: "20260210",
                  time: "102500",
                  location: {
                    address: {
                      city: "Miami",
                      stateProvince: "FL",
                      country: "US",
                    },
                  },
                  status: {
                    type: "D",
                    code: "DL",
                    description: "Delivered",
                  },
                },
              ],
              currentStatus: {
                date: "20260210",
                time: "102500",
                location: {
                  address: {
                    city: "Miami",
                    stateProvince: "FL",
                    country: "US",
                  },
                },
                status: {
                  type: "D",
                  code: "DL",
                  description: "Delivered",
                },
              },
            },
          ],
        },
      ],
    },
  };

  // Sample exception response
  const sampleExceptionResponse: UpsTrackingResponse = {
    trackResponse: {
      shipment: [
        {
          inquiryNumber: "1Z999AA10123456784",
          package: [
            {
              trackingNumber: "1Z999AA10123456784",
              deliveryDate: [{ type: "RESCHEDULED", date: "20260212" }],
              activity: [
                {
                  date: "20260210",
                  time: "080000",
                  location: {
                    address: {
                      city: "Chicago",
                      stateProvince: "IL",
                      country: "US",
                    },
                  },
                  status: {
                    type: "X",
                    code: "X1",
                    description: "Severe weather conditions have delayed delivery",
                  },
                },
              ],
              currentStatus: {
                date: "20260210",
                time: "080000",
                location: {
                  address: {
                    city: "Chicago",
                    stateProvince: "IL",
                    country: "US",
                  },
                },
                status: {
                  type: "X",
                  code: "X1",
                  description: "Severe weather conditions have delayed delivery",
                },
              },
            },
          ],
        },
      ],
    },
  };

  beforeEach(() => {
    adapter = new UpsAdapter();
    vi.clearAllMocks();

    // Setup environment variables
    process.env.UPS_CLIENT_ID = "test-client-id";
    process.env.UPS_CLIENT_SECRET = "test-client-secret";

    // Default: No cached token
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
  });

  afterEach(() => {
    delete process.env.UPS_CLIENT_ID;
    delete process.env.UPS_CLIENT_SECRET;
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
          json: async () => sampleSuccessResponse,
        });

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trackingNumber).toBe("1Z999AA10123456784");
        expect(result.data.carrier).toBe("UPS");
        expect(result.data.currentStatus).toBe("In Transit");
        expect(result.data.isDelivered).toBe(false);
        expect(result.data.isException).toBe(false);
        expect(result.data.events).toHaveLength(3);
        expect(result.data.lastScanLocation).toBe("Louisville, KY, US");
      }
    });

    it("should detect delivered status", async () => {
      // Setup token fetch and track API call
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

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDelivered).toBe(true);
        expect(result.data.currentStatus).toBe("Delivered");
        expect(result.data.deliveredAt).toBeInstanceOf(Date);
      }
    });

    it("should detect exception status", async () => {
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

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isException).toBe(true);
        expect(result.data.exceptionCode).toBe("X1");
        expect(result.data.exceptionReason).toContain("weather");
        expect(result.data.currentStatus).toBe("Exception");
      }
    });

    it("should use cached token when available", async () => {
      // Return cached token
      const cachedToken = JSON.stringify({
        accessToken: "cached-token",
        expiresAt: Date.now() + 3600000, // 1 hour from now
      });
      mockRedis.get.mockResolvedValue(cachedToken);

      // Only mock track API (no token request)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleSuccessResponse,
      });

      await adapter.track("1Z999AA10123456784");

      // Should only call fetch once (for tracking, not for token)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("track/v1/details"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer cached-token",
          }),
        })
      );
    });

    it("should refresh token when cache is expired", async () => {
      // Return expired cached token
      const expiredToken = JSON.stringify({
        accessToken: "expired-token",
        expiresAt: Date.now() - 1000, // Expired
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
          json: async () => sampleSuccessResponse,
        });

      await adapter.track("1Z999AA10123456784");

      // Should call fetch twice (token + tracking)
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

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("RATE_LIMITED");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("should handle tracking not found", async () => {
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
          status: 404,
          text: async () => "Tracking number not found",
        });

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle auth failure and clear token cache", async () => {
      // First, set up cached token
      const cachedToken = JSON.stringify({
        accessToken: "invalid-token",
        expiresAt: Date.now() + 3600000,
      });
      mockRedis.get.mockResolvedValue(cachedToken);

      // Return 401 from tracking API
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTH_FAILED");
        expect(result.error.retryable).toBe(true);
      }
      // Should delete cached token
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

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("API_ERROR");
        expect(result.error.retryable).toBe(true); // 5xx errors are retryable
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

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PARSE_ERROR");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle missing credentials", async () => {
      delete process.env.UPS_CLIENT_ID;
      delete process.env.UPS_CLIENT_SECRET;

      const result = await adapter.track("1Z999AA10123456784");

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

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTH_FAILED");
      }
    });

    it("should handle response with warnings indicating tracking not found", async () => {
      const notFoundResponse: UpsTrackingResponse = {
        trackResponse: {
          shipment: [
            {
              inquiryNumber: "1Z999AA10123456784",
              warnings: [
                {
                  code: "TW0001",
                  message: "Tracking number not found",
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
          json: async () => notFoundResponse,
        });

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TRACKING_NOT_FOUND");
      }
    });

    it("should handle empty shipment array", async () => {
      const emptyResponse: UpsTrackingResponse = {
        trackResponse: {
          shipment: [],
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

      const result = await adapter.track("1Z999AA10123456784");

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
          json: async () => sampleSuccessResponse,
        });

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expectedDeliveryDate).toBeInstanceOf(Date);
        // Check the date is February 10, 2026
        const expected = result.data.expectedDeliveryDate!;
        expect(expected.getFullYear()).toBe(2026);
        expect(expected.getMonth()).toBe(1); // February is month 1
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
          json: async () => sampleSuccessResponse,
        });

      const result = await adapter.track("1Z999AA10123456784");

      expect(result.success).toBe(true);
      if (result.success) {
        const events = result.data.events;
        expect(events.length).toBeGreaterThan(1);

        // Verify events are sorted by timestamp descending
        for (let i = 0; i < events.length - 1; i++) {
          expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            events[i + 1].timestamp.getTime()
          );
        }
      }
    });
  });

  describe("getTrackingUrl", () => {
    it("should return correct UPS tracking URL", () => {
      const url = adapter.getTrackingUrl("1Z999AA10123456784");
      expect(url).toBe("https://www.ups.com/track?tracknum=1Z999AA10123456784");
    });

    it("should URL encode tracking number", () => {
      const url = adapter.getTrackingUrl("1Z 999 AA1");
      expect(url).toBe("https://www.ups.com/track?tracknum=1Z%20999%20AA1");
    });
  });

  describe("getUpsAdapter singleton", () => {
    it("should return the same instance", () => {
      const adapter1 = getUpsAdapter();
      const adapter2 = getUpsAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it("should return an instance with carrier UPS", () => {
      const adapter = getUpsAdapter();
      expect(adapter.carrier).toBe("UPS");
    });
  });
});

describe("carrier.types helper functions", () => {
  describe("formatLocation", () => {
    it("should format location with all parts", () => {
      expect(formatLocation("New York", "NY", "US")).toBe("New York, NY, US");
    });

    it("should format location with partial parts", () => {
      expect(formatLocation("New York", "NY", null)).toBe("New York, NY");
      expect(formatLocation("New York", null, "US")).toBe("New York, US");
      expect(formatLocation(null, "NY", "US")).toBe("NY, US");
    });

    it("should return null for all empty parts", () => {
      expect(formatLocation(null, null, null)).toBe(null);
      expect(formatLocation(undefined, undefined, undefined)).toBe(null);
    });
  });

  describe("parseCarrierDate", () => {
    it("should parse YYYYMMDD format", () => {
      const date = parseCarrierDate("20260210");
      expect(date).toBeInstanceOf(Date);
      expect(date?.getFullYear()).toBe(2026);
      expect(date?.getMonth()).toBe(1); // February
      expect(date?.getDate()).toBe(10);
    });

    it("should parse ISO 8601 format", () => {
      const date = parseCarrierDate("2026-02-10");
      expect(date).toBeInstanceOf(Date);
      expect(date?.getFullYear()).toBe(2026);
    });

    it("should parse MM/DD/YYYY format", () => {
      const date = parseCarrierDate("02/10/2026");
      expect(date).toBeInstanceOf(Date);
      expect(date?.getFullYear()).toBe(2026);
      expect(date?.getMonth()).toBe(1);
      expect(date?.getDate()).toBe(10);
    });

    it("should return null for invalid dates", () => {
      expect(parseCarrierDate(null)).toBe(null);
      expect(parseCarrierDate(undefined)).toBe(null);
      expect(parseCarrierDate("invalid")).toBe(null);
    });
  });

  describe("parseCarrierDateTime", () => {
    it("should parse date and HHMMSS time", () => {
      const dt = parseCarrierDateTime("20260210", "143025");
      expect(dt).toBeInstanceOf(Date);
      expect(dt?.getHours()).toBe(14);
      expect(dt?.getMinutes()).toBe(30);
      expect(dt?.getSeconds()).toBe(25);
    });

    it("should parse date and HH:MM:SS time", () => {
      const dt = parseCarrierDateTime("20260210", "14:30:25");
      expect(dt).toBeInstanceOf(Date);
      expect(dt?.getHours()).toBe(14);
      expect(dt?.getMinutes()).toBe(30);
    });

    it("should parse date and HH:MM time", () => {
      const dt = parseCarrierDateTime("20260210", "14:30");
      expect(dt).toBeInstanceOf(Date);
      expect(dt?.getHours()).toBe(14);
      expect(dt?.getMinutes()).toBe(30);
    });

    it("should return date only when time is null", () => {
      const dt = parseCarrierDateTime("20260210", null);
      expect(dt).toBeInstanceOf(Date);
    });

    it("should return null for invalid date", () => {
      expect(parseCarrierDateTime(null, "143025")).toBe(null);
    });
  });
});
