import { Kbd, Select } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { type CoordFormat, formatCoord, parseCoord } from "./coords.ts";
import type { Position, TakItem } from "./cot.ts";
import { describeType, labelOf } from "./items.ts";

type Props = {
  items: TakItem[];
  coordFormat: CoordFormat;
  onPickItem: (item: TakItem) => void;
  onGoTo: (position: Position) => void;
  ref?: React.Ref<HTMLInputElement>;
};

const GOTO = "goto";
const MAX_RESULTS = 20;

/** Finds an item by name or UID, or jumps to a typed coordinate in any supported format. */
export const SearchBox = ({ items, coordFormat, onPickItem, onGoTo, ref }: Props) => {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const position = parseCoord(search);
  const found = query
    ? items
        .filter((i) => labelOf(i).toLowerCase().includes(query) || i.uid.toLowerCase() === query)
        .slice(0, MAX_RESULTS)
    : [];
  const data = [
    ...(position ? [{ value: GOTO, label: `Go to ${formatCoord(position, coordFormat)}` }] : []),
    ...found.map((i) => ({ value: i.uid, label: `${labelOf(i)} · ${describeType(i)}` })),
  ];

  return (
    <Select
      ref={ref}
      className="tak-search"
      size="sm"
      searchable
      placeholder="Search callsign, UID or coordinate"
      title="Search the map (/)"
      aria-label="Search the map"
      leftSection={<IconSearch size={16} />}
      rightSection={
        <Kbd size="xs" className="tak-kbd-hint">
          /
        </Kbd>
      }
      rightSectionPointerEvents="none"
      data={data}
      // Matching happens above; the list already holds only hits.
      filter={({ options }) => options}
      searchValue={search}
      onSearchChange={setSearch}
      value={null}
      onChange={(value) => {
        if (value === GOTO && position) onGoTo(position);
        const item = items.find((i) => i.uid === value);
        if (item) onPickItem(item);
        setSearch("");
      }}
      nothingFoundMessage={query ? "No item or coordinate matches" : undefined}
      comboboxProps={{ withinPortal: true }}
    />
  );
};
