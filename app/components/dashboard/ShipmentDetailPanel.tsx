import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Box,
  Spinner,
  Icon,
  InlineGrid,
} from "@shopify/polaris";
import {
  ClockIcon,
  LocationIcon,
  EmailIcon,
  PhoneIcon,
  XIcon,
  DeliveryIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { format, parseISO } from "date-fns";

/**
 * Shape of shipping address stored in Shipment.shippingAddress
 */
interface ShippingAddress {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  zip?: string | null;
  phone?: string | null;
  company?: string | null;
}

/**
 * Tracking event from the API
 */
interface TrackingEvent {
  id: string;
  eventTimestamp: string;
  eventType: string;
  eventDescription: string;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
}

/**
 * Notification log entry from the API
 */
interface NotificationLogEntry {
  id: string;
  sentAt: string;
  sentBy: string;
  recipientEmail: string;
  emailSubject: string;
  status: "SENT" | "FAILED";
}

/**
 * Resolution log entry from the API
 */
interface ResolutionLogEntry {
  id: string;
  resolvedAt: string;
  resolvedBy: string;
  resolutionReason: string;
  notes: string | null;
}

/**
 * Full shipment detail response from API
 */
interface ShipmentDetail {
  id: string;
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  serviceLevel: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shippingAddress: ShippingAddress | null;
  shipDate: string;
  expectedDeliveryDate: string | null;
  expectedDeliverySource: string;
  currentStatus: string;
  isDelayed: boolean;
  delayFlaggedAt: string | null;
  daysDelayed: number;
  lastCarrierStatus: string | null;
  lastScanLocation: string | null;
  lastScanTime: string | null;
  carrierExceptionCode: string | null;
  carrierExceptionReason: string | null;
  rescheduledDeliveryDate: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  resolutionReason: string | null;
  resolutionNotes: string | null;
  notificationSent: boolean;
  notificationSentAt: string | null;
  isDelivered: boolean;
  deliveredAt: string | null;
  orderValue: string | null;
  shopifyOrderId: string;
  fulfillmentLocationName: string | null;
  trackingEvents: TrackingEvent[];
  notificationLogs: NotificationLogEntry[];
  resolutionLogs: ResolutionLogEntry[];
}

interface ShipmentDetailPanelProps {
  shipmentId: string;
  onClose: () => void;
  onSendNotification?: () => void;
  onResolve?: () => void;
}

/**
 * Format date/time for display
 */
function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

/**
 * Format date for display
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

/**
 * Format shipping address for display
 */
function formatAddress(address: ShippingAddress | null): string[] {
  if (!address) return ["No address on file"];

  const lines: string[] = [];
  const name =
    address.name ||
    [address.first_name, address.last_name].filter(Boolean).join(" ");
  if (name) lines.push(name);
  if (address.company) lines.push(address.company);
  if (address.address1) lines.push(address.address1);
  if (address.address2) lines.push(address.address2);

  const cityLine = [
    address.city,
    address.province_code || address.province,
    address.zip,
  ]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);

  if (address.country && address.country_code !== "US") {
    lines.push(address.country);
  }

  return lines.length > 0 ? lines : ["No address on file"];
}

/**
 * Format resolution reason for display
 */
function formatResolutionReason(reason: string): string {
  const reasonMap: Record<string, string> = {
    CONTACTED_CUSTOMER: "Contacted customer - no action needed",
    SENT_NOTIFICATION: "Sent delay notification",
    PARTIAL_REFUND: "Issued partial refund",
    FULL_REFUND: "Issued full refund",
    RESHIPPED: "Reshipped order",
    DELIVERED_FALSE_ALARM: "Package delivered (false alarm)",
    CUSTOMER_CANCELLED: "Customer cancelled",
    OTHER: "Other",
  };
  return reasonMap[reason] || reason;
}

/**
 * Get icon for tracking event type
 */
function getEventIcon(eventType: string): typeof DeliveryIcon {
  const type = eventType.toUpperCase();
  if (type.includes("DELIVER")) return CheckCircleIcon;
  if (type.includes("EXCEPTION") || type.includes("DELAY")) return AlertTriangleIcon;
  return DeliveryIcon;
}

/**
 * Format event location
 */
