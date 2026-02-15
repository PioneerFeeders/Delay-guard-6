import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher } from "@remix-run/react";
import { Page, BlockStack, Card, Text, Pagination, Box, InlineStack, Divider } from "@shopify/polaris";
import { useCallback, useEffect, useState, useMemo } from "react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import {
  SummaryCards,
  TabNav,
  ShipmentTable,
  FilterBar,
  ColumnCustomization,
  BulkActionBar,
  type TabId,
  type SummaryData,
  type FilterValues,
} from "~/components/dashboard";
import { startOfDay, endOfDay } from "date-fns";
import type { Carrier } from "@prisma/client";
import type { ShipmentsApiResponse, ShipmentListItem, MerchantSettings } from "~/lib/validation";
import { parseMerchantSettings } from "~/services/merchant.service";

interface TabCounts {
  all: number;
  delayed: number;
  pending: number;
  resolved: number;
  delivered: number;
}

interface Location {
  id: string;
  name: string;
}

interface LoaderData {
  shop: string;
  summary: SummaryData;
  tabCounts: TabCounts;
  selectedTab: TabId;
  settings: MerchantSettings;
  locations: Location[];
  serviceLevels: string[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Get selected tab from URL params
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab") as TabId | null;
  const selectedTab: TabId = tabParam && ["all", "delayed", "pending", "resolved", "delivered"].includes(tabParam)
    ? tabParam
    : "all";

  // Check if merchant exists and has completed onboarding
  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopId: session.shop },
  });

  const defaultSettings = parseMerchantSettings({});

  if (!merchant) {
    // Merchant record should exist from app.tsx loader
    // Show dashboard anyway, it will be created on next request
    return {
      shop: session.shop,
      summary: {
        totalActive: 0,
        delayed: 0,
        deliveredToday: 0,
        avgDeliveryTimeByCarrier: {
          UPS: null,
          FEDEX: null,
          USPS: null,
        },
      },
      tabCounts: {
        all: 0,
        delayed: 0,
        pending: 0,
        resolved: 0,
        delivered: 0,
      },
      selectedTab,
      settings: defaultSettings,
      locations: [],
      serviceLevels: [],
    } satisfies LoaderData;
  }

  if (!merchant.onboardingDone) {
    return redirect("/app/onboarding");
  }

  const settings = parseMerchantSettings(merchant.settings);

  // Get today's date range for delivered today count
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // Query summary statistics and additional data in parallel
  const [
    totalActive,
    delayed,
    deliveredToday,
    pendingPickup,
    resolved,
    totalDelivered,
    allShipments,
    distinctLocations,
    distinctServiceLevels,
  ] = await Promise.all([
    // Total active: not delivered, not archived
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        isDelivered: false,
        isArchived: false,
      },
    }),
    // Delayed: is delayed and not resolved
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        isDelayed: true,
        isResolved: false,
        isArchived: false,
      },
    }),
    // Delivered today
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        isDelivered: true,
        deliveredAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    }),
    // Pending pickup: current status is 'pending' and no carrier scan yet
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        currentStatus: "pending",
        hasCarrierScan: false,
        isDelivered: false,
        isArchived: false,
      },
    }),
    // Resolved
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        isResolved: true,
        isArchived: false,
      },
    }),
    // Total delivered (for tab count)
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        isDelivered: true,
        isArchived: false,
      },
    }),
    // All shipments count (active, not archived)
    prisma.shipment.count({
      where: {
        merchantId: merchant.id,
        isArchived: false,
      },
    }),
    // Distinct fulfillment locations for filter dropdown
    prisma.shipment.findMany({
      where: {
        merchantId: merchant.id,
        fulfillmentLocationId: { not: null },
      },
      select: {
        fulfillmentLocationId: true,
        fulfillmentLocationName: true,
      },
      distinct: ["fulfillmentLocationId"],
    }),
    // Distinct service levels for filter dropdown
    prisma.shipment.findMany({
      where: {
        merchantId: merchant.id,
        serviceLevel: { not: null },
      },
      select: {
        serviceLevel: true,
      },
      distinct: ["serviceLevel"],
    }),
  ]);

  // Calculate actual average delivery times using raw query for better precision
  const avgDeliveryTimes = await prisma.$queryRaw<
    { carrier: Carrier; avg_days: number | null }[]
  >`
    SELECT
      carrier,
      AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "shipDate")) / 86400)::numeric as avg_days
    FROM "Shipment"
    WHERE "merchantId" = ${merchant.id}
      AND "isDelivered" = true
      AND "deliveredAt" IS NOT NULL
      AND carrier IN ('UPS', 'FEDEX', 'USPS')
    GROUP BY carrier
  `;

  const avgByCarrier: SummaryData["avgDeliveryTimeByCarrier"] = {
    UPS: null,
    FEDEX: null,
    USPS: null,
  };

  for (const row of avgDeliveryTimes) {
    if (row.avg_days !== null) {
      avgByCarrier[row.carrier as keyof typeof avgByCarrier] = Number(row.avg_days);
    }
  }

  const summary: SummaryData = {
    totalActive,
    delayed,
    deliveredToday,
    avgDeliveryTimeByCarrier: avgByCarrier,
  };

  const tabCounts: TabCounts = {
    all: allShipments,
    delayed,
    pending: pendingPickup,
    resolved,
    delivered: totalDelivered,
  };

  // Transform locations to the expected format
  const locations: Location[] = distinctLocations
    .filter((l) => l.fulfillmentLocationId !== null)
    .map((l) => ({
      id: l.fulfillmentLocationId!,
      name: l.fulfillmentLocationName || l.fulfillmentLocationId!,
    }));

  // Extract service levels
  const serviceLevels = distinctServiceLevels
    .map((s) => s.serviceLevel)
    .filter((s): s is string => s !== null);

  return {
    shop: session.shop,
    summary,
    tabCounts,
    selectedTab,
    settings,
    locations,
    serviceLevels,
  } satisfies LoaderData;
};

