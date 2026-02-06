import {
  IndexTable,
  Text,
  Badge,
  Link,
  Box,
  InlineStack,
  BlockStack,
  Spinner,
  EmptyState,
  useIndexResourceState,
  IndexTableSelectionType,
} from "@shopify/polaris";
import { useCallback, useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import type { ShipmentListItem } from "~/lib/validation";
import { ShipmentDetailPanel } from "./ShipmentDetailPanel";
import { ALL_COLUMNS, type ColumnConfig } from "./ColumnCustomization";
import { SendNotificationModal } from "../notifications/SendNotificationModal";
import { ResolveModal } from "../resolution/ResolveModal";

// Type for IndexTable heading
type IndexTableHeading = { title: string };

interface ShipmentTableProps {
  shipments: ShipmentListItem[];
  loading: boolean;
  onSort?: (sortBy: string, sortDir: "asc" | "desc") => void;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  visibleColumns?: string[];
  columnOrder?: string[];
}

/**
 * Get carrier tracking URL based on carrier and tracking number
 */
function getCarrierTrackingUrl(carrier: string, trackingNumber: string): string {
  switch (carrier.toUpperCase()) {
    case "UPS":
      return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`;
    case "FEDEX":
      return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
    case "USPS":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`;
    default:
      return "";
  }
}

/**
 * Get Shopify admin order URL
 */
function getShopifyOrderUrl(shopifyOrderId: string): string {
  // Extract numeric ID from gid://shopify/Order/123456789 format
  const numericId = shopifyOrderId.replace(/\D/g, "");
  return `/admin/orders/${numericId}`;
}

/**
 * Format carrier name for display
 */
function formatCarrier(carrier: string): string {
  switch (carrier.toUpperCase()) {
    case "UPS":
      return "UPS";
    case "FEDEX":
      return "FedEx";
    case "USPS":
      return "USPS";
    case "UNKNOWN":
      return "Unknown";
    default:
      return carrier;
  }
}

/**
 * Get badge tone based on shipment status
 */
function getStatusBadge(shipment: ShipmentListItem): React.ReactNode {
  const badges: React.ReactNode[] = [];

  // Test Data badge first
  if (shipment.isTestData) {
    badges.push(
      <Badge key="test" tone="info">
        Test Data
      </Badge>
    );
  }

  // Duplicate tracking warning badge
  if (shipment.isDuplicateTracking) {
    badges.push(
      <Badge key="duplicate" tone="warning">
        Duplicate Tracking
      </Badge>
    );
  }

  // Status badge
  if (shipment.isDelivered) {
    badges.push(<Badge key="status" tone="success">Delivered</Badge>);
  } else if (shipment.isResolved) {
    badges.push(<Badge key="status" tone="info">Resolved</Badge>);
  } else if (shipment.isDelayed) {
    badges.push(<Badge key="status" tone="critical">Delayed</Badge>);
  } else if (shipment.currentStatus === "pending" && !shipment.lastScanTime) {
    badges.push(<Badge key="status" tone="attention">Pending Pickup</Badge>);
  } else {
    badges.push(<Badge key="status" tone="success">On Time</Badge>);
  }

  return <InlineStack gap="100">{badges}</InlineStack>;
}

/**
 * Format days delayed display
 */
function formatDaysDelayed(days: number, isDelayed: boolean): React.ReactNode {
  if (!isDelayed || days <= 0) {
    return (
      <Text as="span" tone="success">
        On Time
      </Text>
    );
  }
  return (
    <Text as="span" tone="critical">
      {days} {days === 1 ? "day" : "days"}
    </Text>
  );
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
 * Format currency for display
 */
function formatCurrency(value: string | null): string {
  if (!value) return "—";
  try {
    const num = parseFloat(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);
  } catch {
    return "—";
  }
}

/**
 * Render a cell value based on column key
 */
function renderCellValue(
  shipment: ShipmentListItem,
  columnKey: string
): React.ReactNode {
  const trackingUrl = getCarrierTrackingUrl(shipment.carrier, shipment.trackingNumber);
  const orderUrl = getShopifyOrderUrl(shipment.shopifyOrderId);

  switch (columnKey) {
    case "orderNumber":
      return (
        <InlineStack gap="200" blockAlign="center">
          <Link url={orderUrl} removeUnderline monochrome>
            {shipment.orderNumber}
          </Link>
          {getStatusBadge(shipment)}
        </InlineStack>
      );
    case "trackingNumber":
      return trackingUrl ? (
        <Link url={trackingUrl} external removeUnderline>
          {shipment.trackingNumber}
        </Link>
      ) : (
        <Text as="span">{shipment.trackingNumber}</Text>
      );
    case "carrier":
      return <Text as="span">{formatCarrier(shipment.carrier)}</Text>;
    case "serviceLevel":
      return <Text as="span">{shipment.serviceLevel || "—"}</Text>;
    case "customerName":
      return <Text as="span">{shipment.customerName}</Text>;
    case "shipDate":
      return <Text as="span">{formatDate(shipment.shipDate)}</Text>;
    case "expectedDeliveryDate":
      return <Text as="span">{formatDate(shipment.expectedDeliveryDate)}</Text>;
    case "daysDelayed":
      return formatDaysDelayed(shipment.daysDelayed, shipment.isDelayed);
    case "orderValue":
      return <Text as="span">{formatCurrency(shipment.orderValue)}</Text>;
    default:
      return <Text as="span">—</Text>;
  }
}

export function ShipmentTable({
  shipments,
  loading,
  onSort,
  sortBy = "daysDelayed",
  sortDir = "desc",
  selectedIds,
  onSelectionChange,
  visibleColumns,
  columnOrder,
}: ShipmentTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notificationShipmentId, setNotificationShipmentId] = useState<string | null>(null);
  const [resolveShipmentId, setResolveShipmentId] = useState<string | null>(null);

  // Use provided columns or default to all columns
  const defaultColumnKeys = ALL_COLUMNS.map((c) => c.key);
  const effectiveVisibleColumns = visibleColumns || defaultColumnKeys;
  const effectiveColumnOrder = columnOrder || defaultColumnKeys;

  // Get the columns to display in order, filtered by visibility
  const displayColumns = useMemo(() => {
    const visibleSet = new Set(effectiveVisibleColumns);
    return effectiveColumnOrder
      .filter((key) => visibleSet.has(key))
      .map((key) => ALL_COLUMNS.find((c) => c.key === key))
      .filter((c): c is ColumnConfig => c !== undefined);
  }, [effectiveVisibleColumns, effectiveColumnOrder]);

  // Index table resource state
  const resourceName = {
    singular: "shipment",
    plural: "shipments",
  };

  // Convert shipments to the format expected by useIndexResourceState
  const resourceItems = shipments.map((s) => ({ id: s.id }));

  const { selectedResources, handleSelectionChange } = useIndexResourceState(
    resourceItems,
    { selectedResources: selectedIds }
  );

  // Sync selection with parent
  const handleSelect = useCallback(
    (selectionType: IndexTableSelectionType, isSelecting: boolean, selection?: string | [number, number]) => {
      handleSelectionChange(selectionType, isSelecting, selection);
      // Update parent after internal state updates
      setTimeout(() => {
        if (selectionType === IndexTableSelectionType.Page || selectionType === IndexTableSelectionType.All) {
          onSelectionChange(isSelecting ? shipments.map((s) => s.id) : []);
        } else if (typeof selection === "string") {
          const newSelection = isSelecting
            ? [...selectedIds, selection]
            : selectedIds.filter((id) => id !== selection);
          onSelectionChange(newSelection);
        }
      }, 0);
    },
    [handleSelectionChange, onSelectionChange, selectedIds, shipments]
  );

  // Handle row click to expand/collapse detail panel
  const handleRowClick = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Handle opening notification modal from detail panel
  const handleSendNotification = useCallback((shipmentId: string) => {
    setNotificationShipmentId(shipmentId);
  }, []);

  // Handle notification modal close
  const handleNotificationClose = useCallback(() => {
    setNotificationShipmentId(null);
  }, []);

  // Handle notification sent successfully
  const handleNotificationSuccess = useCallback(() => {
    // Could trigger a refresh here if needed
    setNotificationShipmentId(null);
  }, []);

  // Handle opening resolve modal from detail panel
  const handleResolve = useCallback((shipmentId: string) => {
    setResolveShipmentId(shipmentId);
  }, []);

  // Handle resolve modal close
  const handleResolveClose = useCallback(() => {
    setResolveShipmentId(null);
  }, []);

  // Handle resolve success
  const handleResolveSuccess = useCallback(() => {
    // Could trigger a refresh here if needed
    setResolveShipmentId(null);
    // Close the detail panel since the shipment is now resolved
    setExpandedId(null);
  }, []);

  // Handle sort column click
  const handleSort = useCallback(
    (headingIndex: number, direction: "ascending" | "descending") => {
      if (onSort && headingIndex < displayColumns.length) {
        const column = displayColumns[headingIndex];
        if (column.sortable) {
          onSort(column.key, direction === "ascending" ? "asc" : "desc");
        }
      }
    },
    [onSort, displayColumns]
  );

  // Find current sort column index within visible columns
  const sortColumnIndex = displayColumns.findIndex((col) => col.key === sortBy);
  const sortDirection = sortDir === "asc" ? "ascending" : "descending";

  // Build headings from visible columns - ensure at least one heading (NonEmptyArray)
  const headings = displayColumns.map((col) => ({
    title: col.title,
  })) as [IndexTableHeading, ...IndexTableHeading[]];

  // Build sortable array for visible columns
  const sortableColumns = displayColumns.map((col) => col.sortable ?? false);

  // Loading state
  if (loading && shipments.length === 0) {
    return (
      <Box padding="800">
        <InlineStack align="center" blockAlign="center">
          <Spinner size="large" accessibilityLabel="Loading shipments" />
        </InlineStack>
      </Box>
    );
  }

  // Empty state
  if (!loading && shipments.length === 0) {
    return (
      <EmptyState
        heading="No shipments found"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>
          No shipments match the current filters. Try adjusting your search criteria or
          wait for new fulfillments to sync.
        </p>
      </EmptyState>
    );
  }

  // Build row markup using dynamic columns
  const rowMarkup = shipments.map((shipment, index) => {
    return (
      <IndexTable.Row
        key={shipment.id}
        id={shipment.id}
        selected={selectedResources.includes(shipment.id)}
        position={index}
        onClick={() => handleRowClick(shipment.id)}
      >
        {displayColumns.map((column) => (
          <IndexTable.Cell key={column.key}>
            {renderCellValue(shipment, column.key)}
          </IndexTable.Cell>
        ))}
      </IndexTable.Row>
    );
  });

  // Expanded detail panel
  const expandedShipment = expandedId
    ? shipments.find((s) => s.id === expandedId)
    : null;

  return (
    <BlockStack gap="400">
      <IndexTable
        resourceName={resourceName}
        itemCount={shipments.length}
        selectedItemsCount={selectedResources.length}
        onSelectionChange={handleSelect}
        headings={headings}
        sortable={sortableColumns}
        sortColumnIndex={sortColumnIndex >= 0 ? sortColumnIndex : undefined}
        sortDirection={sortDirection}
        onSort={handleSort}
        loading={loading}
      >
        {rowMarkup}
      </IndexTable>

      {expandedShipment && (
        <ShipmentDetailPanel
          shipmentId={expandedShipment.id}
          onClose={() => setExpandedId(null)}
          onSendNotification={() => handleSendNotification(expandedShipment.id)}
          onResolve={() => handleResolve(expandedShipment.id)}
        />
      )}

      {/* Send Notification Modal */}
      {notificationShipmentId && (
        <SendNotificationModal
          shipmentId={notificationShipmentId}
          open={!!notificationShipmentId}
          onClose={handleNotificationClose}
          onSuccess={handleNotificationSuccess}
        />
      )}

      {/* Resolve Modal */}
      {resolveShipmentId && (
        <ResolveModal
          shipmentId={resolveShipmentId}
          open={!!resolveShipmentId}
          onClose={handleResolveClose}
          onSuccess={handleResolveSuccess}
          shipmentInfo={
            shipments.find((s) => s.id === resolveShipmentId)
              ? {
                  orderNumber: shipments.find((s) => s.id === resolveShipmentId)!.orderNumber,
                  trackingNumber: shipments.find((s) => s.id === resolveShipmentId)!.trackingNumber,
                  customerName: shipments.find((s) => s.id === resolveShipmentId)!.customerName,
                }
              : undefined
          }
        />
      )}
    </BlockStack>
  );
}
