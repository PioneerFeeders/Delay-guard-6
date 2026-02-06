/**
 * Bulk Notify Modal Component
 *
 * Modal for sending delay notifications to multiple customers at once.
 * Enqueues notification jobs that run in the background.
 */

import {
  Modal,
  BlockStack,
  Banner,
  Text,
  Checkbox,
} from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";

interface BulkNotifyModalProps {
  /** Array of shipment IDs to notify */
  shipmentIds: string[];
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when notifications are successfully queued */
  onSuccess?: () => void;
}

export function BulkNotifyModal({
  shipmentIds,
  open,
  onClose,
  onSuccess,
}: BulkNotifyModalProps) {
  // Fetcher for submitting bulk notifications
  const fetcher = useFetcher<{
    success?: boolean;
    error?: string;
    queuedCount?: number;
    skippedCount?: number;
    message?: string;
  }>();

  // Form state
  const [skipAlreadyNotified, setSkipAlreadyNotified] = useState(true);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setSkipAlreadyNotified(true);
    }
  }, [open]);

  // Handle successful submission
  useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess?.();
    }
  }, [fetcher.data, onSuccess]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    fetcher.submit(
      JSON.stringify({
        shipmentIds,
        skipAlreadyNotified,
      }),
      {
        method: "POST",
        action: "/api/shipments/bulk-notify",
        encType: "application/json",
      }
    );
  }, [shipmentIds, skipAlreadyNotified, fetcher]);

  // Handle close with cleanup
  const handleClose = useCallback(() => {
    setSkipAlreadyNotified(true);
    onClose();
  }, [onClose]);

  const isSubmitting = fetcher.state === "submitting";
  const submitError = fetcher.data?.error;
  const count = shipmentIds.length;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Send Notifications to ${count} Customer${count === 1 ? "" : "s"}`}
      primaryAction={{
        content: isSubmitting ? "Queueing..." : `Send ${count} Notification${count === 1 ? "" : "s"}`,
        onAction: handleSubmit,
        loading: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
          disabled: isSubmitting,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Info about bulk notification */}
          <Banner tone="info">
            <p>
              Notification emails will be queued for delivery using each shipment's
              configured template. Emails are sent in the background and may take
              a few minutes to complete.
            </p>
          </Banner>

          {/* Error banner */}
          {submitError && (
            <Banner tone="critical">
              <p>{submitError}</p>
            </Banner>
          )}

          {/* Success banner with results */}
          {fetcher.data?.success && (
            <Banner tone="success">
              <p>
                {fetcher.data.queuedCount} notification{fetcher.data.queuedCount === 1 ? "" : "s"} queued for delivery.
                {fetcher.data.skippedCount && fetcher.data.skippedCount > 0 && (
                  <> {fetcher.data.skippedCount} skipped (already notified).</>
                )}
              </p>
            </Banner>
          )}

          {/* Option to skip already notified */}
          <Checkbox
            label="Skip shipments that have already been notified"
            checked={skipAlreadyNotified}
            onChange={setSkipAlreadyNotified}
            helpText="If checked, shipments that already have a notification sent will be skipped"
          />

          {/* Summary */}
          <Text as="p" variant="bodySm" tone="subdued">
            This will send delay notification emails to the customers of {count} selected
            shipment{count === 1 ? "" : "s"}. Each email will use the merchant's configured
            notification template.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
