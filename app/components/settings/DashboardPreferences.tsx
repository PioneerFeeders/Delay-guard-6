/**
 * Dashboard Preferences Component
 *
 * Allows merchants to configure:
 * - Column visibility (which columns to show in the shipment table)
 * - Column order (drag-and-drop reordering - simplified as select-based)
 * - Default sort column and direction
 */

import {
  Card,
  BlockStack,
  Text,
  Box,
  Button,
  InlineStack,
  Checkbox,
  Select,
  Divider,
  Badge,
} from "@shopify/polaris";
import { useCallback, useMemo } from "react";

/**
 * Available columns with labels and descriptions
 */
const AVAILABLE_COLUMNS = [
  { key: "orderNumber", label: "Order #", description: "Shopify order number" },
  { key: "trackingNumber", label: "Tracking #", description: "Carrier tracking number" },
  { key: "carrier", label: "Carrier", description: "UPS, FedEx, USPS" },
  { key: "serviceLevel", label: "Service Level", description: "Ground, Priority, etc." },
  { key: "customerName", label: "Customer Name", description: "Recipient name" },
  { key: "shipDate", label: "Ship Date", description: "When shipment was created" },
  { key: "expectedDeliveryDate", label: "Expected Delivery", description: "Estimated delivery date" },
  { key: "daysDelayed", label: "Days Delayed", description: "Days past expected delivery" },
  { key: "orderValue", label: "Order Value", description: "Total order amount" },
  { key: "currentStatus", label: "Status", description: "Current shipment status" },
  { key: "lastScanLocation", label: "Last Location", description: "Last scan location" },
  { key: "fulfillmentLocationName", label: "Fulfillment Location", description: "Where order was fulfilled" },
];

/**
 * Sortable columns
 */
const SORTABLE_COLUMNS = [
  { value: "orderNumber", label: "Order #" },
  { value: "trackingNumber", label: "Tracking #" },
  { value: "carrier", label: "Carrier" },
  { value: "serviceLevel", label: "Service Level" },
  { value: "customerName", label: "Customer Name" },
  { value: "shipDate", label: "Ship Date" },
  { value: "expectedDeliveryDate", label: "Expected Delivery" },
  { value: "daysDelayed", label: "Days Delayed" },
  { value: "orderValue", label: "Order Value" },
  { value: "currentStatus", label: "Status" },
  { value: "createdAt", label: "Created Date" },
  { value: "updatedAt", label: "Updated Date" },
];

interface DashboardPreferencesProps {
  columnVisibility: string[];
  columnOrder: string[];
  defaultSortColumn: string;
  defaultSortDirection: "asc" | "desc";
  onChange: (
    columnVisibility: string[],
    columnOrder: string[],
    defaultSortColumn: string,
    defaultSortDirection: "asc" | "desc"
  ) => void;
  onSave: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
}

