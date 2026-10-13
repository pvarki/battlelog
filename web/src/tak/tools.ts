/** Parts of the TAK workspace a dashboard widget can switch on; the Map page has all of them. */
export const TAK_TOOLS = [
  "items",
  "missions",
  "plans",
  "layers",
  "draw",
  "search",
  "chat",
  "contacts",
] as const;

export type TakTool = (typeof TAK_TOOLS)[number];

export const TOOL_LABEL: Record<TakTool, string> = {
  items: "Items list",
  missions: "Missions",
  plans: "Plans",
  layers: "Layers",
  draw: "Drawing",
  search: "Search",
  chat: "Chat",
  contacts: "Contacts",
};

export type MapView = { center: [number, number]; zoom: number; bearing: number };
