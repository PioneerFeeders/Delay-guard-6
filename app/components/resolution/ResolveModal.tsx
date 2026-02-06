/**
 * Resolve Modal Component
 *
 * Modal for marking shipments as resolved with a resolution reason
 * and optional notes. Creates an audit trail entry.
 */

import {
  Modal,
  BlockStack,
  Select,
  TextField,
  Banner,
  Text,
} from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import type { ResolutionReason } from "@prisma/client";

/**
 * Resolution reason options for the dropdown
 */
const RESOLUTION_REASON_OPTIONS: Array<{ label: string; value: ResolutionReason }> = [
  { label: "Contacted customer - no action needed", value: "CONTACTED_CUSTOMER" },
  { label: "Sent delay notification", value: "SENT_NOTIFICATION" },
  { label: "Issued partial refund", value: "PARTIAL_REFUND" },
  { label: "Issued full refund", value: "FULL_REFUND" },
  { label: "Reshipped order", value: "RESHIPPED" },
  { label: "Package delivered (false alarm)", value: "DELIVERED_FALSE_ALARM" },
  { label: "Customer cancelled", value: "CUSTOMER_CANCELLED" },
  { label: "Other", value: "OTHER" },
];

interface ResolveModalProps {
  /** The shipment ID to resolve */
  shipmentId: string;
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when resolution is successful */
  onSuccess?: () => void;
  /** Optional shipment info for display */
  shipmentInfo?: {
    orderNumber: string;
    trackingNumber: string;
    customerName: string;
  };
}

