import { describe, it, expect } from "vitest";
import {
  MerchantSettingsSchema,
  DEFAULT_MERCHANT_SETTINGS,
} from "~/lib/validation";

describe("MerchantSettingsSchema validation", () => {
  describe("delayThresholdHours", () => {
    it("should accept valid values within range (0-72)", () => {
      expect(MerchantSettingsSchema.parse({ delayThresholdHours: 0 }).delayThresholdHours).toBe(0);
      expect(MerchantSettingsSchema.parse({ delayThresholdHours: 8 }).delayThresholdHours).toBe(8);
      expect(MerchantSettingsSchema.parse({ delayThresholdHours: 72 }).delayThresholdHours).toBe(72);
    });

    it("should reject values below minimum", () => {
      expect(() => MerchantSettingsSchema.parse({ delayThresholdHours: -1 })).toThrow();
    });

    it("should reject values above maximum", () => {
      expect(() => MerchantSettingsSchema.parse({ delayThresholdHours: 73 })).toThrow();
    });

    it("should use default value of 8 when not provided", () => {
      expect(MerchantSettingsSchema.parse({}).delayThresholdHours).toBe(8);
    });
  });

  describe("autoArchiveDays", () => {
    it("should accept valid values within range (1-365)", () => {
      expect(MerchantSettingsSchema.parse({ autoArchiveDays: 1 }).autoArchiveDays).toBe(1);
      expect(MerchantSettingsSchema.parse({ autoArchiveDays: 30 }).autoArchiveDays).toBe(30);
      expect(MerchantSettingsSchema.parse({ autoArchiveDays: 365 }).autoArchiveDays).toBe(365);
    });

    it("should reject values below minimum", () => {
      expect(() => MerchantSettingsSchema.parse({ autoArchiveDays: 0 })).toThrow();
    });

    it("should reject values above maximum", () => {
      expect(() => MerchantSettingsSchema.parse({ autoArchiveDays: 366 })).toThrow();
    });

    it("should use default value of 30 when not provided", () => {
      expect(MerchantSettingsSchema.parse({}).autoArchiveDays).toBe(30);
    });
  });

  describe("deliveryWindows", () => {
    it("should accept valid delivery window overrides", () => {
      const settings = MerchantSettingsSchema.parse({
        deliveryWindows: {
          ups_ground: 6,
          fedex_ground: 5,
          usps_priority: 4,
        },
      });
      expect(settings.deliveryWindows.ups_ground).toBe(6);
      expect(settings.deliveryWindows.fedex_ground).toBe(5);
      expect(settings.deliveryWindows.usps_priority).toBe(4);
    });

    it("should default to empty object when not provided", () => {
      expect(MerchantSettingsSchema.parse({}).deliveryWindows).toEqual({});
    });

    it("should accept empty object", () => {
      expect(MerchantSettingsSchema.parse({ deliveryWindows: {} }).deliveryWindows).toEqual({});
    });
  });

  describe("columnVisibility", () => {
    it("should accept custom column visibility array", () => {
      const customColumns = ["orderNumber", "trackingNumber", "carrier"];
      const settings = MerchantSettingsSchema.parse({
        columnVisibility: customColumns,
      });
      expect(settings.columnVisibility).toEqual(customColumns);
    });

    it("should provide default visible columns", () => {
      const defaults = MerchantSettingsSchema.parse({}).columnVisibility;
      expect(defaults).toContain("orderNumber");
      expect(defaults).toContain("trackingNumber");
      expect(defaults).toContain("carrier");
      expect(defaults).toContain("daysDelayed");
    });

    it("should accept empty array", () => {
      expect(MerchantSettingsSchema.parse({ columnVisibility: [] }).columnVisibility).toEqual([]);
    });
  });

  describe("columnOrder", () => {
    it("should accept custom column order array", () => {
      const customOrder = ["trackingNumber", "orderNumber", "carrier"];
      const settings = MerchantSettingsSchema.parse({
        columnOrder: customOrder,
      });
      expect(settings.columnOrder).toEqual(customOrder);
    });

    it("should provide default column order", () => {
      const defaults = MerchantSettingsSchema.parse({}).columnOrder;
      expect(defaults.length).toBeGreaterThan(0);
      expect(defaults[0]).toBe("orderNumber");
    });
  });

  describe("defaultSortColumn", () => {
    it("should accept valid sort column", () => {
      expect(MerchantSettingsSchema.parse({ defaultSortColumn: "shipDate" }).defaultSortColumn).toBe("shipDate");
    });

    it("should use default value of daysDelayed", () => {
      expect(MerchantSettingsSchema.parse({}).defaultSortColumn).toBe("daysDelayed");
    });
  });

  describe("defaultSortDirection", () => {
    it("should accept asc", () => {
      expect(MerchantSettingsSchema.parse({ defaultSortDirection: "asc" }).defaultSortDirection).toBe("asc");
    });

    it("should accept desc", () => {
      expect(MerchantSettingsSchema.parse({ defaultSortDirection: "desc" }).defaultSortDirection).toBe("desc");
    });

    it("should reject invalid values", () => {
      expect(() => MerchantSettingsSchema.parse({ defaultSortDirection: "invalid" })).toThrow();
    });

    it("should use default value of desc", () => {
      expect(MerchantSettingsSchema.parse({}).defaultSortDirection).toBe("desc");
    });
  });

  describe("notificationTemplate", () => {
    it("should accept custom subject and body", () => {
      const settings = MerchantSettingsSchema.parse({
        notificationTemplate: {
          subject: "Custom subject for order #{order_number}",
          body: "Custom body with {tracking_number} and {order_number}",
        },
      });
      expect(settings.notificationTemplate.subject).toBe("Custom subject for order #{order_number}");
      expect(settings.notificationTemplate.body).toContain("{tracking_number}");
    });

    it("should provide default template when not specified", () => {
      const settings = MerchantSettingsSchema.parse({});
      expect(settings.notificationTemplate.subject).toContain("{order_number}");
      expect(settings.notificationTemplate.body).toContain("{tracking_number}");
    });

    it("should handle partial template (only subject)", () => {
      const settings = MerchantSettingsSchema.parse({
        notificationTemplate: {
          subject: "Custom subject",
        },
      });
      expect(settings.notificationTemplate.subject).toBe("Custom subject");
      // Body should get default
      expect(settings.notificationTemplate.body).toContain("{tracking_number}");
    });
  });

  describe("fromEmail", () => {
    it("should accept valid email", () => {
      expect(MerchantSettingsSchema.parse({ fromEmail: "support@store.com" }).fromEmail).toBe("support@store.com");
    });

    it("should accept null", () => {
      expect(MerchantSettingsSchema.parse({ fromEmail: null }).fromEmail).toBeNull();
    });

    it("should reject invalid email format", () => {
      expect(() => MerchantSettingsSchema.parse({ fromEmail: "not-an-email" })).toThrow();
    });

    it("should use default value of null", () => {
      expect(MerchantSettingsSchema.parse({}).fromEmail).toBeNull();
    });
  });

  describe("partial updates (SettingsUpdateSchema)", () => {
    const SettingsUpdateSchema = MerchantSettingsSchema.partial();

    it("should allow partial updates", () => {
      const result = SettingsUpdateSchema.parse({ delayThresholdHours: 12 });
      expect(result.delayThresholdHours).toBe(12);
      expect(result.autoArchiveDays).toBeUndefined();
    });

    it("should validate partial values against constraints", () => {
      expect(() => SettingsUpdateSchema.parse({ delayThresholdHours: -1 })).toThrow();
    });

    it("should allow empty update object", () => {
      expect(SettingsUpdateSchema.parse({})).toEqual({});
    });
  });

  describe("DEFAULT_MERCHANT_SETTINGS", () => {
    it("should have valid default values", () => {
      expect(DEFAULT_MERCHANT_SETTINGS.delayThresholdHours).toBe(8);
      expect(DEFAULT_MERCHANT_SETTINGS.autoArchiveDays).toBe(30);
      expect(DEFAULT_MERCHANT_SETTINGS.defaultSortColumn).toBe("daysDelayed");
      expect(DEFAULT_MERCHANT_SETTINGS.defaultSortDirection).toBe("desc");
      expect(DEFAULT_MERCHANT_SETTINGS.fromEmail).toBeNull();
    });

    it("should have default notification template with required variables", () => {
      expect(DEFAULT_MERCHANT_SETTINGS.notificationTemplate.subject).toContain("{order_number}");
      expect(DEFAULT_MERCHANT_SETTINGS.notificationTemplate.body).toContain("{tracking_number}");
      expect(DEFAULT_MERCHANT_SETTINGS.notificationTemplate.body).toContain("{order_number}");
    });

    it("should have default visible columns", () => {
      const columns = DEFAULT_MERCHANT_SETTINGS.columnVisibility;
      expect(columns).toContain("orderNumber");
      expect(columns).toContain("trackingNumber");
      expect(columns).toContain("carrier");
      expect(columns).toContain("customerName");
      expect(columns).toContain("daysDelayed");
    });
  });

  describe("integration: complete settings object", () => {
    it("should parse a complete valid settings object", () => {
      const fullSettings = {
        delayThresholdHours: 12,
        autoArchiveDays: 60,
        deliveryWindows: {
          ups_ground: 7,
          fedex_ground: 6,
        },
        columnVisibility: ["orderNumber", "trackingNumber", "carrier"],
        columnOrder: ["orderNumber", "trackingNumber", "carrier"],
        defaultSortColumn: "shipDate",
        defaultSortDirection: "asc" as const,
        notificationTemplate: {
          subject: "Update on order #{order_number}",
          body: "Tracking: {tracking_number}\nOrder: {order_number}",
        },
        fromEmail: "support@mystore.com",
      };

      const result = MerchantSettingsSchema.parse(fullSettings);
      expect(result).toEqual(fullSettings);
    });

    it("should fill in defaults for missing fields", () => {
      const partialSettings = {
        delayThresholdHours: 10,
        deliveryWindows: { ups_ground: 4 },
      };

      const result = MerchantSettingsSchema.parse(partialSettings);
      expect(result.delayThresholdHours).toBe(10);
      expect(result.deliveryWindows.ups_ground).toBe(4);
      expect(result.autoArchiveDays).toBe(30); // default
      expect(result.defaultSortColumn).toBe("daysDelayed"); // default
    });
  });
});
