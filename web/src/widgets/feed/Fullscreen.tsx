import {
  Box,
  Button,
  Center,
  Chip,
  Fieldset,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  TagsInput,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import type { EventResponse } from "../../api.ts";
import { useLiveEvents } from "../../live-events.ts";
import { FeedTable } from "./View.tsx";
import {
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

const FeedFullscreen = ({ config, onClose }: { config: FeedConfig; onClose: () => void }) => {
  const [filters, setFilters] = useState(EMPTY);
  const set = (patch: Partial<typeof EMPTY>) => setFilters((f) => ({ ...f, ...patch }));

  // Every built-in field plus the config's columns is toggleable; config
  // columns start visible. All of this is view-state — nothing persists.
  const candidates: FeedColumn[] = [
    ...config.columns,
    ...FIELDS.filter((f) => !config.columns.some((c) => c.source === f)).map((f) => ({
      id: `builtin-${f}`,
      label: "",
      source: f,
      dataPath: "",
    })),
  ];
  const [visible, setVisible] = useState<string[]>(config.columns.map((c) => c.id));
  const columns = candidates.filter((c) => visible.includes(c.id));

  const extras = toExtras(filters);
  const events = useLiveEvents({
    limit: LIMIT,
    query: queryFor(config, extras),
    match: (row: EventResponse) => matchesFeed(row, config, extras),
  });

  return (
    <Modal opened onClose={onClose} fullScreen title={config.title || "Event feed"}>
      <Fieldset legend="Filters" mb="sm">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <TagsInput
            label="Types"
            description={lockedNote(config.types) ?? "Narrow to these event types"}
            value={filters.types}
            onChange={(types) => set({ types })}
          />
          <TagsInput
            label="Tags"
            description={lockedNote(config.tags) ?? "Also require any of these tags"}
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
      ) : (
        <Box style={{ overflowX: "auto" }}>
          <FeedTable columns={columns} events={events} />
        </Box>
      )}
    </Modal>
  );
};

export default FeedFullscreen;
