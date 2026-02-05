/**
 * Data Cleanup Worker
 *
 * This worker runs daily to:
 * 1. Archive delivered shipments that are past the auto-archive threshold
 * 2. Purge data for merchants who uninstalled more than 30 days ago
 *
 * Implemented in Phase 3: Carrier Integration & Delay Detection
 */

import type { Job } from "bullmq";

export interface DataCleanupJobData {
  // No data needed for cleanup job
}

/**
 * Process a data cleanup job
 *
 * TODO: Implement in Phase 3
 * - Archive: Set isArchived=true for delivered shipments past merchant's autoArchiveDays
 * - Purge: Delete all data for merchants who uninstalled more than 30 days ago
 * - Log cleanup statistics
 */
export async function processDataCleanup(
  job: Job<DataCleanupJobData>
): Promise<void> {
  console.log(`[data-cleanup] Processing job ${job.id}`);

  // Placeholder implementation
  // Will be implemented in Phase 3: Carrier Integration & Delay Detection
  console.log("[data-cleanup] Placeholder: Would archive old shipments and purge uninstalled merchant data");
}
