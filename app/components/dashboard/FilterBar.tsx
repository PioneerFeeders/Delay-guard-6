import {
  Button,
  Popover,
  ActionList,
  TextField,
  DatePicker,
  InlineStack,
  Box,
  ChoiceList,
  Text,
  BlockStack,
  Tag,
} from "@shopify/polaris";
import { XSmallIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo } from "react";
import type { CarrierType, DelayStatus } from "~/lib/validation";

export interface FilterValues {
  carrier?: CarrierType[];
  serviceLevel?: string;
  delayStatus?: DelayStatus;
  orderValueMin?: number;
  orderValueMax?: number;
  shipDateFrom?: string;
  shipDateTo?: string;
  locationId?: string;
}

interface FilterBarProps {
  filters: FilterValues;
  onFiltersChange: (filters: FilterValues) => void;
  onClearFilters: () => void;
  locations?: Array<{ id: string; name: string }>;
  serviceLevels?: string[];
}

const CARRIER_OPTIONS = [
  { label: "UPS", value: "UPS" },
  { label: "FedEx", value: "FEDEX" },
  { label: "USPS", value: "USPS" },
  { label: "Unknown", value: "UNKNOWN" },
] as const;

const DELAY_STATUS_OPTIONS = [
  { label: "Delayed", value: "delayed" },
  { label: "On Time", value: "on_time" },
  { label: "Pending", value: "pending" },
] as const;

