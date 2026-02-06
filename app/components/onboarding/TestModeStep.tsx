/**
 * TestModeStep Component
 *
 * Final step of the onboarding wizard that offers:
 * - Option to add a test shipment with real or fake tracking number
 * - Pre-loaded dummy data option
 * - Skip option to go straight to dashboard
 */

import {
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Box,
  TextField,
  Select,
  Banner,
  Checkbox,
  Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";

interface TestModeStepProps {
  onComplete: (addTestData: boolean, testShipment?: TestShipmentData) => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export interface TestShipmentData {
  trackingNumber: string;
  carrier: "UPS" | "FEDEX" | "USPS";
  customerName: string;
  customerEmail: string;
  orderNumber: string;
}

// Sample test tracking numbers (these are placeholder patterns)
const SAMPLE_TRACKING_NUMBERS = {
  UPS: "1Z999AA10123456784",
  FEDEX: "449044304137821",
  USPS: "9400111899223033005011",
};

export function TestModeStep({ onComplete, onBack, isSubmitting }: TestModeStepProps) {
  const [wantTestData, setWantTestData] = useState(false);
  const [useRealTracking, setUseRealTracking] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState<"UPS" | "FEDEX" | "USPS">("UPS");
  const [customerName, setCustomerName] = useState("Test Customer");
  const [customerEmail, setCustomerEmail] = useState("test@example.com");
  const [orderNumber, setOrderNumber] = useState("#TEST-001");

  const handleCarrierChange = useCallback((value: string) => {
    const newCarrier = value as "UPS" | "FEDEX" | "USPS";
    setCarrier(newCarrier);
    // Update sample tracking number if not using real tracking
    if (!useRealTracking) {
      setTrackingNumber(SAMPLE_TRACKING_NUMBERS[newCarrier]);
    }
  }, [useRealTracking]);

  const handleUseRealTrackingChange = useCallback((checked: boolean) => {
    setUseRealTracking(checked);
    if (!checked) {
      // Reset to sample tracking number
      setTrackingNumber(SAMPLE_TRACKING_NUMBERS[carrier]);
    } else {
      setTrackingNumber("");
    }
  }, [carrier]);

  const handleSkip = useCallback(() => {
    onComplete(false);
  }, [onComplete]);

  const handleAddTestData = useCallback(() => {
    if (!wantTestData) {
      onComplete(false);
      return;
    }

    const testShipment: TestShipmentData = {
      trackingNumber: trackingNumber || SAMPLE_TRACKING_NUMBERS[carrier],
      carrier,
      customerName,
      customerEmail,
      orderNumber,
    };

    onComplete(true, testShipment);
  }, [wantTestData, trackingNumber, carrier, customerName, customerEmail, orderNumber, onComplete]);

  return (
    <Card>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">
            Test Mode (Optional)
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            Try out DelayGuard with a test shipment before going live
          </Text>
        </BlockStack>

        <Banner tone="info">
          <Text as="p" variant="bodyMd">
            Test shipments will be clearly marked with a "Test Data" badge in the dashboard.
            You can clear test data anytime from Settings.
          </Text>
        </Banner>

        <BlockStack gap="400">
          <Checkbox
            label="Add a test shipment to explore the dashboard"
            checked={wantTestData}
            onChange={setWantTestData}
          />

          {wantTestData && (
            <Box paddingInlineStart="600">
              <BlockStack gap="400">
                <Divider />

                <BlockStack gap="300">
                  <Select
                    label="Carrier"
                    options={[
                      { label: "UPS", value: "UPS" },
                      { label: "FedEx", value: "FEDEX" },
                      { label: "USPS", value: "USPS" },
                    ]}
                    value={carrier}
                    onChange={handleCarrierChange}
                  />

                  <Checkbox
                    label="Use a real tracking number (will be tracked by carrier API)"
                    checked={useRealTracking}
                    onChange={handleUseRealTrackingChange}
                    helpText={
                      useRealTracking
                        ? "Enter a real tracking number to see live tracking updates"
                        : "A sample tracking number will be used for demonstration"
                    }
                  />

                  {useRealTracking && (
                    <TextField
                      label="Tracking number"
                      value={trackingNumber}
                      onChange={setTrackingNumber}
                      placeholder={`Enter a ${carrier} tracking number`}
                      autoComplete="off"
                    />
                  )}

                  <TextField
                    label="Customer name"
                    value={customerName}
                    onChange={setCustomerName}
                    autoComplete="off"
                  />

                  <TextField
                    label="Customer email"
                    type="email"
                    value={customerEmail}
                    onChange={setCustomerEmail}
                    autoComplete="off"
                  />

                  <TextField
                    label="Order number"
                    value={orderNumber}
                    onChange={setOrderNumber}
                    autoComplete="off"
                  />
                </BlockStack>
              </BlockStack>
            </Box>
          )}
        </BlockStack>

        <Box paddingBlockStart="400">
          <InlineStack align="space-between">
            <Button onClick={onBack} disabled={isSubmitting}>
              Back
            </Button>
            <InlineStack gap="200">
              {wantTestData ? (
                <Button
                  variant="primary"
                  size="large"
                  onClick={handleAddTestData}
                  loading={isSubmitting}
                >
                  Add Test Data & Go to Dashboard
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="large"
                  onClick={handleSkip}
                  loading={isSubmitting}
                >
                  Go to Dashboard
                </Button>
              )}
            </InlineStack>
          </InlineStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