export default function Index() {
  const { shop, summary, tabCounts, selectedTab, settings, locations, serviceLevels } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const shipmentsFetcher = useFetcher<ShipmentsApiResponse>();
  const settingsFetcher = useFetcher();

  // Local state for shipment data
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Column customization state (initialized from merchant settings)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(settings.columnVisibility);
  const [columnOrder, setColumnOrder] = useState<string[]>(settings.columnOrder);
  const [columnSettingsChanged, setColumnSettingsChanged] = useState(false);

  // Parse filter values from URL params
  const getFiltersFromParams = useCallback((): FilterValues => {
    const carriers = searchParams.get("carrier");
    const serviceLevel = searchParams.get("serviceLevel");
    const delayStatus = searchParams.get("delayStatus");
    const orderValueMin = searchParams.get("orderValueMin");
    const orderValueMax = searchParams.get("orderValueMax");
    const shipDateFrom = searchParams.get("shipDateFrom");
    const shipDateTo = searchParams.get("shipDateTo");
    const locationId = searchParams.get("locationId");

    return {
      carrier: carriers ? (carriers.split(",") as FilterValues["carrier"]) : undefined,
      serviceLevel: serviceLevel || undefined,
      delayStatus: delayStatus as FilterValues["delayStatus"],
      orderValueMin: orderValueMin ? parseFloat(orderValueMin) : undefined,
      orderValueMax: orderValueMax ? parseFloat(orderValueMax) : undefined,
      shipDateFrom: shipDateFrom || undefined,
      shipDateTo: shipDateTo || undefined,
      locationId: locationId || undefined,
    };
  }, [searchParams]);

  const currentFilters = useMemo(() => getFiltersFromParams(), [getFiltersFromParams]);

  // Get current sort parameters from URL (or default from settings)
  const currentSortBy = searchParams.get("sortBy") || settings.defaultSortColumn || "daysDelayed";
  const currentSortDir = (searchParams.get("sortDir") as "asc" | "desc") || settings.defaultSortDirection || "desc";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  // Build API query params including filters
  const buildApiParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("tab", selectedTab);
    params.set("sortBy", currentSortBy);
    params.set("sortDir", currentSortDir);
    params.set("page", String(currentPage));
    params.set("pageSize", "50");

    // Add filter params
    if (currentFilters.carrier && currentFilters.carrier.length > 0) {
      params.set("carrier", currentFilters.carrier[0]); // API expects single carrier
    }
    if (currentFilters.serviceLevel) {
      params.set("serviceLevel", currentFilters.serviceLevel);
    }
    if (currentFilters.delayStatus) {
      params.set("delayStatus", currentFilters.delayStatus);
    }
    if (currentFilters.orderValueMin !== undefined) {
      params.set("orderValueMin", String(currentFilters.orderValueMin));
    }
    if (currentFilters.orderValueMax !== undefined) {
      params.set("orderValueMax", String(currentFilters.orderValueMax));
    }
    if (currentFilters.shipDateFrom) {
      params.set("shipDateFrom", currentFilters.shipDateFrom);
    }
    if (currentFilters.shipDateTo) {
      params.set("shipDateTo", currentFilters.shipDateTo);
    }
    if (currentFilters.locationId) {
      params.set("locationId", currentFilters.locationId);
    }

    return params;
  }, [selectedTab, currentSortBy, currentSortDir, currentPage, currentFilters]);

  // Fetch shipments when dependencies change
  useEffect(() => {
    const params = buildApiParams();
    shipmentsFetcher.load(`/api/shipments?${params.toString()}`);
  }, [selectedTab, currentSortBy, currentSortDir, currentPage, currentFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update local state when data arrives
  useEffect(() => {
    if (shipmentsFetcher.data && "shipments" in shipmentsFetcher.data) {
      setShipments(shipmentsFetcher.data.shipments);
      setPagination(shipmentsFetcher.data.pagination);
    }
  }, [shipmentsFetcher.data]);

  // Track column changes
  useEffect(() => {
    const visibilityChanged =
      JSON.stringify(visibleColumns.sort()) !== JSON.stringify(settings.columnVisibility.sort());
    const orderChanged = JSON.stringify(columnOrder) !== JSON.stringify(settings.columnOrder);
    setColumnSettingsChanged(visibilityChanged || orderChanged);
  }, [visibleColumns, columnOrder, settings.columnVisibility, settings.columnOrder]);

  const isLoading = shipmentsFetcher.state === "loading";
  const isSavingSettings = settingsFetcher.state === "submitting";

  const handleTabSelect = useCallback(
    (tab: TabId) => {
      setSelectedIds([]); // Clear selection when changing tabs
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set("tab", tab);
        newParams.set("page", "1"); // Reset to page 1 when changing tabs
        return newParams;
      });
    },
    [setSearchParams]
  );

  const handleSort = useCallback(
    (sortBy: string, sortDir: "asc" | "desc") => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set("sortBy", sortBy);
        newParams.set("sortDir", sortDir);
        newParams.set("page", "1"); // Reset to page 1 when sorting changes
        return newParams;
      });
    },
    [setSearchParams]
  );

  const handlePageChange = useCallback(
    (direction: "previous" | "next") => {
      const newPage = direction === "next" ? currentPage + 1 : currentPage - 1;
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set("page", String(newPage));
        return newParams;
      });
    },
    [currentPage, setSearchParams]
  );

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  // Filter handlers
  const handleFiltersChange = useCallback(
    (filters: FilterValues) => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set("page", "1"); // Reset to page 1 when filters change

        // Update filter params
        if (filters.carrier && filters.carrier.length > 0) {
          newParams.set("carrier", filters.carrier.join(","));
        } else {
          newParams.delete("carrier");
        }

        if (filters.serviceLevel) {
          newParams.set("serviceLevel", filters.serviceLevel);
        } else {
          newParams.delete("serviceLevel");
        }

        if (filters.delayStatus) {
          newParams.set("delayStatus", filters.delayStatus);
        } else {
          newParams.delete("delayStatus");
        }

        if (filters.orderValueMin !== undefined) {
          newParams.set("orderValueMin", String(filters.orderValueMin));
        } else {
          newParams.delete("orderValueMin");
        }

        if (filters.orderValueMax !== undefined) {
          newParams.set("orderValueMax", String(filters.orderValueMax));
        } else {
          newParams.delete("orderValueMax");
        }

        if (filters.shipDateFrom) {
          newParams.set("shipDateFrom", filters.shipDateFrom);
        } else {
          newParams.delete("shipDateFrom");
        }

        if (filters.shipDateTo) {
          newParams.set("shipDateTo", filters.shipDateTo);
        } else {
          newParams.delete("shipDateTo");
        }

        if (filters.locationId) {
          newParams.set("locationId", filters.locationId);
        } else {
          newParams.delete("locationId");
        }

        return newParams;
      });
    },
    [setSearchParams]
  );

  const handleClearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams();
      // Keep only tab and sort params
      const tab = prev.get("tab");
      const sortBy = prev.get("sortBy");
      const sortDir = prev.get("sortDir");
      if (tab) newParams.set("tab", tab);
      if (sortBy) newParams.set("sortBy", sortBy);
      if (sortDir) newParams.set("sortDir", sortDir);
      newParams.set("page", "1");
      return newParams;
    });
  }, [setSearchParams]);

  // Column customization handlers
  const handleVisibilityChange = useCallback((columns: string[]) => {
    setVisibleColumns(columns);
  }, []);

  const handleOrderChange = useCallback((columns: string[]) => {
    setColumnOrder(columns);
  }, []);

  const handleSaveColumnSettings = useCallback(() => {
    settingsFetcher.submit(
      {
        columnVisibility: visibleColumns,
        columnOrder: columnOrder,
      },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json",
      }
    );
  }, [settingsFetcher, visibleColumns, columnOrder]);

  // Reset changed flag after successful save
  useEffect(() => {
    if (settingsFetcher.data && "success" in (settingsFetcher.data as object)) {
      setColumnSettingsChanged(false);
    }
  }, [settingsFetcher.data]);

  // Export state
  const [isExporting, setIsExporting] = useState(false);

  // Handle clearing selection
  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  // Handle export of selected shipments
  const handleExport = useCallback(() => {
    if (selectedIds.length === 0) return;

    setIsExporting(true);

    // Build export URL with selected shipment IDs
    const exportUrl = `/api/shipments/export?shipmentIds=${selectedIds.join(",")}`;

    // Create a temporary link to trigger download
    const link = document.createElement("a");
    link.href = exportUrl;
    link.download = ""; // Let the server set the filename
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Reset exporting state after a short delay
    setTimeout(() => {
      setIsExporting(false);
    }, 1000);
  }, [selectedIds]);

  // Handle refresh after bulk action
  const handleBulkActionComplete = useCallback(() => {
    // Re-fetch shipments to reflect changes
    const params = buildApiParams();
    shipmentsFetcher.load(`/api/shipments?${params.toString()}`);
  }, [buildApiParams, shipmentsFetcher]);

  return (
    <Page title="DelayGuard Dashboard">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Welcome to DelayGuard
            </Text>
            <Text variant="bodyMd" as="p">
              Proactive shipment delay detection for {shop}
            </Text>
          </BlockStack>
        </Card>

        <SummaryCards data={summary} />

        <Card padding="0">
          <TabNav
            selected={selectedTab}
            onSelect={handleTabSelect}
            counts={tabCounts}
          />
          <Box padding="400">
            {/* Filter Bar */}
            <InlineStack align="space-between" blockAlign="start">
              <Box minWidth="0" maxWidth="calc(100% - 120px)">
                <FilterBar
                  filters={currentFilters}
                  onFiltersChange={handleFiltersChange}
                  onClearFilters={handleClearFilters}
                  locations={locations}
                  serviceLevels={serviceLevels}
                />
              </Box>
              <ColumnCustomization
                visibleColumns={visibleColumns}
                columnOrder={columnOrder}
                onVisibilityChange={handleVisibilityChange}
                onOrderChange={handleOrderChange}
                onSave={handleSaveColumnSettings}
                hasChanges={columnSettingsChanged}
                isSaving={isSavingSettings}
              />
            </InlineStack>

            <Divider />

            {/* Bulk Action Bar - shows when items are selected */}
            {selectedIds.length > 0 && (
              <Box paddingBlockStart="400">
                <BulkActionBar
                  selectedIds={selectedIds}
                  onClearSelection={handleClearSelection}
                  onExport={handleExport}
                  onActionComplete={handleBulkActionComplete}
                  isExporting={isExporting}
                />
              </Box>
            )}

            <Box paddingBlockStart="400">
              <ShipmentTable
                shipments={shipments}
                loading={isLoading}
                onSort={handleSort}
                sortBy={currentSortBy}
                sortDir={currentSortDir}
                selectedIds={selectedIds}
                onSelectionChange={handleSelectionChange}
                visibleColumns={visibleColumns}
                columnOrder={columnOrder}
              />

              {pagination.totalPages > 1 && (
                <Box paddingBlockStart="400">
                  <InlineStack align="center" blockAlign="center">
                    <Pagination
                      hasPrevious={pagination.page > 1}
                      hasNext={pagination.page < pagination.totalPages}
                      onPrevious={() => handlePageChange("previous")}
                      onNext={() => handlePageChange("next")}
                      label={`Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} shipments)`}
                    />
                  </InlineStack>
                </Box>
              )}
            </Box>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}
