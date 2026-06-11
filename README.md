# BattleLog

Event-logging backend for PVARKI's situational-awareness stack.

A Hono + Drizzle + TypeScript service for capturing, versioning, and querying geo-tagged hybrid-threat events. Built around a PostGIS-backed append-only event log with NATO Admiralty-Code reliability/credibility ratings and Hybrid CoE threat-domain tagging.

## Quickstart

Prerequisites: a tool-version manager ([mise](https://mise.jdx.dev/) or [asdf](https://asdf-vm.com/)) and Docker. Pinned versions live in [`.tool-versions`](./.tool-versions): Node 24, pnpm 11, [prek](https://github.com/j178/prek) 0.4 (a single-binary reimplementation of `pre-commit`).

```bash
mise install                    # or: asdf install
cp .env.schema .env             # adjust as needed
pnpm install
prek install                    # register git hooks
docker compose up -d db         # local Postgres + PostGIS
pnpm db:migrate
pnpm dev
```

Then open:

- API: <http://localhost:3000/api/v1/events>
- Swagger UI: <http://localhost:3000/api-docs> (enabled by default in dev)
- Health: <http://localhost:3000/healthz>

### Full stack via Docker

```bash
docker compose up --build       # app + db
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Watch-mode dev server |
| `pnpm build` / `pnpm start` | Compile and run from `dist/` |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm check` / `pnpm check:fix` | Biome lint + format |
| `pnpm db:generate` | Generate migration from schema diff |
| `pnpm db:migrate` | Apply migrations (ensures `postgis` extension) |
| `pnpm db:seed` | Seed dev data |
| `pnpm db:fake` | Continuously generate fake events |
| `pnpm db:studio` | Drizzle Studio |

## Configuration

All runtime config flows through [varlock](https://varlock.dev/) and is declared in [`.env.schema`](./.env.schema). Schema changes regenerate `src/env.d.ts` via `pnpm exec varlock typegen`. Notable knobs:

- `DATABASE_URL` — Postgres connection (defaults to the local compose DB in dev)
- `USE_SWAGGER` — Swagger UI exposure (on by default in dev)
- `BL_TRUST_PROXY_HOPS` — XFF parsing depth for rate-limit IP extraction
- `RM_API_ENABLED` + `RM_MTLS_*` — opt-in Rasenmaeher (RM) integration with mTLS
- `OTEL_EXPORTER_OTLP_ENDPOINT` — when set, boots the OTel SDK in prod

## Tech stack

Hono · `@hono/zod-openapi` · Drizzle · Postgres + PostGIS · Zod · pino · OpenTelemetry · varlock · Biome · Vitest

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — module layout, conventions, request flow, data model
- [LICENSE](./LICENSE)
