/**
 * Webhook Handler: fulfillments/update
 *
 * Triggered when a fulfillment is updated in Shopify.
 * Updates shipment record if tracking number or carrier changes.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { getMerchantByShopId } from "~/services/merchant.service";
import {
  updateShipmentFromFulfillment,
  createShipmentFromFulfillment,
  getShipmentByFulfillmentId,
} from "~/services/shipment.service";
import { enqueuePollJob } from "~/queue.server";
import {
  safeParseFulfillmentPayload,
  type FulfillmentWebhookPayload,
  type OrderPartial,
} from "~/lib/validation";

/**
 * Fetch order details from Shopify Admin API
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

  console.log(`[Webhook] fulfillments/update received for shop: ${shop}`);

  // Validate the webhook payload
  const parseResult = safeParseFulfillmentPayload(payload);
  if (!parseResult.success) {
    console.error("Invalid fulfillment webhook payload:", parseResult.error);
    return new Response(null, { status: 200 });
  }

  const fulfillment: FulfillmentWebhookPayload = parseResult.data;

  try {
    // Get the merchant record
    const merchant = await getMerchantByShopId(shop);
    if (!merchant) {
      console.error(`Merchant not found for shop: ${shop}`);
      return new Response(null, { status: 200 });
    }

    // Check if merchant is active
    if (merchant.billingStatus === "CANCELLED") {
      console.log(`Skipping shipment update for cancelled merchant: ${shop}`);
      return new Response(null, { status: 200 });
    }

    // Check if shipment exists
    const existingShipment = await getShipmentByFulfillmentId(
      merchant.id,
      String(fulfillment.id)
    );

    if (!existingShipment) {
      // Shipment doesn't exist yet - this can happen if:
      // 1. The create webhook was missed
      // 2. The shipment was created before the app was installed
      // Create it now
      console.log(
        `Shipment not found for fulfillment ${fulfillment.id}, creating new shipment`
      );

      const orderDetails = await fetchOrderDetails(admin, fulfillment.order_id);
      const fallbackOrder: OrderPartial = orderDetails ?? {
        id: fulfillment.order_id,
        name: `#${fulfillment.order_id}`,
        email: null,
        shipping_address: fulfillment.destination,
      };

      const locationName = await fetchLocationName(admin, fulfillment.location_id);

      const { shipment, isNew } = await createShipmentFromFulfillment({
        merchantId: merchant.id,
        fulfillment,
        order: fallbackOrder,
        locationName,
      });

      if (isNew) {
        console.log(`Created shipment from update webhook: ${shipment.id}`);
        const trackingNumber = fulfillment.tracking_number ||
          (fulfillment.tracking_numbers && fulfillment.tracking_numbers[0]);

        if (trackingNumber && shipment.carrier !== "UNKNOWN") {
          await enqueuePollJob(shipment.id);
          console.log(`Enqueued poll job for new shipment: ${shipment.id}`);
        }
      }

      return new Response(null, { status: 200 });
    }

    // Check what changed
    const newTrackingNumber = fulfillment.tracking_number ||
      (fulfillment.tracking_numbers && fulfillment.tracking_numbers[0]);
    const trackingChanged = newTrackingNumber &&
      newTrackingNumber !== existingShipment.trackingNumber;
    const hadNoTracking = !existingShipment.trackingNumber && newTrackingNumber;

    // Update the shipment
    const updatedShipment = await updateShipmentFromFulfillment(
      merchant.id,
      fulfillment
    );

    if (!updatedShipment) {
      console.error(`Failed to update shipment for fulfillment: ${fulfillment.id}`);
      return new Response(null, { status: 200 });
    }

    console.log(`Updated shipment: ${updatedShipment.id} for fulfillment ${fulfillment.id}`);

    // If tracking number was just added or changed, enqueue a poll job
    if ((trackingChanged || hadNoTracking) && updatedShipment.carrier !== "UNKNOWN") {
      await enqueuePollJob(updatedShipment.id);
      console.log(
        `Enqueued poll job for shipment with updated tracking: ${updatedShipment.id}`
      );
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Error processing fulfillments/update webhook:", error);
    return new Response(null, { status: 200 });
  }
}
