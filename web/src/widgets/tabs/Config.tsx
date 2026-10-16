import { Accordion, Button, Menu, Stack, Text } from "@mantine/core";
import { ItemActions, moveItem } from "../../dashboard/ItemCard.tsx";
import { getWidget, registry, type WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { WidgetConfigPanel } from "../../dashboard/WidgetConfigPanel.tsx";
import { tabLabel } from "./View.tsx";
import { TABS_TYPE, type Tab, type TabsConfig } from "./widget.ts";

const MAX_TABS = 8;

const TabsConfigForm = ({ config, onChange }: WidgetConfigProps<TabsConfig>) => {
  // An invalid stored config reaches the form unparsed (an imported file can
  // say anything); show what can be edited instead of crashing the drawer.
  const tabs = Array.isArray(config.tabs) ? config.tabs.filter((t) => t?.id) : [];
  const setTabs = (next: Tab[]) => onChange({ ...config, tabs: next });
  const addTab = (type: string) => {
    const descriptor = getWidget(type);
    if (!descriptor) return;
    setTabs([...config.tabs, { id: crypto.randomUUID(), type, config: descriptor.defaultConfig }]);
  };

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />

      <Accordion variant="separated">
        {tabs.map((tab, index) => {
          const descriptor = getWidget(tab.type);
          return (
            <Accordion.Item key={tab.id} value={tab.id}>
              <Accordion.Control>
                <Text fz="sm">{tabLabel(tab)}</Text>
                <Text fz="xs" c="dimmed">
                  {descriptor?.name ?? tab.type}
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack>
                  <ItemActions
                    name={tabLabel(tab)}
                    onRemove={() => setTabs(tabs.filter((t) => t.id !== tab.id))}
                    move={{
                      index,
                      count: tabs.length,
                      onMove: (by) => setTabs(moveItem(tabs, index, by)),
                    }}
                  />
                  {descriptor ? (
                    <WidgetConfigPanel
                      widget={tab}
                      descriptor={descriptor}
                      onChange={(next) =>
                        setTabs(tabs.map((t) => (t.id === tab.id ? { ...t, config: next } : t)))
                      }
                    />
                  ) : (
                    <Text fz="xs" c="dimmed">
                      Unknown widget type "{tab.type}" — remove this tab.
                    </Text>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>

      <Menu position="bottom-start">
        <Menu.Target>
          <Button size="xs" variant="default" disabled={tabs.length >= MAX_TABS}>
            Add tab
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {[...registry.values()]
            .filter((d) => d.type !== TABS_TYPE)
            .map((d) => (
              <Menu.Item key={d.type} onClick={() => addTab(d.type)}>
                <Text fz="sm">{d.name}</Text>
                {d.description && (
                  <Text fz="xs" c="dimmed">
                    {d.description}
                  </Text>
                )}
              </Menu.Item>
            ))}
        </Menu.Dropdown>
      </Menu>
    </Stack>
  );
};

export default TabsConfigForm;
