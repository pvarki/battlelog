import { afterEach, expect, test, vi } from "vitest";
import {
  deletePackageRequest,
  deleteTakPackage,
  isOwnPackage,
  syncDeleteRequest,
  type TakPackage,
} from "./import.ts";

const hash = "a".repeat(64);
const pkg: TakPackage = {
  hash,
  name: "Kaikki.zip",
  size: 1013,
  by: "Eversti",
  submitted: "2026-10-14T08:00:00Z",
  creatorUid: "ANDROID-1",
};

test("only packages this user uploaded, from BattleLog or under their name, are theirs", () => {
  const me = { callsign: "Eversti", clientUid: "BattleLog-Eversti" };
  expect(isOwnPackage(pkg, me)).toBe(true);
  expect(isOwnPackage({ ...pkg, by: "eetu", creatorUid: "BattleLog-Eversti" }, me)).toBe(true);
  expect(isOwnPackage({ ...pkg, by: "eetu" }, me)).toBe(false);
  expect(isOwnPackage({ ...pkg, by: "", creatorUid: "" }, { callsign: "", clientUid: "" })).toBe(
    false,
  );
});

test("a package is deleted by its hash", () => {
  expect(deletePackageRequest(hash)).toEqual({
    method: "DELETE",
    path: `/Marti/api/files/${hash}`,
  });
  expect(syncDeleteRequest(hash)).toEqual({
    method: "POST",
    path: `/Marti/sync/delete?Hash=${hash}`,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const search = (hashes: string[]) =>
  JSON.stringify({ results: hashes.map((Hash) => ({ Hash, Name: "x.zip" })) });

test("a TAK without the files API deletes through sync, and the list confirms it", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(
      `${init?.method ?? "GET"} ${new URL(url, "https://tak.test").pathname.replace(/^.*(?=\/Marti)/, "")}`,
    );
    if (init?.method === "DELETE") return new Response("", { status: 405 });
    return new Response(init?.method === "POST" ? "" : search(["b".repeat(64)]));
  });
  expect((await deleteTakPackage(hash)).map((p) => p.hash)).toEqual(["b".repeat(64)]);
  expect(calls).toEqual([
    `DELETE /Marti/api/files/${hash}`,
    "POST /Marti/sync/delete",
    "GET /Marti/sync/search",
  ]);
});

test("a package still listed after the delete fails it", async () => {
  vi.stubGlobal("fetch", async () => new Response(search([hash])));
  await expect(deleteTakPackage(hash)).rejects.toThrow(/didn't confirm/);
});
