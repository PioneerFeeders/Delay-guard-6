/**
 * Onboarding Wizard Route
 *
 * Multi-step onboarding flow for new DelayGuard merchants:
 * 1. Welcome - Introduction and value proposition
 * 2. Preferences - Configure delay threshold, timezone, preview template
 * 3. Sync - Import recent fulfillments from Shopify
 * 4. Test Mode - Optionally add test shipment data
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { data, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, BlockStack, Box, InlineStack, Text } from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { prisma } from "~/db.server";
import {
  getMerchantByShopId,
  updateMerchantSettings,
  completeOnboarding,
} from "~/services/merchant.service";
import { type MerchantSettings } from "~/lib/validation";
import {
  WelcomeStep,
  PreferencesStep,
  SyncStep,
  TestModeStep,
  type TestShipmentData,
} from "~/components/onboarding";

type OnboardingStep = "welcome" | "preferences" | "sync" | "test";

const STEPS: OnboardingStep[] = ["welcome", "preferences", "sync", "test"];

interface LoaderData {
  shop: string;
  merchantId: string;
  settings: MerchantSettings;
  timezone: string;
  onboardingDone: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);

  if (!merchant) {
    // Merchant should be created in app.tsx - redirect back
    return redirect("/app");
  }

  // If onboarding is already done, redirect to dashboard
  if (merchant.onboardingDone) {
    return redirect("/app");
  }

  return {
    shop: session.shop,
    merchantId: merchant.id,
    settings: merchant.settings,
    timezone: merchant.timezone,
    onboardingDone: merchant.onboardingDone,
  } satisfies LoaderData;
}

interface ActionData {
  success: boolean;
  error?: string;
  action?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const merchant = await getMerchantByShopId(session.shop);
  if (!merchant) {
    return data<ActionData>(
      { success: false, error: "Merchant not found" },
      { status: 404 }
    );
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  try {
    switch (actionType) {
      case "savePreferences": {
        const settingsJson = formData.get("settings") as string;
        const timezone = formData.get("timezone") as string;

        const settingsUpdate = JSON.parse(settingsJson) as Partial<MerchantSettings>;

        // Update merchant settings
        await updateMerchantSettings(merchant.id, settingsUpdate);

        // Update timezone if changed
        if (timezone && timezone !== merchant.timezone) {
          await prisma.merchant.update({
            where: { id: merchant.id },
            data: { timezone },
          });
        }

        return { success: true, action: "savePreferences" } satisfies ActionData;
      }

      case "addTestShipment": {
        const testDataJson = formData.get("testShipment") as string;
        const testData = JSON.parse(testDataJson) as TestShipmentData;

        // Create a test shipment with isTestData flag
        await prisma.shipment.create({
          data: {
            merchantId: merchant.id,
            shopifyOrderId: "test-" + Date.now(),
            shopifyFulfillmentId: "test-fulfillment-" + Date.now(),
            orderNumber: testData.orderNumber,
            trackingNumber: testData.trackingNumber,
            carrier: testData.carrier,
            customerName: testData.customerName,
            customerEmail: testData.customerEmail,
            shipDate: new Date(),
            currentStatus: "pending",
            isTestData: true, // Mark as test data
            shippingAddress: {
              firstName: testData.customerName.split(" ")[0] || "Test",
              lastName: testData.customerName.split(" ").slice(1).join(" ") || "Customer",
              address1: "123 Test Street",
              city: "Test City",
              province: "Test State",
              country: "United States",
              countryCode: "US",
              zip: "12345",
            },
          },
        });

        return { success: true, action: "addTestShipment" } satisfies ActionData;
      }

      case "completeOnboarding": {
        await completeOnboarding(merchant.id);
        return { success: true, action: "completeOnboarding" } satisfies ActionData;
      }

      default:
        return data<ActionData>(
          { success: false, error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[onboarding] Action error:", error);
    return data<ActionData>(
      { success: false, error: "An error occurred" },
      { status: 500 }
    );
  }
}

export default function OnboardingPage() {
  const { settings, timezone } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();

  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [localSettings, setLocalSettings] = useState<MerchantSettings>(settings);
  const [localTimezone, setLocalTimezone] = useState(timezone);

  // Get current step index for progress indicator
  const currentStepIndex = STEPS.indexOf(currentStep);
  const isSubmitting = fetcher.state === "submitting";

  const goToNextStep = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  }, [currentStepIndex]);

  const goToPreviousStep = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  }, [currentStepIndex]);

  // Handle preferences submission
  const handlePreferencesSubmit = useCallback(
    (prefs: { settings: Partial<MerchantSettings>; timezone: string }) => {
      // Update local state
      setLocalSettings((prev) => ({ ...prev, ...prefs.settings }));
      setLocalTimezone(prefs.timezone);

      // Save to server
      fetcher.submit(
        {
          _action: "savePreferences",
          settings: JSON.stringify(prefs.settings),
          timezone: prefs.timezone,
        },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  // Handle test mode completion
  const handleTestModeComplete = useCallback(
    (addTestData: boolean, testShipment?: TestShipmentData) => {
      if (addTestData && testShipment) {
        // Add test shipment then complete onboarding
        fetcher.submit(
          {
            _action: "addTestShipment",
            testShipment: JSON.stringify(testShipment),
          },
          { method: "POST" }
        );
      } else {
        // Just complete onboarding
        fetcher.submit({ _action: "completeOnboarding" }, { method: "POST" });
      }
    },
    [fetcher]
  );

  // Handle action responses
  useEffect(() => {
    if (fetcher.data?.success) {
      switch (fetcher.data.action) {
        case "savePreferences":
          goToNextStep();
          break;
        case "addTestShipment":
          // Now complete onboarding
          fetcher.submit({ _action: "completeOnboarding" }, { method: "POST" });
          break;
        case "completeOnboarding":
          // Redirect to dashboard
          window.location.href = "/app";
          break;
      }
    }
  }, [fetcher.data, goToNextStep, fetcher]);

  // Step progress indicator
  const StepIndicator = () => (
    <Box paddingBlockEnd="600">
      <InlineStack gap="200" align="center">
        {STEPS.map((step, index) => {
          const isActive = index === currentStepIndex;
          const isCompleted = index < currentStepIndex;
          const stepNumber = index + 1;

          return (
            <InlineStack key={step} gap="100" blockAlign="center">
              <Box
                background={
                  isActive
                    ? "bg-fill-brand"
                    : isCompleted
                    ? "bg-fill-success"
                    : "bg-fill-tertiary"
                }
                borderRadius="full"
                minWidth="32px"
                minHeight="32px"
              >
                <Box padding="100">
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight="semibold"
                    tone={isActive || isCompleted ? "text-inverse" : undefined}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "24px",
                        height: "24px",
                      }}
                    >
                      {isCompleted ? "✓" : stepNumber}
                    </span>
                  </Text>
                </Box>
              </Box>
              {index < STEPS.length - 1 && (
                <Box
                  background={isCompleted ? "bg-fill-success" : "bg-fill-tertiary"}
                  minWidth="40px"
                  minHeight="2px"
                />
              )}
            </InlineStack>
          );
        })}
      </InlineStack>
    </Box>
  );

  return (
    <Page narrowWidth>
      <BlockStack gap="400">
        <StepIndicator />

        {currentStep === "welcome" && (
          <WelcomeStep onNext={goToNextStep} />
        )}

        {currentStep === "preferences" && (
          <PreferencesStep
            initialSettings={localSettings}
            initialTimezone={localTimezone}
            onNext={handlePreferencesSubmit}
            onBack={goToPreviousStep}
            isSubmitting={isSubmitting}
          />
        )}

        {currentStep === "sync" && (
          <SyncStep
            onNext={goToNextStep}
            onBack={goToPreviousStep}
          />
        )}

        {currentStep === "test" && (
          <TestModeStep
            onComplete={handleTestModeComplete}
            onBack={goToPreviousStep}
            isSubmitting={isSubmitting}
          />
        )}
      </BlockStack>
    </Page>
  );
}
