# UX & visual roadmap

Working checklist for the UX/visual pass. Ordering is **inside-out**: shared
foundations first, then surfaces, then finish — so each slice makes the next
cheaper instead of re-litigating the same shared code from three angles.

Not a spec. One slice at a time: issue → decision → fix.

## Locked decisions

- **The Event Explorer is a workspace, not a form-over-table** — a map view is
  coming, so filters live in a drawer plus a chip row and the results area owns the
  viewport. When the map lands: a Table/Map/Split switcher, the 100-row page becomes
  misleading on a map (raise the limit or aggregate), events with no `locationPoint`
  must be counted and stated rather than silently dropped, and the tile source is a
  deployment decision (self-hosted/offline vs CDN) that drives MapLibre vs Leaflet.
  The existing `ST_DWithin` radius filter is already the right shape for a map and
  needs no server change.

- **Desk density only.** Ops-room wall display and mobile are both out of scope.
  Revisit when mobile is on the table (it brings its own questions).
- **Undo covers composition, not content.** Layout, widget config, add/remove/
  duplicate and the dashboard name flow through `DashboardGrid.persist()` and are
  undoable. Widget *content* (note text, todo checkmarks, table cells) lives in its
  own event chain via `useEventDocument` and is not. A stray ⌘Z must never un-tick
  someone's checklist.
- **Undo history is session-scoped and in-memory**, held in a ref inside
  `DashboardGrid`. Dashboards are a mutable row (`version` is a uuidv7 optimistic
  token, rewritten on every UPDATE) so the server keeps no history to restore from.
  Per-mount storage also makes "discard history on 409" free via the existing
  `key={id}:{version}` remount. Durable version history is a separate future
  feature, not undo.
- **Event Explorer keeps its Search button**; the fix is making draft-vs-applied
  state honest, not live-as-you-type. Geo queries are expensive.
- **Acceptance criterion on every slice:** could an untrained reservist get through
  this screen without asking someone?

## Foundations

- [x] **1. Icon & control vocabulary.** Done — `@tabler/icons-react`, 16 sites. Replace glyph-as-icon with a real icon set.
      Rule: icon-only is permitted only where the action is also reachable by label.
- [x] **2. Status & connection language.** Done — stream health surfaced, `SaveState` folded into `DocStatus`. Unify `useEventDocument`'s `DocStatus`
      (`idle|loading|waiting|saving|saved|error|stale|unavailable`) with
      `DashboardPage`'s parallel `SaveState`, and surface SSE health — currently
      invisible. *Stale but plausible* is the dangerous failure on a live display.
- [x] **3. Empty / error / loading pattern.** Done — shared `Placeholder`, `onConfigure` on the widget contract. Promote `WidgetWrapper.Placeholder`
      to shared. Empty states should teach, not just report absence.
- [~] **4. Density & hierarchy scale.** SKIPPED deliberately — measured, no defect. Widget body padding is already uniform at `p="xs"`; the 18 raw spacings are all sub-10px, below Mantine's `xs`, which is a legitimate gap in the token scale rather than drift. Retuning `theme.spacing` would silently reflow 60 call sites for no visible gain. Codify spacing in `theme.ts`; it sets type
      sizes but no spacing, so every file improvises.

## Surfaces

- [~] **5. Dashboard canvas.** Undo/redo DONE — `dashboard/history.ts`, coalescing
      per widget for config and per gesture for drags, edit-mode gated, text fields
      excluded, visible buttons, session-scoped. Drag coalescing is unit-tested but
      NOT browser-verified (synthetic and CDP drags don't drive react-grid-layout —
      needs one real mouse drag). STILL TO DO: add-widget flow, and full-canvas
      behaviour is still undefined.
- [~] **6. Event Explorer.** Shell DONE — full-height workspace, active-filter chips, filter drawer, header search that debounce-applies, `event-filters.ts` extracted and tested. STILL TO DO: sortable columns; unbounded `tags`/`location` will wreck the column grid on real data; Admiralty as a designed component (note: the column is empty on every row today, so capture may be the real gap). Active-filter chips (highest leverage — makes filter
      state readable and collapsing safe). Draft-vs-applied dirty indicator.
      Sortable columns. Unbounded `tags`/`location` will wreck the column grid.
      Admiralty code as a designed component, not `join("")`.
- [ ] **7. Shell & navigation.** No route has an `errorComponent` — the most common
      failure lands on TanStack's default screen. Connection indicator in the header.
      The too-narrow-screen guard is a dead end.

## Finish

- [ ] **8. Widget-by-widget pass.** Apply foundations per folder. `table/View.tsx`
      (441 lines) and `form/Config.tsx` (279) are worth splitting on the way through.
- [ ] **9. Motion.** Rule: motion marks a state *change*, never a state *condition* —
      a badge that pulses forever is noise in a minute and harmful on a wall display.
      120–200ms budget. Honor `prefers-reduced-motion` from the start.
      `feed/Fullscreen.tsx` already sets a precedent (`transition: "pop"`, 180ms).
- [ ] **10. Accessibility.** Largest item: the grid is mouse-only, so composing a
      dashboard — the product's central act — has no keyboard path. Also focus-ring
      contrast on the dark surfaces, status color needing label/shape pairing, the
      explorer's nested interactive table rows, and `window.confirm`.
- [ ] **11. Character.** Tabular figures wherever numbers change in place (cheapest
      high-impact item on this list; also lets the clock drop monospace and return to
      Inter). HCoE domains promoted from `join(", ")`. Microcopy in one voice.
