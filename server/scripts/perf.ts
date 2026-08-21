import "varlock/auto-load";
import autocannon from "autocannon";
import { asc, desc, gt, like, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { ENV } from "varlock/env";
import { db, pool } from "../src/db/client.ts";
import { events } from "../src/db/schema.ts";
import { generateFakeEvent } from "./fake-events-generator.ts";

/**
 * Perf smoke against a RUNNING dev server (pnpm dev) + compose DB.
 *   pnpm perf [baseUrl] [--cleanup] [--json]
 *
 * Phases: seed to 50k rows → HTTP read latency (autocannon) → write throughput
 * (autocannon) → SSE fan-out with exact-delivery assertions → reconnect replay
 * paging → EXPLAIN ANALYZE index checks. Run manually; CI latency is noise.
 */

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const wantCleanup = args.includes("--cleanup");
const wantJson = args.includes("--json");
/** --scale=10 → 500k rows, 20k-write burst, 500 SSE subscribers. Thresholds stay fixed. */
const scale = Math.max(1, Number(args.find((a) => a.startsWith("--scale="))?.slice(8) ?? 1));

const SEED_TARGET = 50_000 * scale;
const WRITE_AMOUNT = 2000 * scale;
const READ_P97_5_MS = 150;
const WRITE_P97_5_MS = 200;
const WRITE_MIN_PER_SEC = 100;
const SSE_SUBSCRIBERS = 50 * scale;
const SSE_EVENTS = 200;
const SSE_P95_MS = 1000;

const failures: string[] = [];
const report: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
};
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
const ms = (n: number) => `${n.toFixed(1)}ms`;

// --- phase 0: seed -----------------------------------------------------------

const seed = async () => {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(events);
  const have = row?.count ?? 0;
  if (have >= SEED_TARGET) {
    console.log(`seed: ${have} rows present, target ${SEED_TARGET} — skipping`);
    return;
  }
  console.log(`seed: inserting ${SEED_TARGET - have} rows (batches of 500)…`);
  for (let done = have; done < SEED_TARGET; done += 500) {
    const batch = Array.from({ length: Math.min(500, SEED_TARGET - done) }, () => {
      const id = uuidv7();
      return { ...generateFakeEvent("perf-seed"), id, eventId: id, updateFor: null };
    });
    await db.insert(events).values(batch);
  }
  console.log("seed: done");
};

// --- phases 1+2: HTTP via autocannon ------------------------------------------

const httpScenario = async (
  name: string,
  opts: autocannon.Options,
  p97_5LimitMs: number,
): Promise<autocannon.Result> => {
  const res = await autocannon(opts);
  const clean = res.errors === 0 && res.non2xx === 0;
  check(
    name,
    clean && res.latency.p97_5 < p97_5LimitMs,
    `req/s ${res.requests.mean.toFixed(0)}  p50 ${ms(res.latency.p50)}  p97.5 ${ms(res.latency.p97_5)}  max ${ms(res.latency.max)}  non2xx ${res.non2xx}  errors ${res.errors}`,
  );
  report[name] = { latency: res.latency, requestsMean: res.requests.mean, non2xx: res.non2xx };
  return res;
};

const readScenarios = async () => {
  console.log(`\nreads (10 conns × 10s each, ${SEED_TARGET} rows):`);
  const [oldRow] = await db
    .select({ id: events.id })
    .from(events)
    .orderBy(asc(events.id))
    .offset(1000)
    .limit(1);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const scenarios: [string, string][] = [
    ["list limit=100", "/api/v1/events?limit=100"],
    [
      "filtered (tags+type+time)",
      `/api/v1/events?tags=cyber,port&types=report&eventTimeFrom=${encodeURIComponent(weekAgo)}`,
    ],
    ["search (trigram)", "/api/v1/events?search=dolor"],
    ["geo 20km (geography gist)", "/api/v1/events?lng=24.94&lat=60.17&radiusMeters=20000"],
    ["deep page via cursor", `/api/v1/events?limit=100&cursor=${oldRow?.id}`],
  ];
  for (const [name, path] of scenarios) {
    await httpScenario(name, { url: base + path, connections: 10, duration: 10 }, READ_P97_5_MS);
  }
};

