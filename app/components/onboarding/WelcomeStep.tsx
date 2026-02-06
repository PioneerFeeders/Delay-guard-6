/**
 * WelcomeStep Component
 *
 * First step of the onboarding wizard that introduces DelayGuard
 * and its value proposition.
 */

import {
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Icon,
  Box,
} from "@shopify/polaris";
import {
  DeliveryIcon,
  AlertCircleIcon,
  EmailIcon,
  ChartVerticalIcon,
} from "@shopify/polaris-icons";

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  const features = [
    {
      icon: AlertCircleIcon,
      title: "Early Warning System",
      description: "Detect delays before customers complain",
    },
    {
      icon: EmailIcon,
      title: "Proactive Communication",
      description: "Send delay notifications to maintain customer trust",
    },
    {
      icon: ChartVerticalIcon,
      title: "Operational Visibility",
      description: "Dashboard showing all shipment statuses and delay metrics",
    },
    {
      icon: DeliveryIcon,
      title: "Reduced Support Tickets",
      description: 'Fewer "where is my order?" inquiries',
    },
  ];

  return (
    <Card>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">
            Welcome to DelayGuard
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            Proactive shipment delay detection for your Shopify store
          </Text>
        </BlockStack>

        <Text as="p" variant="bodyMd">
          DelayGuard monitors your shipments for delays and enables you to proactively
          notify customers before they ask "Where's my order?" We track packages from
          UPS, FedEx, and USPS automatically.
        </Text>

        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            What you'll get:
          </Text>
          <BlockStack gap="300">
            {features.map((feature, index) => (
              <Box key={index} paddingInlineStart="200">
                <InlineStack gap="300" blockAlign="start">
                  <Box>
                    <Icon source={feature.icon} tone="base" />
                  </Box>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {feature.title}
                    </Text>
                    <Text as="span" variant="bodyMd" tone="subdued">
                      {feature.description}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </BlockStack>

        <Box paddingBlockStart="400">
          <InlineStack align="end">
            <Button variant="primary" size="large" onClick={onNext}>
              Let's get you set up
            </Button>
          </InlineStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
