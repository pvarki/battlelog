# BattleLog

Event log for PVARKI's situational-awareness stack: Hono + Drizzle backend (`server/`), React SPA (`web/`), one pnpm workspace. Read `README.md` for setup.

## Verify before claiming done

```bash
pnpm check        # Biome lint + format (whole repo)
pnpm typecheck    # tsc --noEmit in every package
pnpm test         # Vitest in every package
npx prettier@3 --check "**/*.{md,yml,yaml}" --ignore-path .gitignore   # see below
```

**Biome does not format Markdown or YAML — Prettier does**, via a pre-commit
hook (`.pre-commit-config.yaml`, `files: \.(yml|yaml|md)$`). So a green
`pnpm check` says nothing about a README edit, and CI fails the whole publish on
it. `pnpm-lock.yaml` is excluded from the hook and will always warn; ignore it.

**Server tests are integration tests against the local compose DB.** When the DB is down they skip with a warning locally (CI fails instead) — a green run without `docker compose up -d db` proves nothing about server code.

## DB changes

Edit the feature's `*.dbSchema.ts` → `pnpm -C server db:generate` → `pnpm -C server db:migrate`. Never hand-edit generated migrations.

## Invariants

- Events are **append-only version chains**: PATCH creates a new version; a concurrent PATCH loses to the `update_for` unique constraint and returns 409.
- Routes mount under both `/api` and `/api/v1`; keep both live.
- `routes/<feature>/<feature>.apiSchema.ts` (Zod) is the OpenAPI source of truth.
