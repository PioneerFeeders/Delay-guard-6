/**
 * Data Cleanup Worker
 *
 * This worker runs daily to:
 * 1. Archive delivered shipments that are past the auto-archive threshold
 * 2. Purge data for merchants who uninstalled more than 30 days ago
 *
 * The worker also handles immediate purge requests for specific merchants
 * (triggered by the delayed job from uninstall webhook).
 */

import type { Job } from "bullmq";
import type { DataCleanupJobData } from "../app/jobs/types";
import type { DataCleanupJobResult } from "../app/jobs/data-cleanup.job";
import { prisma } from "../app/db.server";
import { MerchantSettingsSchema } from "../app/lib/validation";
import {
  DATA_CLEANUP_BATCH_SIZE,
  MERCHANT_DATA_RETENTION_DAYS,
} from "../app/jobs/data-cleanup.job";
import { subDays } from "date-fns";

/**
 * Data for a specific merchant purge job (scheduled 30 days after uninstall)
 */
interface MerchantPurgeJobData {
  merchantId: string;
  shopDomain?: string;
  uninstalledAt?: string;
}

/**
 * Process a data cleanup job
 *
 * Handles two types of jobs:
 * 1. Regular daily cleanup (job name: "cleanup") - archives old shipments and purges merchants past retention
 * 2. Specific merchant purge (job name: "purge-merchant") - purges a specific merchant's data
 *
 * @param job - The BullMQ job
 * @returns Job result with statistics
 */
export async function processDataCleanup(
  job: Job<DataCleanupJobData | MerchantPurgeJobData>
): Promise<DataCleanupJobResult> {
  const startTime = Date.now();
  console.log(`[data-cleanup] Processing job ${job.id} (name: ${job.name})`);

  const result: DataCleanupJobResult = {
    shipmentsArchived: 0,
    merchantsPurged: 0,
    shipmentsDeleted: 0,
    trackingEventsDeleted: 0,
    notificationLogsDeleted: 0,
    resolutionLogsDeleted: 0,
    durationMs: 0,
    errors: [],
  };

  try {
    // Handle specific merchant purge request
    if (job.name === "purge-merchant") {
      const purgeData = job.data as MerchantPurgeJobData;
      console.log(
        `[data-cleanup] Processing merchant purge for ${purgeData.merchantId}`
      );
      await purgeMerchant(purgeData.merchantId, result);
    } else {
      // Regular daily cleanup
      await archiveDeliveredShipments(result);
      await purgeUninstalledMerchants(result);
    }

    result.durationMs = Date.now() - startTime;

    console.log(
      `[data-cleanup] Completed in ${result.durationMs}ms: ` +
        `archived=${result.shipmentsArchived}, merchantsPurged=${result.merchantsPurged}, ` +
        `shipmentsDeleted=${result.shipmentsDeleted}`
    );

    return result;
  } catch (error) {
    result.durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    result.errors?.push(errorMessage);

    console.error(
      `[data-cleanup] Failed after ${result.durationMs}ms:`,
      errorMessage
    );

    // Re-throw to mark job as failed and trigger retry
    throw error;
  }
}

/**
 * Archive delivered shipments that are past the auto-archive threshold.
 * Each merchant can have a different autoArchiveDays setting (default: 30).
 */
