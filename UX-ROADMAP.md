# UX & visual roadmap

Working checklist for the UX/visual pass. Ordering is **inside-out**: shared
foundations first, then surfaces, then finish — so each slice makes the next
cheaper instead of re-litigating the same shared code from three angles.

Not a spec. One slice at a time: issue → decision → fix.

## Locked decisions

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

- [ ] **1. Icon & control vocabulary.** Replace glyph-as-icon with a real icon set.
      Rule: icon-only is permitted only where the action is also reachable by label.
- [ ] **2. Status & connection language.** Unify `useEventDocument`'s `DocStatus`
      (`idle|loading|waiting|saving|saved|error|stale|unavailable`) with
      `DashboardPage`'s parallel `SaveState`, and surface SSE health — currently
      invisible. *Stale but plausible* is the dangerous failure on a live display.
- [ ] **3. Empty / error / loading pattern.** Promote `WidgetWrapper.Placeholder`
      to shared. Empty states should teach, not just report absence.
- [ ] **4. Density & hierarchy scale.** Codify spacing in `theme.ts`; it sets type
      sizes but no spacing, so every file improvises.

## Surfaces

- [ ] **5. Dashboard canvas.** Undo/redo (leading — every edit autosaves in 800ms
      with no way back). Coalesce per gesture, not per keystroke: config edits by
      widget, drags by drag session, structural ops always push. Gate on edit mode;
      the keydown handler must ignore text inputs. Visible undo/redo buttons.
      Also: edit-mode discoverability, add-widget flow, full-canvas behaviour.
- [ ] **6. Event Explorer.** Active-filter chips (highest leverage — makes filter
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
