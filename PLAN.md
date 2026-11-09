# Plan — architecture

Local-first calendar + task planner for Fedora/GNOME (Wayland). Linux only.

## Stack
Tauri 2 (minimal Rust) · Svelte 5 runes + TypeScript + Vite · plain CSS variables ·
SQLite via `tauri-plugin-sql` (Rust-side migrations) · `date-fns` · `rrule`.

## Rust backend (`src-tauri/src/main.rs`, ~150 lines)
- Plugins: single-instance (first!), window-state, sql (+ migrations in `migrations/`).
- `plan --quick-add`: single-instance callback raises the window and emits `quick-add`.
  First launch with the flag stores `pending_quick_add`, which the UI drains on mount.
- Tray built inside `catch_unwind`; failure is non-fatal. `tray_ok` + `close_to_tray`
  atomics decide whether the close button hides or quits (never hides without a tray).
- Commands: `set_close_to_tray`, `take_pending_quick_add`.
- No global-shortcut plugin (not Wayland-safe).

## Data
SQLite tables: `calendars`, `events`, `tasks`, `settings`. Times are epoch-ms (UTC);
all-day events are local-midnight start, exclusive end. Recurrence is an RRULE string
(no DTSTART) + `exdates` JSON; expansion uses the "floating UTC" trick so wall-clock
times survive DST. Everything is loaded into memory at start (local-first); UI mutates
memory first (optimistic) and a serial queue writes through to SQLite.

## Frontend
- `lib/store.svelte.ts` — single reactive store (calendars/events/tasks/settings, view state,
  all mutations, undo stack). `lib/ui.svelte.ts` — transient UI state (popovers, palette, drag).
- `lib/recur.ts` expansion · `layout.ts` overlap columns · `fuzzy.ts` · `quickparse.ts`.
- Views: `TimeGrid` (day/week, hand-built CSS grid, pointer-event drag create/move/resize,
  15-min snap, now-line), `MonthGrid`. Tasks drag onto the grid via a pointer-driven ghost
  (no HTML5 DnD → reliable in WebKitGTK) and hit-test `[data-drop]` targets.
- Sidebar: mini month, calendars, virtualized task list. Overlays: event/task editors
  (popover), command palette, shortcuts sheet, quick add, settings, scope dialog, toasts.
- Perf rules: transitions ≤120 ms on transform/opacity only; no spinners for local data.

## Packaging
`tauri build --bundles rpm`; custom `.desktop` template with a "Quick add" action;
icon set generated from `assets/logo.svg` by `scripts/gen-icons.sh`.
