import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Drawer,
  Fieldset,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api, type EventResponse } from "../api.ts";
import { EventDetail } from "../components/EventDetail.tsx";
import { Placeholder } from "../components/Placeholder.tsx";
import { CREDIBILITY, RELIABILITY } from "../events/admiralty.ts";
import {
  activeChips,
  buildQuery,
  compact,
  EMPTY,
  type FilterChip,
  type Filters,
  isUuid,
  PAGE,
} from "../events/event-filters.ts";
import { formatDateTime } from "../time.ts";
import { useIsMobile } from "../viewport.ts";

const route = getRouteApi("/events");

const SORT_OPTIONS = [
  { value: "logged", label: "Newest logged" },
  { value: "happened", label: "Newest happened" },
];

// The URL holds the sort like the filters; the last choice is remembered so a
// plain link to the explorer opens the way this user reads the log.
const SORT_KEY = "battlelog.explorer.sort";

const rememberedSort = (): Filters["sort"] | undefined => {
  try {
    return localStorage.getItem(SORT_KEY) === "happened" ? "happened" : undefined;
  } catch {
    return undefined;
  }
};

const rememberSort = (sort: Filters["sort"]) => {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    // Private mode: the choice still holds in the URL.
  }
};

/** The time the table is sorted by, and the other one for the tooltip. */
const timesOf = (event: EventResponse, sort: Filters["sort"]) => {
  const logged = `Logged ${formatDateTime(event.createdAt)}`;
  const happened = event.eventTime && `Happened ${formatDateTime(event.eventTime)}`;
  return sort === "happened"
    ? {
        shown: formatDateTime(event.eventTime ?? event.createdAt),
        other: event.eventTime ? logged : undefined,
      }
    : { shown: formatDateTime(event.createdAt), other: happened || undefined };
};

// The header search box applies itself; the drawer's filters wait for Apply.
// Header search is one indexed ILIKE, so auto-applying it is cheap and removes
// the trap of a visible field that isn't what the table is showing. Geo and
// the multi-value filters stay explicit — those queries are not cheap.
const SEARCH_DEBOUNCE_MS = 400;

// `tags` and `location` are unbounded free text in the DB, so with an auto-layout
// table one verbose row set the width of every column. The table is now
// layout="fixed": columns keep their declared width, over-long values ellipsize,
// and the full value stays reachable via the title tooltip and the detail drawer.
// The minor columns are percentages so Header keeps a share on a narrow desktop.
const TRUNCATE = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

const TAGS_SHOWN = 2;

const TagsCell = ({ tags }: { tags: string[] }) => (
  <Group gap={4} wrap="nowrap" title={tags.join(", ")}>
    {tags.slice(0, TAGS_SHOWN).map((tag) => (
      <Badge key={tag} variant="default" size="sm" miw={0} style={{ textTransform: "none" }}>
        {tag}
      </Badge>
    ))}
    {tags.length > TAGS_SHOWN && (
      <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
        +{tags.length - TAGS_SHOWN}
      </Text>
    )}
  </Group>
);

/**
 * A workspace over one filtered result set: a compact header carrying the
 * search box and the active-filter chips, results filling the rest of the
 * viewport, and the twenty-odd inputs behind a drawer. Laid out full-height
 * (like DashboardPage) so a map view can take the canvas later without the
 * page needing to be rebuilt around it.
 */
