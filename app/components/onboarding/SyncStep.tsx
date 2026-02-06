/**
 * SyncStep Component
 *
 * Third step of the onboarding wizard that performs the initial
 * fulfillment sync from Shopify. Shows progress and results.
 */

import {
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Box,
  ProgressBar,
  Badge,
  Banner,
  Spinner,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "@remix-run/react";

interface SyncStatus {
  syncInProgress: boolean;
  totalShipments: number;
  delayedShipments: number;
  lastSyncedAt: string | null;
  lastSyncResult: {
    state: string;
    progress: number | { processed: number; total: number; percentage: number };
    result: {
      total: number;
      created: number;
      skipped: number;
      errors: number;
      duplicates: number;
      pollJobsEnqueued: number;
    } | null;
    failedReason: string | null;
    finishedOn: number | null;
  } | null;
}

interface SyncStepProps {
  onNext: () => void;
  onBack: () => void;
}

type SyncState = "idle" | "syncing" | "completed" | "error";

export function SyncStep({ onNext, onBack }: SyncStepProps) {
  const syncFetcher = useFetcher<{ success: boolean; jobId?: string; message?: string; error?: string }>();
  const statusFetcher = useFetcher<SyncStatus>();

  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [progress, setProgress] = useState(0);
  const [totalShipments, setTotalShipments] = useState(0);
  const [delayedShipments, setDelayedShipments] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start polling for status updates
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Immediately check status
    statusFetcher.load("/api/sync");

    // Then poll every 2 seconds
    pollingIntervalRef.current = setInterval(() => {
      statusFetcher.load("/api/sync");
    }, 2000);
  }, [statusFetcher]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Handle status updates
  useEffect(() => {
    if (statusFetcher.data) {
      const data = statusFetcher.data;

      if (data.syncInProgress) {
        setSyncState("syncing");

        // Update progress from job data
        if (data.lastSyncResult?.progress) {
          const jobProgress = data.lastSyncResult.progress;
          if (typeof jobProgress === "object" && "percentage" in jobProgress) {
            setProgress(jobProgress.percentage);
          } else if (typeof jobProgress === "number") {
            setProgress(jobProgress);
          }
        }
      } else if (syncState === "syncing") {
        // Sync was in progress and is now complete
        stopPolling();

        if (data.lastSyncResult?.state === "completed") {
          setSyncState("completed");
          setTotalShipments(data.totalShipments);
          setDelayedShipments(data.delayedShipments);
          setProgress(100);
        } else if (data.lastSyncResult?.state === "failed") {
          setSyncState("error");
          setError(data.lastSyncResult.failedReason || "Sync failed");
        }
      } else if (syncState === "idle") {
        // Initial load - check if there's already data
        setTotalShipments(data.totalShipments);
        setDelayedShipments(data.delayedShipments);
      }
    }
  }, [statusFetcher.data, syncState, stopPolling]);

  // Handle sync trigger response
  useEffect(() => {
    if (syncFetcher.data) {
      if (syncFetcher.data.success) {
        setSyncState("syncing");
        startPolling();
      } else {
        setSyncState("error");
        setError(syncFetcher.data.error || syncFetcher.data.message || "Failed to start sync");
      }
    }
  }, [syncFetcher.data, startPolling]);

  const handleStartSync = useCallback(() => {
    setSyncState("syncing");
    setProgress(0);
    setError(null);
    syncFetcher.submit(
      { fullSync: false },
      { method: "POST", action: "/api/sync", encType: "application/json" }
    );
  }, [syncFetcher]);

  const handleRetry = useCallback(() => {
    setSyncState("idle");
    setError(null);
    setProgress(0);
  }, []);

  // Check initial status on mount
  useEffect(() => {
    statusFetcher.load("/api/sync");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">
            Sync Your Shipments
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            We'll import your recent fulfillments from the last 5 days
          </Text>
        </BlockStack>

        {/* Idle State */}
        {syncState === "idle" && (
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Click the button below to start syncing your recent shipments. This will import
              all fulfillments from the last 5 days and begin tracking their delivery status.
            </Text>

            {totalShipments > 0 && (
              <Banner tone="info">
                <Text as="p" variant="bodyMd">
                  You already have {totalShipments} shipment{totalShipments !== 1 ? "s" : ""} synced.
                  {delayedShipments > 0 && ` (${delayedShipments} delayed)`}
                </Text>
              </Banner>
            )}

            <Box paddingBlockStart="200">
              <Button variant="primary" onClick={handleStartSync}>
                Start Sync
              </Button>
            </Box>
          </BlockStack>
        )}

        {/* Syncing State */}
        {syncState === "syncing" && (
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="p" variant="bodyMd">
                Syncing your recent shipments...
              </Text>
            </InlineStack>

            <ProgressBar progress={progress} size="small" />

            <Text as="p" variant="bodySm" tone="subdued">
              {progress > 0 ? `${progress}% complete` : "Starting sync..."}
            </Text>
          </BlockStack>
        )}

        {/* Completed State */}
        {syncState === "completed" && (
          <BlockStack gap="400">
            <Banner tone="success">
              <Text as="p" variant="bodyMd">
                Sync completed successfully!
              </Text>
            </Banner>

            <InlineStack gap="400" wrap>
              <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100" inlineAlign="center">
                  <Text as="p" variant="headingLg">
                    {totalShipments}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Shipments Synced
                  </Text>
                </BlockStack>
              </Box>

              <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100" inlineAlign="center">
                  <InlineStack gap="100" blockAlign="center">
                    <Text as="p" variant="headingLg">
                      {delayedShipments}
                    </Text>
                    {delayedShipments > 0 && <Badge tone="warning">Needs attention</Badge>}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Currently Delayed
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>

            {delayedShipments > 0 && (
              <Text as="p" variant="bodyMd">
                You have {delayedShipments} delayed shipment{delayedShipments !== 1 ? "s" : ""} that
                may need your attention. You can review them in the dashboard.
              </Text>
            )}

            {totalShipments === 0 && (
              <Text as="p" variant="bodyMd" tone="subdued">
                No shipments found in the last 5 days. New shipments will be tracked automatically
                when you create fulfillments in Shopify.
              </Text>
            )}
          </BlockStack>
        )}

        {/* Error State */}
        {syncState === "error" && (
          <BlockStack gap="400">
            <Banner tone="critical">
              <Text as="p" variant="bodyMd">
                {error || "An error occurred during sync"}
              </Text>
            </Banner>

            <Button onClick={handleRetry}>
              Try Again
            </Button>
          </BlockStack>
        )}

        <Box paddingBlockStart="400">
          <InlineStack align="space-between">
            <Button
              onClick={onBack}
              disabled={syncState === "syncing"}
            >
              Back
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={onNext}
              disabled={syncState === "syncing"}
            >
              {syncState === "completed" || syncState === "error" || totalShipments > 0
                ? "Continue"
                : "Skip for now"}
            </Button>
          </InlineStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
