import { useStoredSetting } from "../stored-setting.ts";
import type { CoordFormat } from "./coords.ts";
import { DEFAULT_BASEMAP } from "./map/basemaps.ts";
import type { CustomSource } from "./map/custom-sources.ts";
import { SAVING_KEY } from "./picture-cache.ts";
import { DEFAULT_ROLE, DEFAULT_TEAM } from "./position/self-sa.ts";

/** Per-viewer map preferences, remembered in this browser only. */
export const useMapSettings = () => {
  const [coordFormat, setCoordFormat] = useStoredSetting<CoordFormat>({
    key: "battlelog.tak.coordFormat",
    defaultValue: "mgrs",
  });
  const [basemap, setBasemap] = useStoredSetting<string>({
    key: "battlelog.tak.basemap",
    defaultValue: DEFAULT_BASEMAP,
  });
  const [overlay, setOverlay] = useStoredSetting<string | null>({
    key: "battlelog.tak.overlay",
    defaultValue: null,
  });
  const [overlayOpacity, setOverlayOpacity] = useStoredSetting({
    key: "battlelog.tak.overlayOpacity",
    defaultValue: 0.6,
  });
  const [customSources, setCustomSources] = useStoredSetting<CustomSource[]>({
    key: "battlelog.tak.mapSources",
    defaultValue: [],
  });
  const [savePicture, setSavePicture] = useStoredSetting({
    key: SAVING_KEY,
    defaultValue: true,
  });
  const [dim, setDim] = useStoredSetting({ key: "battlelog.tak.dim", defaultValue: false });
  const [mgrsGrid, setMgrsGrid] = useStoredSetting({
    key: "battlelog.tak.mgrsGrid",
    defaultValue: false,
  });
  const [showAllTracks, setShowAllTracks] = useStoredSetting({
    key: "battlelog.tak.showAllTracks",
    defaultValue: false,
  });
  const [hiddenList, setHiddenList] = useStoredSetting<string[]>({
    key: "battlelog.tak.hiddenGroups",
    defaultValue: [],
  });
  const hidden = new Set(hiddenList);
  const toggleGroup = (key: string) =>
    setHiddenList((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const [shownMissionList, setShownMissionList] = useStoredSetting<string[]>({
    key: "battlelog.tak.shownMissions",
    defaultValue: [],
  });
  const shownMissions = new Set(shownMissionList);
  const toggleMission = (name: string) =>
    setShownMissionList((list) =>
      list.includes(name) ? list.filter((n) => n !== name) : [...list, name],
    );
  const [shownEventLayerList, setShownEventLayerList] = useStoredSetting<string[]>({
    key: "battlelog.tak.shownEventLayers",
    defaultValue: [],
  });
  const shownEventLayers = new Set(shownEventLayerList);
  const toggleEventLayer = (eventId: string) =>
    setShownEventLayerList((list) =>
      list.includes(eventId) ? list.filter((id) => id !== eventId) : [...list, eventId],
    );
  const [sharePosition, setSharePosition] = useStoredSetting({
    key: "battlelog.tak.sharePosition",
    defaultValue: false,
  });
  const [team, setTeam] = useStoredSetting({
    key: "battlelog.tak.team",
    defaultValue: DEFAULT_TEAM,
  });
  const [role, setRole] = useStoredSetting({
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
