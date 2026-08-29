/**
 * Reading CoT type codes out loud.
 *
 * A CoT type is a dash-separated path, not a name: `a-f-G-U-C-I` is an atom,
 * friendly affiliation, ground dimension, then the MIL-STD-2525 function chain
 * unit → combat → infantry. Shown raw in a feed it tells an operator nothing, so
 * this turns it into "Friendly, Ground, Infantry".
 *
 * Coverage is deliberately partial. 2525 has well over a thousand function codes
 * and almost none of them appear on a TAK net; the levels worth naming are here
 * and anything unrecognised falls through as its own code, so an unusual marker
 * degrades to "Hostile, Ground, X" rather than to a lie.
 *
 * ponytail: echelon (platoon, company, battalion) is NOT in the CoT type — it
 * lives in the 2525 symbol ID, which TAK does not put on the wire. If a producer
 * starts sending one it will be in <detail>, and that is where to read it from.
 */

/** Second field: whose side it is on. */
const AFFILIATION: Record<string, string> = {
  f: "Friendly",
  h: "Hostile",
  n: "Neutral",
  u: "Unknown",
  p: "Pending",
  a: "Assumed friendly",
  s: "Suspect",
  j: "Joker",
  k: "Faker",
  o: "No statement",
  x: "Other",
};

/**
 * Dimension and function chain, keyed by the whole path so far.
 *
 * An empty label means "matched, but adds nothing worth reading": `G-U` is
 * "unit", which is already implied by naming what kind of unit it is.
 */
const FUNCTION: Record<string, string> = {
  // Ground
  G: "Ground",
  "G-U": "",
  "G-U-C": "",
  "G-U-C-I": "Infantry",
  "G-U-C-I-M": "Mechanised infantry",
  "G-U-C-I-N": "Naval infantry",
  "G-U-C-I-Z": "Motorised infantry",
  "G-U-C-A": "Armour",
  "G-U-C-A-A": "Anti-tank",
  "G-U-C-R": "Reconnaissance",
  "G-U-C-F": "Artillery",
  "G-U-C-F-A": "Air defence artillery",
  "G-U-C-D": "Air defence",
  "G-U-C-E": "Engineer",
  "G-U-C-V": "Aviation",
  "G-U-C-N": "NBC",
  "G-U-C-S": "Special forces",
  "G-U-H": "Combat support",
  "G-U-H-M": "Medical",
  "G-U-H-C": "Signals",
  "G-U-S": "Logistics",
  "G-U-S-M": "Medical",
  "G-U-S-S": "Supply",
  "G-U-S-T": "Transport",
  "G-U-S-X": "Maintenance",
  "G-E": "Equipment",
  "G-E-V": "Vehicle",
  "G-E-W": "Weapon",
  "G-E-S": "Sensor",
  "G-I": "Installation",
  "G-G": "Command post",
  // Air
  A: "Air",
  "A-M": "",
  "A-C": "Civilian",
  "A-M-F": "Fixed wing",
  "A-M-F-Q": "Drone",
  "A-M-F-Q-r": "Drone",
  "A-M-F-A": "Attack aircraft",
  "A-M-F-B": "Bomber",
  "A-M-F-C": "Cargo aircraft",
  "A-M-H": "Helicopter",
  "A-W": "Missile",
  // Sea and below
  S: "Sea surface",
  "S-C": "Combatant",
  "S-N": "Non-combatant",
  U: "Subsurface",
  "U-S": "Submarine",
  // Other dimensions
  F: "Special operations",
  P: "Space",
  X: "Other",
};

/** Whole non-atom types, which are messages and drawings rather than things. */
const WHOLE_TYPE: Record<string, string> = {
  "b-t-f": "Chat message",
  "b-m-p-c": "Marker",
  "b-m-p-s-p-i": "Digital pointer",
  "b-m-p-w": "Waypoint",
  "b-m-p-s-m": "Sensor point of interest",
  "b-m-r": "Route",
  "b-i-v": "Video stream",
  "b-f-t-r": "File transfer request",
  "b-f-t-a": "File transfer ack",
  "b-a-o-tbl": "Emergency alert",
  "b-a-o-can": "Emergency cancelled",
  "t-x-takp-v": "TAK server version",
  "t-x-c-t": "Client ping",
  "t-x-c-t-r": "Client pong",
  "t-x-d-d": "Delete request",
  "u-d-f": "Drawing",
  "u-d-r": "Rectangle",
  "u-d-c-c": "Circle",
  "y-a": "Acknowledgement",
};

/**
 * A CoT type as words: "Friendly, Ground, Infantry".
 *
 * Returns the type unchanged when there is nothing to say about it, so a caller
 * never has to decide whether the result is useful — an unknown code shown as
 * itself is the honest answer.
 */
export const describeCotType = (type: string): string => {
  const whole = WHOLE_TYPE[type];
  if (whole) return whole;

  const parts = type.split("-");
  if (parts[0] !== "a" || parts.length < 3) return type;

  const words: string[] = [];
  const affiliation = parts[1] ? AFFILIATION[parts[1]] : undefined;
  words.push(affiliation ?? `Affiliation ${parts[1] ?? "?"}`);

  // Walk the function path one level at a time, naming the levels that have a
  // name and passing through the codes that do not.
  const rest = parts.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const path = rest.slice(0, i + 1).join("-");
    const label = FUNCTION[path];
    if (label === undefined) {
      // Unrecognised from here on: show what is left rather than guessing at it.
      words.push(rest.slice(i).join("-"));
      break;
    }
    if (label) words.push(label);
  }
  return words.join(", ");
};
