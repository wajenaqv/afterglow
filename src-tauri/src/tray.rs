// The tray (Windows) / menu bar (macOS) icon and its menu:
//   Pause              stop every wallpaper (no CPU) until unticked
//   Pause when fullscreen / Pause on battery   the automatic pause rules
//   Start at login
//   Settings…          the AfterGlow window (placeholder for now)
//   Quit AfterGlow

use std::sync::atomic::Ordering;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

use crate::host::{self, Host};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);

    let pause = CheckMenuItem::with_id(app, "pause", "Pause", true, false, None::<&str>)?;
    let fullscreen = CheckMenuItem::with_id(app, "pause-fullscreen", "Pause when an app is fullscreen", true, true, None::<&str>)?;
    let battery = CheckMenuItem::with_id(app, "pause-battery", "Pause on battery", true, true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start at login", true, autostart_on, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AfterGlow", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &pause,
            &PredefinedMenuItem::separator(app)?,
            &fullscreen,
            &battery,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("afterglow").tooltip("AfterGlow").menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| {
        let state = app.state::<Host>();
        match event.id.as_ref() {
            // check items flip their own tick when clicked; we read it back
            "pause" => {
                state.user_paused.store(pause.is_checked().unwrap_or(false), Ordering::Relaxed);
                host::apply_pause(app);
            }
            "pause-fullscreen" => {
                state.pause_fullscreen.store(fullscreen.is_checked().unwrap_or(true), Ordering::Relaxed);
                host::apply_pause(app);
            }
            "pause-battery" => {
                state.pause_on_battery.store(battery.is_checked().unwrap_or(true), Ordering::Relaxed);
                host::apply_pause(app);
            }
            "autostart" => {
                let on = autostart.is_checked().unwrap_or(false);
                let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
                if let Err(e) = result {
                    eprintln!("afterglow: start at login: {e}");
                }
            }
            "settings" => show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        }
    })
    .build(app)?;
    Ok(())
}

/// Opens the Settings window. It only exists while open: created here and
/// destroyed when closed, so it costs no memory the rest of the time
/// (a hidden webview still holds ~100 MB).
pub fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("AfterGlow")
        .inner_size(960.0, 600.0)
        .background_color(Color(0, 0, 0, 255))
        .build();
    if let Err(e) = built {
        eprintln!("afterglow: could not open settings: {e}");
    }
}
