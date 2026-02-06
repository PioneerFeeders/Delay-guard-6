import {
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
} from "@shopify/polaris";

export interface SummaryData {
  totalActive: number;
  delayed: number;
  deliveredToday: number;
  avgDeliveryTimeByCarrier: {
    UPS: number | null;
    FEDEX: number | null;
    USPS: number | null;
  };
}

interface SummaryCardsProps {
  data: SummaryData;
}

export function SummaryCards({ data }: SummaryCardsProps) {
  const formatAvgTime = (days: number | null): string => {
    if (days === null) return "—";
    if (days < 1) return "<1 day";
    return `${days.toFixed(1)} days`;
  };

  const hasAvgData =
    data.avgDeliveryTimeByCarrier.UPS !== null ||
    data.avgDeliveryTimeByCarrier.FEDEX !== null ||
    data.avgDeliveryTimeByCarrier.USPS !== null;

  return (
    <Layout>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Active Shipments
            </Text>
            <Text variant="heading2xl" as="p">
              {data.totalActive}
            </Text>
            <Text variant="bodySm" as="p" tone="subdued">
              Currently being tracked
            </Text>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm" tone="subdued">
                Delayed
              </Text>
              {data.delayed > 0 && (
                <Badge tone="critical">{String(data.delayed)}</Badge>
              )}
            </InlineStack>
            <Text variant="heading2xl" as="p" tone="critical">
              {data.delayed}
            </Text>
            <Text variant="bodySm" as="p" tone="subdued">
              Require attention
            </Text>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Delivered Today
            </Text>
            <Text variant="heading2xl" as="p" tone="success">
              {data.deliveredToday}
            </Text>
            <Text variant="bodySm" as="p" tone="subdued">
              Successfully delivered
            </Text>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="subdued">
              Average Delivery Time by Carrier
            </Text>
            {hasAvgData ? (
              <InlineStack gap="800" wrap={false}>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="p">
                    {formatAvgTime(data.avgDeliveryTimeByCarrier.UPS)}
                  </Text>
                  <Text variant="bodySm" as="p" tone="subdued">
                    UPS
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="p">
                    {formatAvgTime(data.avgDeliveryTimeByCarrier.FEDEX)}
                  </Text>
                  <Text variant="bodySm" as="p" tone="subdued">
                    FedEx
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="p">
                    {formatAvgTime(data.avgDeliveryTimeByCarrier.USPS)}
                  </Text>
                  <Text variant="bodySm" as="p" tone="subdued">
                    USPS
                  </Text>
                </BlockStack>
              </InlineStack>
            ) : (
              <Text variant="bodyMd" as="p" tone="subdued">
                No delivery data yet
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
