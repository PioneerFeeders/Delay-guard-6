/**
 * API Route: /api/shipments/bulk-resolve
 *
 * POST: Resolve multiple shipments at once with the same reason and notes.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import { ResolutionReasonSchema } from "~/lib/validation";
import { bulkResolveShipments } from "~/services/resolution.service";

/**
 * Request body schema for bulk resolve
 */
const BulkResolveRequestSchema = z.object({
  shipmentIds: z.array(z.string().uuid()).min(1).max(100),
  resolutionReason: ResolutionReasonSchema,
  notes: z.string().max(500).optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  // Only allow POST
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: {
      id: true,
      email: true,
    },
  });

  if (!merchant) {
    return json({ error: "Merchant not found" }, { status: 404 });
  }

  // Parse and validate request body
  let body: z.infer<typeof BulkResolveRequestSchema>;
  try {
    const rawBody = await request.json();
    body = BulkResolveRequestSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json(
        { error: "Invalid request body", details: err.errors },
        { status: 400 }
      );
    }
    return json({ error: "Failed to parse request body" }, { status: 400 });
  }

  const { shipmentIds, resolutionReason, notes } = body;

  // Use the bulk resolve service
  try {
    const result = await bulkResolveShipments({
      shipmentIds,
      merchantId: merchant.id,
      resolvedBy: merchant.email || "bulk-action",
      resolutionReason,
      notes,
    });

    return json({
      success: true,
      successCount: result.successCount,
      failureCount: result.failureCount,
      results: result.results,
      message: `${result.successCount} shipment${result.successCount === 1 ? "" : "s"} resolved`,
    });
  } catch (err) {
    console.error("[bulk-resolve] Failed to resolve shipments:", err);
    return json(
      { error: "Failed to resolve shipments" },
      { status: 500 }
    );
  }
};
