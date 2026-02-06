/**
 * Bulk Action Bar Component
 *
 * Displays a floating action bar when shipments are selected,
 * providing bulk operations like sending notifications, resolving,
 * and exporting selected shipments.
 */

import {
  Box,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
} from "@shopify/polaris";
import { useCallback, useState } from "react";
import { BulkResolveModal } from "../resolution/ResolveModal";
import { BulkNotifyModal } from "../notifications/BulkNotifyModal";

interface BulkActionBarProps {
  /** Array of selected shipment IDs */
  selectedIds: string[];
  /** Callback to clear selection after action */
  onClearSelection: () => void;
  /** Callback when export is requested */
  onExport: () => void;
  /** Callback to refresh data after bulk action */
  onActionComplete?: () => void;
  /** Whether export is currently loading */
  isExporting?: boolean;
}

export function BulkActionBar({
  selectedIds,
  onClearSelection,
  onExport,
  onActionComplete,
  isExporting = false,
}: BulkActionBarProps) {
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);

  const count = selectedIds.length;

  // Handle bulk notify
  const handleNotifyClick = useCallback(() => {
    setShowNotifyModal(true);
  }, []);

  const handleNotifyClose = useCallback(() => {
    setShowNotifyModal(false);
  }, []);

  const handleNotifySuccess = useCallback(() => {
    setShowNotifyModal(false);
    onClearSelection();
    onActionComplete?.();
  }, [onClearSelection, onActionComplete]);

  // Handle bulk resolve
  const handleResolveClick = useCallback(() => {
    setShowResolveModal(true);
  }, []);

  const handleResolveClose = useCallback(() => {
    setShowResolveModal(false);
  }, []);

  const handleResolveSuccess = useCallback(() => {
    setShowResolveModal(false);
    onClearSelection();
    onActionComplete?.();
  }, [onClearSelection, onActionComplete]);

  // Handle export
  const handleExportClick = useCallback(() => {
    onExport();
  }, [onExport]);

  // Don't render if nothing is selected
  if (count === 0) {
    return null;
  }

  return (
    <>
      <Box
        padding="400"
        background="bg-surface-active"
        borderRadius="200"
      >
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {count} shipment{count === 1 ? "" : "s"} selected
            </Text>
            <Button variant="plain" onClick={onClearSelection}>
              Clear selection
            </Button>
          </InlineStack>

          <ButtonGroup>
            <Button
              onClick={handleNotifyClick}
              variant="secondary"
            >
              Send Notification to All
            </Button>
            <Button
              onClick={handleResolveClick}
              variant="secondary"
            >
              Mark All as Resolved
            </Button>
            <Button
              onClick={handleExportClick}
              variant="secondary"
              loading={isExporting}
            >
              Export Selected
            </Button>
          </ButtonGroup>
        </InlineStack>
      </Box>

      {/* Bulk Notify Modal */}
      <BulkNotifyModal
        shipmentIds={selectedIds}
        open={showNotifyModal}
        onClose={handleNotifyClose}
        onSuccess={handleNotifySuccess}
      />

      {/* Bulk Resolve Modal */}
      <BulkResolveModal
        shipmentIds={selectedIds}
        open={showResolveModal}
        onClose={handleResolveClose}
        onSuccess={handleResolveSuccess}
      />
    </>
  );
}
