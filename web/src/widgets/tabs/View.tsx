import { Tabs } from "@mantine/core";
import { useRef, useState } from "react";
import { getWidget, type WidgetViewProps } from "../../dashboard/registry.ts";
import { WidgetBody } from "../../dashboard/WidgetWrapper.tsx";
import { configTitle } from "../../dashboard/widget-base.ts";
import { Placeholder } from "../../Placeholder.tsx";
import type { Tab, TabsConfig } from "./widget.ts";

export const tabLabel = (tab: Tab) =>
  configTitle(tab.config) ?? getWidget(tab.type)?.name ?? tab.type;

const TabsView = ({
  config,
  editMode,
  dashboardIsTemplate,
  updateConfig,
  onConfigure,
}: WidgetViewProps<TabsConfig>) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  // A child's first save can resolve after the tab was removed or siblings
  // changed; its callback must write against the current tabs, not its render's.
  const latest = useRef({ config, updateConfig });
  latest.current = { config, updateConfig };

  if (config.tabs.length === 0) {
    return (
      <Placeholder
        title="No tabs yet"
        detail="Add widgets as tabs in this widget's settings."
        action={{ label: "Add tabs", onClick: onConfigure }}
      />
    );
  }

  const active = config.tabs.find((t) => t.id === activeId) ?? config.tabs[0];
  const replaceTab = (id: string, next: Tab | null) => {
    const { config, updateConfig } = latest.current;
    if (!config.tabs.some((t) => t.id === id)) return;
    updateConfig({
      ...config,
      tabs: config.tabs.flatMap((t) => (t.id !== id ? [t] : next ? [next] : [])),
    });
  };

  // Inactive panels stay mounted (Mantine's default): unmounting a note
  // mid-debounce before its first save would drop the text.
  return (
    <Tabs
      value={active?.id ?? null}
      onChange={setActiveId}
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Tabs.List
        className="screen-only"
        style={{ flexWrap: "nowrap", overflowX: "auto", flexShrink: 0 }}
      >
        {config.tabs.map((tab) => (
          <Tabs.Tab key={tab.id} value={tab.id}>
            {tabLabel(tab)}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {config.tabs.map((tab) => (
        <Tabs.Panel
          key={tab.id}
          value={tab.id}
          flex={1}
          mih={0}
          data-active-child={tab.id === active?.id ? tab.id : undefined}
        >
          <WidgetBody
            instance={tab}
            editMode={editMode}
            dashboardIsTemplate={dashboardIsTemplate}
            onConfigure={onConfigure}
            onRemove={() => replaceTab(tab.id, null)}
            onResetConfig={() =>
              replaceTab(tab.id, { ...tab, config: getWidget(tab.type)?.defaultConfig })
            }
            onUpdateConfig={(next) => replaceTab(tab.id, { ...tab, config: next })}
          />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
};

export default TabsView;
