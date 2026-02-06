import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Job, Queue } from "bullmq";
import type { PollSchedulerJobData } from "../../app/jobs/types";
import { processPollScheduler } from "../poll-scheduler.worker";

// Import mocked modules
import { prisma } from "../../app/db.server";
import { getQueue } from "../../app/queue.server";

// Mock Prisma
vi.mock("../../app/db.server", () => ({
  prisma: {
    shipment: {
      findMany: vi.fn(),
    },
  },
}));

// Mock queue.server
vi.mock("../../app/queue.server", () => ({
  getQueue: vi.fn(),
}));

/**
 * Helper to create a mock BullMQ job
 */
function createMockJob(): Job<PollSchedulerJobData> {
  return {
    id: "poll-scheduler-repeatable",
    name: "schedule",
    data: {},
    updateProgress: vi.fn(),
  } as unknown as Job<PollSchedulerJobData>;
}

/**
 * Helper to create a mock queue
 */
function createMockQueue(): Partial<Queue> {
  return {
    addBulk: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Create a mock shipment for query results
 */
function createMockShipmentForQuery(id: string, expectedDeliveryDate: Date | null) {
  return {
    id,
    expectedDeliveryDate,
  };
}

describe("poll-scheduler.worker", () => {
  let mockQueue: Partial<Queue>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-04T12:00:00Z"));
    vi.clearAllMocks();

    mockQueue = createMockQueue();
    vi.mocked(getQueue).mockReturnValue(mockQueue as Queue);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("processPollScheduler", () => {
    it("should query for shipments due for polling", async () => {
      vi.mocked(prisma.shipment.findMany).mockResolvedValue([]);

      const job = createMockJob();
      await processPollScheduler(job);

      expect(prisma.shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nextPollAt: { lte: expect.any(Date) },
            isDelivered: false,
            isArchived: false,
            carrier: { not: "UNKNOWN" },
            merchant: {
              billingStatus: { not: "CANCELLED" },
              shopFrozen: false,
            },
          }),
        })
      );
    });

    it("should return zero counts when no shipments due", async () => {
      vi.mocked(prisma.shipment.findMany).mockResolvedValue([]);

      const job = createMockJob();
      const result = await processPollScheduler(job);

      expect(result.shipmentsFound).toBe(0);
      expect(result.jobsEnqueued).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("should enqueue poll jobs for due shipments", async () => {
      const mockShipments = [
        createMockShipmentForQuery("shipment-1", new Date("2026-02-05")),
        createMockShipmentForQuery("shipment-2", new Date("2026-02-06")),
        createMockShipmentForQuery("shipment-3", null),
      ];

      vi.mocked(prisma.shipment.findMany).mockResolvedValue(mockShipments as any);
      vi.mocked(mockQueue.addBulk!).mockResolvedValue([
        { id: "poll-shipment-1" },
        { id: "poll-shipment-2" },
        { id: "poll-shipment-3" },
      ] as any);

      const job = createMockJob();
      const result = await processPollScheduler(job);

      expect(result.shipmentsFound).toBe(3);
      expect(result.jobsEnqueued).toBe(3);
      expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
      expect(mockQueue.addBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: "poll",
            data: { shipmentId: "shipment-1" },
            opts: expect.objectContaining({
              jobId: "poll-shipment-1",
            }),
          }),
          expect.objectContaining({
            name: "poll",
            data: { shipmentId: "shipment-2" },
            opts: expect.objectContaining({
              jobId: "poll-shipment-2",
            }),
          }),
          expect.objectContaining({
            name: "poll",
            data: { shipmentId: "shipment-3" },
            opts: expect.objectContaining({
              jobId: "poll-shipment-3",
            }),
          }),
        ])
      );
    });

    it("should assign higher priority to past-due shipments", async () => {
      // Past due shipment
      const mockShipments = [
        createMockShipmentForQuery("shipment-past-due", new Date("2026-02-01")),
        createMockShipmentForQuery("shipment-tomorrow", new Date("2026-02-05")),
        createMockShipmentForQuery("shipment-far-future", new Date("2026-02-15")),
      ];

      vi.mocked(prisma.shipment.findMany).mockResolvedValue(mockShipments as any);
      vi.mocked(mockQueue.addBulk!).mockResolvedValue([
        { id: "poll-shipment-past-due" },
        { id: "poll-shipment-tomorrow" },
        { id: "poll-shipment-far-future" },
      ] as any);

      const job = createMockJob();
      await processPollScheduler(job);

      const addBulkCall = vi.mocked(mockQueue.addBulk!).mock.calls[0][0];

      // Find each job by shipmentId
      const pastDueJob = addBulkCall.find(
        (j: any) => j.data.shipmentId === "shipment-past-due"
      );
      const tomorrowJob = addBulkCall.find(
        (j: any) => j.data.shipmentId === "shipment-tomorrow"
      );
      const futureJob = addBulkCall.find(
        (j: any) => j.data.shipmentId === "shipment-far-future"
      );

      // Lower priority number = higher priority
      expect(pastDueJob?.opts?.priority).toBe(1); // URGENT
      expect(tomorrowJob?.opts?.priority).toBe(2); // HIGH
      expect(futureJob?.opts?.priority).toBe(4); // LOW
    });

    it("should handle batch processing for large result sets", async () => {
      // First batch of 500
      const firstBatch = Array.from({ length: 500 }, (_, i) =>
        createMockShipmentForQuery(`shipment-${i}`, new Date("2026-02-10"))
      );
      // Second batch of 100 (less than batch size = end of results)
      const secondBatch = Array.from({ length: 100 }, (_, i) =>
        createMockShipmentForQuery(`shipment-${500 + i}`, new Date("2026-02-10"))
      );

      vi.mocked(prisma.shipment.findMany)
        .mockResolvedValueOnce(firstBatch as any)
        .mockResolvedValueOnce(secondBatch as any);

      vi.mocked(mockQueue.addBulk!).mockResolvedValue(
        Array.from({ length: 500 }, (_, i) => ({ id: `job-${i}` })) as any
      );

      const job = createMockJob();
      const result = await processPollScheduler(job);

      expect(result.shipmentsFound).toBe(600);
      expect(prisma.shipment.findMany).toHaveBeenCalledTimes(2);
    });

    it("should set truncated flag when hitting max jobs limit", async () => {
      // Create enough mock shipments to exceed max jobs per run (10000)
      const largeResultSet = Array.from({ length: 500 }, (_, i) =>
        createMockShipmentForQuery(`shipment-${i}`, new Date("2026-02-10"))
      );

      // Return full batches repeatedly to simulate exceeding limit
      vi.mocked(prisma.shipment.findMany).mockResolvedValue(largeResultSet as any);
      vi.mocked(mockQueue.addBulk!).mockResolvedValue(
        Array.from({ length: 500 }, (_, i) => ({ id: `job-${i}` })) as any
      );

      const job = createMockJob();
      const result = await processPollScheduler(job);

      // Should have processed up to max limit
      expect(result.truncated).toBe(true);
    });

    it("should handle addBulk errors gracefully", async () => {
      const mockShipments = [
        createMockShipmentForQuery("shipment-1", new Date("2026-02-05")),
      ];

      vi.mocked(prisma.shipment.findMany).mockResolvedValue(mockShipments as any);
      vi.mocked(mockQueue.addBulk!).mockRejectedValue(new Error("Redis connection lost"));

      const job = createMockJob();
      const result = await processPollScheduler(job);

      // Should record the error but continue
      expect(result.errors).toContain("Batch enqueue error: Redis connection lost");
      expect(result.shipmentsFound).toBe(1);
    });

    it("should throw on database errors", async () => {
      vi.mocked(prisma.shipment.findMany).mockRejectedValue(
        new Error("Database connection failed")
      );

      const job = createMockJob();

      await expect(processPollScheduler(job)).rejects.toThrow(
        "Database connection failed"
      );
    });

    it("should include duration in result", async () => {
      vi.mocked(prisma.shipment.findMany).mockResolvedValue([]);

      const job = createMockJob();
      const result = await processPollScheduler(job);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
