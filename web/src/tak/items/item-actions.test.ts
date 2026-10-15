import { expect, test } from "vitest";
import type { TakItem } from "../cot.ts";
import { type ActionContext, isPointItem, itemActions, unitStatusOfItem } from "./item-actions.ts";

const item = (type: string, extra: Partial<TakItem> = {}): TakItem => ({
  uid: "x",
  type,
  time: 0,
  stale: 1,
  geometry: { type: "Point", coordinates: [25, 60] },
  event: {} as TakItem["event"],
  ...extra,
});

const ctx: ActionContext = {
  readOnlyReason: undefined,
  callsign: "ME",
  planActive: false,
  clientUid: "me",
  missionCount: 1,
};

test("a writable unit offers everything", () => {
  expect(itemActions(item("a-h-G"), ctx)).toEqual({
    edit: true,
    send: true,
    addToFeed: true,
    attachPhoto: true,
    log: true,
    exportTrack: true,
    markDestroyed: true,
    delete: true,
    more: true,
  });
});

test("read only leaves sending, logging, feeds and tracks", () => {
  const actions = itemActions(item("a-h-G"), { ...ctx, readOnlyReason: "not yours" });
  expect(actions).toMatchObject({
    edit: false,
    attachPhoto: false,
    markDestroyed: false,
    delete: false,
    send: true,
    log: true,
    addToFeed: true,
    exportTrack: true,
  });
});

test("a plan draft stays in the browser: nothing that reaches TAK", () => {
  const actions = itemActions(item("a-h-G", { draft: true }), ctx);
  expect(actions).toMatchObject({
    send: false,
    addToFeed: false,
    attachPhoto: false,
    log: false,
    exportTrack: false,
    edit: true,
    delete: true,
  });
});

test("photos need a callsign and no active plan; feeds need an identity and a mission", () => {
  expect(itemActions(item("a-h-G"), { ...ctx, callsign: null }).attachPhoto).toBe(false);
  expect(itemActions(item("a-h-G"), { ...ctx, planActive: true }).attachPhoto).toBe(false);
  expect(itemActions(item("a-h-G"), { ...ctx, clientUid: undefined }).addToFeed).toBe(false);
  expect(itemActions(item("a-h-G"), { ...ctx, missionCount: 0 }).addToFeed).toBe(false);
});

test("only units not already destroyed can be marked destroyed", () => {
  const destroyed = item("a-h-G", { sidc: "SHGXU----------" });
  expect(unitStatusOfItem(destroyed)).toBe("destroyed");
  expect(itemActions(destroyed, ctx).markDestroyed).toBe(false);
  expect(itemActions(item("a-f-G-U-C", { team: "Cyan" }), ctx).markDestroyed).toBe(false);
  expect(itemActions(item("u-d-f"), ctx).markDestroyed).toBe(false);
  expect(unitStatusOfItem(item("u-d-f"))).toBeUndefined();
});

test("tracks are for single points, not ellipses or shapes", () => {
  expect(isPointItem(item("a-h-G"))).toBe(true);
  expect(isPointItem(item("u-d-c-c", { ellipse: { major: 5, minor: 5, angle: 0 } }))).toBe(false);
  const line = item("b-m-r", {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  });
  expect(isPointItem(line)).toBe(false);
  expect(itemActions(line, ctx).exportTrack).toBe(false);
});

test("a draft with nothing writable has an empty More menu", () => {
  expect(itemActions(item("a-h-G", { draft: true }), { ...ctx, readOnlyReason: "x" }).more).toBe(
    false,
  );
});
