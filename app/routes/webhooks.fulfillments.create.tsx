/**
 * Webhook Handler: fulfillments/create
 *
 * Triggered when a new fulfillment is created in Shopify.
 * Creates a new shipment record and enqueues carrier polling job.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { getMerchantByShopId } from "~/services/merchant.service";
import {
  createShipmentFromFulfillment,
} from "~/services/shipment.service";
import { checkPlanLimit, getDowngradeInfo } from "~/services/billing.service";
import { enqueuePollJob } from "~/queue.server";
import {
  safeParseFulfillmentPayload,
  type FulfillmentWebhookPayload,
  type OrderPartial,
} from "~/lib/validation";

/**
 * Fetch order details from Shopify Admin API
 * We need order details that aren't included in the fulfillment webhook payload
 */
async function fetchOrderDetails(
  admin: any,
  orderId: number
): Promise<OrderPartial | null> {
  try {
    const response = await admin.graphql(`
      query getOrder($id: ID!) {
        order(id: $id) {
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
      }
    `, {
      variables: {
        id: `gid://shopify/Order/${orderId}`,
      },
    });

    const { data } = await response.json();
    const order = data?.order;

    if (!order) {
      return null;
    }

    // Transform GraphQL response to expected format
    return {
      id: orderId,
      name: order.name,
      email: order.email,
      phone: order.phone,
      total_price: order.totalPriceSet?.shopMoney?.amount,
      currency: order.totalPriceSet?.shopMoney?.currencyCode,
      shipping_address: order.shippingAddress
        ? {
            first_name: order.shippingAddress.firstName,
            last_name: order.shippingAddress.lastName,
            name: order.shippingAddress.name,
            address1: order.shippingAddress.address1,
            address2: order.shippingAddress.address2,
            city: order.shippingAddress.city,
            province: order.shippingAddress.province,
            province_code: order.shippingAddress.provinceCode,
            country: order.shippingAddress.country,
            country_code: order.shippingAddress.countryCode,
            zip: order.shippingAddress.zip,
            phone: order.shippingAddress.phone,
            company: order.shippingAddress.company,
          }
        : null,
      customer: order.customer
        ? {
            id: parseInt(order.customer.legacyResourceId, 10),
            email: order.customer.email,
            phone: order.customer.phone,
            first_name: order.customer.firstName,
            last_name: order.customer.lastName,
          }
        : null,
    };
  } catch (error) {
    console.error("Error fetching order details:", error);
    return null;
  }
}

/**
 * Fetch fulfillment location name from Shopify
 */
