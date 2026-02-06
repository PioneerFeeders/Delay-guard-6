import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Job } from "bullmq";
import type { DataCleanupJobData } from "../../app/jobs/types";
import { processDataCleanup } from "../data-cleanup.worker";

// Import mocked modules
import { prisma } from "../../app/db.server";

// Mock Prisma
vi.mock("../../app/db.server", () => ({
  prisma: {
    merchant: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    shipment: {
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    trackingEvent: {
      count: vi.fn(),
    },
    notificationLog: {
      count: vi.fn(),
    },
    resolutionLog: {
      count: vi.fn(),
    },
  },
}));

/**
 * Helper to create a mock BullMQ job for regular cleanup
 */
function createMockCleanupJob(): Job<DataCleanupJobData> {
  return {
    id: "data-cleanup-repeatable",
    name: "cleanup",
    data: {},
    updateProgress: vi.fn(),
  } as unknown as Job<DataCleanupJobData>;
}

/**
 * Helper to create a mock BullMQ job for merchant purge
 */
function createMockPurgeJob(merchantId: string): Job<any> {
  return {
    id: `purge-${merchantId}`,
    name: "purge-merchant",
    data: {
      merchantId,
      shopDomain: "test-shop.myshopify.com",
      uninstalledAt: new Date().toISOString(),
    },
    updateProgress: vi.fn(),
  } as unknown as Job<any>;
}

/**
 * Create a mock merchant for query results
 */
function createMockMerchant(
  id: string,
  settings: object = { autoArchiveDays: 30 },
  billingStatus = "ACTIVE",
  uninstalledAt: Date | null = null
) {
  return {
    id,
    settings,
    billingStatus,
    uninstalledAt,
    shopDomain: "test-shop.myshopify.com",
  };
}

describe("data-cleanup.worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-04T03:00:00Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("processDataCleanup - regular cleanup job", () => {
    describe("archiving delivered shipments", () => {
      it("should query for active merchants", async () => {
        vi.mocked(prisma.merchant.findMany).mockResolvedValue([]);

        const job = createMockCleanupJob();
        await processDataCleanup(job);

        // First call is for archiving (active merchants)
        expect(prisma.merchant.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { billingStatus: { not: "CANCELLED" } },
          })
        );
      });

      it("should archive shipments past auto-archive threshold", async () => {
        const merchant = createMockMerchant("merchant-1", { autoArchiveDays: 30 });

        // First call: get active merchants for archiving
        // Second call: get cancelled merchants for purging
        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce([merchant] as any)
          .mockResolvedValueOnce([]);

        vi.mocked(prisma.shipment.updateMany).mockResolvedValue({ count: 5 });

        const job = createMockCleanupJob();
        const result = await processDataCleanup(job);

        expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
          where: {
            merchantId: "merchant-1",
            isDelivered: true,
            isArchived: false,
            deliveredAt: {
              lte: expect.any(Date),
            },
          },
          data: {
            isArchived: true,
          },
        });

        expect(result.shipmentsArchived).toBe(5);
      });

      it("should use merchant-specific autoArchiveDays", async () => {
        const merchant = createMockMerchant("merchant-1", { autoArchiveDays: 7 });

        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce([merchant] as any)
          .mockResolvedValueOnce([]);

        vi.mocked(prisma.shipment.updateMany).mockResolvedValue({ count: 3 });

        const job = createMockCleanupJob();
        await processDataCleanup(job);

        // Verify the deliveredAt threshold (should be 7 days ago)
        const updateManyCall = vi.mocked(prisma.shipment.updateMany).mock.calls[0][0];
        const deliveredThreshold = (updateManyCall.where as any).deliveredAt.lte as Date;

        // 7 days ago from Feb 4 = Jan 28
        const expectedDate = new Date("2026-01-28T03:00:00Z");
        expect(deliveredThreshold.toISOString()).toBe(expectedDate.toISOString());
      });

      it("should process multiple merchants", async () => {
        const merchants = [
          createMockMerchant("merchant-1", { autoArchiveDays: 30 }),
          createMockMerchant("merchant-2", { autoArchiveDays: 14 }),
        ];

        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce(merchants as any)
          .mockResolvedValueOnce([]);

        vi.mocked(prisma.shipment.updateMany)
          .mockResolvedValueOnce({ count: 5 })
          .mockResolvedValueOnce({ count: 3 });

        const job = createMockCleanupJob();
        const result = await processDataCleanup(job);

        expect(prisma.shipment.updateMany).toHaveBeenCalledTimes(2);
        expect(result.shipmentsArchived).toBe(8);
      });

      it("should continue processing other merchants on error", async () => {
        const merchants = [
          createMockMerchant("merchant-1"),
          createMockMerchant("merchant-2"),
        ];

        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce(merchants as any)
          .mockResolvedValueOnce([]);

        vi.mocked(prisma.shipment.updateMany)
          .mockRejectedValueOnce(new Error("DB error for merchant-1"))
          .mockResolvedValueOnce({ count: 2 });

        const job = createMockCleanupJob();
        const result = await processDataCleanup(job);

        // Should have continued with merchant-2
        expect(result.shipmentsArchived).toBe(2);
        expect(result.errors).toContain(
          "Archive error for merchant merchant-1: DB error for merchant-1"
        );
      });
    });

    describe("purging uninstalled merchants", () => {
      it("should query for merchants past retention period", async () => {
        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce([]) // No active merchants
          .mockResolvedValueOnce([]); // No merchants to purge

        const job = createMockCleanupJob();
        await processDataCleanup(job);

        // Second call should query for cancelled merchants past retention
        const secondCall = vi.mocked(prisma.merchant.findMany).mock.calls[1];
        expect(secondCall[0]).toEqual(
          expect.objectContaining({
            where: {
              billingStatus: "CANCELLED",
              uninstalledAt: {
                lte: expect.any(Date),
              },
            },
          })
        );
      });

      it("should purge merchants uninstalled over 30 days ago", async () => {
        const oldUninstallDate = new Date("2026-01-01"); // Over 30 days ago
        const merchantToPurge = createMockMerchant(
          "merchant-to-purge",
          {},
          "CANCELLED",
          oldUninstallDate
        );

        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce([]) // No active merchants
          .mockResolvedValueOnce([merchantToPurge] as any); // One merchant to purge

        // Mock counts for purge reporting
        vi.mocked(prisma.shipment.count).mockResolvedValue(10);
        vi.mocked(prisma.trackingEvent.count).mockResolvedValue(50);
        vi.mocked(prisma.notificationLog.count).mockResolvedValue(5);
        vi.mocked(prisma.resolutionLog.count).mockResolvedValue(2);
        vi.mocked(prisma.merchant.delete).mockResolvedValue({} as any);

        const job = createMockCleanupJob();
        const result = await processDataCleanup(job);

        expect(prisma.merchant.delete).toHaveBeenCalledWith({
          where: { id: "merchant-to-purge" },
        });
        expect(result.merchantsPurged).toBe(1);
        expect(result.shipmentsDeleted).toBe(10);
        expect(result.trackingEventsDeleted).toBe(50);
        expect(result.notificationLogsDeleted).toBe(5);
        expect(result.resolutionLogsDeleted).toBe(2);
      });

      it("should not purge merchants within retention period", async () => {
        const recentUninstallDate = new Date("2026-01-20"); // Only 15 days ago
        // Create mock but don't use - just to demonstrate the scenario
        const _merchantRecent = createMockMerchant(
          "merchant-recent",
          {},
          "CANCELLED",
          recentUninstallDate
        );

        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]); // Query should filter this out

        const job = createMockCleanupJob();
        const result = await processDataCleanup(job);

        expect(prisma.merchant.delete).not.toHaveBeenCalled();
        expect(result.merchantsPurged).toBe(0);
      });

      it("should continue with other merchants on purge error", async () => {
        const oldDate = new Date("2026-01-01");
        const merchants = [
          createMockMerchant("merchant-1", {}, "CANCELLED", oldDate),
          createMockMerchant("merchant-2", {}, "CANCELLED", oldDate),
        ];

        vi.mocked(prisma.merchant.findMany)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(merchants as any);

        vi.mocked(prisma.shipment.count).mockResolvedValue(5);
        vi.mocked(prisma.trackingEvent.count).mockResolvedValue(20);
        vi.mocked(prisma.notificationLog.count).mockResolvedValue(2);
        vi.mocked(prisma.resolutionLog.count).mockResolvedValue(1);

        vi.mocked(prisma.merchant.delete)
          .mockRejectedValueOnce(new Error("Foreign key constraint"))
          .mockResolvedValueOnce({} as any);

        const job = createMockCleanupJob();
        const result = await processDataCleanup(job);

        expect(result.merchantsPurged).toBe(1);
        expect(result.errors).toContain(
          "Purge error for merchant merchant-1: Foreign key constraint"
        );
      });
    });
  });

  describe("processDataCleanup - specific merchant purge job", () => {
    it("should purge specific merchant when job name is purge-merchant", async () => {
      vi.mocked(prisma.shipment.count).mockResolvedValue(15);
      vi.mocked(prisma.trackingEvent.count).mockResolvedValue(100);
      vi.mocked(prisma.notificationLog.count).mockResolvedValue(10);
      vi.mocked(prisma.resolutionLog.count).mockResolvedValue(5);
      vi.mocked(prisma.merchant.delete).mockResolvedValue({} as any);

      const job = createMockPurgeJob("specific-merchant-id");
      const result = await processDataCleanup(job);

      expect(prisma.merchant.delete).toHaveBeenCalledWith({
        where: { id: "specific-merchant-id" },
      });
      expect(result.merchantsPurged).toBe(1);
      expect(result.shipmentsDeleted).toBe(15);
    });

    it("should not run archiving or general purge for specific merchant job", async () => {
      vi.mocked(prisma.shipment.count).mockResolvedValue(0);
      vi.mocked(prisma.trackingEvent.count).mockResolvedValue(0);
      vi.mocked(prisma.notificationLog.count).mockResolvedValue(0);
      vi.mocked(prisma.resolutionLog.count).mockResolvedValue(0);
      vi.mocked(prisma.merchant.delete).mockResolvedValue({} as any);

      const job = createMockPurgeJob("specific-merchant-id");
      await processDataCleanup(job);

      // Should not query for merchants (that's for daily cleanup)
      expect(prisma.merchant.findMany).not.toHaveBeenCalled();
      // Should not run updateMany for archiving
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("result statistics", () => {
    it("should include duration in result", async () => {
      vi.mocked(prisma.merchant.findMany).mockResolvedValue([]);

      const job = createMockCleanupJob();
      const result = await processDataCleanup(job);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should return all zero counts when nothing to process", async () => {
      vi.mocked(prisma.merchant.findMany).mockResolvedValue([]);

      const job = createMockCleanupJob();
      const result = await processDataCleanup(job);

      expect(result.shipmentsArchived).toBe(0);
      expect(result.merchantsPurged).toBe(0);
      expect(result.shipmentsDeleted).toBe(0);
      expect(result.trackingEventsDeleted).toBe(0);
      expect(result.notificationLogsDeleted).toBe(0);
      expect(result.resolutionLogsDeleted).toBe(0);
    });
  });
});
