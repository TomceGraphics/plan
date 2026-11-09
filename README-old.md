# Plan

A fast, lightweight, **local-first calendar + task planner** for Fedora Linux (GNOME, Wayland).
No accounts required, no cloud, no AI, no paywall. Data lives in a local SQLite file; Google Calendar sync is an opt-in extra.

Stack: Tauri 2 (minimal Rust) · Svelte 5 (runes) + TypeScript + Vite · plain CSS variables ·
SQLite via `tauri-plugin-sql` (migrations in `src-tauri/migrations/`) · `date-fns` · `rrule`.

## Features

- **Day / week / month** views, 15-minute time grid, current-time line, ctrl+wheel to zoom hours
- **Events**: click-drag to create, drag to move, drag top/bottom edge to resize (15-min snap),
  overlap layout, editor popover, colour-coded calendars, recurring events (RRULE; "this event / all events")
- **Tasks**: sidebar list (virtualized), due dates, priorities, estimates, subtasks;
  **drag a task onto the calendar to time-block it**; completing the task completes the block and vice versa
- **Command palette** (`Ctrl+K`): fuzzy search over events, tasks and actions · **shortcuts sheet** (`?`)
- **Quick add** (`Q`): "Lunch with Ana tomorrow 12:30 for 1h", "Send invoice fri !2 ~30m"
- **Optional two-way Google Calendar sync** (off until you connect an account; see below)
- Undo (`Ctrl+Z`) for deletes, moves, completions, time-blocks
- Light/dark theme following the system (or forced in Settings)
- System tray that degrades gracefully; window size/position/maximised state persisted

### Keyboard

| Key | Action | Key | Action |
|---|---|---|---|
| `←` `→` | previous / next period | `T` | today |
| `↑` `↓` | scroll the time grid | `1` `2` `3` | day / week / month |
| `Q` | quick add | `N` | new event |
| `A` | new task | `[` | toggle sidebar |
| `Ctrl+K` | command palette | `?` | shortcuts |
| `Enter` / `Del` | open / delete selected event | `Ctrl+Z` | undo |
| `Ctrl+,` | settings | `Esc` | close / cancel drag |

## Install on Fedora (build from source)

```bash
# 1. System dependencies (Fedora 40+)
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file gcc gcc-c++ make \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel rpm-build pkgconf-pkg-config
sudo dnf group install -y "c-development"

# 2. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 3. Node.js (20+; Fedora ships a recent LTS)
sudo dnf install -y nodejs npm

# 4. Project
cd plan
npm install
npm run tauri dev                      # development, hot reload
npm run tauri build -- --bundles rpm   # release RPM
```

The RPM is written to `src-tauri/target/release/bundle/rpm/Plan-0.1.0-1.x86_64.rpm`. Install it with:

```bash
sudo dnf install ./src-tauri/target/release/bundle/rpm/Plan-0.1.0-1.x86_64.rpm
```

It installs `/usr/bin/plan`, a `.desktop` entry (app grid, with a "Quick add" action) and the icon set.

Other scripts: `npm run check` (svelte-check, fails on warnings), `npm run build` (frontend only),
`npm run selftest` (recurrence, layout, fuzzy search and quick-add parser tests),
`npm run icons` (regenerate PNG icons from `assets/logo.svg`; needs `librsvg2-tools`).

## Quick add from anywhere (Wayland-safe)

Wayland has no app-level global shortcuts, so Plan does not use the global-shortcut plugin. Instead,
running `plan --quick-add` hands off to the already-running instance (single-instance plugin), raises
the window and opens the quick-add box. If Plan is not running it starts and opens quick-add.

Bind it to a GNOME custom shortcut:

1. **Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts → +**
2. Name: `Plan quick add` · Command: `plan --quick-add` · Shortcut: e.g. `Super+Shift+A`

Or from a terminal:

```bash
P=/org/gnome/settings-daemon/plugins/media-keys
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['$P/custom-keybindings/plan/']"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$P/custom-keybindings/plan/ name 'Plan quick add'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$P/custom-keybindings/plan/ command 'plan --quick-add'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$P/custom-keybindings/plan/ binding '<Super><Shift>a'
```

(That `gsettings` form replaces any existing custom shortcuts list; use the Settings UI if you already have some.)
GNOME's focus-stealing prevention may occasionally show a "Plan is ready" notification instead of raising
the window; invoking the shortcut again or clicking the notification focuses it.

## Google Calendar (optional two-way sync)

Plan can read your Google calendars and push changes back. Nothing is contacted until you connect.
Because Plan has no server, you use **your own** (free) Google OAuth client — a one-time, 5-minute setup:

