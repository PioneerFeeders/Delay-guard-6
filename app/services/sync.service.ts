/**
 * Sync Service
 *
 * Handles initial and ongoing synchronization of fulfillments from Shopify.
 * Used during onboarding and for manual re-syncs.
 */

import { prisma } from "~/db.server";
import type { Merchant } from "@prisma/client";
import { sessionStorage } from "~/shopify.server";
import {
  createShipmentFromFulfillment,
} from "./shipment.service";
import { enqueuePollJob } from "~/queue.server";
import type { FulfillmentWebhookPayload, OrderPartial } from "~/lib/validation";

/**
 * GraphQL fulfillment fragment for consistent data shape
 */
const FULFILLMENT_FRAGMENT = `
  fragment FulfillmentFields on Fulfillment {
    id
    legacyResourceId
    status
    createdAt
    updatedAt
    trackingInfo {
      company
      number
      url
    }
    location {
      legacyResourceId
      name
    }
    order {
      id
      legacyResourceId
      name
      email
      phone
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      shippingAddress {
        firstName
        lastName
        name
        address1
        address2
        city
        province
        provinceCode
        country
        countryCode
        zip
        phone
        company
      }
      customer {
        legacyResourceId
        email
        phone
        firstName
        lastName
      }
    }
    service {
      serviceName
    }
  }
`;

/**
 * GraphQL query to fetch fulfillments with pagination
 */
const FULFILLMENTS_QUERY = `
  ${FULFILLMENT_FRAGMENT}

  query getFulfillments($first: Int!, $after: String, $query: String) {
    fulfillments(first: $first, after: $after, query: $query) {
      edges {
        node {
          ...FulfillmentFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Result of sync operation
 */
export interface SyncResult {
  /** Total fulfillments processed */
  total: number;
  /** New shipments created */
  created: number;
  /** Existing shipments skipped */
  skipped: number;
  /** Shipments with errors */
  errors: number;
  /** Shipments with duplicate tracking numbers */
  duplicates: number;
  /** Poll jobs enqueued */
  pollJobsEnqueued: number;
}

/**
 * Progress callback for sync operation
 */
export type SyncProgressCallback = (progress: {
  processed: number;
  total: number;
  percentage: number;
}) => void;

/**
 * Transform GraphQL fulfillment response to webhook-compatible format
 */
function transformFulfillmentFromGraphQL(node: any): {
  fulfillment: FulfillmentWebhookPayload;
  order: OrderPartial;
  locationName: string | null;
} {
  const trackingInfo = node.trackingInfo?.[0] ?? {};

  // Build fulfillment payload matching webhook format
  const fulfillment: FulfillmentWebhookPayload = {
    id: parseInt(node.legacyResourceId, 10),
    order_id: parseInt(node.order?.legacyResourceId, 10),
    status: node.status?.toLowerCase() ?? "success",
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    tracking_company: trackingInfo.company ?? null,
    tracking_number: trackingInfo.number ?? null,
    tracking_numbers: trackingInfo.number ? [trackingInfo.number] : [],
    tracking_url: trackingInfo.url ?? null,
    tracking_urls: trackingInfo.url ? [trackingInfo.url] : [],
    shipment_status: null, // Not available from GraphQL
    location_id: node.location?.legacyResourceId
      ? parseInt(node.location.legacyResourceId, 10)
      : null,
    service: node.service?.serviceName ?? null,
  };

  // Build order data
  const orderNode = node.order;
  const order: OrderPartial = {
    id: parseInt(orderNode?.legacyResourceId, 10) || fulfillment.order_id,
    name: orderNode?.name ?? `#${fulfillment.order_id}`,
    email: orderNode?.email ?? null,
    phone: orderNode?.phone ?? null,
    total_price: orderNode?.totalPriceSet?.shopMoney?.amount ?? null,
    currency: orderNode?.totalPriceSet?.shopMoney?.currencyCode ?? null,
    shipping_address: orderNode?.shippingAddress
      ? {
          first_name: orderNode.shippingAddress.firstName ?? null,
          last_name: orderNode.shippingAddress.lastName ?? null,
          name: orderNode.shippingAddress.name ?? null,
          address1: orderNode.shippingAddress.address1 ?? null,
          address2: orderNode.shippingAddress.address2 ?? null,
          city: orderNode.shippingAddress.city ?? null,
          province: orderNode.shippingAddress.province ?? null,
          province_code: orderNode.shippingAddress.provinceCode ?? null,
          country: orderNode.shippingAddress.country ?? null,
          country_code: orderNode.shippingAddress.countryCode ?? null,
          zip: orderNode.shippingAddress.zip ?? null,
          phone: orderNode.shippingAddress.phone ?? null,
          company: orderNode.shippingAddress.company ?? null,
        }
      : null,
    customer: orderNode?.customer
      ? {
          id: parseInt(orderNode.customer.legacyResourceId, 10),
          email: orderNode.customer.email ?? null,
          phone: orderNode.customer.phone ?? null,
          first_name: orderNode.customer.firstName ?? null,
          last_name: orderNode.customer.lastName ?? null,
        }
      : null,
  };

  const locationName = node.location?.name ?? null;

  return { fulfillment, order, locationName };
}