async function archiveDeliveredShipments(
  result: DataCleanupJobResult
): Promise<void> {
  console.log("[data-cleanup] Starting delivered shipment archival...");

  const now = new Date();

  // Get all active merchants with their settings
  const merchants = await prisma.merchant.findMany({
    where: {
      billingStatus: { not: "CANCELLED" },
    },
    select: {
      id: true,
      settings: true,
    },
  });

  for (const merchant of merchants) {
    try {
      // Parse merchant settings to get autoArchiveDays
      const settings = MerchantSettingsSchema.parse(merchant.settings);
      const archiveThreshold = subDays(now, settings.autoArchiveDays);

      // Archive delivered shipments in batches
      let totalArchived = 0;
      let hasMore = true;

      while (hasMore) {
        const updated = await prisma.shipment.updateMany({
          where: {
            merchantId: merchant.id,
            isDelivered: true,
            isArchived: false,
            deliveredAt: {
              lte: archiveThreshold,
            },
          },
          data: {
            isArchived: true,
          },
        });

        totalArchived += updated.count;

        // If we updated fewer than the implicit batch limit, we're done
        // Prisma doesn't have explicit batch limits for updateMany, so we check if any were updated
        hasMore = updated.count >= DATA_CLEANUP_BATCH_SIZE;
      }

      if (totalArchived > 0) {
        console.log(
          `[data-cleanup] Archived ${totalArchived} shipments for merchant ${merchant.id}`
        );
      }

      result.shipmentsArchived += totalArchived;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[data-cleanup] Error archiving shipments for merchant ${merchant.id}:`,
        errorMessage
      );
      result.errors?.push(
        `Archive error for merchant ${merchant.id}: ${errorMessage}`
      );
      // Continue with other merchants
    }
  }

  console.log(
    `[data-cleanup] Archival complete: ${result.shipmentsArchived} shipments archived`
  );
}

/**
 * Purge data for merchants who uninstalled more than 30 days ago.
 * This is a safety net in case the delayed purge job didn't run.
 */
async function purgeUninstalledMerchants(
  result: DataCleanupJobResult
): Promise<void> {
  console.log("[data-cleanup] Starting uninstalled merchant purge scan...");

  const retentionCutoff = subDays(new Date(), MERCHANT_DATA_RETENTION_DAYS);

  // Find merchants who uninstalled more than 30 days ago
  const merchantsToPurge = await prisma.merchant.findMany({
    where: {
      billingStatus: "CANCELLED",
      uninstalledAt: {
        lte: retentionCutoff,
      },
    },
    select: {
      id: true,
      shopDomain: true,
      uninstalledAt: true,
    },
  });

  if (merchantsToPurge.length === 0) {
    console.log("[data-cleanup] No merchants due for purge");
    return;
  }

  console.log(
    `[data-cleanup] Found ${merchantsToPurge.length} merchants to purge`
  );

  for (const merchant of merchantsToPurge) {
    await purgeMerchant(merchant.id, result);
  }

  console.log(`[data-cleanup] Purge complete: ${result.merchantsPurged} merchants purged`);
}

/**
 * Purge all data for a specific merchant.
 * Records counts before deletion for reporting.
 */
async function purgeMerchant(
  merchantId: string,
  result: DataCleanupJobResult
): Promise<void> {
  try {
    // Get counts before deletion for reporting
    const [shipmentCount, trackingEventCount, notificationLogCount, resolutionLogCount] =
      await Promise.all([
        prisma.shipment.count({ where: { merchantId } }),
        prisma.trackingEvent.count({
          where: { shipment: { merchantId } },
        }),
        prisma.notificationLog.count({ where: { merchantId } }),
        prisma.resolutionLog.count({
          where: { shipment: { merchantId } },
        }),
      ]);

    console.log(
      `[data-cleanup] Purging merchant ${merchantId}: ` +
        `${shipmentCount} shipments, ${trackingEventCount} tracking events, ` +
        `${notificationLogCount} notifications, ${resolutionLogCount} resolutions`
    );

    // Delete merchant - cascade will delete all related records
    await prisma.merchant.delete({
      where: { id: merchantId },
    });

    result.merchantsPurged += 1;
    result.shipmentsDeleted += shipmentCount;
    result.trackingEventsDeleted += trackingEventCount;
    result.notificationLogsDeleted += notificationLogCount;
    result.resolutionLogsDeleted += resolutionLogCount;

    console.log(`[data-cleanup] Successfully purged merchant ${merchantId}`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(
      `[data-cleanup] Error purging merchant ${merchantId}:`,
      errorMessage
    );
    result.errors?.push(`Purge error for merchant ${merchantId}: ${errorMessage}`);
    // Don't re-throw - continue with other merchants
  }
}
