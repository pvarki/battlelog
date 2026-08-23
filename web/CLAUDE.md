# web/

Vite + React SPA (TanStack Router, Mantine, dark-only theme). Responsive: desktop (1024px+) gets the full grid/management UI; below that (and on landscape phones) every page renders a mobile layout — the gate is `useIsMobile()` / `MOBILE_QUERY` in `src/dashboard/mobile.ts`, mirrored in `global.css` for the font-size bumps. Dashboards on mobile render as the `MobileSwitcher` (one widget fullscreen, bottom bar); editing and management are desktop-only by construction.

React Compiler is enabled (`babel-plugin-react-compiler` in `vite.config.ts`): don't add `useMemo`/`useCallback`/`memo` for render performance, and don't name plain functions `use*` — the compiler treats them as hooks.

## Widget system

- The registry auto-discovers `src/widgets/*/widget.ts` via `import.meta.glob` — a new widget is one folder (descriptor with a `.strict()` Zod config schema, lazy `View.tsx` / `Config.tsx`, `widget.test.ts`), no registration step. Copy an existing widget.
- Descriptors load eagerly at startup: keep heavy deps (mathjs etc.) out of `widget.ts`, import them only in the lazy View/Config chunks.
- Every config schema MUST spread `...baseWidgetConfig` (from `registry.ts`: optional `title` + `showOnMobile`). The settings drawer writes `showOnMobile` into any widget's config, so a `.strict()` schema without it gets bricked by the toggle.
- Widget types that don't work on a phone set `showOnMobile: false` on the descriptor (see table).

## Invariants

- **Config forms persist every keystroke**, so mid-edit configs may be schema-invalid. They must round-trip through the settings drawer untouched — never fall back to `defaultConfig` on invalid input (that wipes the user's config). Use the shared `TitleInput` for titles.
- **Event-backed widgets must use `useEventDocument`** (`src/dashboard/useEventDocument.ts`) for load/save/SSE/retry. Never hand-roll the save machinery — the todo widget once did, diverged, and silently lost remote edits.

## Tests

`pnpm -C web test` — pure Vitest, no DB needed. Widget logic tests live next to the widget as `widget.test.ts`.