export function DashboardPreferences({
  columnVisibility,
  columnOrder,
  defaultSortColumn,
  defaultSortDirection,
  onChange,
  onSave,
  isSaving = false,
  hasChanges = false,
}: DashboardPreferencesProps) {
  // Handle column visibility toggle
  const handleColumnToggle = useCallback(
    (columnKey: string, checked: boolean) => {
      let newVisibility: string[];
      let newOrder: string[];

      if (checked) {
        // Add column to visibility and order (at end)
        newVisibility = [...columnVisibility, columnKey];
        newOrder = [...columnOrder, columnKey];
      } else {
        // Remove column from visibility and order
        newVisibility = columnVisibility.filter((key) => key !== columnKey);
        newOrder = columnOrder.filter((key) => key !== columnKey);
      }

      onChange(newVisibility, newOrder, defaultSortColumn, defaultSortDirection);
    },
    [columnVisibility, columnOrder, defaultSortColumn, defaultSortDirection, onChange]
  );

  // Handle sort column change
  const handleSortColumnChange = useCallback(
    (value: string) => {
      onChange(columnVisibility, columnOrder, value, defaultSortDirection);
    },
    [columnVisibility, columnOrder, defaultSortDirection, onChange]
  );

  // Handle sort direction change
  const handleSortDirectionChange = useCallback(
    (value: string) => {
      onChange(columnVisibility, columnOrder, defaultSortColumn, value as "asc" | "desc");
    },
    [columnVisibility, columnOrder, defaultSortColumn, onChange]
  );

  // Move column up in order
  const handleMoveUp = useCallback(
    (columnKey: string) => {
      const currentIndex = columnOrder.indexOf(columnKey);
      if (currentIndex <= 0) return;

      const newOrder = [...columnOrder];
      [newOrder[currentIndex - 1], newOrder[currentIndex]] = [
        newOrder[currentIndex],
        newOrder[currentIndex - 1],
      ];
      onChange(columnVisibility, newOrder, defaultSortColumn, defaultSortDirection);
    },
    [columnVisibility, columnOrder, defaultSortColumn, defaultSortDirection, onChange]
  );

  // Move column down in order
  const handleMoveDown = useCallback(
    (columnKey: string) => {
      const currentIndex = columnOrder.indexOf(columnKey);
      if (currentIndex < 0 || currentIndex >= columnOrder.length - 1) return;

      const newOrder = [...columnOrder];
      [newOrder[currentIndex], newOrder[currentIndex + 1]] = [
        newOrder[currentIndex + 1],
        newOrder[currentIndex],
      ];
      onChange(columnVisibility, newOrder, defaultSortColumn, defaultSortDirection);
    },
    [columnVisibility, columnOrder, defaultSortColumn, defaultSortDirection, onChange]
  );

  // Reset to defaults
  const handleResetDefaults = useCallback(() => {
    const defaultVisibility = [
      "orderNumber",
      "trackingNumber",
      "carrier",
      "serviceLevel",
      "customerName",
      "shipDate",
      "expectedDeliveryDate",
      "daysDelayed",
      "orderValue",
    ];
    onChange(defaultVisibility, defaultVisibility, "daysDelayed", "desc");
  }, [onChange]);

  // Get ordered visible columns for display
  const orderedVisibleColumns = useMemo(() => {
    return columnOrder
      .filter((key) => columnVisibility.includes(key))
      .map((key) => AVAILABLE_COLUMNS.find((col) => col.key === key))
      .filter(Boolean) as typeof AVAILABLE_COLUMNS;
  }, [columnVisibility, columnOrder]);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Dashboard Preferences
            </Text>
            <Button variant="plain" onClick={handleResetDefaults}>
              Reset to defaults
            </Button>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Customize which columns appear in the shipment table and how they're sorted.
          </Text>
        </BlockStack>

        {/* Column Visibility */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Visible Columns
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Select which columns to show in the shipment table.
          </Text>
          <Box
            padding="300"
            background="bg-surface-secondary"
            borderRadius="200"
          >
            <BlockStack gap="200">
              {AVAILABLE_COLUMNS.map((column) => (
                <Checkbox
                  key={column.key}
                  label={
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        {column.label}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        — {column.description}
                      </Text>
                    </InlineStack>
                  }
                  checked={columnVisibility.includes(column.key)}
                  onChange={(checked) => handleColumnToggle(column.key, checked)}
                />
              ))}
            </BlockStack>
          </Box>
        </BlockStack>

        <Divider />

        {/* Column Order */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Column Order
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Arrange the order of visible columns. Use the arrows to move columns.
          </Text>
          {orderedVisibleColumns.length > 0 ? (
            <Box
              padding="300"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <BlockStack gap="100">
                {orderedVisibleColumns.map((column, index) => (
                  <Box
                    key={column.key}
                    padding="200"
                    background="bg-surface"
                    borderRadius="100"
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="info">{String(index + 1)}</Badge>
                        <Text as="span" variant="bodyMd">
                          {column.label}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="100">
                        <Button
                          variant="plain"
                          size="slim"
                          onClick={() => handleMoveUp(column.key)}
                          disabled={index === 0}
                          accessibilityLabel={`Move ${column.label} up`}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="plain"
                          size="slim"
                          onClick={() => handleMoveDown(column.key)}
                          disabled={index === orderedVisibleColumns.length - 1}
                          accessibilityLabel={`Move ${column.label} down`}
                        >
                          ↓
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </Box>
          ) : (
            <Box
              padding="400"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                Select at least one column to show in the table.
              </Text>
            </Box>
          )}
        </BlockStack>

        <Divider />

        {/* Default Sort */}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Default Sort Order
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            How shipments are sorted when you first open the dashboard.
          </Text>
          <InlineStack gap="400">
            <Box minWidth="200px">
              <Select
                label="Sort by"
                options={SORTABLE_COLUMNS}
                value={defaultSortColumn}
                onChange={handleSortColumnChange}
              />
            </Box>
            <Box minWidth="150px">
              <Select
                label="Direction"
                options={[
                  { label: "Descending (high to low)", value: "desc" },
                  { label: "Ascending (low to high)", value: "asc" },
                ]}
                value={defaultSortDirection}
                onChange={handleSortDirectionChange}
              />
            </Box>
          </InlineStack>
        </BlockStack>

        {/* Save Button */}
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={onSave}
            loading={isSaving}
            disabled={!hasChanges}
          >
            Save Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
