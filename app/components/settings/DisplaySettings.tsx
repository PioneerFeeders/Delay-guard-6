/**
 * Display Settings Component
 *
 * Allows merchants to configure:
 * - Timezone selection for date/time display
 * - Auto-archive days (how long to keep delivered shipments visible)
 */

import {
  Card,
  BlockStack,
  TextField,
  Text,
  Select,
  Button,
  InlineStack,
  Banner,
  Divider,
  Modal,
} from "@shopify/polaris";
import { useState, useCallback, useMemo } from "react";
import { useFetcher } from "@remix-run/react";

/**
 * Common timezone options for US merchants (primary market)
 * Grouped by region for easier selection
 */
const TIMEZONE_OPTIONS = [
  { label: "— US Time Zones —", value: "", disabled: true },
  { label: "Pacific Time (Los Angeles)", value: "America/Los_Angeles" },
  { label: "Mountain Time (Denver)", value: "America/Denver" },
  { label: "Arizona (no DST)", value: "America/Phoenix" },
  { label: "Central Time (Chicago)", value: "America/Chicago" },
  { label: "Eastern Time (New York)", value: "America/New_York" },
  { label: "Alaska Time", value: "America/Anchorage" },
  { label: "Hawaii Time", value: "Pacific/Honolulu" },
  { label: "— Canada —", value: "", disabled: true },
  { label: "Pacific Time (Vancouver)", value: "America/Vancouver" },
  { label: "Mountain Time (Edmonton)", value: "America/Edmonton" },
  { label: "Central Time (Winnipeg)", value: "America/Winnipeg" },
  { label: "Eastern Time (Toronto)", value: "America/Toronto" },
  { label: "Atlantic Time (Halifax)", value: "America/Halifax" },
  { label: "— Other —", value: "", disabled: true },
  { label: "UTC (Coordinated Universal Time)", value: "UTC" },
  { label: "London (GMT/BST)", value: "Europe/London" },
  { label: "Paris (CET/CEST)", value: "Europe/Paris" },
  { label: "Sydney (AEST/AEDT)", value: "Australia/Sydney" },
];

interface DisplaySettingsProps {
  timezone: string;
  autoArchiveDays: number;
  onTimezoneChange: (timezone: string) => void;
  onAutoArchiveDaysChange: (days: number) => void;
  onSave: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
}

export function DisplaySettings({
  timezone,
  autoArchiveDays,
  onTimezoneChange,
  onAutoArchiveDaysChange,
  onSave,
  isSaving = false,
  hasChanges = false,
}: DisplaySettingsProps) {
  const [archiveDaysError, setArchiveDaysError] = useState<string | undefined>();
  const [showClearTestDataModal, setShowClearTestDataModal] = useState(false);
  const [testDataCleared, setTestDataCleared] = useState(false);

  const clearTestDataFetcher = useFetcher<{ success?: boolean; count?: number; error?: string }>();
  const isClearingTestData = clearTestDataFetcher.state === "submitting";

  // Handle clear test data
  const handleClearTestData = useCallback(() => {
    clearTestDataFetcher.submit(
      { _action: "clearTestData" },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json",
      }
    );
    setShowClearTestDataModal(false);
  }, [clearTestDataFetcher]);

  // Show success message when test data is cleared
  if (clearTestDataFetcher.data?.success && !testDataCleared) {
    setTestDataCleared(true);
    setTimeout(() => setTestDataCleared(false), 5000);
  }

  // Handle timezone change
  const handleTimezoneChange = useCallback(
    (value: string) => {
      onTimezoneChange(value);
    },
    [onTimezoneChange]
  );

  // Handle auto-archive days change with validation
  const handleArchiveDaysChange = useCallback(
    (value: string) => {
      const numValue = parseInt(value, 10);
      if (isNaN(numValue)) {
        setArchiveDaysError("Please enter a number");
        return;
      }
      if (numValue < 1) {
        setArchiveDaysError("Must be at least 1 day");
        return;
      }
      if (numValue > 365) {
        setArchiveDaysError("Maximum is 365 days");
        return;
      }
      setArchiveDaysError(undefined);
      onAutoArchiveDaysChange(numValue);
    },
    [onAutoArchiveDaysChange]
  );

  // Get current time in selected timezone for preview
  const currentTimePreview = useMemo(() => {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      });
      return formatter.format(new Date());
    } catch {
      return "Invalid timezone";
    }
  }, [timezone]);

  const validationPassed = !archiveDaysError;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Display Settings
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Configure how dates and times are displayed in the dashboard.
          </Text>
        </BlockStack>

        {/* Timezone Selection */}
        <BlockStack gap="200">
          <Select
            label="Timezone"
            options={TIMEZONE_OPTIONS}
            value={timezone}
            onChange={handleTimezoneChange}
            helpText="All dates and times will be displayed in this timezone"
          />
          <Text as="p" variant="bodySm" tone="subdued">
            Current time in selected timezone: <strong>{currentTimePreview}</strong>
          </Text>
        </BlockStack>

        {/* Auto-Archive Days */}
        <BlockStack gap="200">
          <TextField
            label="Auto-archive delivered shipments after"
            type="number"
            value={String(autoArchiveDays)}
            onChange={handleArchiveDaysChange}
            error={archiveDaysError}
            autoComplete="off"
            min={1}
            max={365}
            suffix="days"
            helpText="Delivered shipments will be hidden from the main view after this many days"
          />
          <Banner tone="info">
            <p>
              Archived shipments are not deleted. They remain in the database for reporting
              and can be exported at any time. This setting only affects dashboard visibility.
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

        <Divider />

        {/* Test Data Management Section */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Test Data Management
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Clear test shipments created during onboarding or testing. This action cannot be undone.
          </Text>

          {testDataCleared && (
            <Banner
              title="Test data cleared"
              tone="success"
              onDismiss={() => setTestDataCleared(false)}
            >
              <p>
                {clearTestDataFetcher.data?.count} test shipment(s) have been removed.
              </p>
            </Banner>
          )}

          {clearTestDataFetcher.data?.error && (
            <Banner title="Error" tone="critical">
              <p>{clearTestDataFetcher.data.error}</p>
            </Banner>
          )}

          <InlineStack align="start">
            <Button
              tone="critical"
              onClick={() => setShowClearTestDataModal(true)}
              loading={isClearingTestData}
            >
              Clear Test Data
            </Button>
          </InlineStack>
        </BlockStack>
      </BlockStack>

      {/* Confirmation Modal */}
      <Modal
        open={showClearTestDataModal}
        onClose={() => setShowClearTestDataModal(false)}
        title="Clear Test Data"
        primaryAction={{
          content: "Clear Test Data",
          destructive: true,
          onAction: handleClearTestData,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowClearTestDataModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to clear all test shipments? This will permanently remove
            all shipments marked as test data, including their tracking history and notifications.
          </Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Card>
  );
}
