// The tray (Windows) / menu bar (macOS) icon and its menu:
//   0.1.2 is ready: restart to update   (only while an update waits, updates.rs)
//   Wallpaper ▸        every wallpaper (one ticked), and Rotate wallpapers
//   Try a signal ▸     the simulator (development builds only)
//   Pause ▸            pause now (stop every wallpaper, no CPU, until unticked),
//                      and the rules: hidden by windows, an app is
//                      fullscreen, on battery (only with a battery)
//   Keep awake ▸       why it's awake now, then off / 30 minutes / 1 hour /
//                      2 hours / until turned off
//   Settings…          the AfterGlow window
//   Quit AfterGlow
// Only what you'd change on the spot; what you set once (frame rate, Do Not
// Disturb, start at login) is in Settings.
// The tooltip names the wallpaper that's showing.

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::host::{self, Host};
use crate::settings::{self, Settings, WALLPAPERS};
use crate::signals::{self, Signal};

const TRAY_ID: &str = "afterglow";

/// The menu's radio-style items, kept so their ticks can follow changes made
/// in the Settings window (sync).
#[derive(Default)]
pub struct TrayItems {
    walls: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
    awake: Mutex<Vec<(&'static str, CheckMenuItem<Wry>)>>,
    rotate: Mutex<Option<CheckMenuItem<Wry>>>,
    /// Pause ▸, by menu id
    pause: Mutex<Vec<(&'static str, CheckMenuItem<Wry>)>>,
    awake_line: Mutex<Option<AwakeLine>>,
}

/// The line on top of Keep awake ▸, only there while there's something to say
struct AwakeLine {
    menu: Submenu<Wry>,
    line: MenuItem<Wry>,
    separator: PredefinedMenuItem<Wry>,
    shown: bool,
}

/// Try a signal ▸: (label, signal). "waiting" adds 3 to the simulator's own
/// count, "nothing waiting" clears it.
const TRIES: &[(&str, &str)] = &[
    ("WhatsApp message", r#"{"source":"whatsapp","kind":"new"}"#),
    ("Gmail email", r#"{"source":"gmail","kind":"new"}"#),
    ("Slack message", r#"{"source":"slack","kind":"new"}"#),
    ("3 more waiting", "waiting+3"),
    ("Nothing waiting", "waiting=0"),
    ("Flash", r#"{"source":"simulator","kind":"flash"}"#),
];
static SIM_WAITING: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

fn try_signal(_app: &AppHandle, what: &str) -> Option<Signal> {
    let n = match what {
        "waiting+3" => SIM_WAITING.fetch_add(3, Ordering::Relaxed) + 3,
        "waiting=0" => {
            SIM_WAITING.store(0, Ordering::Relaxed);
            0
        }
        json => return serde_json::from_str(json).ok(),
    };
    let json = if n == 0 { r#"{"source":"simulator","kind":"clear"}"#.to_string() } else { format!(r#"{{"source":"simulator","kind":"unread","count":{n}}}"#) };
    serde_json::from_str(&json).ok()
}

fn tooltip(s: &Settings) -> String {
    let name = WALLPAPERS.iter().find(|(id, _)| *id == s.wallpaper).map(|(_, name)| *name).unwrap_or("AfterGlow");
    format!("AfterGlow · {name}")
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let saved = app.state::<Host>().settings.lock().unwrap().clone();

    let walls: Vec<(String, CheckMenuItem<Wry>)> = WALLPAPERS
        .iter()
        .map(|(id, name)| Ok((id.to_string(), CheckMenuItem::with_id(app, format!("wall:{id}"), *name, true, saved.wallpaper == *id, None::<&str>)?)))
        .collect::<tauri::Result<_>>()?;
    let wall_refs: Vec<&dyn IsMenuItem<Wry>> = walls.iter().map(|(_, i)| i as &dyn IsMenuItem<Wry>).collect();
    let wallpaper_menu = Submenu::with_items(app, "Wallpaper", true, &wall_refs)?;
    let rotate = CheckMenuItem::with_id(app, "rotate", "Rotate wallpapers", true, saved.rotate.on, None::<&str>)?;
    wallpaper_menu.append_items(&[&PredefinedMenuItem::separator(app)?, &rotate])?;
    let awake: Vec<(&'static str, CheckMenuItem<Wry>)> = crate::awake::CHOICES
        .iter()
        .map(|(id, name)| Ok((*id, CheckMenuItem::with_id(app, format!("awake:{id}"), *name, true, *id == "off", None::<&str>)?)))
        .collect::<tauri::Result<_>>()?;
    let awake_refs: Vec<&dyn IsMenuItem<Wry>> = awake.iter().map(|(_, i)| i as &dyn IsMenuItem<Wry>).collect();
    let awake_menu = Submenu::with_items(app, "Keep awake", true, &awake_refs)?;
    let awake_line = AwakeLine {
        menu: awake_menu.clone(),
        line: MenuItem::with_id(app, "awake-line", "", false, None::<&str>)?,
        separator: PredefinedMenuItem::separator(app)?,
        shown: false,
    };
    // Try a signal ▸ the simulator, from the tray so nothing covers the wallpaper
    let tries: Vec<MenuItem<Wry>> = TRIES
        .iter()
        .enumerate()
        .map(|(i, (label, _))| MenuItem::with_id(app, format!("try:{i}"), *label, true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let try_refs: Vec<&dyn IsMenuItem<Wry>> = tries.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let try_menu = Submenu::with_items(app, "Try a signal", true, &try_refs)?;

    let pause = CheckMenuItem::with_id(app, "pause", "Pause now", true, false, None::<&str>)?;
    let covered = CheckMenuItem::with_id(app, "pause-covered", "When hidden by windows", true, saved.pause_covered, None::<&str>)?;
    let fullscreen = CheckMenuItem::with_id(app, "pause-fullscreen", "When an app is fullscreen", true, saved.pause_fullscreen, None::<&str>)?;
    let on_battery = if cfg!(target_os = "macos") { "On battery or in Low Power Mode" } else { "On battery" };
    let battery = CheckMenuItem::with_id(app, "pause-battery", on_battery, true, saved.pause_on_battery, None::<&str>)?;
    let pause_menu = Submenu::with_items(app, "Pause", true, &[&pause, &PredefinedMenuItem::separator(app)?, &covered, &fullscreen])?;
    if crate::platform::has_battery() {
        pause_menu.append(&battery)?;
    }
    let open_settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AfterGlow", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&wallpaper_menu, &pause_menu, &awake_menu, &PredefinedMenuItem::separator(app)?, &open_settings, &quit])?;
    if cfg!(debug_assertions) {
        menu.insert(&try_menu, 1)?;
    }

    crate::updates::set_menu(app, menu.clone());
    app.manage(TrayItems {
        walls: Mutex::new(walls),
        awake: Mutex::new(awake),
        rotate: Mutex::new(Some(rotate.clone())),
        pause: Mutex::new(vec![("pause", pause.clone()), ("pause-covered", covered.clone()), ("pause-fullscreen", fullscreen.clone()), ("pause-battery", battery.clone())]),
        awake_line: Mutex::new(Some(awake_line)),
    });
    sync(app); // Keep awake's "Off" depends on the saved apps

    let mut tray = TrayIconBuilder::with_id(TRAY_ID).tooltip(tooltip(&saved)).menu(&menu).show_menu_on_left_click(true);
    // The AG logo made for small sizes (scripts/icon.js): green on a black
    // plate on Windows; a black template image on macOS, recoloured by the
    // menu bar for light and dark mode
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(Image::from_bytes(include_bytes!("../icons/tray/mac/tray.png"))?).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        tray = tray.icon(Image::from_bytes(include_bytes!("../icons/tray/win/32x32.png"))?);
    }
    tray.on_menu_event(move |app, event| {
        let id = event.id.as_ref();
        // Wallpaper ▸ <one>: switch, keeping that wallpaper's saved options
        if let Some(wall) = id.strip_prefix("wall:") {
            if let Err(e) = settings::choose(app, wall, None) {
                crate::alog!("afterglow: {e}");
            }
            sync(app); // also re-ticks the item if it was clicked while already ticked
            return;
        }
        // Try a signal ▸ <one>
        if let Some(i) = id.strip_prefix("try:").and_then(|n| n.parse::<usize>().ok()) {
            if let Some((_, json)) = TRIES.get(i) {
                if let Some(sig) = try_signal(app, json) {
                    if let Err(e) = signals::handle_test(app, sig) {
                        crate::alog!("afterglow: {e}");
                    }
                }
            }
            return;
        }
        // Keep awake ▸ <one>
        if let Some(choice) = id.strip_prefix("awake:") {
            if let Err(e) = crate::awake::choose(app, choice) {
                crate::alog!("afterglow: {e}");
            }
            return;
        }
        match id {
            // check items flip their own tick when clicked; we read it back
            "pause" => {
                app.state::<Host>().user_paused.store(pause.is_checked().unwrap_or(false), Ordering::Relaxed);
                host::apply_pause(app);
            }
            "pause-covered" | "pause-fullscreen" | "pause-battery" => {
                let host = app.state::<Host>();
                let snapshot = {
                    let mut s = host.settings.lock().unwrap();
                    s.pause_covered = covered.is_checked().unwrap_or(true);
                    s.pause_fullscreen = fullscreen.is_checked().unwrap_or(true);
                    s.pause_on_battery = battery.is_checked().unwrap_or(true);
                    s.clone()
                };
                settings::save(app, &snapshot);
                host::apply_pause(app);
            }
            "rotate" => {
                let r = app.state::<Host>().settings.lock().unwrap().rotate.clone();
                if let Err(e) = crate::extras::set_rotation(app.clone(), rotate.is_checked().unwrap_or(false), r.minutes, r.walls) {
                    crate::alog!("afterglow: {e}");
                }
            }
            crate::updates::MENU_ID => crate::updates::install(app),
            "settings" => show_settings(app),
            "quit" => {
                crate::alog!("afterglow: quit from the tray");
                app.exit(0)
            }
            _ => {}
        }
    })
    .build(app)?;
    Ok(())
}

/// Bring the menu and the tooltip in step with what's set. Always on the main
/// thread: menu changes from another thread wait for it, so two threads here
/// at once could wait for each other.
pub fn sync(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || sync_here(&a));
}

fn sync_here(app: &AppHandle) {
    let s = app.state::<Host>().settings.lock().unwrap().clone();
    if let Some(items) = app.try_state::<TrayItems>() {
        for (id, item) in items.walls.lock().unwrap().iter() {
            let _ = item.set_checked(*id == s.wallpaper);
        }
        if let Some(item) = items.rotate.lock().unwrap().as_ref() {
            let _ = item.set_checked(s.rotate.on);
        }
        let choice = app.state::<crate::awake::Keeper>().choice();
        for (id, item) in items.awake.lock().unwrap().iter() {
            let _ = item.set_checked(*id == choice);
        }
        for (id, item) in items.pause.lock().unwrap().iter() {
            let on = match *id {
                "pause-covered" => s.pause_covered,
                "pause-fullscreen" => s.pause_fullscreen,
                "pause-battery" => s.pause_on_battery,
                _ => app.state::<Host>().user_paused.load(Ordering::Relaxed),
            };
            let _ = item.set_checked(on);
        }
        if let Some((_, off)) = items.awake.lock().unwrap().first() {
            let _ = off.set_text(if s.awake.apps.is_empty() { "Off" } else { "Only for chosen apps" });
        }
        if let Some(l) = items.awake_line.lock().unwrap().as_mut() {
            let text = app.state::<crate::awake::Keeper>().line();
            if let Some(text) = &text {
                // in a menu, & underlines the next letter; && is a plain one
                let _ = l.line.set_text(text.replace('&', "&&"));
            }
            if text.is_some() && !l.shown {
                let _ = l.menu.insert_items(&[&l.line, &l.separator], 0);
            } else if text.is_none() && l.shown {
                let _ = l.menu.remove(&l.line);
                let _ = l.menu.remove(&l.separator);
            }
            l.shown = text.is_some();
        }
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip(&s)));
    }
}

/// Settings → power and apps: the pause rules (also in the tray), quiet
#[tauri::command]
pub fn set_pausing(app: AppHandle, covered: bool, fullscreen: bool, battery: bool, quiet_dnd: bool) {
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.pause_covered = covered;
        s.pause_fullscreen = fullscreen;
        s.pause_on_battery = battery;
        s.quiet_dnd = quiet_dnd;
        s.clone()
    };
    settings::save(&app, &snapshot);
    host::apply_pause(&app);
    sync(&app);
}

/// Settings → general: start at login (read and set)
#[tauri::command]
pub fn autostart_state(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<bool, String> {
    let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
    result.map_err(|e| e.to_string())?;
    Ok(app.autolaunch().is_enabled().unwrap_or(on))
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
    let theme = app.state::<Host>().settings.lock().unwrap().theme.clone();
    let built = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("AfterGlow")
        .inner_size(1040.0, 760.0)
        .min_inner_size(640.0, 480.0)
        // one of settings.rs THEMES, so it needs no escaping; read by index.html
        .initialization_script(format!("window.__AFTERGLOW_THEME__ = \"{theme}\";"))
        .background_color(settings_background(&theme))
        .build();
    match built {
        // Windows: the taskbar button needs the big icon too
        #[cfg(windows)]
        Ok(window) => crate::platform::set_taskbar_icon(&window),
        #[cfg(not(windows))]
        Ok(_) => {}
        Err(e) => crate::alog!("afterglow: could not open settings: {e}"),
    }
}

/// The Settings window's background before its page has drawn, per theme
pub fn settings_background(theme: &str) -> Color {
    if theme == "light" {
        Color(255, 255, 255, 255)
    } else {
        Color(0, 0, 0, 255)
    }
}
