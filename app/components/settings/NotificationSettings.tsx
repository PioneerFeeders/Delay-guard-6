/**
 * Notification Settings Component
 *
 * Allows merchants to customize their notification email template.
 * Provides subject and body fields with variable reference and live preview.
 */

import {
  Card,
  BlockStack,
  TextField,
  Text,
  Box,
  Banner,
  Button,
  InlineStack,
  Collapsible,
  Icon,
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo } from "react";
import {
  TEMPLATE_VARIABLES,
  REQUIRED_TEMPLATE_VARIABLES,
  validateTemplate,
  renderTemplate,
  type TemplateContext,
} from "~/lib/notification-templates";

/**
 * Sample data for template preview
 */
const SAMPLE_CONTEXT: TemplateContext = {
  customerFirstName: "John",
  customerFullName: "John Smith",
  orderNumber: "#1001",
  trackingNumber: "1Z999AA10123456784",
  carrierName: "UPS",
  carrierStatus: "In Transit - Delayed",
  trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
  expectedDeliveryDate: "Friday, February 7, 2026",
  shopName: "Your Store",
};

interface NotificationSettingsProps {
  subject: string;
  body: string;
  onChange: (subject: string, body: string) => void;
  onSave: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
}

export function NotificationSettings({
  subject,
  body,
  onChange,
  onSave,
  isSaving = false,
  hasChanges = false,
}: NotificationSettingsProps) {
  const [showVariables, setShowVariables] = useState(false);
  const [subjectError, setSubjectError] = useState<string | undefined>();
  const [bodyError, setBodyError] = useState<string | undefined>();

  // Validate on change
  const handleSubjectChange = useCallback(
    (value: string) => {
      // Subject validation - check for required variables
      if (!value.trim()) {
        setSubjectError("Subject is required");
      } else if (value.length > 200) {
        setSubjectError("Subject is too long (max 200 characters)");
      } else if (!value.includes("{order_number}")) {
        // Subject should at least have order number for context
        setSubjectError(undefined); // Warning, not error for subject
      } else {
        setSubjectError(undefined);
      }
      onChange(value, body);
    },
    [body, onChange]
  );

  const handleBodyChange = useCallback(
    (value: string) => {
      // Body validation - must contain required variables
      const bodyValidation = validateTemplate(value);
      if (!value.trim()) {
        setBodyError("Body is required");
      } else if (value.length > 10000) {
        setBodyError("Body is too long (max 10,000 characters)");
      } else if (!bodyValidation.isValid) {
        setBodyError(
          `Body must include: ${bodyValidation.missingVariables.join(", ")}`
        );
      } else {
        setBodyError(undefined);
      }
      onChange(subject, value);
    },
    [subject, onChange]
  );

  // Compute combined validation status
  const validationResult = useMemo(() => {
    const subjectValid = subject.trim().length > 0 && subject.length <= 200;
    const bodyValidation = validateTemplate(body);
    const bodyValid = body.trim().length > 0 && body.length <= 10000 && bodyValidation.isValid;
    return {
      isValid: subjectValid && bodyValid,
      subjectValid,
      bodyValid,
      missingVariables: bodyValidation.missingVariables,
    };
  }, [subject, body]);

  // Render preview with sample data
  const previewSubject = useMemo(() => {
    try {
      return renderTemplate(subject, SAMPLE_CONTEXT);
    } catch {
      return subject;
    }
  }, [subject]);

  const previewBody = useMemo(() => {
    try {
      return renderTemplate(body, SAMPLE_CONTEXT);
    } catch {
      return body;
    }
  }, [body]);

  const toggleVariables = useCallback(() => {
    setShowVariables((prev) => !prev);
  }, []);

  const handleSave = useCallback(() => {
    if (validationResult.isValid) {
      onSave();
    }
  }, [validationResult.isValid, onSave]);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Notification Email Template
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Customize the email that's sent to customers when you notify them of a shipment delay.
          </Text>
        </BlockStack>

        {/* Variable Reference Toggle */}
        <Box>
          <Button
            variant="plain"
            onClick={toggleVariables}
            icon={<Icon source={InfoIcon} />}
          >
            {showVariables ? "Hide" : "Show"} available variables
          </Button>
          <Collapsible open={showVariables} id="template-variables">
            <Box paddingBlockStart="300">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Template Variables
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Use these variables in your template. They will be replaced with actual values when sending.
                  </Text>
                  <Box
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      {TEMPLATE_VARIABLES.map((variable) => {
                        const isRequired = REQUIRED_TEMPLATE_VARIABLES.includes(
                          variable as (typeof REQUIRED_TEMPLATE_VARIABLES)[number]
                        );
                        const description = getVariableDescription(variable);
                        return (
                          <InlineStack key={variable} gap="200" blockAlign="center">
                            <Box minWidth="200px">
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight={isRequired ? "semibold" : "regular"}
                              >
                                <code>{variable}</code>
                              </Text>
                            </Box>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {description}
                              {isRequired && (
                                <Text as="span" tone="critical">
                                  {" "}(required)
                                </Text>
                              )}
                            </Text>
                          </InlineStack>
                        );
                      })}
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            </Box>
          </Collapsible>
        </Box>

        {/* Subject Field */}
        <TextField
          label="Email Subject"
          value={subject}
          onChange={handleSubjectChange}
          error={subjectError}
          autoComplete="off"
          maxLength={200}
          showCharacterCount
          helpText="The subject line for notification emails"
        />

        {/* Body Field */}
        <TextField
          label="Email Body"
          value={body}
          onChange={handleBodyChange}
          error={bodyError}
          multiline={12}
          autoComplete="off"
          maxLength={10000}
          helpText={`Must include ${REQUIRED_TEMPLATE_VARIABLES.join(" and ")}`}
        />

        {/* Validation Warning */}
        {!validationResult.isValid && validationResult.missingVariables.length > 0 && (
          <Banner tone="warning">
            <p>
              Your template is missing required variables: {validationResult.missingVariables.join(", ")}
            </p>
          </Banner>
        )}

        {/* Preview Section */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Email Preview
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Preview with sample data
            </Text>
            <Box
              padding="400"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <BlockStack gap="200">
                <InlineStack gap="100">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    To:
                  </Text>
                  <Text as="span" variant="bodySm">
                    john.smith@example.com
                  </Text>
                </InlineStack>
                <InlineStack gap="100">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    Subject:
                  </Text>
                  <Text as="span" variant="bodySm">
                    {previewSubject}
                  </Text>
                </InlineStack>
                <Box paddingBlockStart="200">
                  <Box
                    padding="300"
                    background="bg-surface"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <Text as="p" variant="bodySm">
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          margin: 0,
                        }}
                      >
                        {previewBody}
                      </pre>
                    </Text>
                  </Box>
                </Box>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Save Button */}
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isSaving}
            disabled={!hasChanges || !validationResult.isValid}
          >
            Save Template
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

/**
 * Get human-readable description for a template variable
 */
function getVariableDescription(variable: string): string {
  switch (variable) {
    case "{customer_first_name}":
      return "Customer's first name";
    case "{customer_full_name}":
      return "Customer's full name";
    case "{order_number}":
      return "Order number (e.g., #1001)";
    case "{tracking_number}":
      return "Carrier tracking number";
    case "{carrier_name}":
      return "Carrier name (UPS, FedEx, USPS)";
    case "{carrier_status}":
      return "Current shipment status";
    case "{tracking_url}":
      return "Link to track the package";
    case "{expected_delivery_date}":
      return "Expected delivery date";
    case "{shop_name}":
      return "Your store name";
    default:
      return "";
  }
}
