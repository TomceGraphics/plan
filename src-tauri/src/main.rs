// Plan — minimal Rust backend.
//
// Responsibilities (everything else lives in the Svelte frontend):
//   * SQLite (tauri-plugin-sql) with migrations
//   * single-instance + `--quick-add` CLI flag (Wayland-safe replacement for a global shortcut)
//   * window-state persistence
//   * optional system tray that degrades gracefully when no tray host exists (stock GNOME)

mod google;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

const QUICK_ADD_FLAG: &str = "--quick-add";

#[derive(Default)]
struct Flags {
    /// User preference: hide the window instead of quitting when it is closed.
    close_to_tray: AtomicBool,
    /// True only when the tray icon was created without error.
    tray_ok: AtomicBool,
    /// Set when the very first launch carried `--quick-add`; drained by the UI on mount.
    pending_quick_add: AtomicBool,
}

#[tauri::command]
fn set_close_to_tray(flags: State<'_, Flags>, enabled: bool) {
    flags.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn take_pending_quick_add(flags: State<'_, Flags>) -> bool {
    flags.pending_quick_add.swap(false, Ordering::SeqCst)
}

/// Whether a tray icon was registered. (On GNOME it may still be invisible without the
/// AppIndicator extension, which is why close-to-tray is opt-in.)
#[tauri::command]
fn tray_registered(flags: State<'_, Flags>) -> bool {
    flags.tray_ok.load(Ordering::SeqCst)
}

fn reveal(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Plan", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick add…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &quit])?;

    let mut builder = TrayIconBuilder::with_id("plan-tray")
        .tooltip("Plan")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => reveal(app),
            "quick" => {
                reveal(app);
                let _ = app.emit("quick-add", ());
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "google calendar sync columns",
            sql: include_str!("../migrations/002_google_sync.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

fn main() {
    let launched_with_quick_add = std::env::args().any(|a| a == QUICK_ADD_FLAG);

    tauri::Builder::default()
        // Must be the first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            reveal(app);
            if argv.iter().any(|a| a == QUICK_ADD_FLAG) {
                let _ = app.emit("quick-add", ());
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:plan.db", migrations())
                .build(),
        )
        .manage(Flags::default())
        .manage(google::GoogleState::default())
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            take_pending_quick_add,
            tray_registered,
            google::google_status,
            google::google_sign_in,
            google::google_cancel,
            google::google_sign_out,
            google::google_request
        ])
        .setup(move |app| {
            let flags = app.state::<Flags>();
            flags
                .pending_quick_add
                .store(launched_with_quick_add, Ordering::SeqCst);

            // A missing tray host must never stop the app from starting.
            let handle = app.handle().clone();
            let ok = catch_unwind(AssertUnwindSafe(|| build_tray(&handle).is_ok())).unwrap_or(false);
            flags.tray_ok.store(ok, Ordering::SeqCst);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let flags = window.state::<Flags>();
                // Only hide when the user opted in AND a tray exists; otherwise quit normally.
                if flags.close_to_tray.load(Ordering::SeqCst) && flags.tray_ok.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Plan");
}
