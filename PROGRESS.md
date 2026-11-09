# Progress checklist

- [x] Environment probe (node ok, rust via apt rustc-1.91, webkit dev libs via apt)
- [x] Project config (package.json, vite, svelte, tsconfig)
- [x] Logo + icon set + .desktop template
- [x] Rust backend + capabilities + migrations
- [x] Core libs (types, sql, db, time, recur, layout, fuzzy, quickparse)
- [x] Store + UI state
- [x] CSS theme + Icon set
- [x] Time grid (day/week) + month grid
- [x] Event editor + scope dialog
- [x] Tasks sidebar (virtualized) + task editor + drag-to-time-block
- [x] Command palette, shortcuts sheet, quick add, settings, toasts
- [x] svelte-check clean, vite build clean, selftest
- [x] cargo check clean (and release build / RPM if feasible)
- [x] README
- [x] Zip → /mnt/user-data/outputs

## Verification log
- `npm run check`: 0 errors, 0 warnings · `npm run build`: clean · `npm run selftest`: passes
- `cargo check` (dev) and full `cargo build --release` + RPM bundle (`tauri build --bundles rpm`) succeeded on Ubuntu 24.04 / rustc 1.91
- SQL statements + migration exercised against real SQLite
- UI exercised in real WebKitGTK 2.52 (Xvfb): quick-add, drag-create, resize, task→calendar time-block,
  complete-sync, recurrence, undo, palette, themes, settings
- Release binary run: DB created + migrated, calendars persisted, second `plan --quick-add` hands off and exits 0

## Round 2 — fixes + Google Calendar sync
- [x] Built-app bug: all-day row misaligned (grid rows 24px < cell min-height 28px → hidden scrollbar shrank the row). Fixed; measured equal widths in WebKitGTK.
- [x] Built-app bug: blurry popover (fractional `translate()` + `will-change` ⇒ composited layer resampled). Popover/dialogs/toasts now use whole-pixel left/top or margin:auto; `will-change` only on elements while being dragged; hour labels no longer use translateY(-50%). DOM audit: 0 fractional transforms at rest.
- [x] Migration 002 (Google columns + sync_deletions), tested as an upgrade of a populated v1 DB
- [x] src/lib/sync.ts engine + fake-Google selftests (incremental sync, exceptions/EXDATE, 410 resync, conflicts, PATCH keeps remote-only fields, read-only, 401)
- [x] src-tauri/src/google.rs: PKCE loopback OAuth, refresh, narrow Calendar proxy, 0600 token file (+ mock-server tests)
- [x] Settings UI, sidebar sync button, palette action, README setup guide
