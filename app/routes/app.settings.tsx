/**
 * Settings Page
 *
 * Main settings page for merchant configuration.
 * Includes sections for:
 * - Polling & Detection (delay threshold, delivery windows)
 * - Dashboard Preferences (column visibility, sort order)
 * - Notifications (email template customization)
 * - Display (timezone, auto-archive)
 * - Account & Billing (plan, usage, upgrade)
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, BlockStack, Banner, Tabs, Card, Text, Spinner, Box } from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { getMerchantByShopId, parseMerchantSettings } from "~/services/merchant.service";
import { getBillingInfo, getAllPlans } from "~/services/billing.service";
import {
  NotificationSettings,
  PollingSettings,
  DashboardPreferences,
  DisplaySettings,
  AccountBilling,
} from "~/components/settings";
import type { MerchantSettings } from "~/lib/validation";
import type { PlanTier } from "@prisma/client";
import type { SerializedBillingInfo, PlanInfo } from "~/components/settings";

interface LoaderData {
  settings: MerchantSettings;
  timezone: string;
  shop: string;
  billingInfo: SerializedBillingInfo | null;
  allPlans: PlanInfo[];
  hasActiveSubscription: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);

  if (!merchant) {
    return json<LoaderData>({
      settings: parseMerchantSettings({}),
      timezone: "America/New_York",
      shop: session.shop,
      billingInfo: null,
      allPlans: getAllPlans(),
      hasActiveSubscription: false,
    });
  }

  // Get billing info
  let billingInfo: SerializedBillingInfo | null = null;
  let hasActiveSubscription = false;

  try {
    const rawBillingInfo = await getBillingInfo(merchant);

    // Serialize billing info (convert Date objects to ISO strings for JSON)
    billingInfo = {
      ...rawBillingInfo,
      usage: {
        ...rawBillingInfo.usage,
        billingCycle: {
          start: rawBillingInfo.usage.billingCycle.start.toISOString(),
          end: rawBillingInfo.usage.billingCycle.end.toISOString(),
        },
      },
    };

    // Check Shopify subscription status
    try {
      const subscriptionCheck = await billing.check({
        plans: ["Starter", "Professional", "Business", "Enterprise"],
        isTest: process.env.NODE_ENV !== "production",
      });
      hasActiveSubscription = subscriptionCheck.hasActivePayment;
    } catch {
      // billing.check may fail if no subscription exists
    }
  } catch (error) {
    console.error("Failed to get billing info:", error);
  }

  return json<LoaderData>({
    settings: parseMerchantSettings(merchant.settings),
    timezone: merchant.timezone,
    shop: session.shop,
    billingInfo,
    allPlans: getAllPlans(),
    hasActiveSubscription,
  });
}

export default function SettingsPage() {
  const {
    settings: initialSettings,
    timezone: initialTimezone,
    billingInfo,
    allPlans,
    hasActiveSubscription,
  } = useLoaderData<typeof loader>();

  const settingsFetcher = useFetcher<{ success?: boolean; error?: string; settings?: MerchantSettings }>();
  const billingFetcher = useFetcher<{ success?: boolean; confirmationUrl?: string; error?: string }>();

  // Tab state
  const [selectedTab, setSelectedTab] = useState(0);

  // Local state for all settings sections
  const [settings, setSettings] = useState({
    // Polling settings
    delayThresholdHours: initialSettings.delayThresholdHours,
    deliveryWindows: initialSettings.deliveryWindows,
    // Dashboard preferences
    columnVisibility: initialSettings.columnVisibility,
    columnOrder: initialSettings.columnOrder,
    defaultSortColumn: initialSettings.defaultSortColumn,
    defaultSortDirection: initialSettings.defaultSortDirection,
    // Notification template
    notificationSubject: initialSettings.notificationTemplate.subject,
    notificationBody: initialSettings.notificationTemplate.body,
    // Display settings
    autoArchiveDays: initialSettings.autoArchiveDays,
  });

  // Timezone is stored separately on merchant, not in settings JSON
  const [timezone, setTimezone] = useState(initialTimezone);

  // Track changes per section
  const [hasPollingChanges, setHasPollingChanges] = useState(false);
  const [hasDashboardChanges, setHasDashboardChanges] = useState(false);
  const [hasNotificationChanges, setHasNotificationChanges] = useState(false);
  const [hasDisplayChanges, setHasDisplayChanges] = useState(false);

  // Success/error banners
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Track changes for polling section
  useEffect(() => {
    const changed =
      settings.delayThresholdHours !== initialSettings.delayThresholdHours ||
      JSON.stringify(settings.deliveryWindows) !== JSON.stringify(initialSettings.deliveryWindows);
    setHasPollingChanges(changed);
  }, [settings.delayThresholdHours, settings.deliveryWindows, initialSettings]);

  // Track changes for dashboard section
  useEffect(() => {
    const changed =
      JSON.stringify(settings.columnVisibility) !== JSON.stringify(initialSettings.columnVisibility) ||
      JSON.stringify(settings.columnOrder) !== JSON.stringify(initialSettings.columnOrder) ||
      settings.defaultSortColumn !== initialSettings.defaultSortColumn ||
      settings.defaultSortDirection !== initialSettings.defaultSortDirection;
    setHasDashboardChanges(changed);
  }, [
    settings.columnVisibility,
    settings.columnOrder,
    settings.defaultSortColumn,
    settings.defaultSortDirection,
    initialSettings,
  ]);

  // Track changes for notification section
  useEffect(() => {
    const changed =
      settings.notificationSubject !== initialSettings.notificationTemplate.subject ||
      settings.notificationBody !== initialSettings.notificationTemplate.body;
    setHasNotificationChanges(changed);
  }, [settings.notificationSubject, settings.notificationBody, initialSettings.notificationTemplate]);

  // Track changes for display section
  useEffect(() => {
    const changed =
      settings.autoArchiveDays !== initialSettings.autoArchiveDays ||
      timezone !== initialTimezone;
    setHasDisplayChanges(changed);
  }, [settings.autoArchiveDays, timezone, initialSettings.autoArchiveDays, initialTimezone]);

  // Handlers for polling settings
  const handlePollingChange = useCallback(
    (delayThresholdHours: number, deliveryWindows: Record<string, number>) => {
      setSettings((prev) => ({ ...prev, delayThresholdHours, deliveryWindows }));
    },
    []
  );

  const handlePollingSave = useCallback(() => {
    setActiveSection("polling");
    settingsFetcher.submit(
      {
        delayThresholdHours: settings.delayThresholdHours,
        deliveryWindows: settings.deliveryWindows,
      },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json",
      }
    );
  }, [settingsFetcher, settings.delayThresholdHours, settings.deliveryWindows]);

  // Handlers for dashboard preferences
  const handleDashboardChange = useCallback(
    (
      columnVisibility: string[],
      columnOrder: string[],
      defaultSortColumn: string,
      defaultSortDirection: "asc" | "desc"
    ) => {
      setSettings((prev) => ({
        ...prev,
        columnVisibility,
        columnOrder,
        defaultSortColumn,
        defaultSortDirection,
      }));
    },
    []
  );

  const handleDashboardSave = useCallback(() => {
    setActiveSection("dashboard");
    settingsFetcher.submit(
      {
        columnVisibility: settings.columnVisibility,
        columnOrder: settings.columnOrder,
        defaultSortColumn: settings.defaultSortColumn,
        defaultSortDirection: settings.defaultSortDirection,
      },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json",
      }
    );
  }, [
    settingsFetcher,
    settings.columnVisibility,
    settings.columnOrder,
    settings.defaultSortColumn,
    settings.defaultSortDirection,
  ]);

  // Handlers for notification settings
  const handleNotificationChange = useCallback((subject: string, body: string) => {
    setSettings((prev) => ({
      ...prev,
      notificationSubject: subject,
      notificationBody: body,
    }));
  }, []);

  const handleNotificationSave = useCallback(() => {
    setActiveSection("notification");
    settingsFetcher.submit(
      {
        notificationTemplate: {
          subject: settings.notificationSubject,
          body: settings.notificationBody,
        },
      },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json",
      }
    );
  }, [settingsFetcher, settings.notificationSubject, settings.notificationBody]);

  // Handlers for display settings
  const handleTimezoneChange = useCallback((newTimezone: string) => {
    setTimezone(newTimezone);
  }, []);

  const handleAutoArchiveDaysChange = useCallback((days: number) => {
    setSettings((prev) => ({ ...prev, autoArchiveDays: days }));
  }, []);

  const handleDisplaySave = useCallback(() => {
    setActiveSection("display");
    // Note: timezone update would need a separate endpoint or be included in settings
    // For now, we save autoArchiveDays to settings
    settingsFetcher.submit(
      {
        autoArchiveDays: settings.autoArchiveDays,
      },
      {
        method: "POST",
        action: "/api/settings",
        encType: "application/json",
      }
    );
  }, [settingsFetcher, settings.autoArchiveDays]);

  // Handler for billing plan change
  const handleSelectPlan = useCallback(
    (planTier: PlanTier) => {
      billingFetcher.submit(
        {
          action: "selectPlan",
          planTier,
        },
        {
          method: "POST",
          action: "/api/billing",
          encType: "application/json",
        }
      );
    },
    [billingFetcher]
  );

  // Handle billing response - redirect to Shopify confirmation
  useEffect(() => {
    if (billingFetcher.data?.confirmationUrl) {
      window.open(billingFetcher.data.confirmationUrl, "_top");
    }
  }, [billingFetcher.data]);

  // Handle successful save
  useEffect(() => {
    if (settingsFetcher.data?.success) {
      setShowSaveSuccess(true);
      // Reset change tracking for the active section
      if (activeSection === "polling") setHasPollingChanges(false);
      if (activeSection === "dashboard") setHasDashboardChanges(false);
      if (activeSection === "notification") setHasNotificationChanges(false);
      if (activeSection === "display") setHasDisplayChanges(false);

      const timeout = setTimeout(() => {
        setShowSaveSuccess(false);
        setActiveSection(null);
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [settingsFetcher.data, activeSection]);

  const isSaving = settingsFetcher.state === "submitting";
  const isChangingPlan = billingFetcher.state === "submitting";
  const saveError = settingsFetcher.data?.error;
  const billingError = billingFetcher.data?.error;

  // Tab configuration
  const tabs = [
    { id: "polling", content: "Polling & Detection", accessibilityLabel: "Polling settings" },
    { id: "dashboard", content: "Dashboard", accessibilityLabel: "Dashboard preferences" },
    { id: "notifications", content: "Notifications", accessibilityLabel: "Notification settings" },
    { id: "display", content: "Display", accessibilityLabel: "Display settings" },
    { id: "billing", content: "Account & Billing", accessibilityLabel: "Billing settings" },
  ];

  const handleTabChange = useCallback((selectedTabIndex: number) => {
    setSelectedTab(selectedTabIndex);
  }, []);

  return (
    <Page title="Settings" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Success Banner */}
            {showSaveSuccess && (
              <Banner
                title="Settings saved"
                tone="success"
                onDismiss={() => setShowSaveSuccess(false)}
              >
                <p>Your settings have been updated.</p>
              </Banner>
            )}

            {/* Error Banner */}
            {saveError && (
              <Banner title="Error saving settings" tone="critical">
                <p>{saveError}</p>
              </Banner>
            )}

            {/* Billing Error Banner */}
            {billingError && (
              <Banner title="Billing error" tone="critical">
                <p>{billingError}</p>
              </Banner>
            )}

            {/* Tabs */}
            <Card padding="0">
              <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                <Box padding="400">
                  {/* Polling & Detection Tab */}
                  {selectedTab === 0 && (
                    <PollingSettings
                      delayThresholdHours={settings.delayThresholdHours}
                      deliveryWindows={settings.deliveryWindows}
                      onChange={handlePollingChange}
                      onSave={handlePollingSave}
                      isSaving={isSaving && activeSection === "polling"}
                      hasChanges={hasPollingChanges}
                    />
                  )}

                  {/* Dashboard Preferences Tab */}
                  {selectedTab === 1 && (
                    <DashboardPreferences
                      columnVisibility={settings.columnVisibility}
                      columnOrder={settings.columnOrder}
                      defaultSortColumn={settings.defaultSortColumn}
                      defaultSortDirection={settings.defaultSortDirection}
                      onChange={handleDashboardChange}
                      onSave={handleDashboardSave}
                      isSaving={isSaving && activeSection === "dashboard"}
                      hasChanges={hasDashboardChanges}
                    />
                  )}

                  {/* Notifications Tab */}
                  {selectedTab === 2 && (
                    <NotificationSettings
                      subject={settings.notificationSubject}
                      body={settings.notificationBody}
                      onChange={handleNotificationChange}
                      onSave={handleNotificationSave}
                      isSaving={isSaving && activeSection === "notification"}
                      hasChanges={hasNotificationChanges}
                    />
                  )}

                  {/* Display Tab */}
                  {selectedTab === 3 && (
                    <DisplaySettings
                      timezone={timezone}
                      autoArchiveDays={settings.autoArchiveDays}
                      onTimezoneChange={handleTimezoneChange}
                      onAutoArchiveDaysChange={handleAutoArchiveDaysChange}
                      onSave={handleDisplaySave}
                      isSaving={isSaving && activeSection === "display"}
                      hasChanges={hasDisplayChanges}
                    />
                  )}

                  {/* Account & Billing Tab */}
                  {selectedTab === 4 && (
                    <>
                      {billingInfo ? (
                        <AccountBilling
                          billingInfo={billingInfo}
                          allPlans={allPlans}
                          hasActiveSubscription={hasActiveSubscription}
                          onSelectPlan={handleSelectPlan}
                          isChangingPlan={isChangingPlan}
                        />
                      ) : (
                        <Card>
                          <BlockStack gap="400" inlineAlign="center">
                            <Spinner size="large" />
                            <Text as="p" variant="bodySm" tone="subdued">
                              Loading billing information...
                            </Text>
                          </BlockStack>
                        </Card>
                      )}
                    </>
                  )}
                </Box>
              </Tabs>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">
              About Settings
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Configure DelayGuard to match your business needs. Changes are saved
              per-section when you click "Save Settings".
            </Text>

            {selectedTab === 0 && (
              <>
                <Text as="h3" variant="headingSm">
                  Polling & Detection
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Control how DelayGuard detects delayed shipments. The delay threshold
                  determines how many hours after the expected delivery before flagging
                  a shipment as delayed.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Delivery window overrides let you customize expected delivery times
                  for specific service levels when carriers don't provide estimates.
                </Text>
              </>
            )}

            {selectedTab === 1 && (
              <>
                <Text as="h3" variant="headingSm">
                  Dashboard Preferences
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Customize your shipment table view. Choose which columns to display
                  and their order, plus set your preferred default sorting.
                </Text>
              </>
            )}

            {selectedTab === 2 && (
              <>
                <Text as="h3" variant="headingSm">
                  Notification Templates
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  When you send a delay notification to a customer, the email will use
                  this template. Variables like {"{tracking_number}"} are replaced with
                  the actual shipment data.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  The template must include both {"{tracking_number}"} and{" "}
                  {"{order_number}"} so customers can identify their shipment.
                </Text>
              </>
            )}

            {selectedTab === 3 && (
              <>
                <Text as="h3" variant="headingSm">
                  Display Settings
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Set your preferred timezone for displaying dates and times throughout
                  the app. Configure how long delivered shipments remain visible before
                  being auto-archived.
                </Text>
              </>
            )}

            {selectedTab === 4 && (
              <>
                <Text as="h3" variant="headingSm">
                  Billing & Plans
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  View your current plan usage and upgrade if needed. All billing is
                  handled securely through Shopify.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Shipments are counted when they receive their first carrier scan.
                  Shipments without tracking or that never get picked up don't count.
                </Text>
              </>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
