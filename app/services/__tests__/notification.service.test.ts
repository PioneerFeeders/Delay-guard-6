import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import after mock setup
import { prisma } from "~/db.server";
import {
  renderTemplate,
  validateTemplate,
  buildTemplateContext,
  extractFirstName,
  formatCarrierName,
  getCarrierTrackingUrl,
  TEMPLATE_VARIABLES,
  REQUIRED_TEMPLATE_VARIABLES,
  type TemplateContext,
} from "../notification.service";

// Mock Prisma
vi.mock("~/db.server", () => ({
  prisma: {
    shipment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    notificationLog: {
      create: vi.fn(),
    },
  },
}));

// Mock Resend
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn(),
    },
  })),
}));

// Get typed mocks (prefixed with _ as they may be used in future tests)
const _mockShipmentFindUnique = prisma.shipment.findUnique as ReturnType<typeof vi.fn>;
const _mockShipmentFindFirst = prisma.shipment.findFirst as ReturnType<typeof vi.fn>;
const _mockShipmentUpdate = prisma.shipment.update as ReturnType<typeof vi.fn>;
const _mockNotificationLogCreate = prisma.notificationLog.create as ReturnType<typeof vi.fn>;

describe("notification.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("extractFirstName", () => {
    it("should extract first name from full name", () => {
      expect(extractFirstName("John Doe")).toBe("John");
    });

    it("should handle single name", () => {
      expect(extractFirstName("John")).toBe("John");
    });

    it("should handle multiple names", () => {
      expect(extractFirstName("John Michael Doe")).toBe("John");
    });

    it("should handle empty string", () => {
      expect(extractFirstName("")).toBe("");
    });

    it("should handle whitespace", () => {
      expect(extractFirstName("  John  Doe  ")).toBe("John");
    });
  });

  describe("formatCarrierName", () => {
    it("should format UPS", () => {
      expect(formatCarrierName("UPS")).toBe("UPS");
      expect(formatCarrierName("ups")).toBe("UPS");
    });

    it("should format FedEx", () => {
      expect(formatCarrierName("FEDEX")).toBe("FedEx");
      expect(formatCarrierName("fedex")).toBe("FedEx");
    });

    it("should format USPS", () => {
      expect(formatCarrierName("USPS")).toBe("USPS");
      expect(formatCarrierName("usps")).toBe("USPS");
    });

    it("should handle UNKNOWN carrier", () => {
      expect(formatCarrierName("UNKNOWN")).toBe("Unknown Carrier");
    });

    it("should return original for unknown carriers", () => {
      expect(formatCarrierName("DHL")).toBe("DHL");
    });
  });

  describe("getCarrierTrackingUrl", () => {
    it("should generate UPS tracking URL", () => {
      const url = getCarrierTrackingUrl("UPS", "1Z999AA10123456784");
      expect(url).toBe(
        "https://www.ups.com/track?tracknum=1Z999AA10123456784"
      );
    });

    it("should generate FedEx tracking URL", () => {
      const url = getCarrierTrackingUrl("FEDEX", "123456789012");
      expect(url).toBe(
        "https://www.fedex.com/fedextrack/?trknbr=123456789012"
      );
    });

    it("should generate USPS tracking URL", () => {
      const url = getCarrierTrackingUrl("USPS", "9400111899223456789012");
      expect(url).toBe(
        "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223456789012"
      );
    });

    it("should handle lowercase carrier names", () => {
      const url = getCarrierTrackingUrl("ups", "1Z999AA10123456784");
      expect(url).toBe(
        "https://www.ups.com/track?tracknum=1Z999AA10123456784"
      );
    });

    it("should return empty string for unknown carriers", () => {
      const url = getCarrierTrackingUrl("UNKNOWN", "123456");
      expect(url).toBe("");
    });

    it("should URL encode tracking numbers", () => {
      const url = getCarrierTrackingUrl("UPS", "1Z999 AA10123456784");
      expect(url).toContain("1Z999%20AA10123456784");
    });
  });

  describe("renderTemplate", () => {
    const sampleContext: TemplateContext = {
      customerFirstName: "John",
      customerFullName: "John Doe",
      orderNumber: "#1001",
      trackingNumber: "1Z999AA10123456784",
      carrierName: "UPS",
      carrierStatus: "In Transit",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      expectedDeliveryDate: "Monday, February 10, 2026",
      shopName: "Test Store",
    };

    it("should replace all template variables", () => {
      const template =
        "Hi {customer_first_name}, your order {order_number} is {carrier_status}.";
      const result = renderTemplate(template, sampleContext);
      expect(result).toBe("Hi John, your order #1001 is In Transit.");
    });

    it("should replace {customer_first_name}", () => {
      const result = renderTemplate("Hello {customer_first_name}!", sampleContext);
      expect(result).toBe("Hello John!");
    });

    it("should replace {customer_full_name}", () => {
      const result = renderTemplate("Dear {customer_full_name},", sampleContext);
      expect(result).toBe("Dear John Doe,");
    });

    it("should replace {order_number}", () => {
      const result = renderTemplate("Order: {order_number}", sampleContext);
      expect(result).toBe("Order: #1001");
    });

    it("should replace {tracking_number}", () => {
      const result = renderTemplate("Tracking: {tracking_number}", sampleContext);
      expect(result).toBe("Tracking: 1Z999AA10123456784");
    });

    it("should replace {carrier_name}", () => {
      const result = renderTemplate("Carrier: {carrier_name}", sampleContext);
      expect(result).toBe("Carrier: UPS");
    });

    it("should replace {carrier_status}", () => {
      const result = renderTemplate("Status: {carrier_status}", sampleContext);
      expect(result).toBe("Status: In Transit");
    });

    it("should replace {tracking_url}", () => {
      const result = renderTemplate("Track here: {tracking_url}", sampleContext);
      expect(result).toBe(
        "Track here: https://www.ups.com/track?tracknum=1Z999AA10123456784"
      );
    });

    it("should replace {expected_delivery_date}", () => {
      const result = renderTemplate(
        "Expected: {expected_delivery_date}",
        sampleContext
      );
      expect(result).toBe("Expected: Monday, February 10, 2026");
    });

    it("should replace {shop_name}", () => {
      const result = renderTemplate("Thanks, {shop_name}", sampleContext);
      expect(result).toBe("Thanks, Test Store");
    });

    it("should replace multiple occurrences of the same variable", () => {
      const template =
        "{order_number} - Your order {order_number} from {shop_name}";
      const result = renderTemplate(template, sampleContext);
      expect(result).toBe(
        "#1001 - Your order #1001 from Test Store"
      );
    });

    it("should leave unrecognized variables unchanged", () => {
      const template = "Hello {unknown_variable}!";
      const result = renderTemplate(template, sampleContext);
      expect(result).toBe("Hello {unknown_variable}!");
    });

    it("should handle template with no variables", () => {
      const template = "Hello, this is a plain message.";
      const result = renderTemplate(template, sampleContext);
      expect(result).toBe("Hello, this is a plain message.");
    });

    it("should handle empty template", () => {
      const result = renderTemplate("", sampleContext);
      expect(result).toBe("");
    });

    it("should handle multiline templates", () => {
      const template = `Hi {customer_first_name},

Your order {order_number} is on its way!

Track it here: {tracking_url}

Thanks,
{shop_name}`;

      const result = renderTemplate(template, sampleContext);
      expect(result).toContain("Hi John,");
      expect(result).toContain("Your order #1001 is on its way!");
      expect(result).toContain(
        "Track it here: https://www.ups.com/track?tracknum=1Z999AA10123456784"
      );
      expect(result).toContain("Thanks,");
      expect(result).toContain("Test Store");
    });
  });

  describe("validateTemplate", () => {
    it("should return valid for template with all required variables", () => {
      const template = "Order {order_number} tracking: {tracking_number}";
      const result = validateTemplate(template);
      expect(result.isValid).toBe(true);
      expect(result.missingVariables).toHaveLength(0);
    });

    it("should return invalid for template missing {tracking_number}", () => {
      const template = "Order {order_number}";
      const result = validateTemplate(template);
      expect(result.isValid).toBe(false);
      expect(result.missingVariables).toContain("{tracking_number}");
    });

    it("should return invalid for template missing {order_number}", () => {
      const template = "Tracking: {tracking_number}";
      const result = validateTemplate(template);
      expect(result.isValid).toBe(false);
      expect(result.missingVariables).toContain("{order_number}");
    });

    it("should return invalid for template missing both required variables", () => {
      const template = "Your package is on the way!";
      const result = validateTemplate(template);
      expect(result.isValid).toBe(false);
      expect(result.missingVariables).toContain("{tracking_number}");
      expect(result.missingVariables).toContain("{order_number}");
      expect(result.missingVariables).toHaveLength(2);
    });

    it("should validate empty template as invalid", () => {
      const result = validateTemplate("");
      expect(result.isValid).toBe(false);
    });

    it("should accept templates with extra variables", () => {
      const template =
        "Hi {customer_first_name}, order {order_number}, tracking {tracking_number}";
      const result = validateTemplate(template);
      expect(result.isValid).toBe(true);
    });
  });

  describe("buildTemplateContext", () => {
    it("should build context from shipment data", () => {
      const shipment = {
        customerName: "John Doe",
        orderNumber: "#1001",
        trackingNumber: "1Z999AA10123456784",
        carrier: "UPS",
        currentStatus: "In Transit",
        lastCarrierStatus: "Out for Delivery",
        expectedDeliveryDate: new Date("2026-02-10T12:00:00Z"),
      };

      const context = buildTemplateContext(shipment, "test-store.myshopify.com");

      expect(context.customerFirstName).toBe("John");
      expect(context.customerFullName).toBe("John Doe");
      expect(context.orderNumber).toBe("#1001");
      expect(context.trackingNumber).toBe("1Z999AA10123456784");
      expect(context.carrierName).toBe("UPS");
      expect(context.carrierStatus).toBe("Out for Delivery");
      expect(context.trackingUrl).toContain("ups.com");
      expect(context.expectedDeliveryDate).toContain("February");
      expect(context.shopName).toBe("Test Store");
    });

    it("should use currentStatus when lastCarrierStatus is null", () => {
      const shipment = {
        customerName: "Jane Smith",
        orderNumber: "#1002",
        trackingNumber: "123456789012",
        carrier: "FEDEX",
        currentStatus: "pending",
        lastCarrierStatus: null,
        expectedDeliveryDate: null,
      };

      const context = buildTemplateContext(shipment, "my-store.myshopify.com");

      expect(context.carrierStatus).toBe("pending");
    });

    it("should handle null expectedDeliveryDate", () => {
      const shipment = {
        customerName: "Jane Smith",
        orderNumber: "#1002",
        trackingNumber: "9400111899223456789012",
        carrier: "USPS",
        currentStatus: "In Transit",
        lastCarrierStatus: null,
        expectedDeliveryDate: null,
      };

      const context = buildTemplateContext(shipment, "my-store.myshopify.com");

      expect(context.expectedDeliveryDate).toBe("Not available");
    });

    it("should format shop name correctly", () => {
      const shipment = {
        customerName: "Test User",
        orderNumber: "#1003",
        trackingNumber: "123",
        carrier: "UPS",
        currentStatus: "In Transit",
        lastCarrierStatus: null,
        expectedDeliveryDate: null,
      };

      // Test hyphenated domain
      let context = buildTemplateContext(
        shipment,
        "my-awesome-store.myshopify.com"
      );
      expect(context.shopName).toBe("My Awesome Store");

      // Test single word domain
      context = buildTemplateContext(shipment, "teststore.myshopify.com");
      expect(context.shopName).toBe("Teststore");
    });
  });

  describe("TEMPLATE_VARIABLES constant", () => {
    it("should contain all expected variables", () => {
      expect(TEMPLATE_VARIABLES).toContain("{customer_first_name}");
      expect(TEMPLATE_VARIABLES).toContain("{customer_full_name}");
      expect(TEMPLATE_VARIABLES).toContain("{order_number}");
      expect(TEMPLATE_VARIABLES).toContain("{tracking_number}");
      expect(TEMPLATE_VARIABLES).toContain("{carrier_name}");
      expect(TEMPLATE_VARIABLES).toContain("{carrier_status}");
      expect(TEMPLATE_VARIABLES).toContain("{tracking_url}");
      expect(TEMPLATE_VARIABLES).toContain("{expected_delivery_date}");
      expect(TEMPLATE_VARIABLES).toContain("{shop_name}");
    });
  });

  describe("REQUIRED_TEMPLATE_VARIABLES constant", () => {
    it("should contain tracking_number and order_number", () => {
      expect(REQUIRED_TEMPLATE_VARIABLES).toContain("{tracking_number}");
      expect(REQUIRED_TEMPLATE_VARIABLES).toContain("{order_number}");
      expect(REQUIRED_TEMPLATE_VARIABLES).toHaveLength(2);
    });
  });

  describe("Integration: renderTemplate with buildTemplateContext", () => {
    it("should properly render the default template", () => {
      const shipment = {
        customerName: "John Doe",
        orderNumber: "#1001",
        trackingNumber: "1Z999AA10123456784",
        carrier: "UPS",
        currentStatus: "pending",
        lastCarrierStatus: "In Transit",
        expectedDeliveryDate: new Date("2026-02-10T12:00:00Z"),
      };

      const context = buildTemplateContext(shipment, "pioneer-feeders.myshopify.com");

      // Note: The default template uses {order_number} directly (not #{order_number})
      // since Shopify order numbers already include the # prefix
      const template = `Hi {customer_first_name},

We wanted to let you know that your recent order ({order_number}) is experiencing a slight delay in transit.

Current Status: {carrier_status}
Carrier: {carrier_name}
Tracking Number: {tracking_number}
Track your package: {tracking_url}

Thank you for your patience!

{shop_name}`;

      const result = renderTemplate(template, context);

      expect(result).toContain("Hi John,");
      expect(result).toContain("order (#1001)");
      expect(result).toContain("Current Status: In Transit");
      expect(result).toContain("Carrier: UPS");
      expect(result).toContain("Tracking Number: 1Z999AA10123456784");
      expect(result).toContain("Track your package: https://www.ups.com/track");
      expect(result).toContain("Pioneer Feeders");
    });
  });
});
