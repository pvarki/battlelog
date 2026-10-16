// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { contentLinks, parseCotXmlInSlices, takGetText } from "./rest.ts";
import { inSlices } from "./slices.ts";

test("photo links in remarks resolve to where this browser fetches them", () => {
  const hash = "ab".repeat(32);
  const remarks = `Tuhottu\nPhoto: https://tak.example.fi:8443/Marti/sync/content?hash=${hash}`;
  expect(contentLinks(remarks)).toHaveLength(1);
  expect(contentLinks(remarks)[0]).toMatch(new RegExp(`/Marti/sync/content\\?hash=${hash}$`));
  expect(contentLinks("no links here")).toEqual([]);
  expect(contentLinks(undefined)).toEqual([]);
});

const event = (uid: string, remarks = "") =>
  `<event version="2.0" uid="${uid}" type="a-f-G" how="m-g" time="2026-10-13T10:00:00Z" start="2026-10-13T10:00:00Z" stale="2026-10-13T10:05:00Z"><point lat="60" lon="25" hae="0" ce="0" le="0"/><detail>${remarks}</detail></event>`;
const many = (n: number, remarks = "") =>
  Array.from({ length: n }, (_, i) => event(`e${i}`, i === n - 1 ? remarks : "")).join("");

test("an archive parses a slice at a time to the same events", async () => {
  const events = await parseCotXmlInSlices(`<events>${many(450)}</events>`, { strict: true });
  expect(events).toHaveLength(450);
  expect(events.at(-1)?.uid).toBe("e449");
});

test("a cut-off archive still fails strict parsing", async () => {
  await expect(parseCotXmlInSlices(`<events>${many(3)}`, { strict: true })).rejects.toThrow();
});

test('"</event>" inside a comment falls back to parsing the whole document', async () => {
  const xml = `<events>${many(250, "<!-- x</event>y -->")}</events>`;
  const events = await parseCotXmlInSlices(xml, { strict: true });
  expect(events).toHaveLength(250);
  expect(events.at(-1)?.detail).toContain("x</event>y");
});

test("slicing stops once aborted", async () => {
  const abort = new AbortController();
  const seen: number[] = [];
  await inSlices(
    Array.from({ length: 600 }, (_, i) => i),
    (slice) => {
      seen.push(...slice);
      abort.abort();
    },
    abort.signal,
  );
  expect(seen).toHaveLength(200);
});

test("a TAK answer over 64 MB is refused before it is all in memory", async () => {
  const megabyte = new Uint8Array(1_048_576);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (sent++ < 65) controller.enqueue(megabyte);
      else controller.close();
    },
  });
  vi.stubGlobal("fetch", async () => new Response(body));
  await expect(takGetText("/Marti/api/anything")).rejects.toThrow(/over 64 MB/);
  vi.unstubAllGlobals();
});
