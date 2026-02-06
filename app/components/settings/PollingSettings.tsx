/**
 * Polling Settings Component
 *
 * Allows merchants to configure:
 * - Delay threshold (hours after expected delivery to flag as delayed)
 * - Default delivery windows by service level
 */

import {
  Card,
  BlockStack,
  TextField,
  Text,
  Box,
  Button,
  InlineStack,
  DataTable,
  Select,
  Popover,
  Icon,
  Banner,
} from "@shopify/polaris";
import { PlusCircleIcon, DeleteIcon, EditIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo } from "react";
import {
  DEFAULT_DELIVERY_WINDOWS,
  getServiceLevelLabel,
} from "~/services/delay-detection.service";

interface PollingSettingsProps {
  delayThresholdHours: number;
  deliveryWindows: Record<string, number>;
  onChange: (delayThresholdHours: number, deliveryWindows: Record<string, number>) => void;
  onSave: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
}

export function PollingSettings({
  delayThresholdHours,
  deliveryWindows,
  onChange,
  onSave,
  isSaving = false,
  hasChanges = false,
}: PollingSettingsProps) {
  const [thresholdError, setThresholdError] = useState<string | undefined>();
  const [showAddWindow, setShowAddWindow] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newServiceLevel, setNewServiceLevel] = useState("");
  const [newDays, setNewDays] = useState("5");

  // Validate delay threshold
  const handleThresholdChange = useCallback(
    (value: string) => {
      const numValue = parseInt(value, 10);
      if (isNaN(numValue)) {
        setThresholdError("Please enter a number");
        return;
      }
      if (numValue < 0) {
        setThresholdError("Must be 0 or greater");
        return;
      }
      if (numValue > 72) {
        setThresholdError("Maximum is 72 hours");
        return;
      }
      setThresholdError(undefined);
      onChange(numValue, deliveryWindows);
    },
    [deliveryWindows, onChange]
  );

  // Get available service levels that aren't already overridden
  const availableServiceLevels = useMemo(() => {
    const existingKeys = new Set(Object.keys(deliveryWindows));
    return Object.keys(DEFAULT_DELIVERY_WINDOWS)
      .filter((key) => !existingKeys.has(key))
      .map((key) => ({
        label: getServiceLevelLabel(key),
        value: key,
      }));
  }, [deliveryWindows]);

  // Handle adding a new delivery window override
  const handleAddWindow = useCallback(() => {
    if (!newServiceLevel || !newDays) return;
    const days = parseInt(newDays, 10);
    if (isNaN(days) || days < 1) return;

    const updatedWindows = {
      ...deliveryWindows,
      [newServiceLevel]: days,
    };
    onChange(delayThresholdHours, updatedWindows);
    setShowAddWindow(false);
    setNewServiceLevel("");
    setNewDays("5");
  }, [newServiceLevel, newDays, deliveryWindows, delayThresholdHours, onChange]);

  // Handle removing a delivery window override
  const handleRemoveWindow = useCallback(
    (key: string) => {
      const { [key]: _removed, ...rest } = deliveryWindows;
      onChange(delayThresholdHours, rest);
    },
    [deliveryWindows, delayThresholdHours, onChange]
  );

  // Handle updating a delivery window
  const handleUpdateWindow = useCallback(
    (key: string, days: number) => {
      if (days < 1) return;
      const updatedWindows = {
        ...deliveryWindows,
        [key]: days,
      };
      onChange(delayThresholdHours, updatedWindows);
      setEditingKey(null);
    },
    [deliveryWindows, delayThresholdHours, onChange]
  );

  // Build table rows for delivery window overrides
  const windowRows = useMemo(() => {
    return Object.entries(deliveryWindows).map(([key, days]) => {
      const defaultDays = DEFAULT_DELIVERY_WINDOWS[key];
      const isEditing = editingKey === key;

      return [
        <Text key={`${key}-label`} as="span" variant="bodyMd">
          {getServiceLevelLabel(key)}
        </Text>,
        defaultDays ? (
          <Text key={`${key}-default`} as="span" variant="bodyMd" tone="subdued">
            {defaultDays} {defaultDays === 1 ? "day" : "days"}
          </Text>
        ) : (
          <Text key={`${key}-default`} as="span" variant="bodyMd" tone="subdued">
            —
          </Text>
        ),
        isEditing ? (
          <InlineStack key={`${key}-override`} gap="200" blockAlign="center">
            <TextField
              label=""
              labelHidden
              type="number"
              value={String(days)}
              onChange={(value) => {
                const newDays = parseInt(value, 10);
                if (!isNaN(newDays) && newDays >= 1) {
                  handleUpdateWindow(key, newDays);
                }
              }}
              autoComplete="off"
              min={1}
              max={30}
            />
            <Button onClick={() => setEditingKey(null)} size="slim">
              Done
            </Button>
          </InlineStack>
        ) : (
          <Text key={`${key}-override`} as="span" variant="bodyMd" fontWeight="semibold">
            {days} {days === 1 ? "day" : "days"}
          </Text>
        ),
        <InlineStack key={`${key}-actions`} gap="100">
          <Button
            variant="plain"
            icon={<Icon source={EditIcon} />}
            onClick={() => setEditingKey(key)}
            accessibilityLabel={`Edit ${getServiceLevelLabel(key)}`}
          />
          <Button
            variant="plain"
            tone="critical"
            icon={<Icon source={DeleteIcon} />}
            onClick={() => handleRemoveWindow(key)}
            accessibilityLabel={`Remove ${getServiceLevelLabel(key)} override`}
          />
        </InlineStack>,
      ];
    });
  }, [deliveryWindows, editingKey, handleUpdateWindow, handleRemoveWindow]);

  const validationPassed = !thresholdError;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Polling & Detection
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Configure when shipments are flagged as delayed and customize delivery expectations.
          </Text>
        </BlockStack>

        {/* Delay Threshold */}
        <BlockStack gap="200">
          <TextField
            label="Delay threshold (hours)"
            type="number"
            value={String(delayThresholdHours)}
            onChange={handleThresholdChange}
            error={thresholdError}
            autoComplete="off"
            min={0}
            max={72}
            helpText="Hours after expected delivery before flagging as delayed (default: 8 hours)"
          />
        </BlockStack>

        {/* Delivery Windows */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">
              Delivery Window Overrides
            </Text>
            <Popover
              active={showAddWindow}
              activator={
                <Button
                  variant="plain"
                  icon={<Icon source={PlusCircleIcon} />}
                  onClick={() => setShowAddWindow(true)}
                  disabled={availableServiceLevels.length === 0}
                >
                  Add override
                </Button>
              }
              onClose={() => setShowAddWindow(false)}
            >
              <Box padding="400" minWidth="300px">
                <BlockStack gap="300">
                  <Text as="h4" variant="headingSm">
                    Add Delivery Window Override
                  </Text>
                  <Select
                    label="Service Level"
                    options={[
                      { label: "Select a service level...", value: "" },
                      ...availableServiceLevels,
                    ]}
                    value={newServiceLevel}
                    onChange={setNewServiceLevel}
                  />
                  <TextField
                    label="Business Days"
                    type="number"
                    value={newDays}
                    onChange={setNewDays}
                    autoComplete="off"
                    min={1}
                    max={30}
                    helpText="Expected delivery time in business days"
                  />
                  <InlineStack gap="200" align="end">
                    <Button onClick={() => setShowAddWindow(false)}>Cancel</Button>
                    <Button
                      variant="primary"
                      onClick={handleAddWindow}
                      disabled={!newServiceLevel || !newDays}
                    >
                      Add
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Popover>
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            Override the default delivery windows for specific service levels. These are used when the carrier doesn't provide an expected delivery date.
          </Text>

          {Object.keys(deliveryWindows).length > 0 ? (
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={["Service Level", "Default", "Your Override", ""]}
              rows={windowRows}
            />
          ) : (
            <Box
              padding="400"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                No delivery window overrides. Click "Add override" to customize delivery expectations for specific service levels.
              </Text>
            </Box>
          )}

          <Banner tone="info">
            <p>
              Default delivery windows are used when carriers don't provide expected delivery dates.
              For example, UPS Ground defaults to 5 business days, USPS Priority Mail to 3 business days.
            </p>
          </Banner>
        </BlockStack>

        {/* Save Button */}
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={onSave}
            loading={isSaving}
            disabled={!hasChanges || !validationPassed}
          >
            Save Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
