import { expect, test } from "vitest";
import { hiddenExcept, isHidden } from "../overlays.ts";
import { toggledGroup } from "./ViewLayers.tsx";

const shown = (key: string, hidden: ReadonlySet<string>) => !isHidden(key.split("/"), hidden);

test("a group under a hidden parent can be switched back on", () => {
  const hidden = hiddenExcept(["shapes"]);
  expect(shown("markers/friendly", hidden)).toBe(false);
  const next = toggledGroup(hidden, "markers/friendly");
  expect(shown("markers/friendly", next)).toBe(true);
  expect(shown("markers/friendly/troops", next)).toBe(true);
  expect(shown("markers/hostile", next)).toBe(false);
  expect(shown("shapes", next)).toBe(true);
});

test("switching a parent off hides everything under it, and only that", () => {
  const next = toggledGroup(new Set(), "navigation");
  expect(shown("navigation/routes", next)).toBe(false);
  expect(shown("navigation/waypoints", next)).toBe(false);
  expect(shown("markers/team", next)).toBe(true);
});
