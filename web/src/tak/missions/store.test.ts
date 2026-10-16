// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { TakItem } from "../cot.ts";
import type { CotEvent } from "../protocol/cot-event.ts";
import type { Mission } from "./missions.ts";

const itemsOf = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => ({ uid: `${prefix}${i}` }) as TakItem);
const missionOf = (name: string, items: TakItem[]) =>
  ({ name, version: "1", itemUids: items.map((i) => i.uid) }) as unknown as Mission;

const full = itemsOf(20_000, "full-");
const saved = itemsOf(20_001, "saved-");

vi.mock("./missions.ts", async (original) => ({
  ...(await original<typeof import("./missions.ts")>()),
  fetchMissions: async () => [missionOf("full", full), missionOf("saved", saved)],
  fetchInvitedMissions: async () => [],
  fetchMissionItems: async () => full,
  fetchMissionItem: async (uid: string) => ({ uid }) as TakItem,
}));
vi.mock("../picture-cache.ts", () => ({
  loadSavedMission: async (name: string) => (name === "saved" ? { items: saved } : undefined),
  saveMission: async () => undefined,
}));
vi.mock("../session.ts", () => ({ addTakReceiver: () => undefined }));
vi.mock("./changes.ts", () => ({
  MISSION_CHANGE_TYPE: "t-x-m-c",
  parseMissionChanges: () => [{ mission: "full", type: "ADD_CONTENT", uid: "one-more" }],
}));

const { receiveMissionChange, useMissions, useMissionsSync } = await import("./store.ts");

let state: ReturnType<typeof useMissions> | undefined;
const Holder = () => {
  useMissionsSync(["full", "saved"]);
  state = useMissions();
  return null;
};

test("a mission over 20,000 items fails however its items arrive", async () => {
  createRoot(document.createElement("div")).render(createElement(Holder));
  await vi.waitFor(() => expect(state?.contents.get("full")?.kind).toBe("loaded"));
  await vi.waitFor(() => expect(state?.contents.get("saved")?.kind).toBe("failed"));

  receiveMissionChange({ type: "t-x-m-c" } as CotEvent);
  await vi.waitFor(() => expect(state?.contents.get("full")?.kind).toBe("failed"));
});
