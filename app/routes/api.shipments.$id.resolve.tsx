/**
 * API Route: /api/shipments/:id/resolve
 *
 * POST: Resolve a shipment with a reason and optional notes
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { resolveShipment } from "../services/resolution.service";

/**
 * Valid resolution reasons (must match Prisma enum)
 */
const ResolutionReasonEnum = z.enum([
  "CONTACTED_CUSTOMER",
  "SENT_NOTIFICATION",
  "PARTIAL_REFUND",
  "FULL_REFUND",
  "RESHIPPED",
  "DELIVERED_FALSE_ALARM",
  "CUSTOMER_CANCELLED",
  "OTHER",
]);

/**
 * Request body schema for resolving a shipment
 */
const ResolveShipmentSchema = z.object({
  resolutionReason: ResolutionReasonEnum,
  notes: z.string().max(500, "Notes cannot exceed 500 characters").optional(),
});

/**
 * POST: Resolve a shipment
 *
 * Marks the shipment as resolved with the given reason and optional notes.
 * Creates a resolution log entry for audit trail.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Shipment ID is required" }, { status: 400 });
  }

  // Parse and validate request body
  let body: z.infer<typeof ResolveShipmentSchema>;
  try {
    const rawBody = await request.json();
    body = ResolveShipmentSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json(
        { error: "Validation failed", details: err.errors },
        { status: 400 }
      );
    }
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  // Get merchant
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
    select: { id: true, email: true },
  });

  if (!merchant) {
    return json({ error: "Merchant not found" }, { status: 404 });
  }

  // Resolve the shipment
  const result = await resolveShipment({
    shipmentId: id,
    merchantId: merchant.id,
    resolvedBy: merchant.email,
    resolutionReason: body.resolutionReason,
    notes: body.notes,
  });

  if (!result.success) {
    return json({ error: result.error }, { status: 400 });
  }

  return json({
    success: true,
    message: "Shipment resolved successfully",
    shipmentId: result.shipmentId,
    resolutionLogId: result.resolutionLogId,
  });
};