async function fetchLocationName(
  admin: any,
  locationId: number | null | undefined
): Promise<string | null> {
  if (!locationId) {
    return null;
  }

  try {
    const response = await admin.graphql(`
      query getLocation($id: ID!) {
        location(id: $id) {
          name
        }
      }
    `, {
      variables: {
        id: `gid://shopify/Location/${locationId}`,
      },
    });

    const { data } = await response.json();
    return data?.location?.name ?? null;
  } catch (error) {
    console.error("Error fetching location name:", error);
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, admin } = await authenticate.webhook(request);

  console.log(`[Webhook] fulfillments/create received for shop: ${shop}`);

  // Validate the webhook payload
  const parseResult = safeParseFulfillmentPayload(payload);
  if (!parseResult.success) {
    console.error("Invalid fulfillment webhook payload:", parseResult.error);
    // Still return 200 to prevent Shopify retries for malformed payloads
    return new Response(null, { status: 200 });
  }

  const fulfillment: FulfillmentWebhookPayload = parseResult.data;

  try {
    // Get the merchant record
    const merchant = await getMerchantByShopId(shop);
    if (!merchant) {
      console.error(`Merchant not found for shop: ${shop}`);
      // Return 200 to prevent retries - merchant doesn't exist
      return new Response(null, { status: 200 });
    }

    // Check if merchant's billing status allows new shipments
    if (merchant.billingStatus === "CANCELLED") {
      console.log(`Skipping shipment creation for cancelled merchant: ${shop}`);
      return new Response(null, { status: 200 });
    }

    // Check if merchant's shop is frozen/paused
    if (merchant.shopFrozen) {
      console.log(`Skipping shipment creation for frozen shop: ${shop}`);
      return new Response(null, { status: 200 });
    }

    // Check plan limits - we still create the shipment but log the limit status
    // Actual enforcement happens when hasCarrierScan transitions to true
    const planLimitCheck = await checkPlanLimit(merchant);
    if (!planLimitCheck.allowed) {
      console.log(
        `[Webhook] Merchant ${shop} at plan limit: ${planLimitCheck.reason}. ` +
        `Shipment will be created but won't count until upgraded.`
      );
      // We still create the shipment, but the carrier-poll worker will handle
      // whether to actually count it toward the limit (based on hasCarrierScan)
    }

    // Check for downgrade situation - merchant still gets shipment created,
    // but new ones may not be tracked depending on plan limits
    const downgradeInfo = await getDowngradeInfo(merchant);
    if (downgradeInfo.isDowngrade && !downgradeInfo.canCreateNewShipment) {
      console.log(
        `[Webhook] Merchant ${shop} downgraded and at new plan limit. ` +
        `Shipment will be created but won't be tracked.`
      );
    }

    // Check if this fulfillment has a tracking number
    const trackingNumber = fulfillment.tracking_number ||
      (fulfillment.tracking_numbers && fulfillment.tracking_numbers[0]);

    if (!trackingNumber) {
      console.log(`Fulfillment ${fulfillment.id} has no tracking number, creating pending shipment`);
    }

    // Fetch additional order details from Shopify Admin API
    const orderDetails = await fetchOrderDetails(admin, fulfillment.order_id);
    if (!orderDetails) {
      console.error(`Could not fetch order details for order ${fulfillment.order_id}`);
      // Use fallback order data
      const fallbackOrder: OrderPartial = {
        id: fulfillment.order_id,
        name: `#${fulfillment.order_id}`,
        email: null,
        shipping_address: fulfillment.destination,
      };

      // Fetch location name
      const locationName = await fetchLocationName(admin, fulfillment.location_id);

      // Create shipment with fallback data
      const { shipment, isNew, isDuplicate } = await createShipmentFromFulfillment({
        merchantId: merchant.id,
        fulfillment,
        order: fallbackOrder,
        locationName,
      });

      if (isDuplicate) {
        console.warn(`Duplicate tracking number detected: ${trackingNumber}`);
      }

      if (isNew && trackingNumber && shipment.carrier !== "UNKNOWN") {
        await enqueuePollJob(shipment.id);
        console.log(`Enqueued poll job for new shipment: ${shipment.id}`);
      }

      return new Response(null, { status: 200 });
    }

    // Fetch location name
    const locationName = await fetchLocationName(admin, fulfillment.location_id);

    // Create the shipment record
    const { shipment, isNew, isDuplicate } = await createShipmentFromFulfillment({
      merchantId: merchant.id,
      fulfillment,
      order: orderDetails,
      locationName,
    });

    if (!isNew) {
      console.log(`Shipment already exists for fulfillment: ${fulfillment.id}`);
      return new Response(null, { status: 200 });
    }

    console.log(`Created new shipment: ${shipment.id} for order ${shipment.orderNumber}`);

    if (isDuplicate) {
      console.warn(
        `Duplicate tracking number detected: ${trackingNumber} for order ${shipment.orderNumber}`
      );
      // We still create the shipment, but merchants will see a warning in the dashboard
    }

    // Enqueue carrier poll job if we have a tracking number and known carrier
    if (trackingNumber && shipment.carrier !== "UNKNOWN") {
      await enqueuePollJob(shipment.id);
      console.log(`Enqueued initial poll job for shipment: ${shipment.id}`);
    }

    // Return 200 quickly to acknowledge webhook receipt
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Error processing fulfillments/create webhook:", error);
    // Return 200 to prevent infinite retries - log and handle errors internally
    // In production, you'd want to alert on these errors
    return new Response(null, { status: 200 });
  }
}
