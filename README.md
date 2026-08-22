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

## Tech stack

Hono · `@hono/zod-openapi` · Drizzle · Postgres + PostGIS · Zod · pino · OpenTelemetry · varlock · Biome · Vitest · React · Vite · TanStack Router · Mantine

## Docs

- [LICENSE](./LICENSE)
