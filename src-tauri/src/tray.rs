// The tray (Windows) / menu bar (macOS) icon and its menu:
//   Wallpaper ▸        jellyfish / big jellyfish / paw prints (one ticked)
//   Pause              stop every wallpaper (no CPU) until unticked
//   Pause when fullscreen / Pause on battery   the automatic pause rules (saved)
//   Start at login
//   Settings…          the AfterGlow window: pick a wallpaper and its options
//   Quit AfterGlow

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::host::{self, Host};
use crate::settings::{self, WALLPAPERS};

/// The Wallpaper submenu's items, kept so their ticks can follow changes made
/// in the Settings window (sync).
#[derive(Default)]
pub struct TrayItems(Mutex<Vec<(String, CheckMenuItem<Wry>)>>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let saved = app.state::<Host>().settings.lock().unwrap().clone();

    let walls: Vec<(String, CheckMenuItem<Wry>)> = WALLPAPERS
        .iter()
        .map(|(id, name)| {
            let item = CheckMenuItem::with_id(app, format!("wall:{id}"), *name, true, saved.wallpaper == *id, None::<&str>)?;
            Ok((id.to_string(), item))
        })
        .collect::<tauri::Result<_>>()?;
    let wall_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = walls.iter().map(|(_, item)| item as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let wallpaper_menu = Submenu::with_items(app, "Wallpaper", true, &wall_refs)?;

    let pause = CheckMenuItem::with_id(app, "pause", "Pause", true, false, None::<&str>)?;
    let fullscreen = CheckMenuItem::with_id(app, "pause-fullscreen", "Pause when an app is fullscreen", true, saved.pause_fullscreen, None::<&str>)?;
    let battery = CheckMenuItem::with_id(app, "pause-battery", "Pause on battery", true, saved.pause_on_battery, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start at login", true, autostart_on, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AfterGlow", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &wallpaper_menu,
            &pause,
            &PredefinedMenuItem::separator(app)?,
            &fullscreen,
            &battery,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &open_settings,
            &quit,
        ],
    )?;

    app.manage(TrayItems(Mutex::new(walls)));

    let mut tray = TrayIconBuilder::with_id("afterglow").tooltip("AfterGlow").menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| {
        let id = event.id.as_ref();
        // Wallpaper ▸ <one>: switch, keeping that wallpaper's saved options
        if let Some(wall) = id.strip_prefix("wall:") {
            if let Err(e) = settings::choose(app, wall, None) {
                eprintln!("afterglow: {e}");
            }
            sync(app); // also re-ticks the item if it was clicked while already ticked
            return;
        }
        match id {
            // check items flip their own tick when clicked; we read it back
            "pause" => {
                app.state::<Host>().user_paused.store(pause.is_checked().unwrap_or(false), Ordering::Relaxed);
                host::apply_pause(app);
            }
            "pause-fullscreen" | "pause-battery" => {
                let host = app.state::<Host>();
                let snapshot = {
                    let mut s = host.settings.lock().unwrap();
                    s.pause_fullscreen = fullscreen.is_checked().unwrap_or(true);
                    s.pause_on_battery = battery.is_checked().unwrap_or(true);
                    s.clone()
                };
                settings::save(app, &snapshot);
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

/// Tick the wallpaper that's showing, untick the others.
pub fn sync(app: &AppHandle) {
    let current = app.state::<Host>().settings.lock().unwrap().wallpaper.clone();
    if let Some(items) = app.try_state::<TrayItems>() {
        for (id, item) in items.0.lock().unwrap().iter() {
            let _ = item.set_checked(*id == current);
        }
    }
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
        .inner_size(1040.0, 720.0)
        .min_inner_size(640.0, 480.0)
        .background_color(Color(0, 0, 0, 255))
        .build();
    if let Err(e) = built {
        eprintln!("afterglow: could not open settings: {e}");
    }
}
