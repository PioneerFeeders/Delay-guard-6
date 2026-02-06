/**
 * PreferencesStep Component
 *
 * Second step of the onboarding wizard where merchants configure:
 * - Delay threshold (hours after expected delivery before flagging)
 * - Timezone selection
 * - Notification template preview
 */

import {
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  TextField,
  Select,
  Box,
  Banner,
  Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import type { MerchantSettings } from "~/lib/validation";

// Common timezones for US and international merchants
const TIMEZONE_OPTIONS = [
  { label: "Eastern Time (ET)", value: "America/New_York" },
  { label: "Central Time (CT)", value: "America/Chicago" },
  { label: "Mountain Time (MT)", value: "America/Denver" },
  { label: "Pacific Time (PT)", value: "America/Los_Angeles" },
  { label: "Alaska Time (AKT)", value: "America/Anchorage" },
  { label: "Hawaii Time (HT)", value: "Pacific/Honolulu" },
  { label: "UTC", value: "UTC" },
  { label: "London (GMT/BST)", value: "Europe/London" },
  { label: "Central European Time (CET)", value: "Europe/Paris" },
  { label: "Australian Eastern Time (AET)", value: "Australia/Sydney" },
];

interface PreferencesStepProps {
  initialSettings: MerchantSettings;
  initialTimezone: string;
  onNext: (preferences: { settings: Partial<MerchantSettings>; timezone: string }) => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export function PreferencesStep({
  initialSettings,
  initialTimezone,
  onNext,
  onBack,
  isSubmitting,
}: PreferencesStepProps) {
  const [delayThreshold, setDelayThreshold] = useState(
    String(initialSettings.delayThresholdHours)
  );
  const [timezone, setTimezone] = useState(initialTimezone);
  const [error, setError] = useState<string | null>(null);

  const handleDelayThresholdChange = useCallback((value: string) => {
    setDelayThreshold(value);
    setError(null);
  }, []);

  const handleTimezoneChange = useCallback((value: string) => {
    setTimezone(value);
  }, []);

  const handleNext = useCallback(() => {
    const threshold = parseInt(delayThreshold, 10);
    if (isNaN(threshold) || threshold < 0 || threshold > 72) {
      setError("Delay threshold must be between 0 and 72 hours");
      return;
    }

    onNext({
      settings: {
        delayThresholdHours: threshold,
      },
      timezone,
    });
  }, [delayThreshold, timezone, onNext]);

  // Sample template preview
  const sampleTemplate = initialSettings.notificationTemplate;

  return (
    <Card>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">
            Configure Your Preferences
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            Customize how DelayGuard detects and handles delays
          </Text>
        </BlockStack>

        <BlockStack gap="500">
          {/* Delay Threshold */}
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Delay Detection
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              How long after the expected delivery date should a package be flagged as delayed?
            </Text>
            <Box maxWidth="200px">
              <TextField
                label="Grace period (hours)"
                type="number"
                value={delayThreshold}
                onChange={handleDelayThresholdChange}
                min={0}
                max={72}
                suffix="hours"
                autoComplete="off"
                error={error || undefined}
                helpText="Packages won't be marked delayed until this time has passed after expected delivery"
              />
            </Box>
          </BlockStack>

          <Divider />

          {/* Timezone */}
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Timezone
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Select your store's timezone for accurate delivery calculations
            </Text>
            <Box maxWidth="300px">
              <Select
                label="Store timezone"
                options={TIMEZONE_OPTIONS}
                value={timezone}
                onChange={handleTimezoneChange}
              />
            </Box>
          </BlockStack>

          <Divider />

          {/* Notification Template Preview */}
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Notification Email Template
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Here's a preview of the email customers will receive. You can customize this later in Settings.
            </Text>
            <Banner tone="info" hideIcon>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Subject: {sampleTemplate.subject}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
                    {sampleTemplate.body}
                  </pre>
                </Text>
              </BlockStack>
            </Banner>
          </BlockStack>
        </BlockStack>

        <Box paddingBlockStart="400">
          <InlineStack align="space-between">
            <Button onClick={onBack} disabled={isSubmitting}>
              Back
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={handleNext}
              loading={isSubmitting}
            >
              Continue
            </Button>
          </InlineStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
