/**
 * Send Notification Modal Component
 *
 * Modal for sending delay notification emails to customers.
 * Displays pre-filled template that can be edited before sending.
 */

import {
  Modal,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Box,
  Spinner,
  Card,
} from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";

/**
 * Notification data returned from the prepare endpoint
 */
interface NotificationData {
  recipientEmail: string;
  subject: string;
  body: string;
  shipment: {
    id: string;
    orderNumber: string;
    trackingNumber: string;
    customerName: string;
    customerEmail: string;
    carrier: string;
  };
}

interface SendNotificationModalProps {
  shipmentId: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SendNotificationModal({
  shipmentId,
  open,
  onClose,
  onSuccess,
}: SendNotificationModalProps) {
  // Fetcher for loading notification data
  const loadFetcher = useFetcher<{ notification: NotificationData } | { error: string }>();

  // Fetcher for sending notification
  const sendFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    message?: string;
    alreadySent?: boolean;
  }>();

  // Form state
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Validation state
  const [emailError, setEmailError] = useState<string | undefined>();
  const [subjectError, setSubjectError] = useState<string | undefined>();
  const [bodyError, setBodyError] = useState<string | undefined>();

  // Load notification data when modal opens
  useEffect(() => {
    if (open && shipmentId) {
      loadFetcher.load(`/api/shipments/${shipmentId}/notify`);
    }
  }, [open, shipmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update form when data loads
  useEffect(() => {
    const data = loadFetcher.data;
    if (data && "notification" in data) {
      setRecipientEmail(data.notification.recipientEmail);
      setSubject(data.notification.subject);
      setBody(data.notification.body);
      // Clear any previous errors
      setEmailError(undefined);
      setSubjectError(undefined);
      setBodyError(undefined);
    }
  }, [loadFetcher.data]);

  // Handle successful send
  useEffect(() => {
    const data = sendFetcher.data;
    if (data?.success) {
      onSuccess?.();
      onClose();
    }
  }, [sendFetcher.data, onSuccess, onClose]);

  // Validate email
  const validateEmail = useCallback((email: string): boolean => {
    if (!email.trim()) {
      setEmailError("Email is required");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError("Invalid email address");
      return false;
    }
    setEmailError(undefined);
    return true;
  }, []);

  // Validate subject
  const validateSubject = useCallback((subj: string): boolean => {
    if (!subj.trim()) {
      setSubjectError("Subject is required");
      return false;
    }
    if (subj.length > 200) {
      setSubjectError("Subject is too long (max 200 characters)");
      return false;
    }
    setSubjectError(undefined);
    return true;
  }, []);

  // Validate body
  const validateBody = useCallback((content: string): boolean => {
    if (!content.trim()) {
      setBodyError("Body is required");
      return false;
    }
    if (content.length > 10000) {
      setBodyError("Body is too long (max 10,000 characters)");
      return false;
    }
    // Check for required template variables
    if (!content.includes("{tracking_number}") && !content.includes("{order_number}")) {
      setBodyError("Body must include {tracking_number} or {order_number}");
      return false;
    }
    setBodyError(undefined);
    return true;
  }, []);

  // Handle send
  const handleSend = useCallback(() => {
    // Validate all fields
    const isEmailValid = validateEmail(recipientEmail);
    const isSubjectValid = validateSubject(subject);
    const isBodyValid = validateBody(body);

    if (!isEmailValid || !isSubjectValid || !isBodyValid) {
      return;
    }

    // Send the notification
    sendFetcher.submit(
      {
        recipientEmail,
        subject,
        body,
      },
      {
        method: "POST",
        action: `/api/shipments/${shipmentId}/notify`,
        encType: "application/json",
      }
    );
  }, [
    shipmentId,
    recipientEmail,
    subject,
    body,
    validateEmail,
    validateSubject,
    validateBody,
    sendFetcher,
  ]);

  // Handle close with cleanup
  const handleClose = useCallback(() => {
    setRecipientEmail("");
    setSubject("");
    setBody("");
    setEmailError(undefined);
    setSubjectError(undefined);
    setBodyError(undefined);
    onClose();
  }, [onClose]);

  // Determine loading state
  const isLoading = loadFetcher.state === "loading";
  const isSending = sendFetcher.state === "submitting";
  const loadError = loadFetcher.data && "error" in loadFetcher.data ? loadFetcher.data.error : null;
  const sendError = sendFetcher.data?.error;
  const notification =
    loadFetcher.data && "notification" in loadFetcher.data
      ? loadFetcher.data.notification
      : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Send Delay Notification"
      primaryAction={{
        content: isSending ? "Sending..." : "Send Notification",
        onAction: handleSend,
        loading: isSending,
        disabled: isLoading || !notification,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
          disabled: isSending,
        },
      ]}
      size="large"
    >
      <Modal.Section>
        {isLoading && (
          <Box padding="800">
            <InlineStack align="center" blockAlign="center">
              <Spinner size="large" accessibilityLabel="Loading notification data" />
            </InlineStack>
          </Box>
        )}

        {loadError && (
          <Banner tone="critical">
            <p>{loadError}</p>
          </Banner>
        )}

        {sendError && (
          <Banner tone="critical">
            <p>{sendError}</p>
          </Banner>
        )}

        {sendFetcher.data?.alreadySent && (
          <Banner tone="warning">
            <p>
              A notification has already been sent for this shipment. This will send an
              additional notification.
            </p>
          </Banner>
        )}

        {notification && !isLoading && (
          <BlockStack gap="400">
            {/* Shipment Info */}
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Shipment Details
                </Text>
                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Order
                    </Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {notification.shipment.orderNumber}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Customer
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {notification.shipment.customerName}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Tracking
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {notification.shipment.trackingNumber}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Email Form */}
            <TextField
              label="Recipient Email"
              type="email"
              value={recipientEmail}
              onChange={setRecipientEmail}
              error={emailError}
              autoComplete="email"
              helpText="The customer's email address"
            />

            <TextField
              label="Subject"
              value={subject}
              onChange={setSubject}
              error={subjectError}
              autoComplete="off"
              maxLength={200}
              showCharacterCount
            />

            <TextField
              label="Message"
              value={body}
              onChange={setBody}
              error={bodyError}
              multiline={10}
              autoComplete="off"
              maxLength={10000}
              helpText="You can customize this message. Variables like {tracking_number} will be replaced with actual values."
            />

            {/* Preview */}
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Email Preview
                </Text>
                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>To:</strong> {recipientEmail}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>Subject:</strong> {subject}
                    </Text>
                    <Box paddingBlockStart="200">
                      <Text as="p" variant="bodySm">
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
                          {body}
                        </pre>
                      </Text>
                    </Box>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}