const writeScenario = async () => {
  console.log(`\nwrites (20 conns, ${WRITE_AMOUNT} POSTs):`);
  const res = await httpScenario(
    "POST /events",
    {
      url: `${base}/api/v1/events`,
      method: "POST",
      connections: 20,
      amount: WRITE_AMOUNT,
      headers: {
        "content-type": "application/json",
        [ENV.RM_MTLS_HEADER]: "CN=perf-writer",
      },
      body: JSON.stringify({
        header: "perf write burst event",
        tags: ["perf"],
        type: "report",
        locationPoint: { lat: 60.17, lng: 24.94 },
      }),
    },
    WRITE_P97_5_MS,
  );
  const perSec = WRITE_AMOUNT / res.duration;
  check("write throughput", perSec > WRITE_MIN_PER_SEC, `${perSec.toFixed(0)} events/s`);
};

// --- SSE plumbing --------------------------------------------------------------

type Subscriber = {
  arrivals: Map<string, number>;
  order: string[];
  dupes: number;
  abort: AbortController;
  done: Promise<void>;
};

/** Incremental SSE reader; records arrival time per event id. */
const subscribe = async (lastEventId?: string, onIdle?: number): Promise<Subscriber> => {
  const abort = new AbortController();
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (lastEventId) headers["last-event-id"] = lastEventId;
  const res = await fetch(`${base}/api/v1/events/stream`, { headers, signal: abort.signal });
  if (!res.ok || !res.body) throw new Error(`stream connect failed: ${res.status}`);
  const sub: Subscriber = {
    arrivals: new Map(),
    order: [],
    dupes: 0,
    abort,
    done: Promise.resolve(),
  };
  const reader = res.body.getReader();
  sub.done = (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const next = onIdle
          ? await Promise.race([
              reader.read(),
              new Promise<{ done: true; value?: undefined }>((r) =>
                setTimeout(() => r({ done: true }), onIdle),
              ),
            ])
          : await reader.read();
        if (next.done) break;
        buf += dec.decode(next.value, { stream: true });
        let sep = buf.indexOf("\n\n");
        while (sep !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const idLine = frame.split("\n").find((l) => l.startsWith("id: "));
          if (idLine) {
            const id = idLine.slice(4).trim();
            if (sub.arrivals.has(id)) sub.dupes += 1;
            else sub.arrivals.set(id, performance.now());
            sub.order.push(id);
          }
          sep = buf.indexOf("\n\n");
        }
      }
    } catch {
      // aborted
    }
    abort.abort();
  })();
  return sub;
};

const sseFanOut = async () => {
  console.log(`\nSSE fan-out (${SSE_SUBSCRIBERS} subscribers × ${SSE_EVENTS} events):`);
  // Wait for the realtime pipeline to drain prior phases (seed + write burst
  // fire one NOTIFY per row): a fresh subscriber receiving a probe event
  // proves the listener queue is caught up.
  const probe = await subscribe();
  const probeRes = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json", [ENV.RM_MTLS_HEADER]: "CN=perf-sse" },
    body: JSON.stringify({ header: "perf probe", type: "report" }),
  });
  const probeId = ((await probeRes.json()) as { id: string }).id;
  const probeStart = performance.now();
  const probeDeadline = Date.now() + 120_000;
  while (!probe.arrivals.has(probeId) && Date.now() < probeDeadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  probe.abort.abort();
  await probe.done;
  if (!probe.arrivals.has(probeId)) {
    check("SSE pipeline caught up", false, "probe event not delivered within 120s");
    return;
  }
  console.log(`  (pipeline caught up ${ms(performance.now() - probeStart)} after probe)`);

  const subs = await Promise.all(Array.from({ length: SSE_SUBSCRIBERS }, () => subscribe()));
  await new Promise((r) => setTimeout(r, 300));

  const sent: { id: string; t0: number; tResp: number }[] = [];
  for (let i = 0; i < SSE_EVENTS; i++) {
    const t0 = performance.now();
    const res = await fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json", [ENV.RM_MTLS_HEADER]: "CN=perf-sse" },
      body: JSON.stringify({ header: `perf sse ${i}`, type: "report" }),
    });
    const body = (await res.json()) as { id: string };
    sent.push({ id: body.id, t0, tResp: performance.now() });
  }

  const sentIds = new Set(sent.map((s) => s.id));
  const allDelivered = () => subs.every((s) => sent.every(({ id }) => s.arrivals.has(id)));
  const deadline = Date.now() + 10_000;
  while (!allDelivered() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

  for (const s of subs) s.abort.abort();
  await Promise.all(subs.map((s) => s.done));

  let losses = 0;
  let dupes = 0;
  let orderViolations = 0;
  const e2e: number[] = [];
  const prop: number[] = [];
  const perSubP95: number[] = [];
  for (const s of subs) {
    dupes += s.dupes;
    const mine: number[] = [];
    for (const { id, t0, tResp } of sent) {
      const at = s.arrivals.get(id);
      if (at === undefined) {
        losses += 1;
        continue;
      }
      e2e.push(at - t0);
      prop.push(at - tResp);
      mine.push(at - t0);
    }
    const ordered = s.order.filter((id) => sentIds.has(id));
    for (let i = 1; i < ordered.length; i++) {
      const [a, b] = [ordered[i - 1], ordered[i]];
      if (a && b && b <= a) orderViolations += 1;
    }
    mine.sort((a, b) => a - b);
    perSubP95.push(pct(mine, 95));
  }
  e2e.sort((a, b) => a - b);
  prop.sort((a, b) => a - b);

  check(
    "SSE exact delivery",
    losses === 0 && dupes === 0 && orderViolations === 0,
    `losses ${losses}  dupes ${dupes}  order violations ${orderViolations}  (${subs.length * sent.length} deliveries)`,
  );
  check(
    "SSE latency",
    e2e.length > 0 && pct(e2e, 95) < SSE_P95_MS,
    `e2e p50 ${ms(pct(e2e, 50))} p95 ${ms(pct(e2e, 95))} max ${ms(e2e[e2e.length - 1] ?? 0)}  ` +
      `propagation p50 ${ms(pct(prop, 50))} p95 ${ms(pct(prop, 95))}  worst-sub p95 ${ms(Math.max(0, ...perSubP95))}`,
  );
  report.sse = { losses, dupes, orderViolations, e2eP95: pct(e2e, 95), propP95: pct(prop, 95) };
};

