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

- [x] **5. Dashboard canvas.** DONE. Undo/redo in `dashboard/history.ts` —
      config edits coalesce per widget, edit-mode gated, text fields excluded,
      visible buttons, session-scoped. Layout coalescing was removed once the
      library showed one drag emits one usable `onLayoutChange`. Placement now
      uses `dashboard/placement.ts` (`firstFreeSlot`), which fixed a real bug —
      the old clamp silently stacked a widget on top of another once content
      passed row `24 - h` — and made widgets tile instead of piling at `x: 0`.
      Add-widget menu stays open across picks. Full canvas refuses with a
      notification instead of stacking.
      NOT DONE (deliberate): per-descriptor icons (spreads across 9 widget
      folders); drag-from-palette (`dropConfig` makes it viable, but free-slot
      tiling took most of its value); menu search/grouping (revisit ~15 widgets).
- [~] **6. Event Explorer.** Shell DONE — full-height workspace, active-filter
      chips, filter drawer, header search that debounce-applies, `event-filters.ts`
      extracted and tested. Column overflow DONE — `tags` and `location` are
      unbounded free text in the DB (`text("tags").array()`, `text("location")`,
      and nothing in the Zod schema caps them either), and under the old
      auto-layout table one verbose row set the width of every column. The table
      is now `layout="fixed"` with declared widths, so a long value ellipsizes in
      its own column instead of stealing a neighbour's; `Header`, `Type`,
      `Location` and `By` were all unbounded too and got the same treatment. Tags
      render as badges — first two plus a `+N` count — with the full list in the
      title tooltip and the detail drawer. Verified at 1280px (the guarded
      minimum) against a deliberately pathological row.
      STILL TO DO: sortable columns; Admiralty as a designed component rather
      than `join("")` (the capture path is fully wired, so this is presentation
      work).
- [~] **7. Shell & navigation.** Error + not-found screens DONE — shared
      `Placeholder`, registered as router defaults so new routes inherit them, and
      rendered inside the layout so the header nav stays as a way out. A 404 on the
      dashboard route throws `notFound()` (a stale link to a deleted dashboard is
      the likeliest failure there). Connection indicator landed in slice 2.
      STILL TO DO: the too-narrow-screen guard is a dead end that says what is
      wrong but not what to do; the header doesn't show which dashboard you are in.
- [~] **12. Dashboards landing page.** (Numbered by discovery, not priority — it
      surfaced after the first eleven were written.) Three defects, two fixed.
      (a) Templates were rendered as *peers* of dashboards: own `Title order={3}`
      section, identical `Paper`, identical meta line — so a template named
      "Soldier" sat directly below a dashboard named "Soldier" with nothing to
      tell them apart. A template is a starting point, not a destination, so it
      no longer appears in a list of places you can go: the `New` control is a
      menu (Empty / From template / Import / Manage templates…), and template
      housekeeping lives in a modal. FIXED.
      (b) The page was ~60% dead space, and a situational-awareness product whose
      landing page shows no situation is the wrong first screen. Now a ⅓ / ⅔
      split: the list left, `Latest activity` right — the newest 40 events, live.
      It reuses the feed widget's `FeedTable`, so a row arriving here washes with
      the same animation it does inside a dashboard, and the SSE connection was
      already held open on this route by the header indicator. FIXED.
      (c) Rows carried two facts, a widget count and a timestamp, neither of
      which helps you choose. Dashboards now have a `description` — new nullable
      column, in create/patch/export/import and in seeded template files — edited
      from the row menu (`Name & description…`), shown under the name in the list
      and under each template in the New menu. FIXED.
      NOT DONE (deliberate): a widget-type list per row (a count plus a
      description says enough); relative "updated 4 min ago" (its own helper and
      test, and the house timestamp dialect is a settled decision); making the
      whole card clickable (it would nest a link inside a click target, which is
      exactly the a11y defect slice 10 already records); any "N events today"
      counter — there is no count endpoint, and a number derived from a
      `limit`-capped page would be a lying stat.
      Templates cannot be renamed from the list on purpose: the seeding upsert is
      keyed on name, so a rename would let the next boot re-seed the original as
      a second template.
      TEMPLATE FLOW, second pass — the whole thing now runs through one dialog
      that asks for a name, because both directions were producing
      indistinguishable rows or dead ends:
      - Using a template inherited its name verbatim, so a copy of "Soldier"
        landed next to "Soldier". `From template…` opens a picker (radio cards
        showing name, description, widget count) with an editable name below it.
        Switching template re-suggests its name but never overwrites one you
        typed. A single template pre-picks, so the common case stays one click.
      - `Save as template…` reused the dashboard's name, which collided with the
        seeded template of the same name — and that collision surfaced as HTTP
        **500** plus "Save as template failed — try again", a retry that could
        never work. `createDashboard` now maps the unique violation to a typed
        `DuplicateTemplateNameError`, the route returns 409, and the dialog stays
        open showing the server's message next to the field that fixes it.
      - Saving a template carried the source board's `eventId`s, so every
        dashboard made from it wrote into the *original's* notes, checklists and
        tables rather than its own. `forkWidgets` (in `dashboard/transfer.ts`)
        strips the pointer — `useEventDocument` mints a fresh chain when it is
        absent. Applied on export too, where the import dialog's own copy
        ("contents … don't travel with the file") was otherwise false for an
        import back into the same deployment.
      STILL OPEN: `Duplicate` has the same shared-document problem that
      save-as-template did — the copy points at the original's chains. It almost
      certainly wants `forkWidgets` too, but that is a behaviour change on a path
      nobody asked about, so it is recorded rather than done.

