# BattleLog

Event log for PVARKI's situational-awareness stack: a Hono + Drizzle backend and a React UI in one pnpm workspace.

The backend captures, versions, and queries geo-tagged hybrid-threat events — a PostGIS-backed append-only event log with NATO Admiralty-Code reliability/credibility ratings and Hybrid CoE threat-domain tagging. The UI (`web/`) is a Vite + React SPA (TanStack Router, Mantine) served by the same Hono server in production.

## Quickstart

Prerequisites: a tool-version manager ([mise](https://mise.jdx.dev/) or [asdf](https://asdf-vm.com/)) and Docker. Pinned versions live in [`.tool-versions`](./.tool-versions): Node 24, pnpm 11, [prek](https://github.com/j178/prek) 0.4 (a single-binary reimplementation of `pre-commit`).

```bash
mise install                    # or: asdf install
cp server/.env.schema server/.env   # adjust as needed
pnpm install
prek install                    # register git hooks
docker compose up -d db         # local Postgres + PostGIS
pnpm -C server db:migrate
pnpm dev                        # server on :3000, UI (vite) on :5173
```

Then open:

- UI (dev, hot reload): <http://localhost:5173/> (proxies `/api` to :3000)
- API: <http://localhost:3000/api/v1/events>
- Swagger UI: <http://localhost:3000/api-docs> (enabled by default in dev)
- Health: <http://localhost:3000/healthz>

In production there is no separate UI server: `pnpm build` emits `web/dist`, which Hono serves (with an `index.html` fallback for client-side routes).

### Full stack via Docker

```bash
docker compose up --build       # app + db
```

## Scripts

Root scripts fan out to both packages; run package-specific ones with `pnpm -C server <script>` / `pnpm -C web <script>`.

| Command | Purpose |
|---|---|
| `pnpm dev` | Both watch-mode servers (Hono :3000, Vite :5173) |
| `pnpm build` | Compile server to `server/dist`, bundle UI to `web/dist` |
| `pnpm test` | Vitest (server) |
| `pnpm check` / `pnpm check:fix` | Biome lint + format (whole repo) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm -C server start` | Run the compiled server |
| `pnpm -C server db:generate` | Generate migration from schema diff |
| `pnpm -C server db:migrate` | Apply migrations (ensures `postgis` extension) |
| `pnpm -C server db:seed` / `db:fake` | Seed / insert fake dev data |
| `pnpm -C server db:studio` | Drizzle Studio |
| `pnpm -C server perf` | Load-test suite (see `server/scripts/perf.ts`) |

## Configuration

All runtime config flows through [varlock](https://varlock.dev/) and is declared in [`server/.env.schema`](./server/.env.schema). Schema changes regenerate `server/src/env.d.ts` via `pnpm -C server exec varlock typegen`. Notable knobs:

- `DATABASE_URL` — Postgres connection (defaults to the local compose DB in dev)
- `USE_SWAGGER` — Swagger UI exposure (on by default in dev)
- `RM_API_ENABLED` + `RM_MTLS_*` — opt-in Rasenmaeher (RM) integration with mTLS
- `OTEL_EXPORTER_OTLP_ENDPOINT` — when set, boots the OTel SDK in prod
- `TAK_STREAM_HOST`, `MATRIX_HOMESERVER_URL` — enable the ingesters (see below)

## Ingest

Two optional ingesters feed events in from the rest of the deployment. Both are
off unless their host is configured, so a deployment that passes no extra
environment behaves exactly as before.

*What* they ingest is chosen at runtime, not in the environment: an admin manages
ingest sources at `/ingest` in the UI (`/api/v1/ingest/sources`), and changes take
effect within seconds without a restart. Admin rights come from RM through the
`/rmapi/api/v1/users/*` hooks, which is what the `users` table records.

### Startup sequence

The HTTP server comes up first and never waits for either ingester:

0. `container-init` sources miniwerk's `/pvarki/hosts_script.sh` so sibling
   product hostnames resolve to the docker gateway rather than to this
   container, and enrols us for a client certificate if we have none.
1. Migrations run, dashboard templates are seeded, the events listener starts.
2. `startTakIngest()` opens a TLS connection to `TAK_STREAM_HOST:TAK_STREAM_PORT`
   presenting the RM-issued client certificate, and reconnects every 5s for as
   long as that fails.
3. `startMatrixIngest()` asks RM for interop with the Matrix product, fetches the
   ingest bot's access token from it, and long-polls `/sync`.
4. Both report live state through `/api/v1/ingest/status` and per source in the
   settings page. Neither ever throws out to the process: TAK or Synapse being
   down must not stop BattleLog serving its own feed.

Events are inserted with the ordinary `createEvent`, so they reach browsers
through the existing `events_notify` trigger and SSE stream with no extra
plumbing.

### TAK

Connects to TAK Server's CoT stream as an ordinary TAK client over mTLS, using
the certificate `kw_product_init` writes to `/data/persistent` on first run.

TAK trusts the RM CA for TLS but also requires the certificate's CN to be a known
TAK user, so `takrmapi` has to enrol us first (its
`POST /api/v1/interop/add`, which RM calls on our behalf). Until it has, TAK
completes the handshake and then drops the connection — which shows up as a
reconnect loop with the reason on the source's status.

**Known limitation, verified against a local `rmlocal` stack:** enrolment alone is
not sufficient there. TAK accepts the TLS handshake and then sends a
`tlsv1 alert internal error`, closing the socket immediately, so the ingester sits
in a reconnect loop and no CoT arrives. This is not specific to this client — an
`openssl s_client` using the same certificate is dropped identically, as is
`takrmapi`'s own admin certificate. The deployment's `CoreConfig` has
`<auth default="ldap" x509groups="true" x509addAnonymous="false">`, so a
certificate user needs a group that only Keycloak → LDAP (`tak_*`) provides;
`certmod` alone puts the user in `__ANON__`, which that config disables. Giving
the enrolled user a real out-group with `certmod -og default` is necessary but
still not enough. Resolving this needs a TAK-side change (an LDAP identity for the
product, or a dedicated input), not a change here.

A TAK source narrows the stream by CoT type prefix, GeoChat room, sender,
recipient, and by substrings of the raw `<detail>` XML. That last one exists
because TAK has no server-side notion of a client's role: an ATAK operator's
`HQ` role appears only inside `detail`, so a substring is the only way to select
on it. Find the exact string in a real event before relying on it.

A source with no filters set takes **every** CoT event on the stream, and the
settings page says so.

### Matrix

Reads messages from selected rooms in the deployment's Matrix Space as the
`battlelog-bot` user matrixrmapi creates for us. The access token comes over the
product interop API using the same client certificate, so no Matrix secret is
ever put in this container's environment.

**The standard rooms are end-to-end encrypted, and joining a room does not change
that** — megolm keys travel client to device, never through the server. Those
rooms arrive as `m.room.encrypted` and are skipped, with the source's status
reading "Encrypted, unreadable" rather than sitting silently at zero. Only a room
created without encryption yields plaintext until this grows a crypto-capable
client.

There is no backfill: the first `/sync` keeps only its cursor. That cursor is
persisted, so a restart resumes rather than replaying.

| Environment variable | Default | Description |
|---|---|---|
| `TAK_STREAM_HOST` | *(empty)* | TAK Server's CoT streaming host. Setting it enables TAK ingest |
| `TAK_STREAM_PORT` | `8089` | TAK's TLS CoT input port |
| `TAK_TLS_SERVERNAME` | *(empty)* | SNI name, when it differs from the host |
| `TAK_CLIENT_CERT_PATH` | `/data/persistent/public/mtlsclient.pem` | Our RM-issued client certificate |
| `TAK_CLIENT_KEY_PATH` | `/data/persistent/private/mtlsclient.key` | Its private key |
| `TAK_CA_PATH` | `/ca_public/ca_chain.pem` | CA bundle for verifying peers |
| `MATRIX_HOMESERVER_URL` | *(empty)* | Internal Synapse URL. Setting it enables Matrix ingest |
| `MATRIX_PRODUCT_NAME` | `matrix` | RM product name to request interop with |

## Tech stack

Hono · `@hono/zod-openapi` · Drizzle · Postgres + PostGIS · Zod · pino · OpenTelemetry · varlock · Biome · Vitest · React · Vite · TanStack Router · Mantine

## Docs

- [LICENSE](./LICENSE)