const replayPaging = async (markerId: string) => {
  console.log("\nreconnect replay paging:");
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(gt(events.id, markerId));
  const expected = row?.count ?? 0;

  const recovered = new Set<string>();
  let last = markerId;
  let pages = 0;
  const t0 = performance.now();
  // Full 500-row pages close the stream server-side; a partial page goes live,
  // which the 1500ms idle timeout ends.
  while (true) {
    const sub = await subscribe(last, 1500);
    await sub.done;
    let got = 0;
    for (const id of sub.arrivals.keys()) {
      recovered.add(id);
      if (id > last) last = id;
      got += 1;
    }
    pages += 1;
    if (got < 500) break;
  }
  const took = performance.now() - t0;
  check(
    "replay recovers full gap",
    recovered.size === expected,
    `${recovered.size}/${expected} rows in ${pages} pages, ${ms(took)}`,
  );
  report.replay = { expected, recovered: recovered.size, pages, tookMs: took };
};

// --- phase 5: planner ----------------------------------------------------------

const explainCheck = async (name: string, query: string, wantIndex: string) => {
  const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${query}`);
  const plan = rows.map((r: Record<string, string>) => r["QUERY PLAN"]).join("\n");
  check(name, plan.includes(wantIndex), plan.split("\n")[0] ?? "");
};

const plannerChecks = async () => {
  console.log("\nplanner (EXPLAIN ANALYZE at 50k rows, selective predicates):");
  await explainCheck(
    "search uses trigram index",
    "SELECT id FROM events WHERE header ILIKE '%zxqvw%'",
    "events_header_trgm_idx",
  );
  await explainCheck(
    "geo uses geography index",
    "SELECT id FROM events WHERE ST_DWithin(location_point::geography, ST_SetSRID(ST_MakePoint(24.94, 60.17), 4326)::geography, 20000)",
    "events_location_point_geog_gix",
  );
};

// --- main ------------------------------------------------------------------------

const main = async () => {
  const health = await fetch(`${base}/healthz`).catch(() => null);
  if (!health?.ok) {
    console.error(`no server at ${base} — start it first (pnpm dev)`);
    process.exit(1);
  }

  await seed();
  await readScenarios();

  const [head] = await db.select({ id: events.id }).from(events).orderBy(desc(events.id)).limit(1);
  const markerId = head?.id ?? "";

  await writeScenario();
  await sseFanOut();
  await replayPaging(markerId);
  await plannerChecks();

  if (wantCleanup) {
    const gone = await db
      .delete(events)
      .where(like(events.createdBy, "perf-%"))
      .returning({ id: events.id });
    console.log(`\ncleanup: deleted ${gone.length} perf rows`);
  }
  if (wantJson) console.log(`\n${JSON.stringify(report, null, 2)}`);

  console.log(failures.length ? `\nFAIL (${failures.length})` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
