import {
  ActionIcon,
  Button,
  Chip,
  Group,
  Menu,
  Pill,
  Popover,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { IconArrowsSort, IconCheck, IconFilter } from "@tabler/icons-react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { useStoredSetting } from "../../stored-setting.ts";
import { type ItemStatus, STATUS_LABEL } from "../items.ts";
import {
  type Affiliation,
  activeFilters,
  type ItemFilters,
  type ItemKind,
  type ItemSort,
  NO_FILTERS,
} from "./item-filters.ts";

type Option<T extends string> = { value: T; label: string };

const SORT_OPTIONS: Option<ItemSort>[] = [
  { value: "name", label: "Grouped" },
  { value: "newest", label: "Newest" },
  { value: "distance", label: "Nearest" },
];

const STATUS_OPTIONS: ItemStatus[] = ["online", "stale", "offline"];
const AFFILIATION_OPTIONS: Option<Affiliation>[] = [
  { value: "friendly", label: "Friendly" },
  { value: "hostile", label: "Hostile" },
  { value: "neutral", label: "Neutral" },
  { value: "unknown", label: "Unknown" },
];
const KIND_OPTIONS: Option<ItemKind>[] = [
  { value: "people", label: "People" },
  { value: "markers", label: "Markers" },
  { value: "shapes", label: "Shapes" },
  { value: "routes", label: "Routes" },
];
const UPDATED_OPTIONS = [
  { value: "", label: "Any" },
  { value: "15", label: "15 min" },
  { value: "60", label: "1 h" },
  { value: "1440", label: "24 h" },
];

/** The Items list's filters and sort, kept across visits. */
export const useItemListSettings = () => {
  const [storedFilters, setStoredFilters] = useStoredSetting<ItemFilters>({
    key: "battlelog.tak.items.filters",
    defaultValue: NO_FILTERS,
  });
  const filters = { ...NO_FILTERS, ...storedFilters };
  const setFilters = (update: Partial<ItemFilters>) =>
    setStoredFilters((current) => ({ ...NO_FILTERS, ...current, ...update }));
  const [sort, setSort] = useStoredSetting<ItemSort>({
    key: "battlelog.tak.items.sort",
    defaultValue: "name",
  });
  return { filters, setFilters, sort, setSort };
};

export const SortMenu = ({
  sort,
  setSort,
}: {
  sort: ItemSort;
  setSort: (sort: ItemSort) => void;
}) => (
  <Menu position="bottom-end" withinPortal>
    <Menu.Target>
      <ActionIcon
        variant={sort === "name" ? "subtle" : "light"}
        color={sort === "name" ? "gray" : "accent"}
        size="sm"
        aria-label="Sort items"
        title="Sort"
      >
        <IconArrowsSort size={16} />
      </ActionIcon>
    </Menu.Target>
    <Menu.Dropdown>
      <Menu.Label>Sort</Menu.Label>
      {SORT_OPTIONS.map((o) => (
        <Menu.Item
          key={o.value}
          rightSection={o.value === sort ? <IconCheck size={14} /> : undefined}
          onClick={() => setSort(o.value)}
        >
          {o.label}
        </Menu.Item>
      ))}
    </Menu.Dropdown>
  </Menu>
);

const FilterChips = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T[];
  onChange: (value: T[]) => void;
}) => (
  <Stack gap={4}>
    <SectionHeading>{label}</SectionHeading>
    <Chip.Group multiple value={value} onChange={(v) => onChange(v as T[])}>
      <Group gap={4}>
        {options.map((o) => (
          <Chip key={o.value} value={o.value} size="xs">
            {o.label}
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  </Stack>
);

export const FiltersMenu = ({
  filters,
  setFilters,
  sources,
}: {
  filters: ItemFilters;
  setFilters: (update: Partial<ItemFilters>) => void;
  sources: Option<string>[];
}) => {
  const count = activeFilters(filters);
  return (
    <Popover position="bottom-end" width={280} shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon
          variant={count > 0 ? "light" : "subtle"}
          color={count > 0 ? "accent" : "gray"}
          size="sm"
          aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
          title="Filters"
        >
          <IconFilter size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Switch
            size="xs"
            label="Only what's in the map view"
            checked={filters.inView}
            onChange={(e) => setFilters({ inView: e.currentTarget.checked })}
          />
          <FilterChips
            label="Status"
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            value={filters.statuses}
            onChange={(statuses) => setFilters({ statuses })}
          />
          <FilterChips
            label="Affiliation"
            options={AFFILIATION_OPTIONS}
            value={filters.affiliations}
            onChange={(affiliations) => setFilters({ affiliations })}
          />
          <FilterChips
            label="Kind"
            options={KIND_OPTIONS}
            value={filters.kinds}
            onChange={(kinds) => setFilters({ kinds })}
          />
          <Stack gap={4}>
            <SectionHeading>Updated within</SectionHeading>
            <SegmentedControl
              size="xs"
              fullWidth
              data={UPDATED_OPTIONS}
              value={filters.updatedWithin === null ? "" : String(filters.updatedWithin)}
              onChange={(v) => setFilters({ updatedWithin: v ? Number(v) : null })}
            />
          </Stack>
          {sources.length > 0 && (
            <FilterChips
              label="Source"
              options={sources}
              value={filters.sources}
              onChange={(chosen) => setFilters({ sources: chosen })}
            />
          )}
          <Button
            size="xs"
            variant="default"
            disabled={count === 0}
            onClick={() => setFilters(NO_FILTERS)}
          >
            Clear filters
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

/** What narrows or reorders the list, each removable, with how many items are left; nothing when the list is whole. */
export const FilterPills = ({
  filters,
  setFilters,
  sort,
  setSort,
  sources,
  fromOwnPosition,
  searching,
  listedCount,
  totalCount,
}: {
  filters: ItemFilters;
  setFilters: (update: Partial<ItemFilters>) => void;
  sort: ItemSort;
  setSort: (sort: ItemSort) => void;
  sources: Option<string>[];
  /** Nearest is measured from the user rather than the map centre. */
  fromOwnPosition: boolean;
  searching: boolean;
  listedCount: number;
  totalCount: number;
}) => {
  const without = <T,>(list: T[], value: T) => list.filter((v) => v !== value);
  const pills: { key: string; label: string; onRemove: () => void }[] = [
    ...(filters.inView
      ? [{ key: "view", label: "In view", onRemove: () => setFilters({ inView: false }) }]
      : []),
    ...filters.statuses.map((v) => ({
      key: `status ${v}`,
      label: STATUS_LABEL[v],
      onRemove: () => setFilters({ statuses: without(filters.statuses, v) }),
    })),
    ...filters.affiliations.map((v) => ({
      key: `affiliation ${v}`,
      label: AFFILIATION_OPTIONS.find((o) => o.value === v)?.label ?? v,
      onRemove: () => setFilters({ affiliations: without(filters.affiliations, v) }),
    })),
    ...filters.kinds.map((v) => ({
      key: `kind ${v}`,
      label: KIND_OPTIONS.find((o) => o.value === v)?.label ?? v,
      onRemove: () => setFilters({ kinds: without(filters.kinds, v) }),
    })),
    ...(filters.updatedWithin !== null
      ? [
          {
            key: "updated",
            label: `Last ${UPDATED_OPTIONS.find((o) => o.value === String(filters.updatedWithin))?.label ?? `${filters.updatedWithin} min`}`,
            onRemove: () => setFilters({ updatedWithin: null }),
          },
        ]
      : []),
    ...filters.sources.map((v) => ({
      key: `source ${v}`,
      label: sources.find((o) => o.value === v)?.label ?? v,
      onRemove: () => setFilters({ sources: without(filters.sources, v) }),
    })),
    ...(sort === "name"
      ? []
      : [
          {
            key: "sort",
            label:
              sort === "newest"
                ? "Newest first"
                : `Nearest to ${fromOwnPosition ? "you" : "map centre"}`,
            onRemove: () => setSort("name"),
          },
        ]),
  ];
  if (pills.length === 0 && !searching) return null;
  return (
    <Group gap={4}>
      {pills.map((pill) => (
        <Pill key={pill.key} size="sm" withRemoveButton onRemove={pill.onRemove}>
          {pill.label}
        </Pill>
      ))}
      <Text fz="xs" c="dimmed" px={2}>
        {listedCount} of {totalCount}
      </Text>
      {pills.length > 1 && (
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={() => {
            setFilters(NO_FILTERS);
            setSort("name");
          }}
        >
          Clear
        </Button>
      )}
    </Group>
  );
};
