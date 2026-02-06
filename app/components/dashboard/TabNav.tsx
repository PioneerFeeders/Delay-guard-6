import { Tabs } from "@shopify/polaris";
import { useCallback } from "react";

export type TabId = "all" | "delayed" | "pending" | "resolved" | "delivered";

interface TabNavProps {
  selected: TabId;
  onSelect: (tab: TabId) => void;
  counts: {
    all: number;
    delayed: number;
    pending: number;
    resolved: number;
    delivered: number;
  };
}

const tabConfigs: { id: TabId; content: string }[] = [
  { id: "all", content: "All Shipments" },
  { id: "delayed", content: "Delayed" },
  { id: "pending", content: "Pending Pickup" },
  { id: "resolved", content: "Resolved" },
  { id: "delivered", content: "Delivered" },
];

export function TabNav({ selected, onSelect, counts }: TabNavProps) {
  const tabs = tabConfigs.map((tab) => ({
    id: tab.id,
    content: tab.content,
    badge: counts[tab.id] > 0 ? String(counts[tab.id]) : undefined,
    accessibilityLabel: `${tab.content} (${counts[tab.id]})`,
    panelID: `${tab.id}-panel`,
  }));

  const selectedIndex = tabConfigs.findIndex((t) => t.id === selected);

  const handleTabChange = useCallback(
    (index: number) => {
      onSelect(tabConfigs[index].id);
    },
    [onSelect]
  );

  return (
    <Tabs tabs={tabs} selected={selectedIndex} onSelect={handleTabChange} />
  );
}