function formatEventLocation(event: TrackingEvent): string {
  const parts = [event.locationCity, event.locationState, event.locationCountry].filter(
    Boolean
  );
  return parts.length > 0 ? parts.join(", ") : "";
}

export function ShipmentDetailPanel({
  shipmentId,
  onClose,
  onSendNotification,
  onResolve,
}: ShipmentDetailPanelProps) {
  const fetcher = useFetcher<{ shipment: ShipmentDetail } | { error: string }>();

  // Fetch shipment details on mount or when ID changes
  useEffect(() => {
    if (shipmentId) {
      fetcher.load(`/api/shipments/${shipmentId}`);
    }
  }, [shipmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = fetcher.state === "loading";
  const data = fetcher.data;
  const shipment = data && "shipment" in data ? data.shipment : null;
  const error = data && "error" in data ? data.error : null;

  if (isLoading) {
    return (
      <Card>
        <Box padding="800">
          <InlineStack align="center" blockAlign="center">
            <Spinner size="large" accessibilityLabel="Loading shipment details" />
          </InlineStack>
        </Box>
      </Card>
    );
  }

  if (error || !shipment) {
    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Shipment Details
            </Text>
            <Button variant="plain" icon={XIcon} onClick={onClose} accessibilityLabel="Close" />
          </InlineStack>
          <Text as="p" tone="critical">
            {error || "Failed to load shipment details"}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const addressLines = formatAddress(shipment.shippingAddress);

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header with close button */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Order {shipment.orderNumber}
            </Text>
            {shipment.isDelivered && <Badge tone="success">Delivered</Badge>}
            {shipment.isResolved && !shipment.isDelivered && (
              <Badge tone="info">Resolved</Badge>
            )}
            {shipment.isDelayed && !shipment.isResolved && (
              <Badge tone="critical">Delayed</Badge>
            )}
          </InlineStack>
          <Button variant="plain" icon={XIcon} onClick={onClose} accessibilityLabel="Close" />
        </InlineStack>

        <Divider />

        {/* Main content grid */}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          {/* Left column: Customer & Shipping Info */}
          <BlockStack gap="400">
            {/* Customer Information */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Customer Information
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {shipment.customerName}
                </Text>
                <InlineStack gap="100" blockAlign="center">
                  <Icon source={EmailIcon} tone="subdued" />
                  <Text as="p" variant="bodySm">
                    {shipment.customerEmail}
                  </Text>
                </InlineStack>
                {shipment.customerPhone && (
                  <InlineStack gap="100" blockAlign="center">
                    <Icon source={PhoneIcon} tone="subdued" />
                    <Text as="p" variant="bodySm">
                      {shipment.customerPhone}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>

            {/* Shipping Address */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Shipping Address
              </Text>
              <InlineStack gap="100" blockAlign="start">
                <Icon source={LocationIcon} tone="subdued" />
                <BlockStack gap="0">
                  {addressLines.map((line, i) => (
                    <Text as="p" variant="bodySm" key={i}>
                      {line}
                    </Text>
                  ))}
                </BlockStack>
              </InlineStack>
            </BlockStack>

            {/* Carrier Status */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Carrier Status
              </Text>
              <BlockStack gap="100">
                <InlineStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Carrier:
                  </Text>
                  <Text as="span" variant="bodySm">
                    {shipment.carrier === "FEDEX" ? "FedEx" : shipment.carrier}
                  </Text>
                </InlineStack>
                {shipment.serviceLevel && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Service:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {shipment.serviceLevel}
                    </Text>
                  </InlineStack>
                )}
                <InlineStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Status:
                  </Text>
                  <Text as="span" variant="bodySm">
                    {shipment.lastCarrierStatus || shipment.currentStatus}
                  </Text>
                </InlineStack>
                {shipment.lastScanLocation && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Last Location:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {shipment.lastScanLocation}
                    </Text>
                  </InlineStack>
                )}
                {shipment.lastScanTime && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Last Scan:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {formatDateTime(shipment.lastScanTime)}
                    </Text>
                  </InlineStack>
                )}
                {shipment.carrierExceptionReason && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Exception:
                    </Text>
                    <Text as="span" variant="bodySm" tone="critical">
                      {shipment.carrierExceptionReason}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>

            {/* Delivery Dates */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Delivery Information
              </Text>
              <BlockStack gap="100">
                <InlineStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Ship Date:
                  </Text>
                  <Text as="span" variant="bodySm">
                    {formatDate(shipment.shipDate)}
                  </Text>
                </InlineStack>
                <InlineStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Expected:
                  </Text>
                  <Text as="span" variant="bodySm">
                    {formatDate(shipment.expectedDeliveryDate)}
                  </Text>
                </InlineStack>
                {shipment.rescheduledDeliveryDate && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Rescheduled:
                    </Text>
                    <Text as="span" variant="bodySm">
                      {formatDate(shipment.rescheduledDeliveryDate)}
                    </Text>
                  </InlineStack>
                )}
                {shipment.isDelivered && shipment.deliveredAt && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Delivered:
                    </Text>
                    <Text as="span" variant="bodySm" tone="success">
                      {formatDateTime(shipment.deliveredAt)}
                    </Text>
                  </InlineStack>
                )}
                {shipment.isDelayed && shipment.daysDelayed > 0 && (
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Days Delayed:
                    </Text>
                    <Text as="span" variant="bodySm" tone="critical">
                      {shipment.daysDelayed}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </BlockStack>

          {/* Right column: Timeline & History */}
          <BlockStack gap="400">
            {/* Tracking Timeline */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Tracking History
              </Text>
              {shipment.trackingEvents.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No tracking events yet
                </Text>
              ) : (
                <BlockStack gap="300">
                  {shipment.trackingEvents.map((event) => (
                    <InlineStack key={event.id} gap="200" blockAlign="start">
                      <Box paddingBlockStart="100">
                        <Icon source={getEventIcon(event.eventType)} tone="subdued" />
                      </Box>
                      <BlockStack gap="0">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {event.eventDescription}
                        </Text>
                        <InlineStack gap="100">
                          <Icon source={ClockIcon} tone="subdued" />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {formatDateTime(event.eventTimestamp)}
                          </Text>
                        </InlineStack>
                        {formatEventLocation(event) && (
                          <InlineStack gap="100">
                            <Icon source={LocationIcon} tone="subdued" />
                            <Text as="span" variant="bodySm" tone="subdued">
                              {formatEventLocation(event)}
                            </Text>
                          </InlineStack>
                        )}
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>

            <Divider />

            {/* Notification History */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Notification History
              </Text>
              {shipment.notificationLogs.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No notifications sent
                </Text>
              ) : (
                <BlockStack gap="200">
                  {shipment.notificationLogs.map((log) => (
                    <BlockStack key={log.id} gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={log.status === "SENT" ? "success" : "critical"}>
                          {log.status}
                        </Badge>
                        <Text as="span" variant="bodySm">
                          {log.emailSubject}
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Sent to {log.recipientEmail} on {formatDateTime(log.sentAt)} by{" "}
                        {log.sentBy}
                      </Text>
                    </BlockStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>

            <Divider />

            {/* Resolution History */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Resolution History
              </Text>
              {shipment.resolutionLogs.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No resolutions recorded
                </Text>
              ) : (
                <BlockStack gap="200">
                  {shipment.resolutionLogs.map((log) => (
                    <BlockStack key={log.id} gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {formatResolutionReason(log.resolutionReason)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Resolved on {formatDateTime(log.resolvedAt)} by {log.resolvedBy}
                      </Text>
                      {log.notes && (
                        <Text as="p" variant="bodySm">
                          Notes: {log.notes}
                        </Text>
                      )}
                    </BlockStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </BlockStack>
        </InlineGrid>

        <Divider />

        {/* Action buttons */}
        <InlineStack gap="300" align="end">
          {!shipment.isDelivered && !shipment.isResolved && (
            <>
              <Button onClick={onSendNotification} disabled={!onSendNotification}>
                Send Notification
              </Button>
              <Button onClick={onResolve} disabled={!onResolve}>
                Mark Resolved
              </Button>
            </>
          )}
          {shipment.isResolved && !shipment.isDelivered && (
            <Text as="p" variant="bodySm" tone="subdued">
              This shipment has been resolved
            </Text>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
