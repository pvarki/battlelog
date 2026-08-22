import {
  Anchor,
  Badge,
  Button,
  Center,
  Checkbox,
  Code,
  Collapse,
  Container,
  Drawer,
  Fieldset,
  Grid,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { getRouteApi } from "@tanstack/react-router";
import type { InferRequestType } from "hono/client";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { z } from "zod";
import { CREDIBILITY, RELIABILITY } from "../admiralty.ts";
import { api, type EventResponse } from "../api.ts";
import { formatDateTime } from "../time.ts";

const PAGE = 100;

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

type Filters = {
  search: string;
  types: string[];
  tags: string[];
  hcoeDomains: string[];
  reliabilities: string[];
  credibilities: string[];
  createdBy: string;
  eventId: string;
  eventTimeFrom: string;
  eventTimeTo: string;
  createdAtFrom: string;
  createdAtTo: string;
  lat: number | string;
  lng: number | string;
  radiusMeters: number | string;
  includeHistory: boolean;
};

const EMPTY: Filters = {
  search: "",
  types: [],
  tags: [],
  hcoeDomains: [],
  reliabilities: [],
  credibilities: [],
  createdBy: "",
  eventId: "",
  eventTimeFrom: "",
  eventTimeTo: "",
  createdAtFrom: "",
  createdAtTo: "",
  lat: "",
  lng: "",
  radiusMeters: "",
  includeHistory: false,
};

// Applied filters live in the URL as search params: only non-empty fields,
// so links stay short. A malformed URL degrades to no filters via .catch.
const searchSchema = z
  .object({
    search: z.string(),
    types: z.string().array(),
    tags: z.string().array(),
    hcoeDomains: z.string().array(),
    reliabilities: z.string().array(),
    credibilities: z.string().array(),
    createdBy: z.string(),
    eventId: z.string(),
    eventTimeFrom: z.string(),
    eventTimeTo: z.string(),
    createdAtFrom: z.string(),
    createdAtTo: z.string(),
    lat: z.union([z.number(), z.string()]),
    lng: z.union([z.number(), z.string()]),
    radiusMeters: z.union([z.number(), z.string()]),
    includeHistory: z.boolean(),
  })
  .partial();

export const validateEventSearch = (search: unknown) => searchSchema.catch({}).parse(search);

const compact = (f: Filters) =>
  Object.fromEntries(
    Object.entries(f).filter(
      ([, v]) => v !== "" && v !== false && !(Array.isArray(v) && v.length === 0),
    ),
  ) as z.infer<typeof searchSchema>;

type EventsQuery = InferRequestType<typeof api.events.$get>["query"];

const buildQuery = (f: Filters): EventsQuery => {
  const geoComplete = f.lat !== "" && f.lng !== "" && f.radiusMeters !== "";
  return {
    ...(f.search.trim() ? { search: f.search.trim() } : {}),
    ...(f.types.length ? { types: f.types.join(",") } : {}),
    ...(f.tags.length ? { tags: f.tags.join(",") } : {}),
    ...(f.hcoeDomains.length ? { hcoeDomains: f.hcoeDomains.join(",") } : {}),
    ...(f.reliabilities.length ? { reliabilities: f.reliabilities.join(",") } : {}),
    ...(f.credibilities.length ? { credibilities: f.credibilities.join(",") } : {}),
    ...(f.createdBy.trim() ? { createdBy: f.createdBy.trim() } : {}),
    ...(isUuid(f.eventId.trim()) ? { eventId: f.eventId.trim() } : {}),
    ...(f.eventTimeFrom ? { eventTimeFrom: f.eventTimeFrom } : {}),
    ...(f.eventTimeTo ? { eventTimeTo: f.eventTimeTo } : {}),
    ...(f.createdAtFrom ? { createdAtFrom: f.createdAtFrom } : {}),
    ...(f.createdAtTo ? { createdAtTo: f.createdAtTo } : {}),
    ...(geoComplete
      ? { lat: String(f.lat), lng: String(f.lng), radiusMeters: String(f.radiusMeters) }
      : {}),
    ...(f.includeHistory ? { includeHistory: "true" as const } : {}),
    limit: PAGE,
  } as EventsQuery;
};

const route = getRouteApi("/events");

// Filters that live behind the "Advanced" toggle — used to auto-open it when
// a shared URL arrives with one of them applied.
const hasAdvanced = (f: Partial<Filters>) =>
  f.lat !== undefined ||
  f.lng !== undefined ||
  f.radiusMeters !== undefined ||
  !!f.reliabilities?.length ||
  !!f.credibilities?.length ||
  !!f.createdBy ||
  !!f.eventId ||
  !!f.includeHistory;

export const EventExplorerPage = () => {
  const applied = route.useSearch();
  const navigate = route.useNavigate();
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY, ...applied }));
  const [rows, setRows] = useState<EventResponse[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(() => hasAdvanced(applied));
  const [selected, setSelected] = useState<EventResponse | null>(null);
  // Guards against out-of-order responses: only the latest run may touch state.
  const runSeq = useRef(0);

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

  const applyFilters = useEffectEvent((next: Filters) => {
    setFilters(next);
    void run(next);
  });

  // The URL is the source of truth for applied filters: fetch on every change
  // (including mount and back/forward) and resync the form draft.
  useEffect(() => {
    applyFilters({ ...EMPTY, ...applied });
    if (hasAdvanced(applied)) setAdvancedOpen(true);
  }, [applied]);

  const submit = () => {
    const next = compact(filters);
    // Same filters again = manual refresh; navigation alone wouldn't refetch.
    if (JSON.stringify(next) === JSON.stringify(applied)) void run({ ...EMPTY, ...next });
    else navigate({ search: next });
  };

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const eventIdInvalid = filters.eventId.trim() !== "" && !isUuid(filters.eventId.trim());
  const geoPartial =
    [filters.lat, filters.lng, filters.radiusMeters].filter((v) => v !== "").length % 3 !== 0;

  return (
    <Container size="xl" py="md">
      <Title order={2} mb="md">
        Event Explorer
      </Title>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Fieldset legend="Content" mb="xs">
          <SimpleGrid cols={4} spacing="sm">
            <TextInput
              label="Search"
              placeholder="Header contains…"
              value={filters.search}
              onChange={(e) => set({ search: e.currentTarget.value })}
            />
            <TagsInput label="Types" value={filters.types} onChange={(types) => set({ types })} />
            <TagsInput label="Tags" value={filters.tags} onChange={(tags) => set({ tags })} />
            <TagsInput
              label="HCoE domains"
              value={filters.hcoeDomains}
              onChange={(hcoeDomains) => set({ hcoeDomains })}
            />
          </SimpleGrid>
        </Fieldset>
        <Fieldset legend="Time" mb="xs">
          <SimpleGrid cols={4} spacing="sm">
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
        </Fieldset>
        <Collapse in={advancedOpen}>
          <Grid mb="xs" align="stretch">
            <Grid.Col span={4}>
              <Fieldset legend="Location" h="100%">
                <Group grow>
                  <NumberInput
                    label="Lat"
                    min={-90}
                    max={90}
                    value={filters.lat}
                    onChange={(lat) => set({ lat })}
                  />
                  <NumberInput
                    label="Lng"
                    min={-180}
                    max={180}
                    value={filters.lng}
                    onChange={(lng) => set({ lng })}
                  />
                  <NumberInput
                    label="Radius (m)"
                    min={1}
                    error={geoPartial ? "Needs all three" : undefined}
                    value={filters.radiusMeters}
                    onChange={(radiusMeters) => set({ radiusMeters })}
                  />
                </Group>
              </Fieldset>
            </Grid.Col>
            <Grid.Col span={3}>
              <Fieldset legend="Assessment" h="100%">
                <Group grow>
                  <MultiSelect
                    label="Reliability"
                    data={RELIABILITY}
                    value={filters.reliabilities}
                    onChange={(reliabilities) => set({ reliabilities })}
                  />
                  <MultiSelect
                    label="Credibility"
                    data={CREDIBILITY}
                    value={filters.credibilities}
                    onChange={(credibilities) => set({ credibilities })}
                  />
                </Group>
              </Fieldset>
            </Grid.Col>
            <Grid.Col span={5}>
              <Fieldset legend="Origin & history" h="100%">
                <Group grow align="flex-start">
                  <TextInput
                    label="Created by"
                    value={filters.createdBy}
                    onChange={(e) => set({ createdBy: e.currentTarget.value })}
                  />
                  <TextInput
                    label="Event id"
                    placeholder="Scope to one event's chain"
                    value={filters.eventId}
                    error={eventIdInvalid ? "Not a valid event id" : undefined}
                    onChange={(e) => set({ eventId: e.currentTarget.value })}
                  />
                </Group>
                <Checkbox
                  label="Include history — all versions, not just current"
                  mt="sm"
                  checked={filters.includeHistory}
                  onChange={(e) => set({ includeHistory: e.currentTarget.checked })}
                />
              </Fieldset>
            </Grid.Col>
          </Grid>
        </Collapse>
        <Group justify="space-between" mb="xs">
          <Button
            variant="subtle"
            size="compact-sm"
            color="gray"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? "Hide advanced filters" : "Advanced filters…"}
          </Button>
          <Group>
            <Button
              variant="default"
              onClick={() => {
                setFilters(EMPTY);
                navigate({ search: {} });
              }}
            >
              Reset
            </Button>
            <Button type="submit" loading={loading} disabled={eventIdInvalid}>
              Search
            </Button>
          </Group>
        </Group>
      </form>

      {error && (
        <Text c="red.4" my="sm" role="status">
          {error}
        </Text>
      )}
      {rows === null ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : rows.length === 0 ? (
        <Text c="dimmed" my="md">
          No matching events.
        </Text>
      ) : (
        <>
          <Text c="dimmed" fz="xs" my="xs">
            {rows.length} {applied.includeHistory ? "versions" : "events"}
            {!atEnd && "+"}
          </Text>
          <Table striped highlightOnHover fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>Header</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Tags</Table.Th>
                <Table.Th title="Admiralty rating: source reliability (A–F) + information credibility (1–6)">
                  Admiralty
                </Table.Th>
                <Table.Th>Location</Table.Th>
                <Table.Th>By</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((event) => (
                <Table.Tr
                  key={event.id}
                  onClick={() => setSelected(event)}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td>{formatDateTime(event.eventTime ?? event.createdAt)}</Table.Td>
                  <Table.Td>
                    {/* Real button inside the row so keyboard users can open the detail too. */}
                    <Anchor component="button" type="button" onClick={() => setSelected(event)}>
                      {event.header}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    {event.type ? <Badge variant="light">{event.type}</Badge> : null}
                  </Table.Td>
                  <Table.Td>{event.tags?.join(", ")}</Table.Td>
                  <Table.Td>
                    {[event.admiraltyReliability, event.admiraltyAccuracy].filter(Boolean).join("")}
                  </Table.Td>
                  <Table.Td>{event.location}</Table.Td>
                  <Table.Td>{event.updatedBy ?? event.createdBy}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!atEnd && (
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
        </>
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
              navigate({ search: { eventId: selected.eventId, includeHistory: true } });
            }}
          />
        )}
      </Drawer>
    </Container>
  );
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => {
  if (children == null || children === "") return null;
  return (
    <div>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text fz="sm">{children}</Text>
    </div>
  );
};

const EventDetail = ({
  event,
  onShowHistory,
}: {
  event: EventResponse;
  onShowHistory: () => void;
}) => (
  <Stack gap="sm">
    {event.type && (
      <Badge variant="light" style={{ alignSelf: "flex-start" }}>
        {event.type}
      </Badge>
    )}
    <Field label="Event time">{event.eventTime ? formatDateTime(event.eventTime) : null}</Field>
    <Field label="Logged">{formatDateTime(event.createdAt)}</Field>
    <Field label="Admiralty rating">
      {event.admiraltyReliability || event.admiraltyAccuracy
        ? `${event.admiraltyReliability ?? "–"}${event.admiraltyAccuracy ?? "–"} — source reliability ${event.admiraltyReliability ?? "not rated"}, information credibility ${event.admiraltyAccuracy ?? "not rated"}`
        : null}
    </Field>
    <Field label="Tags">{event.tags?.join(", ")}</Field>
    <Field label="HCoE domains">{event.hcoeDomains?.join(", ")}</Field>
    <Field label="Location">{event.location}</Field>
    <Field label="Coordinates">
      {event.locationPoint ? `${event.locationPoint.lat}, ${event.locationPoint.lng}` : null}
    </Field>
    <Field label="Source">{event.sourceUri}</Field>
    <Field label="By">{event.updatedBy ?? event.createdBy}</Field>
    {event.data != null && (
      <div>
        <Text fz="xs" c="dimmed">
          Data
        </Text>
        <Code block fz="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(event.data, null, 2)}
        </Code>
      </div>
    )}
    <Button variant="light" size="xs" style={{ alignSelf: "flex-start" }} onClick={onShowHistory}>
      Show all versions of this event
    </Button>
  </Stack>
);