export const EventExplorerPage = () => {
  const applied = route.useSearch();
  const navigate = route.useNavigate();
  const [rows, setRows] = useState<EventResponse[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [selected, setSelected] = useState<EventResponse | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The drawer edits a copy, so an abandoned edit changes nothing.
  const [draft, setDraft] = useState<Filters>(() => ({ ...EMPTY, ...applied }));
  const [searchInput, setSearchInput] = useState(applied.search ?? "");
  // Guards against out-of-order responses: only the latest run may touch state.
  const runSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const run = async (f: Filters, cursor?: string) => {
    const seq = ++runSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.events.$get({
        query: { ...buildQuery(f), ...(cursor ? { cursor } : {}) },
      });
      if (seq !== runSeq.current) return;
      if (!res.ok) {
        setError(`Query failed (${res.status})`);
        return;
      }
      const page = (await res.json()) as EventResponse[];
      if (seq !== runSeq.current) return;
      setRows((prev) => (cursor && prev ? [...prev, ...page] : page));
      setAtEnd(page.length < PAGE);
    } catch {
      if (seq === runSeq.current) setError("Query failed — network error");
    } finally {
      if (seq === runSeq.current) setLoading(false);
    }
  };

  const applyFilters = useEffectEvent((next: Filters) => void run(next));

  // The URL is the source of truth: fetch on every change (including mount and
  // back/forward) and resync the header box. Cancelling any pending search keeps
  // a stale debounce from resurrecting a filter that was just removed.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    setSearchInput(applied.search ?? "");
    applyFilters({ ...EMPTY, ...applied });
  }, [applied]);

  const restoreSort = useEffectEvent(() => {
    const remembered = rememberedSort();
    if (!applied.sort && remembered)
      navigate({ search: { ...applied, sort: remembered }, replace: true });
  });
  useEffect(() => restoreSort(), []);

  const chips = activeChips(applied);
  // Search lives in the header, so it doesn't count toward the drawer's badge.
  const drawerCount = chips.filter((c) => c.id !== "search").length;

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      const next = { ...applied };
      if (trimmed) next.search = trimmed;
      else delete next.search;
      navigate({ search: next });
    }, SEARCH_DEBOUNCE_MS);
  };

  const openFilters = () => {
    setDraft({ ...EMPTY, ...applied, search: searchInput });
    setFiltersOpen(true);
  };

  const applyDraft = () => {
    clearTimeout(searchTimer.current);
    setFiltersOpen(false);
    navigate({ search: compact({ ...draft, search: searchInput.trim() }) });
  };

  const sort = applied.sort ?? EMPTY.sort;
  const keptSort = compact({ ...EMPTY, sort });

  const clearAll = () => {
    clearTimeout(searchTimer.current);
    setFiltersOpen(false);
    setSearchInput("");
    setDraft({ ...EMPTY, sort });
    navigate({ search: keptSort });
  };

  const setSort = (next: Filters["sort"]) => {
    rememberSort(next);
    navigate({ search: compact({ ...EMPTY, ...applied, sort: next }) });
  };

  const removeChip = (chip: FilterChip) => navigate({ search: chip.without });
  const set = (patch: Partial<Filters>) => setDraft((f) => ({ ...f, ...patch }));

  const eventIdInvalid = draft.eventId.trim() !== "" && !isUuid(draft.eventId.trim());
  const geoPartial =
    [draft.lat, draft.lng, draft.radiusMeters].filter((v) => v !== "").length % 3 !== 0;

  const isMobile = useIsMobile();

  const countText = rows !== null && rows.length > 0 && (
    <Text fz="xs" c="dimmed" role="status" style={{ whiteSpace: "nowrap" }}>
      {rows.length}
      {atEnd ? "" : "+"} {applied.includeHistory ? "version" : "event"}
      {rows.length === 1 ? "" : "s"}
    </Text>
  );

  const clearAllButton = chips.length > 0 && (
    <Button size="xs" variant="subtle" color="gray" style={{ flexShrink: 0 }} onClick={clearAll}>
      Clear all
    </Button>
  );

  const chipBadges = chips.map((chip) => (
    <Badge
      key={chip.id}
      variant="light"
      color="accent"
      size="sm"
      style={{ flexShrink: 0, textTransform: "none" }}
      rightSection={
        <ActionIcon
          size={14}
          variant="transparent"
          color="accent"
          aria-label={`Remove filter ${chip.label}`}
          onClick={() => removeChip(chip)}
        >
          <IconX size={12} stroke={2} />
        </ActionIcon>
      }
    >
      {chip.label}
    </Badge>
  ));

  const filtersButton = (
    <Button
      size="xs"
      variant="default"
      leftSection={<IconFilter size={14} />}
      onClick={openFilters}
    >
      Filters{drawerCount ? ` · ${drawerCount}` : ""}
    </Button>
  );

  const sortSelect = (
    <Select
      size="xs"
      w={150}
      aria-label="Sort events"
      data={SORT_OPTIONS}
      value={sort}
      onChange={(next) => next && setSort(next as Filters["sort"])}
      allowDeselect={false}
    />
  );

  const searchBox = (
    <TextInput
      size="xs"
      w={isMobile ? undefined : 240}
      style={isMobile ? { flex: 1 } : undefined}
      placeholder="Header contains…"
      aria-label="Search event headers"
      leftSection={<IconSearch size={14} />}
      value={searchInput}
      onChange={(e) => onSearchChange(e.currentTarget.value)}
    />
  );

  return (
    <Box
      px="md"
      py="sm"
      h="calc(100dvh - 48px)"
      style={{ display: "flex", flexDirection: "column" }}
    >
      {isMobile ? (
        <Stack gap="xs" mb="xs">
          <Group gap="xs" wrap="nowrap">
            {searchBox}
            {filtersButton}
          </Group>
          {chips.length > 0 && (
            <Group gap={4} wrap="nowrap" style={{ overflowX: "auto", minWidth: 0 }}>
              {chipBadges}
              {clearAllButton}
            </Group>
          )}
          <Group justify="space-between" wrap="nowrap" gap="xs">
            {countText || <span />}
            {sortSelect}
          </Group>
        </Stack>
      ) : (
        <Group justify="space-between" wrap="nowrap" gap="sm" mb="xs">
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            {searchBox}
            {/* Chips scroll sideways rather than wrapping — wrapping would eat the
                height the results need. */}
            <Group gap={4} wrap="nowrap" style={{ overflowX: "auto", minWidth: 0 }}>
              {chipBadges}
            </Group>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {countText}
            {clearAllButton}
            {sortSelect}
            {filtersButton}
          </Group>
        </Group>
      )}

      <Box flex={1} mih={0} style={{ overflowY: "auto" }}>
        {error && (
          <Text c="danger.4" my="sm" role="status">
            {error}
          </Text>
        )}
        {rows === null ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : rows.length === 0 ? (
          <Box py="xl">
            <Placeholder
              title="No matching events"
              detail={
                chips.length > 0
                  ? "Nothing in the log matches these filters."
                  : "The event log is empty — nothing has been reported yet."
              }
              action={
                chips.length > 0 ? { label: "Clear all filters", onClick: clearAll } : undefined
              }
            />
          </Box>
        ) : isMobile ? (
          /* Each card is a real button, like the desktop row's anchor:
             keyboard and screen-reader users must be able to open the detail. */
          <Stack gap="xs">
            {rows.map((event) => (
              <Paper
                key={event.id}
                component="button"
                type="button"
                withBorder
                p="sm"
                onClick={() => setSelected(event)}
                style={{ cursor: "pointer", textAlign: "left", width: "100%" }}
              >
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
                    {event.header}
                  </Text>
                  {event.type && (
                    // Capped so a verbose type never crushes the header text.
                    <Badge variant="light" maw="45%" title={event.type}>
                      {event.type}
                    </Badge>
                  )}
                </Group>
                <Text fz="xs" c="dimmed">
                  {timesOf(event, sort).shown}
                  {event.location ? ` · ${event.location}` : ""}
                </Text>
                {event.tags && event.tags.length > 0 && <TagsCell tags={event.tags} />}
              </Paper>
            ))}
          </Stack>
        ) : (
          <Table striped highlightOnHover fz="sm" stickyHeader layout="fixed">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={170}>{sort === "happened" ? "Happened" : "Logged"}</Table.Th>
                <Table.Th>Header</Table.Th>
                <Table.Th w="15%">Type</Table.Th>
                <Table.Th w="12%">Tags</Table.Th>
                <Table.Th
                  w={90}
                  title="Admiralty rating: source reliability (A–F) + information credibility (1–6)"
                >
                  Admiralty
                </Table.Th>
                <Table.Th w="13%">Location</Table.Th>
                <Table.Th w="10%">By</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((event) => (
                <Table.Tr
                  key={event.id}
                  onClick={() => setSelected(event)}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td title={timesOf(event, sort).other}>
                    {timesOf(event, sort).shown}
                  </Table.Td>
                  <Table.Td style={TRUNCATE}>
                    {/* Real button inside the row so keyboard users can open the detail too. */}
                    <Anchor
                      component="button"
                      type="button"
                      truncate
                      display="block"
                      maw="100%"
                      title={event.header}
                      onClick={() => setSelected(event)}
                    >
                      {event.header}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    {event.type ? (
                      <Badge variant="light" maw="100%" title={event.type}>
                        {event.type}
                      </Badge>
                    ) : null}
                  </Table.Td>
                  <Table.Td>{event.tags?.length ? <TagsCell tags={event.tags} /> : null}</Table.Td>
                  <Table.Td>
                    {[event.admiraltyReliability, event.admiraltyAccuracy].filter(Boolean).join("")}
                  </Table.Td>
                  <Table.Td style={TRUNCATE} title={event.location ?? undefined}>
                    {event.location}
                  </Table.Td>
                  <Table.Td style={TRUNCATE}>{event.updatedBy ?? event.createdBy}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {rows && rows.length > 0 && !atEnd && (
          <Center my="md">
            <Button
              variant="default"
              loading={loading}
              onClick={() =>
                rows.length && void run({ ...EMPTY, ...applied }, rows[rows.length - 1]?.id)
              }
            >
              Load more
            </Button>
          </Center>
        )}
      </Box>

      <Drawer
        opened={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        position="right"
        size="lg"
        title="Filters"
      >
        <Stack gap="xs">
          <Fieldset legend="Content">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TagsInput label="Types" value={draft.types} onChange={(types) => set({ types })} />
              <TagsInput label="Tags" value={draft.tags} onChange={(tags) => set({ tags })} />
              <TagsInput
                label="HCoE domains"
                value={draft.hcoeDomains}
                onChange={(hcoeDomains) => set({ hcoeDomains })}
              />
            </SimpleGrid>
          </Fieldset>

          <Fieldset legend="Time">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                type="datetime-local"
                label="Event time from"
                value={draft.eventTimeFrom}
                onChange={(e) => set({ eventTimeFrom: e.currentTarget.value })}
              />
              <TextInput
                type="datetime-local"
                label="Event time to"
                value={draft.eventTimeTo}
                onChange={(e) => set({ eventTimeTo: e.currentTarget.value })}
              />
              <TextInput
                type="datetime-local"
                label="Created from"
                value={draft.createdAtFrom}
                onChange={(e) => set({ createdAtFrom: e.currentTarget.value })}
              />
              <TextInput
                type="datetime-local"
                label="Created to"
                value={draft.createdAtTo}
                onChange={(e) => set({ createdAtTo: e.currentTarget.value })}
              />
            </SimpleGrid>
          </Fieldset>

          <Fieldset legend="Location">
            <Group grow align="flex-start">
              <NumberInput
                label="Lat"
                min={-90}
                max={90}
                value={draft.lat}
                onChange={(lat) => set({ lat })}
              />
              <NumberInput
                label="Lng"
                min={-180}
                max={180}
                value={draft.lng}
                onChange={(lng) => set({ lng })}
              />
              <NumberInput
                label="Radius (m)"
                min={1}
                error={geoPartial ? "Needs all three" : undefined}
                value={draft.radiusMeters}
                onChange={(radiusMeters) => set({ radiusMeters })}
              />
            </Group>
          </Fieldset>

          <Fieldset legend="Assessment">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <MultiSelect
                label="Reliability"
                data={RELIABILITY}
                value={draft.reliabilities}
                onChange={(reliabilities) => set({ reliabilities })}
              />
              <MultiSelect
                label="Credibility"
                data={CREDIBILITY}
                value={draft.credibilities}
                onChange={(credibilities) => set({ credibilities })}
              />
            </SimpleGrid>
          </Fieldset>

          <Fieldset legend="Origin & history">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                label="Created by"
                value={draft.createdBy}
                onChange={(e) => set({ createdBy: e.currentTarget.value })}
              />
              <TextInput
                label="Event id"
                placeholder="Scope to one event's chain"
                value={draft.eventId}
                error={eventIdInvalid ? "Not a valid event id" : undefined}
                onChange={(e) => set({ eventId: e.currentTarget.value })}
              />
            </SimpleGrid>
            <Checkbox
              label="Include history — all versions, not just current"
              mt="sm"
              checked={draft.includeHistory}
              onChange={(e) => set({ includeHistory: e.currentTarget.checked })}
            />
          </Fieldset>

          <Group justify="space-between" mt="xs">
            <Button variant="subtle" color="gray" onClick={clearAll}>
              Clear all
            </Button>
            <Button onClick={applyDraft} disabled={eventIdInvalid} loading={loading}>
              Apply
            </Button>
          </Group>
        </Stack>
      </Drawer>

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
              navigate({ search: { eventId: selected.eventId, includeHistory: true } });
            }}
          />
        )}
      </Drawer>
    </Box>
  );
};