export function FilterBar({
  filters,
  onFiltersChange,
  onClearFilters,
  locations = [],
  serviceLevels = [],
}: FilterBarProps) {
  // Popover states
  const [carrierPopoverActive, setCarrierPopoverActive] = useState(false);
  const [datePopoverActive, setDatePopoverActive] = useState(false);
  const [valuePopoverActive, setValuePopoverActive] = useState(false);
  const [locationPopoverActive, setLocationPopoverActive] = useState(false);
  const [serviceLevelPopoverActive, setServiceLevelPopoverActive] = useState(false);
  const [delayStatusPopoverActive, setDelayStatusPopoverActive] = useState(false);

  // Date picker state
  const [{ month, year }, setDate] = useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  });

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.carrier && filters.carrier.length > 0) count++;
    if (filters.serviceLevel) count++;
    if (filters.delayStatus) count++;
    if (filters.orderValueMin !== undefined || filters.orderValueMax !== undefined) count++;
    if (filters.shipDateFrom || filters.shipDateTo) count++;
    if (filters.locationId) count++;
    return count;
  }, [filters]);

  const hasActiveFilters = activeFilterCount > 0;

  // Handlers
  const handleCarrierChange = useCallback(
    (selected: string[]) => {
      onFiltersChange({
        ...filters,
        carrier: selected.length > 0 ? (selected as CarrierType[]) : undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleDelayStatusChange = useCallback(
    (selected: string[]) => {
      onFiltersChange({
        ...filters,
        delayStatus: selected[0] as DelayStatus | undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleServiceLevelChange = useCallback(
    (value: string) => {
      onFiltersChange({
        ...filters,
        serviceLevel: value || undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleOrderValueMinChange = useCallback(
    (value: string) => {
      const numValue = value ? parseFloat(value) : undefined;
      onFiltersChange({
        ...filters,
        orderValueMin: numValue && !isNaN(numValue) ? numValue : undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleOrderValueMaxChange = useCallback(
    (value: string) => {
      const numValue = value ? parseFloat(value) : undefined;
      onFiltersChange({
        ...filters,
        orderValueMax: numValue && !isNaN(numValue) ? numValue : undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleShipDateFromChange = useCallback(
    (value: { start: Date; end: Date }) => {
      onFiltersChange({
        ...filters,
        shipDateFrom: value.start.toISOString().split("T")[0],
        shipDateTo: value.end.toISOString().split("T")[0],
      });
      setDatePopoverActive(false);
    },
    [filters, onFiltersChange]
  );

  const handleLocationChange = useCallback(
    (selected: string[]) => {
      onFiltersChange({
        ...filters,
        locationId: selected[0] || undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleMonthChange = useCallback(
    (month: number, year: number) => setDate({ month, year }),
    []
  );

  // Remove individual filter
  const removeCarrierFilter = useCallback(() => {
    onFiltersChange({ ...filters, carrier: undefined });
  }, [filters, onFiltersChange]);

  const removeDelayStatusFilter = useCallback(() => {
    onFiltersChange({ ...filters, delayStatus: undefined });
  }, [filters, onFiltersChange]);

  const removeServiceLevelFilter = useCallback(() => {
    onFiltersChange({ ...filters, serviceLevel: undefined });
  }, [filters, onFiltersChange]);

  const removeOrderValueFilter = useCallback(() => {
    onFiltersChange({ ...filters, orderValueMin: undefined, orderValueMax: undefined });
  }, [filters, onFiltersChange]);

  const removeDateFilter = useCallback(() => {
    onFiltersChange({ ...filters, shipDateFrom: undefined, shipDateTo: undefined });
  }, [filters, onFiltersChange]);

  const removeLocationFilter = useCallback(() => {
    onFiltersChange({ ...filters, locationId: undefined });
  }, [filters, onFiltersChange]);

  // Build applied filters for display
  const appliedFilters = useMemo(() => {
    const applied: Array<{
      key: string;
      label: string;
      onRemove: () => void;
    }> = [];

    if (filters.carrier && filters.carrier.length > 0) {
      applied.push({
        key: "carrier",
        label: `Carrier: ${filters.carrier.join(", ")}`,
        onRemove: removeCarrierFilter,
      });
    }

    if (filters.delayStatus) {
      const statusLabel = DELAY_STATUS_OPTIONS.find((o) => o.value === filters.delayStatus)?.label;
      applied.push({
        key: "delayStatus",
        label: `Status: ${statusLabel}`,
        onRemove: removeDelayStatusFilter,
      });
    }

    if (filters.serviceLevel) {
      applied.push({
        key: "serviceLevel",
        label: `Service: ${filters.serviceLevel}`,
        onRemove: removeServiceLevelFilter,
      });
    }

    if (filters.orderValueMin !== undefined || filters.orderValueMax !== undefined) {
      let label = "Value: ";
      if (filters.orderValueMin !== undefined && filters.orderValueMax !== undefined) {
        label += `$${filters.orderValueMin} - $${filters.orderValueMax}`;
      } else if (filters.orderValueMin !== undefined) {
        label += `>= $${filters.orderValueMin}`;
      } else {
        label += `<= $${filters.orderValueMax}`;
      }
      applied.push({
        key: "orderValue",
        label,
        onRemove: removeOrderValueFilter,
      });
    }

    if (filters.shipDateFrom || filters.shipDateTo) {
      let label = "Ship date: ";
      if (filters.shipDateFrom && filters.shipDateTo) {
        label += `${filters.shipDateFrom} to ${filters.shipDateTo}`;
      } else if (filters.shipDateFrom) {
        label += `from ${filters.shipDateFrom}`;
      } else {
        label += `to ${filters.shipDateTo}`;
      }
      applied.push({
        key: "shipDate",
        label,
        onRemove: removeDateFilter,
      });
    }

    if (filters.locationId) {
      const locationName = locations.find((l) => l.id === filters.locationId)?.name || filters.locationId;
      applied.push({
        key: "location",
        label: `Location: ${locationName}`,
        onRemove: removeLocationFilter,
      });
    }

    return applied;
  }, [
    filters,
    locations,
    removeCarrierFilter,
    removeDelayStatusFilter,
    removeServiceLevelFilter,
    removeOrderValueFilter,
    removeDateFilter,
    removeLocationFilter,
  ]);

  // Selected date range for picker
  const selectedDates = useMemo(() => {
    if (filters.shipDateFrom && filters.shipDateTo) {
      return {
        start: new Date(filters.shipDateFrom),
        end: new Date(filters.shipDateTo),
      };
    }
    return undefined;
  }, [filters.shipDateFrom, filters.shipDateTo]);

  // Get button labels with filter count indicators
  const getCarrierButtonLabel = () => {
    if (filters.carrier && filters.carrier.length > 0) {
      return `Carrier (${filters.carrier.length})`;
    }
    return "Carrier";
  };

  const getStatusButtonLabel = () => {
    if (filters.delayStatus) {
      return "Status (1)";
    }
    return "Status";
  };

  const getServiceLevelButtonLabel = () => {
    if (filters.serviceLevel) {
      return "Service Level (1)";
    }
    return "Service Level";
  };

  const getOrderValueButtonLabel = () => {
    if (filters.orderValueMin !== undefined || filters.orderValueMax !== undefined) {
      return "Order Value (1)";
    }
    return "Order Value";
  };

  const getShipDateButtonLabel = () => {
    if (filters.shipDateFrom || filters.shipDateTo) {
      return "Ship Date (1)";
    }
    return "Ship Date";
  };

  const getLocationButtonLabel = () => {
    if (filters.locationId) {
      return "Location (1)";
    }
    return "Location";
  };

  return (
    <Box paddingBlockEnd="400">
      <InlineStack gap="200" wrap={true} blockAlign="center">
        {/* Carrier Filter */}
        <Popover
          active={carrierPopoverActive}
          activator={
            <Button
              onClick={() => setCarrierPopoverActive(!carrierPopoverActive)}
              disclosure={carrierPopoverActive ? "up" : "down"}
              size="slim"
            >
              {getCarrierButtonLabel()}
            </Button>
          }
          onClose={() => setCarrierPopoverActive(false)}
          preferredAlignment="left"
        >
          <Box padding="300" minWidth="200px">
            <ChoiceList
              title="Carrier"
              titleHidden
              choices={CARRIER_OPTIONS.map((opt) => ({
                label: opt.label,
                value: opt.value,
              }))}
              selected={filters.carrier || []}
              onChange={handleCarrierChange}
              allowMultiple
            />
          </Box>
        </Popover>

        {/* Delay Status Filter */}
        <Popover
          active={delayStatusPopoverActive}
          activator={
            <Button
              onClick={() => setDelayStatusPopoverActive(!delayStatusPopoverActive)}
              disclosure={delayStatusPopoverActive ? "up" : "down"}
              size="slim"
            >
              {getStatusButtonLabel()}
            </Button>
          }
          onClose={() => setDelayStatusPopoverActive(false)}
          preferredAlignment="left"
        >
          <Box padding="300" minWidth="200px">
            <ChoiceList
              title="Delay Status"
              titleHidden
              choices={DELAY_STATUS_OPTIONS.map((opt) => ({
                label: opt.label,
                value: opt.value,
              }))}
              selected={filters.delayStatus ? [filters.delayStatus] : []}
              onChange={handleDelayStatusChange}
            />
          </Box>
        </Popover>

        {/* Service Level Filter */}
        {serviceLevels.length > 0 && (
          <Popover
            active={serviceLevelPopoverActive}
            activator={
              <Button
                onClick={() => setServiceLevelPopoverActive(!serviceLevelPopoverActive)}
                disclosure={serviceLevelPopoverActive ? "up" : "down"}
                size="slim"
              >
                {getServiceLevelButtonLabel()}
              </Button>
            }
            onClose={() => setServiceLevelPopoverActive(false)}
            preferredAlignment="left"
          >
            <ActionList
              items={[
                { content: "All", onAction: () => handleServiceLevelChange("") },
                ...serviceLevels.map((level) => ({
                  content: level,
                  onAction: () => {
                    handleServiceLevelChange(level);
                    setServiceLevelPopoverActive(false);
                  },
                })),
              ]}
            />
          </Popover>
        )}

        {/* Order Value Filter */}
        <Popover
          active={valuePopoverActive}
          activator={
            <Button
              onClick={() => setValuePopoverActive(!valuePopoverActive)}
              disclosure={valuePopoverActive ? "up" : "down"}
              size="slim"
            >
              {getOrderValueButtonLabel()}
            </Button>
          }
          onClose={() => setValuePopoverActive(false)}
          preferredAlignment="left"
        >
          <Box padding="400" minWidth="280px">
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Order Value Range
              </Text>
              <InlineStack gap="200">
                <TextField
                  label="Min ($)"
                  type="number"
                  value={filters.orderValueMin?.toString() || ""}
                  onChange={handleOrderValueMinChange}
                  autoComplete="off"
                  min={0}
                  labelHidden
                  placeholder="Min"
                  prefix="$"
                />
                <TextField
                  label="Max ($)"
                  type="number"
                  value={filters.orderValueMax?.toString() || ""}
                  onChange={handleOrderValueMaxChange}
                  autoComplete="off"
                  min={0}
                  labelHidden
                  placeholder="Max"
                  prefix="$"
                />
              </InlineStack>
            </BlockStack>
          </Box>
        </Popover>

        {/* Ship Date Filter */}
        <Popover
          active={datePopoverActive}
          activator={
            <Button
              onClick={() => setDatePopoverActive(!datePopoverActive)}
              disclosure={datePopoverActive ? "up" : "down"}
              size="slim"
            >
              {getShipDateButtonLabel()}
            </Button>
          }
          onClose={() => setDatePopoverActive(false)}
          preferredAlignment="left"
          sectioned
        >
          <Box padding="400">
            <DatePicker
              month={month}
              year={year}
              onChange={handleShipDateFromChange}
              onMonthChange={handleMonthChange}
              selected={selectedDates}
              allowRange
            />
          </Box>
        </Popover>

        {/* Location Filter (only shown if locations exist) */}
        {locations.length > 0 && (
          <Popover
            active={locationPopoverActive}
            activator={
              <Button
                onClick={() => setLocationPopoverActive(!locationPopoverActive)}
                disclosure={locationPopoverActive ? "up" : "down"}
                size="slim"
              >
                {getLocationButtonLabel()}
              </Button>
            }
            onClose={() => setLocationPopoverActive(false)}
            preferredAlignment="left"
          >
            <ActionList
              items={[
                {
                  content: "All Locations",
                  onAction: () => {
                    handleLocationChange([]);
                    setLocationPopoverActive(false);
                  },
                },
                ...locations.map((loc) => ({
                  content: loc.name,
                  onAction: () => {
                    handleLocationChange([loc.id]);
                    setLocationPopoverActive(false);
                  },
                })),
              ]}
            />
          </Popover>
        )}

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <Button
            onClick={onClearFilters}
            icon={XSmallIcon}
            size="slim"
            tone="critical"
          >
            {`Clear filters (${activeFilterCount})`}
          </Button>
        )}
      </InlineStack>

      {/* Applied filters as tags */}
      {appliedFilters.length > 0 && (
        <Box paddingBlockStart="300">
          <InlineStack gap="200" wrap={true}>
            {appliedFilters.map((filter) => (
              <Tag key={filter.key} onRemove={filter.onRemove}>
                {filter.label}
              </Tag>
            ))}
          </InlineStack>
        </Box>
      )}
    </Box>
  );
}
