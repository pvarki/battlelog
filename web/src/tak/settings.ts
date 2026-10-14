import { useLocalStorage } from "@mantine/hooks";
import type { CoordFormat } from "./coords.ts";
import { DEFAULT_BASEMAP } from "./map/basemaps.ts";
import type { CustomSource } from "./map/custom-sources.ts";
import { SAVING_KEY } from "./picture-cache.ts";
import { DEFAULT_ROLE, DEFAULT_TEAM } from "./position/self-sa.ts";

/** Per-viewer map preferences, remembered in this browser only. */
export const useMapSettings = () => {
  const [coordFormat, setCoordFormat] = useLocalStorage<CoordFormat>({
    key: "battlelog.tak.coordFormat",
    defaultValue: "mgrs",
  });
  const [basemap, setBasemap] = useLocalStorage<string>({
    key: "battlelog.tak.basemap",
    defaultValue: DEFAULT_BASEMAP,
  });
  const [overlay, setOverlay] = useLocalStorage<string | null>({
    key: "battlelog.tak.overlay",
    defaultValue: null,
  });
  const [overlayOpacity, setOverlayOpacity] = useLocalStorage({
    key: "battlelog.tak.overlayOpacity",
    defaultValue: 0.6,
  });
  const [customSources, setCustomSources] = useLocalStorage<CustomSource[]>({
    key: "battlelog.tak.mapSources",
    defaultValue: [],
  });
  const [savePicture, setSavePicture] = useLocalStorage({
    key: SAVING_KEY,
    defaultValue: true,
  });
  const [dim, setDim] = useLocalStorage({ key: "battlelog.tak.dim", defaultValue: false });
  const [mgrsGrid, setMgrsGrid] = useLocalStorage({
    key: "battlelog.tak.mgrsGrid",
    defaultValue: false,
  });
  const [showAllTracks, setShowAllTracks] = useLocalStorage({
    key: "battlelog.tak.showAllTracks",
    defaultValue: false,
  });
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
  const [shownEventLayerList, setShownEventLayerList] = useLocalStorage<string[]>({
    key: "battlelog.tak.shownEventLayers",
    defaultValue: [],
  });
  const shownEventLayers = new Set(shownEventLayerList);
  const toggleEventLayer = (eventId: string) =>
    setShownEventLayerList((list) =>
      list.includes(eventId) ? list.filter((id) => id !== eventId) : [...list, eventId],
    );
  const [sharePosition, setSharePosition] = useLocalStorage({
    key: "battlelog.tak.sharePosition",
    defaultValue: false,
  });
  const [team, setTeam] = useLocalStorage({
    key: "battlelog.tak.team",
    defaultValue: DEFAULT_TEAM,
  });
  const [role, setRole] = useLocalStorage({
    key: "battlelog.tak.role",
    defaultValue: DEFAULT_ROLE,
  });
  return {
    coordFormat,
    setCoordFormat,
    basemap,
    setBasemap,
    overlay,
    setOverlay,
    overlayOpacity,
    setOverlayOpacity,
    customSources,
    setCustomSources,
    savePicture,
    setSavePicture,
    dim,
    setDim,
    mgrsGrid,
    setMgrsGrid,
    showAllTracks,
    setShowAllTracks,
    hidden,
    toggleGroup,
    shownMissions,
    toggleMission,
    shownEventLayers,
    toggleEventLayer,
    sharePosition,
    setSharePosition,
    team,
    setTeam,
    role,
    setRole,
  };
};

export type MapSettings = ReturnType<typeof useMapSettings>;