export function ResolveModal({
  shipmentId,
  open,
  onClose,
  onSuccess,
  shipmentInfo,
}: ResolveModalProps) {
  // Fetcher for submitting resolution
  const fetcher = useFetcher<{
    success?: boolean;
    error?: string;
    message?: string;
  }>();

  // Form state
  const [resolutionReason, setResolutionReason] = useState<ResolutionReason | "">("");
  const [notes, setNotes] = useState("");

  // Validation state
  const [reasonError, setReasonError] = useState<string | undefined>();

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setResolutionReason("");
      setNotes("");
      setReasonError(undefined);
    }
  }, [open]);

  // Handle successful resolution
  useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess?.();
      onClose();
    }
  }, [fetcher.data, onSuccess, onClose]);

  // Handle reason change
  const handleReasonChange = useCallback((value: string) => {
    setResolutionReason(value as ResolutionReason | "");
    if (value) {
      setReasonError(undefined);
    }
  }, []);

  // Handle notes change
  const handleNotesChange = useCallback((value: string) => {
    // Enforce 500 character limit
    if (value.length <= 500) {
      setNotes(value);
    }
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    // Validate reason is selected
    if (!resolutionReason) {
      setReasonError("Please select a resolution reason");
      return;
    }

    // Build payload - only include notes if provided
    const payload: { resolutionReason: string; notes?: string } = {
      resolutionReason,
    };
    if (notes.trim()) {
      payload.notes = notes.trim();
    }

    // Submit the resolution
    fetcher.submit(JSON.stringify(payload), {
      method: "POST",
      action: `/api/shipments/${shipmentId}/resolve`,
      encType: "application/json",
    });
  }, [shipmentId, resolutionReason, notes, fetcher]);

  // Handle close with cleanup
  const handleClose = useCallback(() => {
    setResolutionReason("");
    setNotes("");
    setReasonError(undefined);
    onClose();
  }, [onClose]);

  // Determine loading state
  const isSubmitting = fetcher.state === "submitting";
  const submitError = fetcher.data?.error;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Mark Shipment as Resolved"
      primaryAction={{
        content: isSubmitting ? "Resolving..." : "Mark Resolved",
        onAction: handleSubmit,
        loading: isSubmitting,
        disabled: !resolutionReason,
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
          {/* Shipment info if provided */}
          {shipmentInfo && (
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Resolving delay for Order {shipmentInfo.orderNumber}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Customer: {shipmentInfo.customerName} | Tracking: {shipmentInfo.trackingNumber}
              </Text>
            </BlockStack>
          )}

          {/* Error banner */}
          {submitError && (
            <Banner tone="critical">
              <p>{submitError}</p>
            </Banner>
          )}

          {/* Resolution reason dropdown */}
          <Select
            label="Resolution Reason"
            options={[
              { label: "Select a reason...", value: "" },
              ...RESOLUTION_REASON_OPTIONS,
            ]}
            value={resolutionReason}
            onChange={handleReasonChange}
            error={reasonError}
            requiredIndicator
            helpText="Select the reason for marking this shipment as resolved"
          />

          {/* Notes field */}
          <TextField
            label="Notes"
            value={notes}
            onChange={handleNotesChange}
            multiline={4}
            autoComplete="off"
            maxLength={500}
            showCharacterCount
            helpText="Optional notes about the resolution (500 characters max)"
          />

          {/* Info text */}
          <Text as="p" variant="bodySm" tone="subdued">
            Marking a shipment as resolved will move it to the Resolved tab.
            This action creates an audit trail entry and cannot be undone automatically.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/**
 * Bulk Resolve Modal Component
 *
 * Modal for resolving multiple shipments at once with the same reason and notes.
 */
interface BulkResolveModalProps {
  /** Array of shipment IDs to resolve */
  shipmentIds: string[];
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when resolution is successful */
  onSuccess?: () => void;
}

export function BulkResolveModal({
  shipmentIds,
  open,
  onClose,
  onSuccess,
}: BulkResolveModalProps) {
  // Fetcher for submitting bulk resolution
  const fetcher = useFetcher<{
    success?: boolean;
    error?: string;
    successCount?: number;
    failureCount?: number;
  }>();

  // Form state
  const [resolutionReason, setResolutionReason] = useState<ResolutionReason | "">("");
  const [notes, setNotes] = useState("");

  // Validation state
  const [reasonError, setReasonError] = useState<string | undefined>();

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setResolutionReason("");
      setNotes("");
      setReasonError(undefined);
    }
  }, [open]);

  // Handle successful resolution
  useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess?.();
      onClose();
    }
  }, [fetcher.data, onSuccess, onClose]);

  // Handle reason change
  const handleReasonChange = useCallback((value: string) => {
    setResolutionReason(value as ResolutionReason | "");
    if (value) {
      setReasonError(undefined);
    }
  }, []);

  // Handle notes change
  const handleNotesChange = useCallback((value: string) => {
    if (value.length <= 500) {
      setNotes(value);
    }
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    if (!resolutionReason) {
      setReasonError("Please select a resolution reason");
      return;
    }

    // Build payload - only include notes if provided
    const payload: { shipmentIds: string[]; resolutionReason: string; notes?: string } = {
      shipmentIds,
      resolutionReason,
    };
    if (notes.trim()) {
      payload.notes = notes.trim();
    }

    fetcher.submit(JSON.stringify(payload), {
      method: "POST",
      action: "/api/shipments/bulk-resolve",
      encType: "application/json",
    });
  }, [shipmentIds, resolutionReason, notes, fetcher]);

  // Handle close with cleanup
  const handleClose = useCallback(() => {
    setResolutionReason("");
    setNotes("");
    setReasonError(undefined);
    onClose();
  }, [onClose]);

  const isSubmitting = fetcher.state === "submitting";
  const submitError = fetcher.data?.error;
  const count = shipmentIds.length;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Resolve ${count} Shipment${count === 1 ? "" : "s"}`}
      primaryAction={{
        content: isSubmitting ? "Resolving..." : `Resolve ${count} Shipment${count === 1 ? "" : "s"}`,
        onAction: handleSubmit,
        loading: isSubmitting,
        disabled: !resolutionReason,
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
          {/* Info about bulk resolution */}
          <Banner tone="info">
            <p>
              You are about to resolve {count} shipment{count === 1 ? "" : "s"}.
              The same resolution reason and notes will be applied to all selected shipments.
            </p>
          </Banner>

          {/* Error banner */}
          {submitError && (
            <Banner tone="critical">
              <p>{submitError}</p>
            </Banner>
          )}

          {/* Resolution reason dropdown */}
          <Select
            label="Resolution Reason"
            options={[
              { label: "Select a reason...", value: "" },
              ...RESOLUTION_REASON_OPTIONS,
            ]}
            value={resolutionReason}
            onChange={handleReasonChange}
            error={reasonError}
            requiredIndicator
            helpText="This reason will be applied to all selected shipments"
          />

          {/* Notes field */}
          <TextField
            label="Notes"
            value={notes}
            onChange={handleNotesChange}
            multiline={4}
            autoComplete="off"
            maxLength={500}
            showCharacterCount
            helpText="Optional notes (will be applied to all shipments)"
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