1. Open <https://console.cloud.google.com/>, create a project (any name).
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth platform): user type **External**, app name `Plan`,
   your email as support/developer contact. Add the scope `.../auth/calendar` (see/edit/share/delete calendars).
4. **Publish the app** (Publishing status → *In production*). This matters: while an app is in *Testing*, Google
   expires refresh tokens after **7 days**, which would force you to reconnect weekly. For personal use no
   verification is needed; at sign-in click *Advanced → Go to Plan (unsafe)* — that is Google's standard
   warning for unverified apps and refers to your own client.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: Desktop app.**
   Copy the **Client ID** and **Client secret**.
6. In Plan: **Settings → Google Calendar** → paste both → **Connect Google account**. Your browser opens, you approve,
   and the tab says Plan is connected.
7. In the same panel pick, for each Google calendar, **New Plan calendar** or an existing Plan calendar to link it to.

Optional — bake the client into your own build so the fields never appear:

```bash
PLAN_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com PLAN_GOOGLE_CLIENT_SECRET=xxxx \
  npm run tauri build -- --bundles rpm
```

**How it behaves**

- Sync runs on connect, on launch, ~6 s after you change something in a linked calendar, when the window regains focus
  (at most once a minute), every 5 minutes, and via the sync button in the sidebar / "Sync Google Calendar now" in the palette.
- Pull is incremental (Google sync tokens). Push only sends the fields Plan manages (title, notes, location, start/end,
  all-day, recurrence), so attendees, reminders, conferencing links etc. on Google events are never overwritten.
- Recurring series stay one event (RRULE + EXDATE). Instances you changed in Google arrive as separate events and the
  series skips the replaced instance; editing "this event" in Plan does the reverse.
- Conflicts: the newer edit wins (your local change is kept if it is newer than Google's `updated` time).
- Deleting an event in Plan deletes it on Google (and vice-versa). Undo (`Ctrl+Z`) works, including for synced events.
- Read-only Google calendars (subscribed, holidays, birthdays) are shown but cannot be edited from Plan.
- **Disconnect** or unlinking a calendar keeps all events locally as ordinary Plan events and stops syncing.
- Tasks and task completion are local to Plan (time-blocked tasks appear on Google as plain events).
- Tokens are stored in `~/.config/dev.plan.planner/google-token.json` (mode 0600) and are only ever handled by the
  Rust side; the web view never sees them. Disconnecting revokes the grant and deletes the file.
- Known limit: recurring events created in a *different time zone* than your computer expand on your local wall-clock
  time, so occurrences can differ by an hour across DST changes.

## System tray on GNOME

Stock GNOME has no tray. Plan registers a tray icon (Show / Quick add / Quit) but **never relies on it**:
closing the window quits unless you enable *Settings → System → Keep running in the tray*, which is
only offered when the tray registered. To actually see the icon install the AppIndicator extension:

```bash
sudo dnf install -y gnome-shell-extension-appindicator
gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com   # then log out/in if needed
```

(The RPM lists the extension as a *recommended* package.)

## Troubleshooting: blank / glitchy window

On some GPU/driver combinations WebKitGTK renders a blank or flickering window. Workaround:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 plan
# for dev:
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

To make it permanent for the app-grid launcher, copy the desktop file and edit `Exec`:

```bash
mkdir -p ~/.local/share/applications
cp /usr/share/applications/Plan.desktop ~/.local/share/applications/
sed -i 's|^Exec=|Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 |' ~/.local/share/applications/Plan.desktop
```

## Data

SQLite database `plan.db` in the app config directory (`~/.config/dev.plan.planner/`). Back it up by copying that file while the app is closed.
Schema changes ship as new files in `src-tauri/migrations/` registered in `main.rs`.

## Layout

```
src/lib/store.svelte.ts   reactive store, all mutations, undo
src/lib/sync.ts           Google Calendar sync engine (pure logic, tested with a fake server)
src-tauri/src/google.rs   OAuth (PKCE loopback) + Calendar API proxy, token file
src/lib/recur.ts          RRULE expansion (floating-UTC trick keeps wall-clock times across DST)
src/lib/components/       TimeGrid, MonthGrid, editors, task list, palette, quick add, settings…
src-tauri/src/main.rs     single-instance, --quick-add, tray, window-state, SQL migrations
src-tauri/capabilities/   Tauri 2 permission set
packaging/plan.desktop    desktop-file template used by the RPM bundler
PLAN.md / PROGRESS.md     architecture notes and build checklist
```
