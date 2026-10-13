import { expect, test } from "vitest";
import { contentLinks } from "./rest.ts";

test("photo links in remarks resolve to where this browser fetches them", () => {
  const hash = "ab".repeat(32);
  const remarks = `Tuhottu\nPhoto: https://tak.example.fi:8443/Marti/sync/content?hash=${hash}`;
  expect(contentLinks(remarks)).toHaveLength(1);
  expect(contentLinks(remarks)[0]).toMatch(new RegExp(`/Marti/sync/content\\?hash=${hash}$`));
  expect(contentLinks("no links here")).toEqual([]);
  expect(contentLinks(undefined)).toEqual([]);
});
