import { useLocalStorage } from "@mantine/hooks";
import type { CoordFormat } from "./coords.ts";
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
  const [hiddenList, setHiddenList] = useLocalStorage<string[]>({
    key: "battlelog.tak.hiddenGroups",
    defaultValue: [],
  });
  const hidden = new Set(hiddenList);
  const toggleGroup = (key: string) =>
    setHiddenList((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const [shownMissionList, setShownMissionList] = useLocalStorage<string[]>({
    key: "battlelog.tak.shownMissions",
    defaultValue: [],
  });
  const shownMissions = new Set(shownMissionList);
  const toggleMission = (name: string) =>
    setShownMissionList((list) =>
      list.includes(name) ? list.filter((n) => n !== name) : [...list, name],
    );
  return {
    coordFormat,
    setCoordFormat,
    basemap,
    setBasemap,
    dim,
    setDim,
    hidden,
    toggleGroup,
    shownMissions,
    toggleMission,
  };
};

export type MapSettings = ReturnType<typeof useMapSettings>;
