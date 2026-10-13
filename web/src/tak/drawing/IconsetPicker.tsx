import { Group, Select, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { type IconsetIcon, iconsetPath, useIconsets } from "../map/iconsets.ts";

const Thumb = ({ icon }: { icon: IconsetIcon }) => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([icon.image.slice()], { type: icon.mime }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [icon]);
  return url ? <img src={url} width={20} height={20} alt="" /> : null;
};

type Props = {
  value: string | undefined;
  onChange: (icon: { path: string; type?: string }) => void;
};

/** An icon from the imported ATAK icon sets, grouped by set and group as in ATAK's palette. */
export const IconsetPicker = ({ value, onChange }: Props) => {
  const { sets } = useIconsets();
  const byPath = new Map(
    sets.flatMap((set) => set.icons.map((icon) => [iconsetPath(set, icon), icon] as const)),
  );
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const set of sets) {
    for (const icon of set.icons) {
      const group = `${set.name} · ${icon.group}`;
      const options = groups.get(group) ?? [];
      options.push({ value: iconsetPath(set, icon), label: icon.file.replace(/\.\w+$/, "") });
      groups.set(group, options);
    }
  }
  const selected = value ? byPath.get(value) : undefined;

  return (
    <Select
      size="xs"
      label="Icon"
      placeholder="Search icons"
      searchable
      data={[...groups].map(([group, items]) => ({ group, items }))}
      value={value ?? null}
      onChange={(path) => {
        const icon = path ? byPath.get(path) : undefined;
        if (path && icon) onChange({ path, type: icon.type });
      }}
      leftSection={selected && <Thumb icon={selected} />}
      renderOption={({ option }) => {
        const icon = byPath.get(option.value);
        return (
          <Group gap="xs" wrap="nowrap">
            {icon && <Thumb icon={icon} />}
            <Text fz="xs">{option.label}</Text>
          </Group>
        );
      }}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
};
