//! In-app updates (Tauri's updater plugin).
//!
//! Half a minute after starting, and then once a day, AfterGlow asks GitHub
//! for latest.json (attached to every release by release.yml). A newer
//! version is downloaded in the background and its signature checked against
//! the public key in tauri.conf.json. Nothing is installed until you click
//! "0.1.2 is ready: restart to update" in the tray menu or Settings → general.
//!
//! Off when: the setting is off, a debug build, no public key in the config,
//! or the Microsoft Store's package (the Store updates that one).

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::host::{self, Host};
use crate::settings;

const FIRST_CHECK: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// The loop looks at the clock this often, so a laptop that slept through a
/// check catches up soon after waking.
const TICK: Duration = Duration::from_secs(60);
pub const MENU_ID: &str = "update";

#[derive(Default)]
pub struct Updates {
    /// What Settings shows
    status: Mutex<Status>,
    /// A checked download, waiting for the click
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// The tray menu, and the update line once it has been added to it
    menu: Mutex<Option<Menu<Wry>>>,
    line: Mutex<Option<MenuItem<Wry>>>,
    /// A check or download is going on
    busy: AtomicBool,
}

#[derive(Serialize, Clone, Default)]
pub struct Status {
    /// "idle", "checking", "downloading", "ready", "latest", "error", "off"
    state: &'static str,
    /// The version that's ready or downloading
    version: String,
    text: String,
}

/// The tray line and Settings' text once an update is ready
fn ready_text(version: &str) -> String {
    format!("{version} is ready: restart to update")
}

/// Why updates are off in this copy whatever the setting says, if they are.
fn unavailable(app: &AppHandle) -> Option<&'static str> {
    if cfg!(debug_assertions) {
        return Some("off in development builds");
    }
    if std::env::current_exe().is_ok_and(|p| p.to_string_lossy().contains("\\WindowsApps\\")) {
        return Some("the Microsoft Store updates this copy");
    }
    let key = app.config().plugins.0.get("updater").and_then(|c| c.get("pubkey")).and_then(|k| k.as_str()).unwrap_or("");
    if key.is_empty() {
        return Some("this build has no update key");
    }
    None
}

fn set_status(app: &AppHandle, state: &'static str, version: &str, text: impl Into<String>) {
    *app.state::<Updates>().status.lock().unwrap() = Status { state, version: version.into(), text: text.into() };
}

/// Called by tray::build: the menu the update line goes into.
pub fn set_menu(app: &AppHandle, menu: Menu<Wry>) {
    *app.state::<Updates>().menu.lock().unwrap() = Some(menu);
}

pub fn start(app: &AppHandle) {
    if let Some(why) = unavailable(app) {
        crate::alog!("afterglow: updates: {why}");
        set_status(app, "off", "", why);
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK);
        let mut last: Option<SystemTime> = None;
        loop {
            // elapsed() is an error when the clock was set back: check then too
            let due = last.is_none_or(|t| t.elapsed().map_or(true, |d| d >= EVERY));
            if due && app.state::<Host>().settings.lock().unwrap().check_updates {
                last = Some(SystemTime::now());
                check(&app);
            }
            thread::sleep(TICK);
        }
    });
}

/// Ask for a newer version and download it. Blocks: call from a thread.
fn check(app: &AppHandle) {
    let state = app.state::<Updates>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let have = state.ready.lock().unwrap().as_ref().map(|(u, _)| u.version.clone());
    if have.is_none() {
        set_status(app, "checking", "", "checking…");
    }
    match tauri::async_runtime::block_on(fetch(app, have.as_deref())) {
        Ok(Some((update, bytes))) => {
            let version = update.version.clone();
            crate::alog!("afterglow: updates: {version} downloaded and verified ({} bytes)", bytes.len());
            *state.ready.lock().unwrap() = Some((update, bytes));
            set_status(app, "ready", &version, ready_text(&version));
            show_line(app, &version);
        }
        Ok(None) if have.is_none() => {
            crate::alog!("afterglow: updates: up to date");
            set_status(app, "latest", "", "you have the latest version");
        }
        Ok(None) => {}
        Err(e) => {
            crate::alog!("afterglow: updates: {e}");
            // an update that's already waiting is still good
            if have.is_none() {
                set_status(app, "error", "", "couldn't check for updates (it tries again tomorrow; the log says why)");
            }
        }
    }
    state.busy.store(false, Ordering::SeqCst);
}

/// The newer version and its verified bytes; None when there's none, or when
/// it's the one already waiting (`have`).
async fn fetch(app: &AppHandle, have: Option<&str>) -> Result<Option<(Update, Vec<u8>)>, String> {
    let a = app.clone();
    let updater = app
        .updater_builder()
        // Windows: installing ends the process without Tauri's exit event, so
        // the desktop is restored here
        .on_before_exit(move || {
            crate::alog!("afterglow: updates: closing for the installer");
            host::stop(&a);
        })
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { return Ok(None) };
    if have == Some(update.version.as_str()) {
        return Ok(None);
    }
    if have.is_none() {
        set_status(app, "downloading", &update.version, format!("downloading {}…", update.version));
    }
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    Ok(Some((update, bytes)))
}

/// Put the line at the top of the tray menu (or change its version).
fn show_line(app: &AppHandle, version: &str) {
    let (a, text) = (app.clone(), ready_text(version));
    // menus belong to the main thread
    let _ = app.run_on_main_thread(move || {
        let state = a.state::<Updates>();
        let mut line = state.line.lock().unwrap();
        if let Some(item) = line.as_ref() {
            let _ = item.set_text(&text);
            return;
        }
        let menu = state.menu.lock().unwrap();
        let Some(menu) = menu.as_ref() else { return };
        let added = (|| -> tauri::Result<MenuItem<Wry>> {
            let item = MenuItem::with_id(&a, MENU_ID, &text, true, None::<&str>)?;
            menu.insert(&item, 0)?;
            menu.insert(&PredefinedMenuItem::separator(&a)?, 1)?;
            Ok(item)
        })();
        match added {
            Ok(item) => *line = Some(item),
            Err(e) => crate::alog!("afterglow: updates: no tray line: {e}"),
        }
    });
}

/// Install what's waiting and restart. Windows: starts the installer, which
/// starts AfterGlow again; macOS: swaps the app, then restarts.
pub fn install(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        // taken, so a second click does nothing
        let Some((update, bytes)) = app.state::<Updates>().ready.lock().unwrap().take() else { return };
        crate::alog!("afterglow: updates: installing {}", update.version);
        match update.install(&bytes) {
            Ok(()) => app.request_restart(),
            Err(e) => {
                crate::alog!("afterglow: updates: installing failed: {e}");
                set_status(&app, "error", "", "the update couldn't be installed; the log says why");
                *app.state::<Updates>().ready.lock().unwrap() = Some((update, bytes));
            }
        }
    });
}

/// Settings → general: what the updater is doing
#[tauri::command]
pub fn update_state(app: AppHandle) -> Status {
    app.state::<Updates>().status.lock().unwrap().clone()
}

/// Settings → general: "check now" (works with the daily check off, too)
#[tauri::command]
pub fn check_update(app: AppHandle) {
    if unavailable(&app).is_none() {
        thread::spawn(move || check(&app));
    }
}

/// Settings → general: "restart to update"
#[tauri::command]
pub fn install_update(app: AppHandle) {
    install(&app);
}

/// Settings → general: the daily check on or off
#[tauri::command]
pub fn set_check_updates(app: AppHandle, on: bool) {
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.check_updates = on;
        s.clone()
    };
    settings::save(&app, &snapshot);
}
