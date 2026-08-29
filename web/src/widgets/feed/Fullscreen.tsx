import {
  Box,
  Button,
  Center,
  Chip,
  Drawer,
  Fieldset,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { EventResponse } from "../../api.ts";
import { EventDetail } from "../../EventDetail.tsx";
import { useLiveEvents } from "../../live-events.ts";
import { StaleNotice } from "../../StaleNotice.tsx";
import { FeedTable } from "./View.tsx";
import {
  activeView,
  effectiveColumns,
  effectiveConfig,
  type FeedColumn,
  type FeedConfig,
  type FeedExtras,
  FIELD_LABEL,
  FIELDS,
  labelFor,
  matchesFeed,
  queryFor,
} from "./widget.ts";

const LIMIT = 100;

const EMPTY = {
  types: [] as string[],
  tags: [] as string[],
  search: "",
  createdBy: "",
  eventTimeFrom: "",
  eventTimeTo: "",
  createdAtFrom: "",
  createdAtTo: "",
};

const toExtras = (f: typeof EMPTY): FeedExtras => ({
  ...(f.types.length ? { types: f.types } : {}),
  ...(f.tags.length ? { tags: f.tags } : {}),
  ...(f.search ? { search: f.search } : {}),
  ...(f.createdBy ? { createdBy: f.createdBy } : {}),
  ...(f.eventTimeFrom ? { eventTimeFrom: f.eventTimeFrom } : {}),
  ...(f.eventTimeTo ? { eventTimeTo: f.eventTimeTo } : {}),
  ...(f.createdAtFrom ? { createdAtFrom: f.createdAtFrom } : {}),
  ...(f.createdAtTo ? { createdAtTo: f.createdAtTo } : {}),
});

const lockedNote = (values: string[] | undefined): string | undefined =>
  values?.length ? `Locked by widget config: ${values.join(", ")}` : undefined;

const FeedFullscreen = ({
  opened,
  config,
  onClose,
}: {
  opened: boolean;
  config: FeedConfig;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  // Open one tick after mount: a Modal that mounts already-open skips its
  // enter transition, and this component mounts on the first open click.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [selected, setSelected] = useState<EventResponse | null>(null);
  const [filters, setFilters] = useState(EMPTY);
  const set = (patch: Partial<typeof EMPTY>) => setFilters((f) => ({ ...f, ...patch }));

  // The active view decides which columns and filters apply here too, or
  // fullscreen would show the widget's base columns and quietly drop the view's
  // condition — which is what it used to do.
  const view = activeView(config);
  const active = effectiveConfig(config);
  const viewColumns = effectiveColumns(config);

  // Every built-in field plus those columns is toggleable; they start visible.
  // All of this is view-state — nothing persists.
  const candidates: FeedColumn[] = [
    ...viewColumns,
    ...FIELDS.filter((f) => !viewColumns.some((c) => c.source === f)).map((f) => ({
      id: `builtin-${f}`,
      label: "",
      source: f,
      dataPath: "",
    })),
  ];
  const [visible, setVisible] = useState<string[]>(viewColumns.map((c) => c.id));
  const columns = candidates.filter((c) => visible.includes(c.id));

  const extras = toExtras(filters);
  const { events, failed, arrived } = useLiveEvents({
    limit: LIMIT,
    query: queryFor(config, extras),
    match: (row: EventResponse) => matchesFeed(row, config, extras),
  });

  return (
    <Modal
      opened={opened && mounted}
      onClose={onClose}
      fullScreen
      // Name the view: fullscreen shows one view's rows, and which one is not
      // otherwise visible from in here.
      title={[config.title || "Event feed", view?.label].filter(Boolean).join(" — ")}
      transitionProps={{ transition: "pop", duration: 180 }}
    >
      <Fieldset legend="Filters" mb="sm">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <TagsInput
            label="Types"
            description={lockedNote(active.types) ?? "Narrow to these event types"}
            value={filters.types}
            onChange={(types) => set({ types })}
          />
          <TagsInput
            label="Tags"
            description={lockedNote(active.tags) ?? "Also require any of these tags"}
            value={filters.tags}
            onChange={(tags) => set({ tags })}
          />
          <TextInput
            label="Search"
            description={config.search ? `Locked by widget config: ${config.search}` : undefined}
            placeholder="Header contains"
            value={filters.search}
            onChange={(e) => set({ search: e.currentTarget.value })}
          />
          <TextInput
            label="Created by"
            value={config.createdBy ?? filters.createdBy}
            disabled={Boolean(config.createdBy)}
            description={config.createdBy ? "Locked by widget config" : undefined}
            onChange={(e) => set({ createdBy: e.currentTarget.value })}
          />
          <TextInput
            type="datetime-local"
            label="Event time from"
            value={filters.eventTimeFrom}
            onChange={(e) => set({ eventTimeFrom: e.currentTarget.value })}
          />
          <TextInput
            type="datetime-local"
            label="Event time to"
            value={filters.eventTimeTo}
            onChange={(e) => set({ eventTimeTo: e.currentTarget.value })}
          />
          <TextInput
            type="datetime-local"
            label="Created from"
            value={filters.createdAtFrom}
            onChange={(e) => set({ createdAtFrom: e.currentTarget.value })}
          />
          <TextInput
            type="datetime-local"
            label="Created to"
            value={filters.createdAtTo}
            onChange={(e) => set({ createdAtTo: e.currentTarget.value })}
          />
        </SimpleGrid>
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" size="xs" onClick={() => setFilters(EMPTY)}>
            Reset extra filters
          </Button>
        </Group>
      </Fieldset>

      <Chip.Group multiple value={visible} onChange={setVisible}>
        <Group gap="xs" mb="sm">
          {candidates.map((c) => (
            <Chip key={c.id} value={c.id} size="xs">
              {c.source === "data" ? labelFor(c) : FIELD_LABEL[c.source]}
            </Chip>
          ))}
        </Group>
      </Chip.Group>

      {!events ? (
        <Center h={200}>
          <Loader size="sm" />
        </Center>
      ) : failed && events.length === 0 ? (
        <Center h={200}>
          <Text c="dimmed" fz="sm">
            Could not load events — new ones will still arrive on the live stream.
          </Text>
        </Center>
      ) : (
        <Box style={{ overflowX: "auto" }}>
          {failed && <StaleNotice />}
          <FeedTable columns={columns} events={events} arrived={arrived} onRowClick={setSelected} />
        </Box>
      )}

      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        position="right"
        size="md"
        title={selected?.header}
      >
        {selected && (
          <EventDetail
            event={selected}
            onShowHistory={() => {
              setSelected(null);
              onClose();
              void navigate({
                to: "/events",
                search: { eventId: selected.eventId, includeHistory: true },
              });
            }}
          />
        )}
      </Drawer>
    </Modal>
  );
};

export default FeedFullscreen;
