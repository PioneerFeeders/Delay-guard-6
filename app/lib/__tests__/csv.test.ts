import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  escapeCSVValue,
  generateCSV,
  generateCSVFilename,
  type ShipmentExportData,
} from "../csv";

describe("csv", () => {
  describe("escapeCSVValue", () => {
    it("should return empty string for null", () => {
      expect(escapeCSVValue(null as unknown as string)).toBe("");
    });

    it("should return empty string for undefined", () => {
      expect(escapeCSVValue(undefined as unknown as string)).toBe("");
    });

    it("should return simple strings unchanged", () => {
      expect(escapeCSVValue("hello")).toBe("hello");
      expect(escapeCSVValue("order123")).toBe("order123");
      expect(escapeCSVValue("John Smith")).toBe("John Smith");
    });

    it("should wrap strings with commas in quotes", () => {
      expect(escapeCSVValue("hello, world")).toBe('"hello, world"');
      expect(escapeCSVValue("123 Main St, Suite 100")).toBe('"123 Main St, Suite 100"');
    });

    it("should escape double quotes by doubling them", () => {
      expect(escapeCSVValue('He said "hello"')).toBe('"He said ""hello"""');
      expect(escapeCSVValue('"quoted"')).toBe('"""quoted"""');
    });

    it("should wrap strings with newlines in quotes", () => {
      expect(escapeCSVValue("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCSVValue("line1\r\nline2")).toBe('"line1\r\nline2"');
    });

    it("should handle strings with multiple special characters", () => {
      expect(escapeCSVValue('Hello, "World"\nNew line')).toBe(
        '"Hello, ""World""\nNew line"'
      );
    });

    it("should convert numbers to strings", () => {
      expect(escapeCSVValue(123 as unknown as string)).toBe("123");
      expect(escapeCSVValue(45.67 as unknown as string)).toBe("45.67");
    });
  });

  describe("generateCSV", () => {
    const mockShipment: ShipmentExportData = {
      id: "test-uuid-1",
      orderNumber: "#1001",
      trackingNumber: "1Z999AA10123456784",
      carrier: "UPS",
      serviceLevel: "Ground",
      customerName: "John Smith",
      customerEmail: "john@example.com",
      customerPhone: "555-123-4567",
      shipDate: new Date("2026-02-01T00:00:00Z"),
      expectedDeliveryDate: new Date("2026-02-05T00:00:00Z"),
      currentStatus: "in_transit",
      isDelayed: false,
      daysDelayed: 0,
      isDelivered: false,
      deliveredAt: null,
      isResolved: false,
      resolvedAt: null,
      resolutionReason: null,
      notificationSent: false,
      notificationSentAt: null,
      orderValue: "99.99",
      lastScanLocation: "Louisville, KY",
      lastScanTime: new Date("2026-02-03T14:30:00Z"),
      fulfillmentLocationName: "Main Warehouse",
      shippingAddress: {
        address1: "123 Main St",
        address2: "Suite 100",
        city: "New York",
        province: "NY",
        zip: "10001",
        country: "US",
      },
    };

    it("should generate CSV with header row", () => {
      const csv = generateCSV([]);
      const lines = csv.split("\r\n");

      expect(lines[0]).toContain("Order Number");
      expect(lines[0]).toContain("Tracking Number");
      expect(lines[0]).toContain("Carrier");
      expect(lines[0]).toContain("Customer Name");
      expect(lines[0]).toContain("Customer Email");
    });

    it("should generate CSV with data rows", () => {
      const csv = generateCSV([mockShipment]);
      const lines = csv.split("\r\n");

      expect(lines.length).toBe(2); // Header + 1 data row

      const dataRow = lines[1];
      expect(dataRow).toContain("#1001");
      expect(dataRow).toContain("1Z999AA10123456784");
      expect(dataRow).toContain("UPS");
      expect(dataRow).toContain("John Smith");
      expect(dataRow).toContain("john@example.com");
    });

    it("should format dates correctly", () => {
      const csv = generateCSV([mockShipment]);
      const lines = csv.split("\r\n");
      const dataRow = lines[1];

      // Ship date should be in YYYY-MM-DD format (may vary by local timezone)
      // Just check that it contains a date pattern
      expect(dataRow).toMatch(/2026-0[12]-\d{2}/); // Ship date
    });

    it("should format carrier names correctly", () => {
      const fedexShipment = { ...mockShipment, carrier: "FEDEX" };
      const uspsShipment = { ...mockShipment, carrier: "USPS" };
      const unknownShipment = { ...mockShipment, carrier: "UNKNOWN" };

      const fedexCsv = generateCSV([fedexShipment]);
      const uspsCsv = generateCSV([uspsShipment]);
      const unknownCsv = generateCSV([unknownShipment]);

      expect(fedexCsv).toContain("FedEx");
      expect(uspsCsv).toContain("USPS");
      expect(unknownCsv).toContain("Unknown");
    });

    it("should format boolean values as Yes/No", () => {
      const delayedShipment = { ...mockShipment, isDelayed: true, daysDelayed: 2 };
      const deliveredShipment = { ...mockShipment, isDelivered: true };

      const csv = generateCSV([mockShipment, delayedShipment, deliveredShipment]);
      const lines = csv.split("\r\n");

      // First data row (not delayed)
      expect(lines[1]).toContain(",No,"); // Delayed = No

      // Second data row (delayed)
      expect(lines[2]).toContain(",Yes,"); // Delayed = Yes
      expect(lines[2]).toContain(",2,"); // Days delayed = 2
    });

    it("should format currency values correctly", () => {
      const csv = generateCSV([mockShipment]);
      const lines = csv.split("\r\n");

      // Should contain formatted currency
      expect(lines[1]).toContain("$99.99");
    });

    it("should format resolution reasons correctly", () => {
      const resolvedShipment = {
        ...mockShipment,
        isResolved: true,
        resolvedAt: new Date("2026-02-04T10:00:00Z"),
        resolutionReason: "PARTIAL_REFUND",
      };

      const csv = generateCSV([resolvedShipment]);
      const lines = csv.split("\r\n");

      expect(lines[1]).toContain("Partial Refund");
    });

    it("should format shipping address as single line", () => {
      const csv = generateCSV([mockShipment]);
      const lines = csv.split("\r\n");

      // Address should be comma-separated in quotes
      expect(lines[1]).toContain('"123 Main St, Suite 100, New York, NY, 10001, US"');
    });

    it("should handle null values gracefully", () => {
      const nullShipment: ShipmentExportData = {
        ...mockShipment,
        serviceLevel: null,
        customerPhone: null,
        expectedDeliveryDate: null,
        orderValue: null,
        lastScanLocation: null,
        lastScanTime: null,
        fulfillmentLocationName: null,
        shippingAddress: null,
      };

      const csv = generateCSV([nullShipment]);
      const lines = csv.split("\r\n");

      // Should not throw and should contain empty values
      expect(lines.length).toBe(2);
      expect(lines[1]).not.toContain("null");
      expect(lines[1]).not.toContain("undefined");
    });

    it("should handle multiple shipments", () => {
      const shipment2: ShipmentExportData = {
        ...mockShipment,
        id: "test-uuid-2",
        orderNumber: "#1002",
        customerName: "Jane Doe",
      };

      const csv = generateCSV([mockShipment, shipment2]);
      const lines = csv.split("\r\n");

      expect(lines.length).toBe(3); // Header + 2 data rows
      expect(lines[1]).toContain("#1001");
      expect(lines[1]).toContain("John Smith");
      expect(lines[2]).toContain("#1002");
      expect(lines[2]).toContain("Jane Doe");
    });

    it("should escape special characters in data", () => {
      const specialShipment: ShipmentExportData = {
        ...mockShipment,
        customerName: 'John "Johnny" Smith',
        shippingAddress: {
          address1: "123 Main St, Apt 1",
          city: "New York",
        },
      };

      const csv = generateCSV([specialShipment]);
      const lines = csv.split("\r\n");

      // Name with quotes should be properly escaped
      expect(lines[1]).toContain('"John ""Johnny"" Smith"');
    });
  });

  describe("generateCSVFilename", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-06T14:30:45Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should generate filename with default prefix", () => {
      const filename = generateCSVFilename();

      // Timestamp may vary by local timezone, just check the pattern
      expect(filename).toMatch(/^shipments_export_2026-02-06_\d{2}-30-45\.csv$/);
    });

    it("should generate filename with custom prefix", () => {
      const filename = generateCSVFilename("delayed");

      // Timestamp may vary by local timezone, just check the pattern
      expect(filename).toMatch(/^delayed_export_2026-02-06_\d{2}-30-45\.csv$/);
    });

    it("should have .csv extension", () => {
      const filename = generateCSVFilename();

      expect(filename).toMatch(/\.csv$/);
    });
  });
});
