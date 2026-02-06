/**
 * Resolution Service
 *
 * Handles shipment resolution workflow, including marking shipments as resolved
 * and creating resolution log entries for audit trail.
 */

import { prisma } from "~/db.server";
import type { ResolutionReason } from "@prisma/client";

// ============================================================
// Types
// ============================================================

/**
 * Input for resolving a shipment
 */
export interface ResolveShipmentInput {
  shipmentId: string;
  merchantId: string;
  resolvedBy: string;
  resolutionReason: ResolutionReason;
  notes?: string | null;
}

/**
 * Result of resolving a shipment
 */
export interface ResolveShipmentResult {
  success: boolean;
  shipmentId?: string;
  resolutionLogId?: string;
  error?: string;
}

/**
 * Resolution reason labels for display
 */
export const RESOLUTION_REASON_LABELS: Record<ResolutionReason, string> = {
  CONTACTED_CUSTOMER: "Contacted customer - no action needed",
  SENT_NOTIFICATION: "Sent delay notification",
  PARTIAL_REFUND: "Issued partial refund",
  FULL_REFUND: "Issued full refund",
  RESHIPPED: "Reshipped order",
  DELIVERED_FALSE_ALARM: "Package delivered (false alarm)",
  CUSTOMER_CANCELLED: "Customer cancelled",
  OTHER: "Other",
};

/**
 * All available resolution reasons in order for dropdown
 */
export const RESOLUTION_REASONS: ResolutionReason[] = [
  "CONTACTED_CUSTOMER",
  "SENT_NOTIFICATION",
  "PARTIAL_REFUND",
  "FULL_REFUND",
  "RESHIPPED",
  "DELIVERED_FALSE_ALARM",
  "CUSTOMER_CANCELLED",
  "OTHER",
];

// ============================================================
// Resolution Functions
// ============================================================

/**
 * Calculate time delayed before resolution in minutes
 *
 * @param delayFlaggedAt - When the shipment was first flagged as delayed
 * @param resolvedAt - When the shipment is being resolved (defaults to now)
 * @returns Time in minutes, or null if not applicable
 */
export function calculateTimeDelayedBeforeResolution(
  delayFlaggedAt: Date | null,
  resolvedAt: Date = new Date()
): number | null {
  if (!delayFlaggedAt) {
    return null;
  }

  const diffMs = resolvedAt.getTime() - delayFlaggedAt.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  return Math.max(0, diffMinutes);
}

/**
 * Create a resolution log entry
 *
 * Records the resolution for audit trail purposes.
 *
 * @param params - Resolution log parameters
 * @returns The created ResolutionLog record
 */
export async function createResolutionLog(params: {
  shipmentId: string;
  resolvedBy: string;
  resolutionReason: ResolutionReason;
  notes?: string | null;
  timeDelayedBeforeResolution?: number | null;
}) {
  return prisma.resolutionLog.create({
    data: {
      shipmentId: params.shipmentId,
      resolvedBy: params.resolvedBy,
      resolutionReason: params.resolutionReason,
      notes: params.notes?.substring(0, 500) || null, // Enforce 500 char limit
      timeDelayedBeforeResolution: params.timeDelayedBeforeResolution ?? null,
    },
  });
}

/**
 * Resolve a shipment
 *
 * Marks a shipment as resolved, creates a resolution log entry,
 * and calculates the time delayed before resolution.
 *
 * @param input - Resolution input
 * @returns Result of the resolution operation
 */
export async function resolveShipment(
  input: ResolveShipmentInput
): Promise<ResolveShipmentResult> {
  const { shipmentId, merchantId, resolvedBy, resolutionReason, notes } = input;

  try {
    // Verify shipment exists and belongs to merchant
    const shipment = await prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        merchantId,
      },
      select: {
        id: true,
        isResolved: true,
        isDelivered: true,
        delayFlaggedAt: true,
      },
    });

    if (!shipment) {
      return {
        success: false,
        error: "Shipment not found",
      };
    }

    // Check if already resolved
    if (shipment.isResolved) {
      return {
        success: false,
        error: "Shipment is already resolved",
      };
    }

    // Check if already delivered
    if (shipment.isDelivered) {
      return {
        success: false,
        error: "Cannot resolve a delivered shipment",
      };
    }

    // Calculate time delayed before resolution
    const resolvedAt = new Date();
    const timeDelayedBeforeResolution = calculateTimeDelayedBeforeResolution(
      shipment.delayFlaggedAt,
      resolvedAt
    );

    // Use a transaction to update shipment and create log atomically
    const [updatedShipment, resolutionLog] = await prisma.$transaction([
      // Update shipment to resolved status
      prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          isResolved: true,
          resolvedAt,
          resolvedBy,
          resolutionReason,
          resolutionNotes: notes?.substring(0, 500) || null,
        },
      }),
      // Create resolution log entry
      prisma.resolutionLog.create({
        data: {
          shipmentId,
          resolvedBy,
          resolvedAt,
          resolutionReason,
          notes: notes?.substring(0, 500) || null,
          timeDelayedBeforeResolution,
        },
      }),
    ]);

    return {
      success: true,
      shipmentId: updatedShipment.id,
      resolutionLogId: resolutionLog.id,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[resolution] Failed to resolve shipment:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Bulk resolve multiple shipments
 *
 * Resolves multiple shipments with the same reason and notes.
 * Each shipment gets its own resolution log entry.
 *
 * @param params - Bulk resolution parameters
 * @returns Results for each shipment
 */
export async function bulkResolveShipments(params: {
  shipmentIds: string[];
  merchantId: string;
  resolvedBy: string;
  resolutionReason: ResolutionReason;
  notes?: string | null;
}): Promise<{
  results: Array<{ shipmentId: string; success: boolean; error?: string }>;
  successCount: number;
  failureCount: number;
}> {
  const { shipmentIds, merchantId, resolvedBy, resolutionReason, notes } = params;

  const results: Array<{ shipmentId: string; success: boolean; error?: string }> = [];
  let successCount = 0;
  let failureCount = 0;

  // Process each shipment individually to capture per-shipment errors
  for (const shipmentId of shipmentIds) {
    const result = await resolveShipment({
      shipmentId,
      merchantId,
      resolvedBy,
      resolutionReason,
      notes,
    });

    results.push({
      shipmentId,
      success: result.success,
      error: result.error,
    });

    if (result.success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  return {
    results,
    successCount,
    failureCount,
  };
}

/**
 * Get resolution history for a shipment
 *
 * @param shipmentId - The shipment ID to get history for
 * @returns Array of resolution log entries
 */
export async function getResolutionHistory(shipmentId: string) {
  return prisma.resolutionLog.findMany({
    where: { shipmentId },
    orderBy: { resolvedAt: "desc" },
  });
}

/**
 * Unresolve a shipment (for administrative purposes)
 *
 * This removes the resolved status but keeps the resolution log entries
 * for audit trail purposes.
 *
 * @param shipmentId - The shipment ID to unresolve
 * @param merchantId - The merchant ID for validation
 * @returns Result of the operation
 */
export async function unresolveShipment(
  shipmentId: string,
  merchantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const shipment = await prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        merchantId,
      },
      select: { id: true, isResolved: true },
    });

    if (!shipment) {
      return { success: false, error: "Shipment not found" };
    }

    if (!shipment.isResolved) {
      return { success: false, error: "Shipment is not resolved" };
    }

    await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        isResolved: false,
        resolvedAt: null,
        resolvedBy: null,
        resolutionReason: null,
        resolutionNotes: null,
      },
    });

    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[resolution] Failed to unresolve shipment:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
