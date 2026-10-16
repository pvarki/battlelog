import {
  Button,
  Center,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconSearch, IconShield } from "@tabler/icons-react";
import ms from "milsymbol";
import { useState } from "react";
import { UNIT_STATUSES } from "../items.ts";
import {
  AFFILIATIONS,
  type Affiliation,
  type CatalogueSymbol,
  ECHELONS,
  type Echelon,
  isLandUnit,
  QUICK_SYMBOLS,
  SYMBOL_STATUSES,
  type SymbolChoice,
  searchSymbols,
  sidcOf,
} from "./symbol-catalogue.ts";

const MAX_RESULTS = 60;

export const DEFAULT_SYMBOL: SymbolChoice = {
  symbol: QUICK_SYMBOLS[0]?.symbol as CatalogueSymbol,
  affiliation: "f",
  echelon: "none",
  status: "present",
  headquarters: false,
};

const SymbolImage = ({
  choice,
  size,
  name,
}: {
  choice: SymbolChoice;
  size: number;
  name?: string;
}) => (
  <img
    alt=""
    src={new ms.Symbol(sidcOf(choice), { size, uniqueDesignation: name ?? "" }).toDataURL()}
  />
);

const SymbolButton = ({
  label,
  choice,
  selected,
  onClick,
}: {
  label: string;
  choice: SymbolChoice;
  selected: boolean;
  onClick: () => void;
}) => (
  <Tooltip label={label} withArrow openDelay={300}>
    <UnstyledButton
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      style={{
        outline: selected ? "2px solid var(--mantine-color-accent-4)" : undefined,
        borderRadius: 4,
        height: 40,
      }}
    >
      <Center h="100%">
        <SymbolImage choice={choice} size={16} />
      </Center>
    </UnstyledButton>
  </Tooltip>
);

type Props = {
  value: SymbolChoice;
  onChange: (choice: SymbolChoice) => void;
  /** Shown beside the preview as its unique designation. */
  name?: string;
};

/** ATAK's 2525 point dropper: common symbols one click away, the rest by search. */
export const SymbolPicker = ({ value, onChange, name }: Props) => {
  const [query, setQuery] = useState("");
  const results = searchSymbols(query);
  const landUnit = isLandUnit(value.symbol);
  const pick = (symbol: CatalogueSymbol) => onChange({ ...value, symbol, headquarters: false });

  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
        <SimpleGrid cols={5} spacing={4} verticalSpacing={4}>
          {QUICK_SYMBOLS.map((quick) => {
            const choice: SymbolChoice = {
              ...value,
              symbol: quick.symbol,
              affiliation: quick.affiliation ?? value.affiliation,
              headquarters: !!quick.headquarters,
            };
            return (
              <SymbolButton
                key={quick.label}
                label={quick.label}
                choice={choice}
                selected={sidcOf(choice) === sidcOf(value)}
                onClick={() => onChange(choice)}
              />
            );
          })}
        </SimpleGrid>
        <TextInput
          size="xs"
          leftSection={<IconSearch size={14} />}
          placeholder="Search all symbols, e.g. tank, mortar, bridge"
          aria-label="Search symbols"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        {query.trim() && (
          <ScrollArea.Autosize mah={220} type="auto">
            <Stack gap={2}>
              {results.slice(0, MAX_RESULTS).map((symbol) => (
                <UnstyledButton
                  key={symbol.id}
                  aria-pressed={symbol.id === value.symbol.id}
                  onClick={() => pick(symbol)}
                  px={4}
                  py={2}
                  style={{
                    outline:
                      symbol.id === value.symbol.id
                        ? "2px solid var(--mantine-color-accent-4)"
                        : undefined,
                  }}
                >
                  <Group gap="xs" wrap="nowrap">
                    <Center w={36}>
                      <SymbolImage
                        choice={{ ...value, symbol, echelon: "none", headquarters: false }}
                        size={12}
                      />
                    </Center>
                    <div style={{ minWidth: 0 }}>
                      <Text fz="xs" truncate>
                        {symbol.name}
                      </Text>
                      <Text fz={10} c="dimmed">
                        {symbol.group}
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
              ))}
              {!results.length && (
                <Text fz="xs" c="dimmed">
                  No such symbol
                </Text>
              )}
              {results.length > MAX_RESULTS && (
                <Text fz="xs" c="dimmed">
                  {results.length - MAX_RESULTS} more; narrow the search
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>
      <Stack gap="xs" w={170}>
        <Center mih={90}>
          <SymbolImage choice={value} size={32} name={name} />
        </Center>
        <Text fz="xs" ta="center" lineClamp={2}>
          {value.symbol.name}
        </Text>
        <SegmentedControl
          size="xs"
          fullWidth
          orientation="vertical"
          aria-label="Affiliation"
          data={Object.entries(AFFILIATIONS).map(([key, a]) => ({ value: key, label: a.label }))}
          value={value.affiliation}
          onChange={(affiliation) =>
            onChange({ ...value, affiliation: affiliation as Affiliation })
          }
        />
        <Select
          size="xs"
          label="Echelon"
          data={Object.entries(ECHELONS).map(([key, e]) => ({ value: key, label: e.label }))}
          value={value.echelon}
          onChange={(echelon) => echelon && onChange({ ...value, echelon: echelon as Echelon })}
          allowDeselect={false}
          disabled={!landUnit}
          comboboxProps={{ withinPortal: true }}
        />
        <Select
          size="xs"
          label="Status"
          data={SYMBOL_STATUSES.map((status) => ({
            value: status,
            label: UNIT_STATUSES[status].label,
          }))}
          value={value.status}
          onChange={(status) =>
            status && onChange({ ...value, status: status as SymbolChoice["status"] })
          }
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        <Checkbox
          size="xs"
          label="Headquarters"
          checked={landUnit && value.headquarters}
          disabled={!landUnit}
          onChange={(e) => onChange({ ...value, headquarters: e.currentTarget.checked })}
        />
      </Stack>
    </Group>
  );
};

type ButtonProps = {
  value: SymbolChoice | undefined;
  onChange: (choice: SymbolChoice) => void;
  disabledReason: string | undefined;
};

/** Toolbar button: choose a symbol first, then click where it goes. */
export const SymbolPickerButton = ({ value, onChange, disabledReason }: ButtonProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? DEFAULT_SYMBOL);
  return (
    <>
      <Tooltip label={disabledReason} disabled={!disabledReason} withArrow>
        <Button
          size="compact-xs"
          variant={value ? "filled" : "subtle"}
          color={value ? "primary" : "gray"}
          leftSection={<IconShield size={14} />}
          title="Symbol"
          aria-pressed={!!value}
          disabled={!!disabledReason}
          onClick={() => {
            setDraft(value ?? draft);
            setOpen(true);
          }}
        >
          <span className="tak-tool-label">Symbol</span>
        </Button>
      </Tooltip>
      <Modal opened={open} onClose={() => setOpen(false)} title="Symbol" size="lg" centered>
        <Stack gap="sm">
          <SymbolPicker value={draft} onChange={setDraft} />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Place on map
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