## Finish

- [ ] **8. Widget-by-widget pass.** Apply foundations per folder. `table/View.tsx`
      (441 lines) and `form/Config.tsx` (279) are worth splitting on the way through.
- [~] **9. Motion.** Rule: motion marks a state *change*, never a state
      *condition* — a badge that pulses forever is noise in a minute and harmful
      on a wall display. Both animations live in `global.css`, run once, and
      loop never.
      DONE: (a) a widget added to the canvas fades and scales in at its slot,
      150ms — `firstFreeSlot` picks the slot rather than the user, so "where did
      it land?" is a question the UI created and has to answer. Driven by an
      `enteringId` in `DashboardGrid` and an `entering` prop on `WidgetWrapper`;
      never cleared, because a CSS animation is one-shot per mount. (b) a row
      arriving on the live SSE stream washes accent-9 and decays, 800ms —
      `useLiveEvents` now returns `arrived`, the row ids that came from the
      stream rather than the initial fetch, pruned to the rows still listed by
      `markArrived` so the set stays bounded by `limit`. Keyed on row id, so a
      new *version* of a visible event counts as an arrival too.
      Budget: 150ms for the widget, deliberately 800ms for the row wash — the
      120–200ms budget governs motion that gates interaction, and nothing waits
      on an arrival highlight, which has to survive a glance away.
      `prefers-reduced-motion` swaps the widget animation for a fade-only
      keyframe set (a colour or opacity fade is not a vestibular trigger, so
      reduced-motion users keep the information and lose only the movement).
      NOT DONE (deliberate): exit animation on widget removal — it needs a ghost
      element outliving the state that removed it, and delete already has a
      confirm. Undo/redo settle, and crossfading the save-state label: both are
      real but small, and neither is a question the UI created. Skipped on
      principle: page transitions (they make navigation feel slower, always),
      hover motion, and staggered list entrances.
- [!] **10. Accessibility. ACKNOWLEDGED, NOT PLANNED** — a deliberate call, recorded
      so it isn't rediscovered as a surprise. Note this accepts a gap against design
      principle 4 ("keyboard-first, full keyboard operability"), so the principle and
      the product currently disagree; revisit if BattleLog is ever procured under a
      public-sector accessibility regime (EN 301 549 / the EU Web Accessibility
      Directive), which would make several of these mandatory rather than optional.

      What is already good: `aria-label` on every icon-only control, `role="status"`
      on save/stream state, `autoContrast` in the theme, a real `<button>` inside
      explorer table rows for keyboard users, and `VisuallyHidden` on the quiet
      connection indicator.

      Known open gaps, largest first:
      - The grid is mouse-only — `react-grid-layout` exposes no keyboard path, so
        composing a dashboard (the product's central act) cannot be done from the
        keyboard. This is the expensive one; it needs arrow-key nudge/resize on a
        focused widget in edit mode.
      - Status-board chips carry meaning in colour alone (principle 3 says pair it
        with label or shape).
      - Focus-ring contrast against `#1c2127` / `#2f343c` is unmeasured.
      - Explorer rows nest a clickable `<Table.Tr>` around an `<Anchor>`; the
        row-level target is invisible to assistive tech even though the inner
        button works.
      - Mantine's `Drawer` close button renders with no accessible name.
      - `window.confirm` for destructive deletes (accessible, just crude).

      The last four are each small if they're ever wanted; only the grid is real work.
- [~] **11. Character.** Tabular figures DONE — one inherited rule in `global.css`;
      measured 34px of per-tick jitter before, 0 after, and the clock dropped
      `ff="monospace"` so the type system has no exception left.
      STILL TO DO: HCoE domains promoted from `join(", ")`; Admiralty as a designed
      component (the capture path is fully wired end to end — DB enum, API, server
      filter, form-widget field kinds — so this really is presentation work, and it
      will light up as soon as a form uses those fields); microcopy in one voice.