/**
 * Build the GraphQL query filter for fulfillments
 * @param fullSync If true, fetch all; otherwise fetch last 5 days
 */
function buildFulfillmentQuery(fullSync: boolean): string {
  if (fullSync) {
    // No date filter for full sync
    return "";
  }

  // Calculate date 5 days ago
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const dateStr = fiveDaysAgo.toISOString().split("T")[0]; // YYYY-MM-DD format

  return `created_at:>=${dateStr}`;
}

/**
 * Create an admin API client for a merchant
 * Uses the stored session to authenticate
 */
async function createAdminClient(merchant: Merchant): Promise<{
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
} | null> {
  try {
    // Get the session for this merchant
    const sessionId = `offline_${merchant.shopDomain}`;
    const session = await sessionStorage.loadSession(sessionId);

    if (!session?.accessToken) {
      console.error(`[sync] No valid session found for merchant ${merchant.id}`);
      return null;
    }

    // Create a simple GraphQL client
    const shopDomain = merchant.shopDomain;
    const accessToken = session.accessToken;

    return {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        const response = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            query,
            variables: options?.variables,
          }),
        });
        return response;
      },
    };
  } catch (error) {
    console.error(`[sync] Failed to create admin client for merchant ${merchant.id}:`, error);
    return null;
  }
}

/**
 * Fetch all fulfillments from Shopify with pagination
 */
