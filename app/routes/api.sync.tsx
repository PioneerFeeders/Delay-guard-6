/**
 * API Route: /api/sync
 *
 * Handles manual sync operations for fulfillments.
 *
 * POST /api/sync - Trigger a sync job
 * GET /api/sync - Get sync status
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { getMerchantByShopId } from "~/services/merchant.service";
import {
  getSyncStatus,
  isSyncInProgress,
} from "~/services/sync.service";
import { enqueueFulfillmentSyncJob, getQueue } from "~/queue.server";
import { QUEUE_FULFILLMENT_SYNC } from "~/jobs/queues";

/**
 * GET /api/sync
 *
 * Returns current sync status for the merchant:
 * - Whether a sync is currently in progress
 * - Total shipments synced
 * - Number of delayed shipments
 * - Last sync job result (if available)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  // Get merchant
  const merchant = await getMerchantByShopId(session.shop);
  if (!merchant) {
    return json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  try {
    // Check if sync is in progress
    const syncInProgress = await isSyncInProgress(merchant.id);

    // Get current sync status
    const status = await getSyncStatus(merchant.id);

    // Try to get the last sync job result
    const queue = getQueue(QUEUE_FULFILLMENT_SYNC);
    const jobId = `sync-${merchant.id}`;
    const lastJob = await queue.getJob(jobId);

    let lastSyncResult = null;
    if (lastJob) {
      const jobState = await lastJob.getState();
      lastSyncResult = {
        state: jobState,
        progress: lastJob.progress,
        result: jobState === "completed" ? lastJob.returnvalue : null,
        failedReason: jobState === "failed" ? lastJob.failedReason : null,
        finishedOn: lastJob.finishedOn,
      };
    }

    return json({
      syncInProgress,
      totalShipments: status.totalShipments,
      delayedShipments: status.delayedShipments,
      lastSyncedAt: status.lastSyncedAt,
      lastSyncResult,
    });
  } catch (error) {
    console.error("[api.sync] Error getting sync status:", error);
    return json(
      { error: "Failed to get sync status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sync
 *
 * Trigger a sync job for the merchant.
 *
 * Request body:
 * - fullSync: boolean (optional) - If true, sync all fulfillments; default: false (last 5 days)
 *
 * Response:
 * - success: boolean
 * - jobId: string (if job was enqueued)
 * - message: string
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  const { session } = await authenticate.admin(request);

  // Get merchant
  const merchant = await getMerchantByShopId(session.shop);
  if (!merchant) {
    return json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  // Check if merchant billing allows syncing
  if (merchant.billingStatus === "CANCELLED") {
    return json(
      {
        success: false,
        error: "Cannot sync: billing is cancelled",
      },
      { status: 403 }
    );
  }

  try {
    // Check if a sync is already in progress
    const syncInProgress = await isSyncInProgress(merchant.id);
    if (syncInProgress) {
      return json({
        success: false,
        message: "A sync is already in progress",
        alreadyInProgress: true,
      });
    }

    // Parse request body
    let fullSync = false;
    try {
      const body = await request.json();
      fullSync = body.fullSync === true;
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Enqueue the sync job
    const job = await enqueueFulfillmentSyncJob(merchant.id, { fullSync });

    console.log(
      `[api.sync] Enqueued sync job ${job.id} for merchant ${merchant.id} (fullSync: ${fullSync})`
    );

    return json({
      success: true,
      jobId: job.id,
      message: fullSync
        ? "Full sync started. This may take a few minutes."
        : "Sync started for recent fulfillments.",
    });
  } catch (error) {
    console.error("[api.sync] Error triggering sync:", error);
    return json(
      {
        success: false,
        error: "Failed to start sync",
      },
      { status: 500 }
    );
  }
}
