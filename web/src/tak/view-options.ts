/** What a viewer can reach on a `TakMapView`. Kept apart so widget descriptors stay light. */
export const MAP_CONTROLS = ["search", "layers", "zoom", "locate", "status", "openInMap"] as const;
export type MapControl = (typeof MAP_CONTROLS)[number];

export const CONTROL_LABEL: Record<MapControl, string> = {
  search: "Search",
  layers: "Layer toggles",
  zoom: "Zoom and compass buttons",
  locate: "Locate me",
  status: "TAK connection",
  openInMap: "Open in Map",
};

/** What the card of a selected item offers. */
export const CARD_ACTIONS = ["centre", "log", "openInMap"] as const;
export type CardAction = (typeof CARD_ACTIONS)[number];

export const CARD_ACTION_LABEL: Record<CardAction, string> = {
  centre: "Centre",
  log: "Log this…",
  openInMap: "Open in Map",
};

/** The overlay groups a viewer can switch on and off; nested groups follow their parent. */
export const TOGGLED_GROUPS = [
  "markers/team",
  "markers/friendly",
  "markers/hostile",
  "markers/neutral",
  "markers/unknown",
  "markers/spot",
  "navigation",
  "shapes",
  "alerts",
  "other",
] as const;