async function fetchAllFulfillments(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  queryFilter: string,
  onProgress?: (fetched: number) => void
): Promise<any[]> {
  if (!admin) {
    throw new Error("Admin client not available");
  }

  const allFulfillments: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  const pageSize = 50; // Shopify GraphQL limit for fulfillments

  while (hasNextPage) {
    const response = await admin.graphql(FULFILLMENTS_QUERY, {
      variables: {
        first: pageSize,
        after: cursor,
        query: queryFilter || null,
      },
    });

    const json = await response.json();

    // Handle rate limit errors
    if (json.errors) {
      const rateLimitError = json.errors.find(
        (e: any) => e.extensions?.code === "THROTTLED"
      );
      if (rateLimitError) {
        // Wait and retry
        console.log("[sync] Rate limited, waiting 1 second...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // Log other errors but continue
      console.error("[sync] GraphQL errors:", json.errors);
    }

    const fulfillments = json.data?.fulfillments;
    if (!fulfillments) {
      console.error("[sync] No fulfillments data in response");
      break;
    }

    const edges = fulfillments.edges ?? [];
    for (const edge of edges) {
      allFulfillments.push(edge.node);
    }

    // Update progress
    if (onProgress) {
      onProgress(allFulfillments.length);
    }

    hasNextPage = fulfillments.pageInfo?.hasNextPage ?? false;
    cursor = fulfillments.pageInfo?.endCursor ?? null;
  }

  return allFulfillments;
}

/**
 * Sync fulfillments from Shopify for a merchant
 *
 * @param merchantId The merchant ID to sync fulfillments for
 * @param fullSync If true, sync all fulfillments; otherwise sync last 5 days
 * @param onProgress Optional callback for progress updates
 * @returns SyncResult with counts of processed fulfillments
 */
export async function syncFulfillments(
  merchantId: string,
  fullSync: boolean = false,
  onProgress?: SyncProgressCallback
): Promise<SyncResult> {
  const result: SyncResult = {
    total: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    duplicates: 0,
    pollJobsEnqueued: 0,
  };

  // Load merchant
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
  });

  if (!merchant) {
    throw new Error(`Merchant not found: ${merchantId}`);
  }

  // Check billing status
  if (merchant.billingStatus === "CANCELLED") {
    console.log(`[sync] Skipping sync for cancelled merchant: ${merchantId}`);
    return result;
  }

  // Create admin client
  const admin = await createAdminClient(merchant);
  if (!admin) {
    throw new Error(`Could not create admin client for merchant: ${merchantId}`);
  }

  // Build query filter
  const queryFilter = buildFulfillmentQuery(fullSync);
  console.log(
    `[sync] Starting sync for merchant ${merchantId} (fullSync: ${fullSync}, query: "${queryFilter}")`
  );

  // Fetch all fulfillments from Shopify
  const fulfillments = await fetchAllFulfillments(admin, queryFilter, (fetched) => {
    console.log(`[sync] Fetched ${fetched} fulfillments...`);
  });

  result.total = fulfillments.length;
  console.log(`[sync] Found ${fulfillments.length} fulfillments to process`);

  // Process each fulfillment
  for (let i = 0; i < fulfillments.length; i++) {
    const fulfillmentNode = fulfillments[i];

    try {
      // Transform GraphQL response to webhook-compatible format
      const { fulfillment, order, locationName } = transformFulfillmentFromGraphQL(fulfillmentNode);

      // Skip if order_id is invalid
      if (!fulfillment.order_id || isNaN(fulfillment.order_id)) {
        console.warn(`[sync] Skipping fulfillment with invalid order_id: ${fulfillment.id}`);
        result.errors++;
        continue;
      }

      // Create shipment (will skip if already exists)
      const { shipment, isNew, isDuplicate } = await createShipmentFromFulfillment({
        merchantId,
        fulfillment,
        order,
        locationName,
      });

      if (isNew) {
        result.created++;

        if (isDuplicate) {
          result.duplicates++;
        }

        // Enqueue poll job if we have tracking and known carrier
        const trackingNumber = fulfillment.tracking_number || fulfillment.tracking_numbers?.[0];
        if (trackingNumber && shipment.carrier !== "UNKNOWN") {
          await enqueuePollJob(shipment.id);
          result.pollJobsEnqueued++;
        }
      } else {
        result.skipped++;
      }

      // Report progress
      if (onProgress) {
        onProgress({
          processed: i + 1,
          total: result.total,
          percentage: Math.round(((i + 1) / result.total) * 100),
        });
      }
    } catch (error) {
      console.error(
        `[sync] Error processing fulfillment ${fulfillmentNode.legacyResourceId}:`,
        error
      );
      result.errors++;
    }
  }

  console.log(
    `[sync] Completed sync for merchant ${merchantId}: ` +
      `${result.created} created, ${result.skipped} skipped, ${result.errors} errors, ` +
      `${result.duplicates} duplicates, ${result.pollJobsEnqueued} poll jobs`
  );

  return result;
}

/**
 * Get the current sync status for a merchant
 * Returns shipment counts and last sync info
 */
export async function getSyncStatus(merchantId: string): Promise<{
  totalShipments: number;
  delayedShipments: number;
  lastSyncedAt: Date | null;
}> {
  const [counts, merchant] = await Promise.all([
    prisma.shipment.groupBy({
      by: ["isDelayed"],
      where: { merchantId, isArchived: false },
      _count: true,
    }),
    prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { updatedAt: true },
    }),
  ]);

  let totalShipments = 0;
  let delayedShipments = 0;

  for (const group of counts) {
    totalShipments += group._count;
    if (group.isDelayed) {
      delayedShipments = group._count;
    }
  }

  return {
    totalShipments,
    delayedShipments,
    lastSyncedAt: merchant?.updatedAt ?? null,
  };
}

/**
 * Check if a sync job is already running for a merchant
 */
export async function isSyncInProgress(merchantId: string): Promise<boolean> {
  // We use BullMQ's jobId deduplication (sync-{merchantId})
  // If a job with this ID exists and is active, it's in progress
  const { getQueue } = await import("~/queue.server");
  const { QUEUE_FULFILLMENT_SYNC } = await import("~/jobs/queues");

  const queue = getQueue(QUEUE_FULFILLMENT_SYNC);
  const jobId = `sync-${merchantId}`;

  const job = await queue.getJob(jobId);
  if (!job) {
    return false;
  }

  const state = await job.getState();
  return state === "active" || state === "waiting" || state === "delayed";
}
