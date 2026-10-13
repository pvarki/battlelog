import { useLocalStorage } from "@mantine/hooks";
import type { CoordFormat } from "./coords.ts";
import type { Category } from "./items.ts";
import type { Basemap } from "./map/basemaps.ts";

/** Per-viewer map preferences, remembered in this browser only. */
export const useMapSettings = () => {
  const [coordFormat, setCoordFormat] = useLocalStorage<CoordFormat>({
    key: "battlelog.tak.coordFormat",
    defaultValue: "mgrs",
  });
  const [basemap, setBasemap] = useLocalStorage<Basemap>({
    key: "battlelog.tak.basemap",
    defaultValue: "topographic",
  });
  const [dim, setDim] = useLocalStorage({ key: "battlelog.tak.dim", defaultValue: false });
  const [hiddenList, setHiddenList] = useLocalStorage<Category[]>({
    key: "battlelog.tak.hidden",
    defaultValue: [],
  });
  const hidden = new Set(hiddenList);
  const toggleCategory = (category: Category) =>
    setHiddenList((list) =>
      list.includes(category) ? list.filter((c) => c !== category) : [...list, category],
    );
  return { coordFormat, setCoordFormat, basemap, setBasemap, dim, setDim, hidden, toggleCategory };
};

export type MapSettings = ReturnType<typeof useMapSettings>;
