import { Select, Tooltip } from "@mantine/core";
import { TACTICAL_GRAPHICS, type TacticalGraphic } from "./tactical-graphics.ts";

const OPTIONS = [...new Set(TACTICAL_GRAPHICS.map((g) => g.group))].map((group) => ({
  group,
  items: TACTICAL_GRAPHICS.filter((g) => g.group === group).map((g) => ({
    value: g.sidc,
    label: g.name,
  })),
}));

type Props = {
  value: TacticalGraphic | undefined;
  onChange: (graphic: TacticalGraphic | undefined) => void;
  disabledReason: string | undefined;
};

/** Searchable list of the 2525 tactical graphics that can be drawn. */
export const TacticalGraphicPicker = ({ value, onChange, disabledReason }: Props) => (
  <Tooltip label={disabledReason} disabled={!disabledReason} withArrow>
    <Select
      size="xs"
      w={160}
      placeholder="Tactical graphic…"
      aria-label="Tactical graphic"
      data={OPTIONS}
      value={value?.sidc ?? null}
      onChange={(sidc) => onChange(TACTICAL_GRAPHICS.find((g) => g.sidc === sidc))}
      searchable
      clearable
      nothingFoundMessage="No such graphic"
      disabled={!!disabledReason}
      maxDropdownHeight={360}
      comboboxProps={{ width: 300, position: "bottom-start" }}
    />
  </Tooltip>
);
