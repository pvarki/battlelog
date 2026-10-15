// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { editEvent, setGeofence } from "../commands.ts";
import { type CotEvent, type Geofence, type TakItem, toChange } from "../cot.ts";
import { editGeometryEvent } from "../drawing/edit-geometry.ts";
import {
  breachEvent,
  canBeFence,
  checkFences,
  type FenceState,
  fenceContains,
  isWatched,
  REALERT_AFTER_MS,
} from "./geofence.ts";

const event = (overrides: Partial<CotEvent>): CotEvent => ({
  uid: "x",
  type: "a-f-G",
  how: "h-e",
  time: 1000,
  start: 1000,
  stale: 1_000_000,
  lat: 60,
  lon: 25,
  hae: 0,
  ce: 0,
  le: 0,
  detail: "",
  ...overrides,
});

const itemOf = (e: CotEvent): TakItem => {
  const change = toChange(e);
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

const fenceXml = (attrs: string) => `<__geofence ${attrs}/>`;
const square =
  '<link point="60,25"/><link point="60,25.1"/><link point="60.1,25.1"/><link point="60.1,25"/><link point="60,25"/>';
const polygonFence = (geofence = fenceXml('trigger="Both" monitor="All" tracking="true"')) =>
  itemOf(
    event({
      uid: "fence",
      type: "u-d-f",
      lat: 60.05,
      lon: 25.05,
      detail: `<contact callsign="Area"/>${square}${geofence}`,
    }),
  );
const unit = (uid: string, lat: number, lon: number, type = "a-f-G", detail = "") =>
  itemOf(event({ uid, type, lat, lon, detail: `<contact callsign="${uid}"/>${detail}` }));

test("ATAK's __geofence is read, with CloudTAK's Enter as Entry", () => {
  expect(
    polygonFence(
      fenceXml('trigger="Enter" monitor="Hostile" tracking="true" boundingSphere="80000"'),
    ).geofence,
  ).toEqual({
    trigger: "Entry",
    monitor: "Hostile",
    tracking: true,
  });
  expect(polygonFence(fenceXml("")).geofence).toEqual({
    trigger: "Entry",
    monitor: "TAKUsers",
    tracking: false,
  });
  expect(unit("u", 60, 25).geofence).toBeUndefined();
});

test("a fence written back keeps ATAK's attributes this app doesn't edit, and can be removed", () => {
  const fence = polygonFence(
    fenceXml(
      'trigger="Entry" monitor="All" tracking="false" boundingSphere="123" minElevation="5"',
    ),
  );
  const next: Geofence = { trigger: "Exit", monitor: "Friendly", tracking: true };
  const written = editEvent(fence, (detail) => setGeofence(detail, next));
  expect(itemOf(written).geofence).toEqual(next);
  expect(written.detail).toContain('boundingSphere="123"');
  expect(written.detail).toContain('minElevation="5"');
  const removed = editEvent(itemOf(written), (detail) => setGeofence(detail, undefined));
  expect(removed.detail).not.toContain("__geofence");
});

test("a new fence gets ATAK's full attribute set", () => {
  const plain = polygonFence("");
  const written = editEvent(plain, (detail) =>
    setGeofence(detail, { trigger: "Both", monitor: "TAKUsers", tracking: true }),
  );
  expect(written.detail).toMatch(
    /<__geofence elevationMonitored="false" minElevation="" maxElevation="" boundingSphere="\d+" trigger="Both" monitor="TAKUsers" tracking="true"\/>/,
  );
});

test("reshaping a fence keeps it a fence", () => {
  const fence = polygonFence();
  const moved = editGeometryEvent(fence, {
    kind: "polygon",
    points: [
      [25, 60],
      [25.2, 60],
      [25.2, 60.2],
    ],
  });
  expect(itemOf(moved).geofence).toEqual(fence.geofence);
});

test("only closed shapes can be fences", () => {
  expect(canBeFence(polygonFence())).toBe(true);
  const line = itemOf(
    event({ type: "u-d-f", detail: '<link point="60,25"/><link point="60.1,25.1"/>' }),
  );
  expect(canBeFence(line)).toBe(false);
  const circle = itemOf(
    event({
      type: "u-d-c-c",
      detail: '<shape><ellipse major="100" minor="100" angle="0"/></shape>',
    }),
  );
  expect(canBeFence(circle)).toBe(true);
  expect(canBeFence(unit("u", 60, 25))).toBe(false);
});

test("inside a polygon by its outline, inside a circle by its radius", () => {
  const fence = polygonFence();
  expect(fenceContains(fence, [25.05, 60.05])).toBe(true);
  expect(fenceContains(fence, [25.15, 60.05])).toBe(false);
  const circle = itemOf(
    event({
      type: "u-d-c-c",
      detail: '<shape><ellipse major="1000" minor="1000" angle="0"/></shape>',
    }),
  );
  expect(fenceContains(circle, [25, 60.005])).toBe(true);
  expect(fenceContains(circle, [25, 60.02])).toBe(false);
});

test("a fence watches the items its monitor names", () => {
  const user = unit("user", 60, 25, "a-f-G-U-C", '<__group name="Cyan" role="Team Member"/>');
  const friend = unit("friend", 60, 25, "a-f-G");
  const hostile = unit("hostile", 60, 25, "a-h-G");
  const marker = itemOf(event({ uid: "marker", type: "b-m-p-s-m" }));
  const watched = (monitor: Geofence["monitor"]) =>
    [user, friend, hostile, marker]
      .filter((i) => isWatched({ trigger: "Both", monitor, tracking: true }, i))
      .map((i) => i.uid);
  expect(watched("TAKUsers")).toEqual(["user"]);
  expect(watched("Friendly")).toEqual(["user", "friend"]);
  expect(watched("Hostile")).toEqual(["hostile"]);
  expect(watched("All")).toEqual(["user", "friend", "hostile"]);
  expect(watched("Custom")).toEqual([]);
});

const run = (steps: { fence: TakItem; at: [number, number]; now: number }[]) => {
  let state: FenceState = new Map();
  return steps.map(({ fence, at, now }) => {
    const checked = checkFences(state, [fence, unit("walker", at[1], at[0])], now);
    state = checked.state;
    return checked.crossings.map((c) => (c.entered ? "entered" : "left"));
  });
};
const IN: [number, number] = [25.05, 60.05];
const OUT: [number, number] = [25.5, 60.05];

test("only a change of side alerts, so first sight and standing still don't", () => {
  const fence = polygonFence();
  expect(
    run([
      { fence, at: IN, now: 0 },
      { fence, at: IN, now: 1 },
      { fence, at: OUT, now: 2 },
      { fence, at: OUT, now: 3 },
      { fence, at: IN, now: REALERT_AFTER_MS + 2 },
    ]),
  ).toEqual([[], [], ["left"], [], ["entered"]]);
});

test("the trigger picks which crossings alert", () => {
  const entry = polygonFence(fenceXml('trigger="Entry" monitor="All" tracking="true"'));
  const steps = (fence: TakItem) => [
    { fence, at: OUT, now: 0 },
    { fence, at: IN, now: REALERT_AFTER_MS },
    { fence, at: OUT, now: 2 * REALERT_AFTER_MS },
  ];
  expect(run(steps(entry))).toEqual([[], ["entered"], []]);
  const exit = polygonFence(fenceXml('trigger="Exit" monitor="All" tracking="true"'));
  expect(run(steps(exit))).toEqual([[], [], ["left"]]);
});

test("an item flickering across the line alerts once until the quiet time passes", () => {
  const fence = polygonFence();
  expect(
    run([
      { fence, at: OUT, now: 0 },
      { fence, at: IN, now: 1000 },
      { fence, at: OUT, now: 2000 },
      { fence, at: IN, now: 3000 },
    ]),
  ).toEqual([[], ["entered"], [], []]);
});

test("a fence that isn't monitored doesn't alert", () => {
  const fence = polygonFence(fenceXml('trigger="Both" monitor="All" tracking="false"'));
  expect(
    run([
      { fence, at: OUT, now: 0 },
      { fence, at: IN, now: 1 },
    ]),
  ).toEqual([[], []]);
});

test("a breach alert to TAK reads back as ATAK's Geo-fence Breached from us", () => {
  const fence = polygonFence();
  const walker = unit("walker", 60.05, 25.05);
  const sent = breachEvent(
    { fence, item: walker, entered: true, time: 5 },
    { uid: "BattleLog-K", callsign: "K-BL" },
    5000,
  );
  expect(sent.type).toBe("b-a-g");
  const alert = itemOf(sent);
  expect(alert.emergency).toEqual({ kind: "Geo-fence Breached", from: "walker" });
  expect(alert.creator).toBe("K-BL");
  expect(alert.remarks).toBe("walker entered Area");
  expect(alert.geometry.coordinates).toEqual([25.05, 60.05]);
});

test("a fence across ±180° holds what's between its edges, not the rest of the globe", () => {
  const ring =
    '<link point="10,179"/><link point="10,-179"/><link point="11,-179"/><link point="11,179"/><link point="10,179"/>';
  const fence = itemOf(
    event({ uid: "dateline", type: "u-d-f", lat: 10.5, lon: 180, detail: ring }),
  );
  expect(fenceContains(fence, [179.5, 10.5])).toBe(true);
  expect(fenceContains(fence, [-179.5, 10.5])).toBe(true);
  expect(fenceContains(fence, [0, 10.5])).toBe(false);
  expect(fenceContains(fence, [25, 10.5])).toBe(false);
});
