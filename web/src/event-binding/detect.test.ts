import { expect, test } from "vitest";
import { detectFields } from "./detect.ts";

test("guesses kinds from the values seen across events", () => {
  const fields = detectFields([
    { status: "ready", battery: 92, armed: false, mission: null, crew: ["a"], pos: { lat: 60 } },
    { status: "maintenance", battery: 54, armed: true, mission: "Recon Alpha" },
    { status: "ready", note: 5 },
    null,
  ]);
  expect(fields).toEqual([
    { path: "armed", kind: "boolean", options: [], sample: "false" },
    { path: "battery", kind: "count", options: [], sample: "92" },
    { path: "mission", kind: "text", options: [], sample: "Recon Alpha" },
    { path: "note", kind: "count", options: [], sample: "5" },
    { path: "pos.lat", kind: "count", options: [], sample: "60" },
    { path: "status", kind: "choice", options: ["maintenance", "ready"], sample: "ready" },
  ]);
});

test("many distinct strings or mixed types are text", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ name: `n${i}`, mixed: i % 2 ? "x" : 1 }));
  const fields = detectFields(many);
  expect(fields.find((f) => f.path === "name")?.kind).toBe("text");
  expect(fields.find((f) => f.path === "mixed")?.kind).toBe("text");
});
