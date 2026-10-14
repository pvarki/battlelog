import type { CotEvent, Position } from "../cot.ts";
import type { Sender } from "../identity.ts";
import { newShapeEvent } from "./new-items.ts";

/**
 * MIL-STD-2525C tactical graphics BattleLog can draw, a subset of the lines and
 * areas ATAK's drawing tools offer, written as ATAK writes them: a plain u-d-f
 * line or closed shape with `__milsym` holding the letter code with `*`
 * wildcards. The control points go out in the renderer's order (arrows tip
 * first), whatever order is easiest to click.
 */

export type Affiliation = "friendly" | "hostile";

/**
 * How clicks map to the renderer's control points:
 * - `tipLast`: clicked from the start to the arrow tip; the renderer wants the tip first.
 * - `axis`: clicked along the axis to the tip, then once beside the arrowhead for its width.
 * - `targetLast`: the firing position's two ends, then the target the arrow points at.
 * - `twoTargets`: the position's two ends, then the target beyond the second end and the one beyond the first.
 */
type Order = "tipLast" | "axis" | "targetLast" | "twoTargets";

export type TacticalGraphic = {
  /** 2525C code as ATAK writes it. */
  sidc: string;
  name: string;
  group: string;
  shape: "line" | "area";
  /** Clicks the graphic needs, when it's stricter than any line or area. */
  points?: { min: number; max?: number };
  order?: Order;
};

const graphic = (
  group: string,
  shape: TacticalGraphic["shape"],
  code: string,
  name: string,
  rules: Pick<TacticalGraphic, "points" | "order"> = {},
): TacticalGraphic => ({ sidc: `G*${code.padEnd(8, "-")}****X`, name, group, shape, ...rules });

const LINES = "Boundaries and lines";
const MANEUVER = "Maneuver";
const AREAS = "Areas";
const OBSTACLES = "Obstacles";
const FIRES = "Fire support";
const SUSTAINMENT = "Sustainment";
const AXIS = { order: "axis", points: { min: 3 } } as const;

export const TACTICAL_GRAPHICS: TacticalGraphic[] = [
  graphic(LINES, "line", "G*GLB", "Boundary"),
  graphic(LINES, "line", "G*GLF", "Forward line of own troops (FLOT)"),
  graphic(LINES, "line", "G*GLC", "Line of contact"),
  graphic(LINES, "line", "G*GLP", "Phase line"),
  graphic(LINES, "line", "G*GLL", "Light line"),
  graphic(LINES, "line", "G*DLF", "Forward edge of the battle area (FEBA)"),
  graphic(LINES, "line", "G*OLT", "Line of departure (LD)"),
  graphic(LINES, "line", "G*OLC", "Line of departure / line of contact (LD/LC)"),
  graphic(LINES, "line", "G*OLL", "Limit of advance (LOA)"),
  graphic(LINES, "line", "G*OLF", "Final coordination line"),
  graphic(LINES, "line", "G*OLP", "Probable line of deployment"),
  graphic(MANEUVER, "line", "G*OLAGM", "Axis of advance, main attack", AXIS),
  graphic(MANEUVER, "line", "G*OLAGS", "Axis of advance, supporting attack", AXIS),
  graphic(MANEUVER, "line", "G*OLAV", "Axis of advance, aviation", AXIS),
  graphic(MANEUVER, "line", "G*OLAR", "Axis of advance, attack helicopter", AXIS),
  graphic(MANEUVER, "line", "G*OLKGM", "Direction of attack, main attack", { order: "tipLast" }),
  graphic(MANEUVER, "line", "G*OLKGS", "Direction of attack, supporting attack", {
    order: "tipLast",
  }),
  graphic(MANEUVER, "line", "G*OLKA", "Direction of attack, aviation", { order: "tipLast" }),
  graphic(MANEUVER, "area", "G*OAF", "Attack by fire position", {
    order: "targetLast",
    points: { min: 3, max: 3 },
  }),
  graphic(MANEUVER, "area", "G*OAS", "Support by fire position", {
    order: "twoTargets",
    points: { min: 4, max: 4 },
  }),
  graphic(MANEUVER, "area", "G*OAK", "Attack position"),
  graphic(MANEUVER, "area", "G*OAO", "Objective"),
  graphic(AREAS, "area", "G*GAA", "Assembly area"),
  graphic(AREAS, "area", "G*GAE", "Engagement area (EA)"),
  graphic(AREAS, "area", "G*DAB", "Battle position"),
  graphic(AREAS, "area", "G*GAG", "General area"),
  graphic(AREAS, "area", "G*GAF", "Fortified area"),
  graphic(AREAS, "area", "G*SAN", "Named area of interest (NAI)"),
  graphic(AREAS, "area", "G*SAT", "Targeted area of interest (TAI)"),
  graphic(AREAS, "area", "G*GAD", "Drop zone"),
  graphic(AREAS, "area", "G*GAL", "Landing zone"),
  graphic(AREAS, "area", "G*GAP", "Pick-up zone"),
  graphic(AREAS, "area", "G*GAX", "Extraction zone"),
  graphic(OBSTACLES, "area", "M*OGB", "Obstacle belt"),
  graphic(OBSTACLES, "area", "M*OGZ", "Obstacle zone"),
  graphic(OBSTACLES, "area", "M*OGR", "Obstacle restricted zone"),
  graphic(OBSTACLES, "area", "M*OGF", "Obstacle free zone"),
  graphic(OBSTACLES, "area", "M*OFA", "Mined area"),
  graphic(OBSTACLES, "line", "M*OADU", "Antitank ditch, under construction"),
  graphic(OBSTACLES, "line", "M*OADC", "Antitank ditch, completed"),
  graphic(OBSTACLES, "line", "M*OAR", "Antitank ditch with mines"),
  graphic(OBSTACLES, "line", "M*OWS", "Single fence wire"),
  graphic(OBSTACLES, "line", "M*OWD", "Double fence wire"),
  graphic(OBSTACLES, "line", "M*OWCS", "Single concertina"),
  graphic(OBSTACLES, "line", "M*OWCD", "Double strand concertina"),
  graphic(OBSTACLES, "line", "M*OWCT", "Triple strand concertina"),
  graphic(OBSTACLES, "line", "M*SL", "Fortified line"),
  graphic(FIRES, "line", "F*LCF", "Fire support coordination line (FSCL)"),
  graphic(FIRES, "line", "F*LCC", "Coordinated fire line (CFL)"),
  graphic(FIRES, "line", "F*LCN", "No fire line (NFL)"),
  graphic(FIRES, "line", "F*LCR", "Restrictive fire line (RFL)"),
  graphic(FIRES, "line", "F*LT", "Linear target", { points: { min: 2, max: 2 } }),
  graphic(FIRES, "line", "F*LTF", "Final protective fire (FPF)", { points: { min: 2, max: 2 } }),
  graphic(FIRES, "area", "F*AT", "Area target"),
  graphic(FIRES, "area", "F*ACFI", "Free fire area (FFA)"),
  graphic(FIRES, "area", "F*ACNI", "No fire area (NFA)"),
  graphic(FIRES, "area", "F*ACRI", "Restrictive fire area (RFA)"),
  graphic(FIRES, "area", "F*ACSI", "Fire support area (FSA)"),
  graphic(FIRES, "area", "F*ACAI", "Airspace coordination area (ACA)"),
  graphic(SUSTAINMENT, "line", "S*LRM", "Main supply route (MSR)"),
  graphic(SUSTAINMENT, "line", "S*LRA", "Alternate supply route (ASR)"),
];

