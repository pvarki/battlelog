# web/

Vite + React SPA (TanStack Router, Mantine, dark-only theme). Desktop-only: 1280px+ is the design target, mobile is intentionally unsupported.

React Compiler is enabled (`babel-plugin-react-compiler` in `vite.config.ts`): don't add `useMemo`/`useCallback`/`memo` for render performance, and don't name plain functions `use*` — the compiler treats them as hooks.

## Widget system

- The registry auto-discovers `src/widgets/*/widget.ts` via `import.meta.glob` — a new widget is one folder (descriptor with a `.strict()` Zod config schema, lazy `View.tsx` / `Config.tsx`, `widget.test.ts`), no registration step. Copy an existing widget.
- Descriptors load eagerly at startup: keep heavy deps (mathjs etc.) out of `widget.ts`, import them only in the lazy View/Config chunks.
- Config schemas include optional `title: z.string().max(100)` — the wrapper renders it for every widget.

## Invariants

- **Config forms persist every keystroke**, so mid-edit configs may be schema-invalid. They must round-trip through the settings drawer untouched — never fall back to `defaultConfig` on invalid input (that wipes the user's config). Use the shared `TitleInput` for titles.
- **Event-backed widgets must use `useEventDocument`** (`src/dashboard/useEventDocument.ts`) for load/save/SSE/retry. Never hand-roll the save machinery — the todo widget once did, diverged, and silently lost remote edits.

## Tests

`pnpm -C web test` — pure Vitest, no DB needed. Widget logic tests live next to the widget as `widget.test.ts`.
