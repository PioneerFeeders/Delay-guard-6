import { describe, it, expect } from "vitest";
import {
  ShipmentsQueryParamsSchema,
  parseShipmentsQueryParams,
  safeParseShipmentsQueryParams,
  ShipmentTabSchema,
  DelayStatusSchema,
  SortDirectionSchema,
  ShipmentSortColumnSchema,
} from "../validation";

describe("Shipments Query Parameter Validation", () => {
  describe("ShipmentTabSchema", () => {
    it("should accept valid tab values", () => {
      expect(ShipmentTabSchema.parse("all")).toBe("all");
      expect(ShipmentTabSchema.parse("delayed")).toBe("delayed");
      expect(ShipmentTabSchema.parse("pending")).toBe("pending");
      expect(ShipmentTabSchema.parse("resolved")).toBe("resolved");
      expect(ShipmentTabSchema.parse("delivered")).toBe("delivered");
    });

    it("should reject invalid tab values", () => {
      expect(() => ShipmentTabSchema.parse("invalid")).toThrow();
      expect(() => ShipmentTabSchema.parse("")).toThrow();
    });
  });

  describe("DelayStatusSchema", () => {
    it("should accept valid delay status values", () => {
      expect(DelayStatusSchema.parse("delayed")).toBe("delayed");
      expect(DelayStatusSchema.parse("on_time")).toBe("on_time");
      expect(DelayStatusSchema.parse("pending")).toBe("pending");
    });

    it("should reject invalid delay status values", () => {
      expect(() => DelayStatusSchema.parse("late")).toThrow();
    });
  });

  describe("SortDirectionSchema", () => {
    it("should accept valid sort directions", () => {
      expect(SortDirectionSchema.parse("asc")).toBe("asc");
      expect(SortDirectionSchema.parse("desc")).toBe("desc");
    });

    it("should reject invalid sort directions", () => {
      expect(() => SortDirectionSchema.parse("ascending")).toThrow();
    });
  });

  describe("ShipmentSortColumnSchema", () => {
    it("should accept valid sort columns", () => {
      const validColumns = [
        "orderNumber",
        "trackingNumber",
        "carrier",
        "serviceLevel",
        "customerName",
        "shipDate",
        "expectedDeliveryDate",
        "daysDelayed",
        "orderValue",
        "currentStatus",
        "createdAt",
        "updatedAt",
      ];

      for (const col of validColumns) {
        expect(ShipmentSortColumnSchema.parse(col)).toBe(col);
      }
    });

    it("should reject invalid sort columns", () => {
      expect(() => ShipmentSortColumnSchema.parse("invalidColumn")).toThrow();
    });
  });

  describe("ShipmentsQueryParamsSchema", () => {
    it("should provide default values for empty input", () => {
      const result = ShipmentsQueryParamsSchema.parse({});

      expect(result.tab).toBe("all");
      expect(result.sortBy).toBe("daysDelayed");
      expect(result.sortDir).toBe("desc");
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it("should parse complete query params", () => {
      const result = ShipmentsQueryParamsSchema.parse({
        tab: "delayed",
        carrier: "UPS",
        serviceLevel: "ground",
        delayStatus: "delayed",
        orderValueMin: "10",
        orderValueMax: "100",
        shipDateFrom: "2026-01-01",
        shipDateTo: "2026-02-01",
        locationId: "loc-123",
        sortBy: "shipDate",
        sortDir: "asc",
        page: "2",
        pageSize: "25",
      });

      expect(result.tab).toBe("delayed");
      expect(result.carrier).toBe("UPS");
      expect(result.serviceLevel).toBe("ground");
      expect(result.delayStatus).toBe("delayed");
      expect(result.orderValueMin).toBe(10);
      expect(result.orderValueMax).toBe(100);
      expect(result.shipDateFrom).toBe("2026-01-01");
      expect(result.shipDateTo).toBe("2026-02-01");
      expect(result.locationId).toBe("loc-123");
      expect(result.sortBy).toBe("shipDate");
      expect(result.sortDir).toBe("asc");
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(25);
    });

    it("should coerce numeric strings to numbers", () => {
      const result = ShipmentsQueryParamsSchema.parse({
        page: "5",
        pageSize: "25",
        orderValueMin: "99.99",
        orderValueMax: "199.99",
      });

      expect(result.page).toBe(5);
      expect(result.pageSize).toBe(25);
      expect(result.orderValueMin).toBe(99.99);
      expect(result.orderValueMax).toBe(199.99);
    });

    it("should enforce page minimum of 1", () => {
      expect(() =>
        ShipmentsQueryParamsSchema.parse({ page: "0" })
      ).toThrow();
      expect(() =>
        ShipmentsQueryParamsSchema.parse({ page: "-1" })
      ).toThrow();
    });

    it("should enforce pageSize between 1 and 100", () => {
      expect(() =>
        ShipmentsQueryParamsSchema.parse({ pageSize: "0" })
      ).toThrow();
      expect(() =>
        ShipmentsQueryParamsSchema.parse({ pageSize: "101" })
      ).toThrow();

      const result = ShipmentsQueryParamsSchema.parse({ pageSize: "100" });
      expect(result.pageSize).toBe(100);
    });

    it("should enforce orderValueMin is non-negative", () => {
      expect(() =>
        ShipmentsQueryParamsSchema.parse({ orderValueMin: "-10" })
      ).toThrow();
    });

    it("should accept ISO datetime strings for ship dates", () => {
      const result = ShipmentsQueryParamsSchema.parse({
        shipDateFrom: "2026-01-15T10:30:00+00:00",
        shipDateTo: "2026-02-15T23:59:59-05:00",
      });

      expect(result.shipDateFrom).toBe("2026-01-15T10:30:00+00:00");
      expect(result.shipDateTo).toBe("2026-02-15T23:59:59-05:00");
    });

    it("should accept simple date strings (YYYY-MM-DD)", () => {
      const result = ShipmentsQueryParamsSchema.parse({
        shipDateFrom: "2026-01-15",
        shipDateTo: "2026-02-15",
      });

      expect(result.shipDateFrom).toBe("2026-01-15");
      expect(result.shipDateTo).toBe("2026-02-15");
    });

    it("should accept all carrier values", () => {
      for (const carrier of ["UPS", "FEDEX", "USPS", "UNKNOWN"]) {
        const result = ShipmentsQueryParamsSchema.parse({ carrier });
        expect(result.carrier).toBe(carrier);
      }
    });

    it("should reject invalid carrier values", () => {
      expect(() =>
        ShipmentsQueryParamsSchema.parse({ carrier: "DHL" })
      ).toThrow();
    });
  });

  describe("parseShipmentsQueryParams", () => {
    it("should parse URLSearchParams with all values", () => {
      const params = new URLSearchParams({
        tab: "delayed",
        carrier: "FEDEX",
        page: "3",
        pageSize: "20",
        sortBy: "orderValue",
        sortDir: "desc",
      });

      const result = parseShipmentsQueryParams(params);

      expect(result.tab).toBe("delayed");
      expect(result.carrier).toBe("FEDEX");
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(20);
      expect(result.sortBy).toBe("orderValue");
      expect(result.sortDir).toBe("desc");
    });

    it("should ignore empty string values", () => {
      const params = new URLSearchParams({
        tab: "",
        carrier: "",
        page: "2",
      });

      const result = parseShipmentsQueryParams(params);

      expect(result.tab).toBe("all"); // Default
      expect(result.carrier).toBeUndefined();
      expect(result.page).toBe(2);
    });

    it("should use defaults for missing parameters", () => {
      const params = new URLSearchParams();

      const result = parseShipmentsQueryParams(params);

      expect(result.tab).toBe("all");
      expect(result.sortBy).toBe("daysDelayed");
      expect(result.sortDir).toBe("desc");
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it("should parse order value range filters", () => {
      const params = new URLSearchParams({
        orderValueMin: "50.00",
        orderValueMax: "500.00",
      });

      const result = parseShipmentsQueryParams(params);

      expect(result.orderValueMin).toBe(50);
      expect(result.orderValueMax).toBe(500);
    });

    it("should parse date range filters", () => {
      const params = new URLSearchParams({
        shipDateFrom: "2026-01-01",
        shipDateTo: "2026-01-31",
      });

      const result = parseShipmentsQueryParams(params);

      expect(result.shipDateFrom).toBe("2026-01-01");
      expect(result.shipDateTo).toBe("2026-01-31");
    });

    it("should throw on invalid values", () => {
      const params = new URLSearchParams({
        tab: "invalid-tab",
      });

      expect(() => parseShipmentsQueryParams(params)).toThrow();
    });
  });

  describe("safeParseShipmentsQueryParams", () => {
    it("should return defaults on invalid input", () => {
      const params = new URLSearchParams({
        tab: "invalid",
        page: "not-a-number",
      });

      const result = safeParseShipmentsQueryParams(params);

      expect(result.tab).toBe("all");
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it("should parse valid input normally", () => {
      const params = new URLSearchParams({
        tab: "resolved",
        page: "5",
      });

      const result = safeParseShipmentsQueryParams(params);

      expect(result.tab).toBe("resolved");
      expect(result.page).toBe(5);
    });
  });
});
