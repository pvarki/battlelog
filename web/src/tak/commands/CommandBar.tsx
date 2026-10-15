import { Group, Kbd, Text, UnstyledButton } from "@mantine/core";
import { createSpotlight, Spotlight, type SpotlightStore } from "@mantine/spotlight";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { useStoredSetting } from "../../stored-setting.ts";
import { type Command, rank, remember, score } from "./commands.ts";

const [store, bar] = createSpotlight();

/** Its shortcut is the viewer's to choose, so the workspace's key handler opens it. */
export const openCommandBar = bar.open;

/** Spotlight only moves its selection when the query changes; a new list after Tab needs it too. */
const selectFirst = (spotlight: SpotlightStore) => {
  const list = document.getElementById(spotlight.getState().listId);
  list?.querySelector("[data-selected]")?.removeAttribute("data-selected");
  list?.querySelector("[data-action]")?.setAttribute("data-selected", "true");
  spotlight.updateState((s) => ({ ...s, selected: 0 }));
};

const selectedId = (spotlight: SpotlightStore) =>
  document
    .getElementById(spotlight.getState().listId)
    ?.querySelector<HTMLElement>("[data-selected]")?.dataset.commandId;

type Props = {
  /** Always listed. */
  commands: Command[];
  /** Matches that depend on what's typed: items, coordinates. */
  search: (query: string) => Command[];
  /** A remembered command, for the Recent list; items included. */
  byId: (id: string) => Command | undefined;
  /** Shown in the field, as the viewer has set it. */
  shortcut?: string;
};

/** The map's command bar: find and do anything by name; the workspace opens it from its shortcut. */
export const CommandBar = ({ commands, search, byId, shortcut }: Props) => {
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string>();
  // Resolved on every render, so its actions see the item as it is now.
  const focus = focusId === undefined ? undefined : byId(focusId);
  const [queryBefore, setQueryBefore] = useState("");
  const [recent, setRecent] = useStoredSetting<string[]>({
    key: "battlelog.tak.recentCommands",
    defaultValue: [],
  });

  const recents = recent.flatMap((id) => byId(id) ?? []);
  const groups = focus
    ? [
        {
          group: focus.label,
          commands: (focus.actions?.() ?? []).filter((c) => score(c, query) !== undefined),
        },
      ]
    : query.trim()
      ? rank([...search(query), ...commands], query)
      : [
          ...(recents.length ? [{ group: "Recent", commands: recents }] : []),
          ...rank(commands, ""),
        ];
  const shown = groups.flatMap((g) => g.commands);

  const run = (command: Command) => {
    if (command.disabledReason) return;
    setRecent((list) => remember(list, focus?.id ?? command.id));
    bar.close();
    command.run();
  };

  const afterRender = () => requestAnimationFrame(() => selectFirst(store));

  const back = () => {
    setFocusId(undefined);
    setQuery(queryBefore);
    afterRender();
  };

  const reset = () => {
    setFocusId(undefined);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      if (focus) return e.shiftKey && back();
      const command = shown.find((c) => c.id === selectedId(store));
      if (command?.actions) {
        setQueryBefore(query);
        setFocusId(command.id);
        setQuery("");
        afterRender();
      }
    } else if (focus && (e.key === "Escape" || (e.key === "Backspace" && !query))) {
      e.preventDefault();
      e.stopPropagation();
      back();
    }
  };

  return (
    <>
      <UnstyledButton
        className="tak-command-trigger"
        onClick={bar.open}
        aria-label="Search items, places and commands"
        title="Search and commands"
      >
        <IconSearch size={16} />
        <span>Search items, places and commands</span>
        {shortcut && (
          <Kbd size="xs" className="tak-kbd-hint">
            {shortcut}
          </Kbd>
        )}
      </UnstyledButton>
      <Spotlight.Root
        store={store}
        query={query}
        onQueryChange={setQuery}
        shortcut={null}
        closeOnEscape={!focus}
        onSpotlightOpen={afterRender}
        onSpotlightClose={reset}
        scrollable
        className="tak-command-bar"
        overlayProps={{ backgroundOpacity: 0.35, blur: 0 }}
        classNames={{ action: "tak-command-action" }}
      >
        <Spotlight.Search
          placeholder={
            focus ? `Actions for ${focus.label}` : "Search items, coordinates, commands…"
          }
          leftSection={
            focus ? (
              <IconArrowLeft size={16} title="Back (Shift-Tab)" onClick={back} />
            ) : (
              <IconSearch size={16} />
            )
          }
          onKeyDown={onKeyDown}
        />
        <Spotlight.ActionsList>
          {groups.map(({ group, commands }) => (
            <Spotlight.ActionsGroup key={group} label={group}>
              {commands.map((command) => (
                <Spotlight.Action
                  key={command.id}
                  data-command-id={command.id}
                  label={command.label}
                  description={command.detail}
                  leftSection={command.icon}
                  rightSection={
                    command.actions ? (
                      <Kbd size="xs">Tab</Kbd>
                    ) : command.shortcut ? (
                      <Kbd size="xs">{command.shortcut}</Kbd>
                    ) : undefined
                  }
                  disabled={!!command.disabledReason}
                  title={command.disabledReason}
                  highlightQuery
                  highlightColor="accent"
                  closeSpotlightOnTrigger={false}
                  onClick={() => run(command)}
                />
              ))}
            </Spotlight.ActionsGroup>
          ))}
          {shown.length === 0 && <Spotlight.Empty>Nothing matches</Spotlight.Empty>}
        </Spotlight.ActionsList>
        <Spotlight.Footer>
          <Group gap="md">
            <Text fz="xs" c="dimmed">
              <Kbd size="xs">↵</Kbd> {focus ? "Do it" : "Open"}
            </Text>
            {!focus && (
              <Text fz="xs" c="dimmed">
                <Kbd size="xs">Tab</Kbd> More actions
              </Text>
            )}
            <Text fz="xs" c="dimmed">
              <Kbd size="xs">Esc</Kbd> {focus ? "Back" : "Close"}
            </Text>
          </Group>
        </Spotlight.Footer>
      </Spotlight.Root>
    </>
  );
};
