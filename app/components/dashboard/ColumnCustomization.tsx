import {
  Button,
  Popover,
  BlockStack,
  Checkbox,
  Text,
  Box,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { ViewIcon, ArrowUpIcon, ArrowDownIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo } from "react";

/**
 * Column configuration for the shipment table
 */
export interface ColumnConfig {
  key: string;
  title: string;
  sortable?: boolean;
}

export const ALL_COLUMNS: ColumnConfig[] = [
  { key: "orderNumber", title: "Order #", sortable: true },
  { key: "trackingNumber", title: "Tracking #", sortable: true },
  { key: "carrier", title: "Carrier", sortable: true },
  { key: "serviceLevel", title: "Service Level", sortable: true },
  { key: "customerName", title: "Customer Name", sortable: true },
  { key: "shipDate", title: "Ship Date", sortable: true },
  { key: "expectedDeliveryDate", title: "Expected Delivery", sortable: true },
  { key: "daysDelayed", title: "Days Delayed", sortable: true },
  { key: "orderValue", title: "Order Value", sortable: true },
];

interface ColumnCustomizationProps {
  visibleColumns: string[];
  columnOrder: string[];
  onVisibilityChange: (columns: string[]) => void;
  onOrderChange: (columns: string[]) => void;
  onSave: () => void;
  hasChanges: boolean;
  isSaving?: boolean;
}

export function ColumnCustomization({
  visibleColumns,
  columnOrder,
  onVisibilityChange,
  onOrderChange,
  onSave,
  hasChanges,
  isSaving = false,
}: ColumnCustomizationProps) {
  const [popoverActive, setPopoverActive] = useState(false);

  const togglePopover = useCallback(() => {
    setPopoverActive((active) => !active);
  }, []);

  const handleVisibilityChange = useCallback(
    (columnKey: string, checked: boolean) => {
      if (checked) {
        onVisibilityChange([...visibleColumns, columnKey]);
      } else {
        // Don't allow hiding the last column
        if (visibleColumns.length > 1) {
          onVisibilityChange(visibleColumns.filter((c) => c !== columnKey));
        }
      }
    },
    [visibleColumns, onVisibilityChange]
  );

  const moveColumn = useCallback(
    (columnKey: string, direction: "up" | "down") => {
      const currentIndex = columnOrder.indexOf(columnKey);
      if (currentIndex === -1) return;

      const newOrder = [...columnOrder];
      const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (newIndex < 0 || newIndex >= columnOrder.length) return;

      // Swap positions
      [newOrder[currentIndex], newOrder[newIndex]] = [
        newOrder[newIndex],
        newOrder[currentIndex],
      ];

      onOrderChange(newOrder);
    },
    [columnOrder, onOrderChange]
  );

  // Get sorted columns for display
  const sortedColumns = useMemo(() => {
    return columnOrder
      .map((key) => ALL_COLUMNS.find((c) => c.key === key))
      .filter((c): c is ColumnConfig => c !== undefined);
  }, [columnOrder]);

  const activator = (
    <Button onClick={togglePopover} icon={ViewIcon} disclosure>
      Columns
    </Button>
  );

  return (
    <Popover
      active={popoverActive}
      activator={activator}
      onClose={togglePopover}
      preferredAlignment="right"
    >
      <Box padding="400" minWidth="300px">
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">
            Customize Columns
          </Text>

          <Text as="p" variant="bodySm" tone="subdued">
            Show or hide columns and drag to reorder.
          </Text>

          <Divider />

          <BlockStack gap="200">
            {sortedColumns.map((column, index) => (
              <InlineStack
                key={column.key}
                gap="200"
                align="space-between"
                blockAlign="center"
              >
                <Checkbox
                  label={column.title}
                  checked={visibleColumns.includes(column.key)}
                  onChange={(checked) =>
                    handleVisibilityChange(column.key, checked)
                  }
                  disabled={
                    visibleColumns.length === 1 &&
                    visibleColumns.includes(column.key)
                  }
                />
                <InlineStack gap="100">
                  <Button
                    icon={ArrowUpIcon}
                    size="micro"
                    variant="plain"
                    disabled={index === 0}
                    onClick={() => moveColumn(column.key, "up")}
                    accessibilityLabel={`Move ${column.title} up`}
                  />
                  <Button
                    icon={ArrowDownIcon}
                    size="micro"
                    variant="plain"
                    disabled={index === sortedColumns.length - 1}
                    onClick={() => moveColumn(column.key, "down")}
                    accessibilityLabel={`Move ${column.title} down`}
                  />
                </InlineStack>
              </InlineStack>
            ))}
          </BlockStack>

          {hasChanges && (
            <>
              <Divider />
              <InlineStack align="end">
                <Button
                  onClick={onSave}
                  variant="primary"
                  loading={isSaving}
                >
                  Save Changes
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Box>
    </Popover>
  );
}

/**
 * Get visible columns in the correct order
 */
export function getOrderedVisibleColumns(
  visibleColumns: string[],
  columnOrder: string[]
): ColumnConfig[] {
  const visibleSet = new Set(visibleColumns);
  return columnOrder
    .filter((key) => visibleSet.has(key))
    .map((key) => ALL_COLUMNS.find((c) => c.key === key))
    .filter((c): c is ColumnConfig => c !== undefined);
}
