import { Indicator, UnstyledButton } from "@mantine/core";
import {
  IconAddressBook,
  IconChecklist,
  IconClipboardList,
  IconFolders,
  IconList,
  IconMessage,
  IconSettings,
  IconStack2,
} from "@tabler/icons-react";

export const DRAWERS = {
  items: { label: "Items", Icon: IconList },
  missions: { label: "Data Sync", Icon: IconFolders },
  plans: { label: "Plans", Icon: IconClipboardList },
  layers: { label: "Layers", Icon: IconStack2 },
  chat: { label: "Chat", Icon: IconMessage },
  contacts: { label: "Contacts", Icon: IconAddressBook },
  checklists: { label: "Checklists", Icon: IconChecklist },
  settings: { label: "Settings", Icon: IconSettings },
} as const;

export type DrawerId = keyof typeof DRAWERS;

export const DRAWER_IDS = Object.keys(DRAWERS) as DrawerId[];

/** Focuses a drawer's rail button, e.g. to hand focus back when the drawer closes. */
export const focusRailButton = (id: DrawerId) =>
  document.querySelector<HTMLElement>(`.tak-rail-button[data-drawer="${id}"]`)?.focus();

/** The map page's drawers, one button each, with unread counts. */
export const WorkspaceRail = ({
  open,
  onToggle,
  badges,
  shortcutOf,
}: {
  open: DrawerId | null;
  onToggle: (id: DrawerId) => void;
  badges: Partial<Record<DrawerId, number>>;
  shortcutOf: (action: string) => string | undefined;
}) => (
  <nav className="tak-rail" aria-label="Map tools">
    {DRAWER_IDS.map((id) => {
      const { label, Icon } = DRAWERS[id];
      const key = shortcutOf(`drawer.${id}`);
      return (
        <UnstyledButton
          key={id}
          className="tak-rail-button"
          data-drawer={id}
          data-end={id === "settings" || undefined}
          aria-pressed={open === id}
          onClick={() => onToggle(id)}
          title={key ? `${label} (${key})` : label}
        >
          <Indicator label={badges[id]} size={16} color="primary" disabled={!badges[id]}>
            <Icon size={20} stroke={1.5} />
          </Indicator>
          <span>{label}</span>
        </UnstyledButton>
      );
    })}
  </nav>
);