const HINT: Record<Order, string> = {
  tipLast: "Click from where the attack starts to where it points; click the tip again to finish.",
  axis: "Click along the axis from its start to the tip, then once beside the arrowhead to set its width; click that point again to finish.",
  targetLast:
    "Click the two ends of the firing position, then the target; click the first point to close.",
  twoTargets:
    "Click the two ends of the position, then the target beyond the second end and the one beyond the first; click the first point to close.",
};

/** How to click this graphic, when it's more than drawing a line or an area. */
export const hintFor = (g: TacticalGraphic): string | undefined => g.order && HINT[g.order];

/** Obstacles are green whoever placed them; the rest are blue or red by side, as in 2525. */
export const hasAffiliation = (g: TacticalGraphic) => g.sidc[2] !== "M";

const strokeFor = (g: TacticalGraphic, affiliation: Affiliation) =>
  !hasAffiliation(g) ? "#00ff00" : affiliation === "hostile" ? "#ff0000" : "#0000ff";

/** The clicked points in the order the renderer, and so ATAK, reads them. */
export const controlPoints = (g: TacticalGraphic, clicked: Position[]): Position[] => {
  switch (g.order) {
    case "tipLast":
      return clicked.toReversed();
    case "axis":
      return [...clicked.slice(0, -1).toReversed(), ...clicked.slice(-1)];
    case "targetLast":
      return [...clicked.slice(-1), ...clicked.slice(0, -1)];
    case "twoTargets":
    case undefined:
      return clicked;
  }
};

/** Why the clicked points can't make this graphic, or undefined when they can. */
export const pointsProblem = (g: TacticalGraphic, count: number): string | undefined => {
  const { min, max } = g.points ?? { min: g.shape === "line" ? 2 : 3 };
  if (count >= min && count <= (max ?? count)) return undefined;
  return min === max ? `Needs exactly ${min} points` : `Needs at least ${min} points`;
};

export type TacticalLook = { name: string; affiliation: Affiliation; remarks: string };

export const newTacticalGraphicEvent = (
  g: TacticalGraphic,
  clicked: Position[],
  look: TacticalLook,
  sender: Sender,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent =>
  newShapeEvent(
    { kind: g.shape === "line" ? "line" : "polygon", points: controlPoints(g, clicked) },
    {
      name: look.name,
      remarks: look.remarks,
      stroke: strokeFor(g, look.affiliation),
      strokeWeight: 3,
      strokeStyle: "solid",
      // ATAK shows only the graphic, never the drawing's fill.
      fillOpacity: 0,
      labelsOn: true,
      sidc: g.sidc,
    },
    sender,
    now,
    uid,
  );
