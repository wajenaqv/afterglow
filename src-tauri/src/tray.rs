// The tray (Windows) / menu bar (macOS) icon and its menu:
//   Wallpaper ▸        jellyfish / big jellyfish / paw prints (one ticked)
//   Frame rate ▸       smooth 30 / light 20 / eco 15 fps (one ticked)
//   Try a signal ▸     the simulator: a message, things waiting, a flash
//   Pause              stop every wallpaper (no CPU) until unticked
//   Pause when hidden by windows / when an app is fullscreen / on battery   (saved)
//   Start at login
//   Settings…          the AfterGlow window: pick a wallpaper and its options
//   Quit AfterGlow
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
use crate::settings::{self, Settings, FPS_CHOICES, WALLPAPERS};
use crate::signals::{self, Signal};

const TRAY_ID: &str = "afterglow";

/// The menu's radio-style items, kept so their ticks can follow changes made
/// in the Settings window (sync).
#[derive(Default)]
pub struct TrayItems {
    walls: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
    rates: Mutex<Vec<(u32, CheckMenuItem<Wry>)>>,
    rotate: Mutex<Option<CheckMenuItem<Wry>>>,
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

fn fps_label(fps: u32) -> String {
    match fps {
        30 => "Smooth (30 fps)".into(),
        20 => "Light (20 fps)".into(),
        15 => "Eco (15 fps)".into(),
        n => format!("{n} fps"),
    }
}

fn tooltip(s: &Settings) -> String {
    let name = WALLPAPERS.iter().find(|(id, _)| *id == s.wallpaper).map(|(_, name)| *name).unwrap_or("AfterGlow");
    format!("AfterGlow · {name}")
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let saved = app.state::<Host>().settings.lock().unwrap().clone();

    let walls: Vec<(String, CheckMenuItem<Wry>)> = WALLPAPERS
        .iter()
        .map(|(id, name)| Ok((id.to_string(), CheckMenuItem::with_id(app, format!("wall:{id}"), *name, true, saved.wallpaper == *id, None::<&str>)?)))
        .collect::<tauri::Result<_>>()?;
    let rates: Vec<(u32, CheckMenuItem<Wry>)> = FPS_CHOICES
        .iter()
        .map(|&fps| Ok((fps, CheckMenuItem::with_id(app, format!("fps:{fps}"), fps_label(fps), true, saved.fps == fps, None::<&str>)?)))
        .collect::<tauri::Result<_>>()?;
    let wall_refs: Vec<&dyn IsMenuItem<Wry>> = walls.iter().map(|(_, i)| i as &dyn IsMenuItem<Wry>).collect();
    let rate_refs: Vec<&dyn IsMenuItem<Wry>> = rates.iter().map(|(_, i)| i as &dyn IsMenuItem<Wry>).collect();
    let wallpaper_menu = Submenu::with_items(app, "Wallpaper", true, &wall_refs)?;
    let rate_menu = Submenu::with_items(app, "Frame rate", true, &rate_refs)?;
    // Try a signal ▸ the simulator, from the tray so nothing covers the wallpaper
    let tries: Vec<MenuItem<Wry>> = TRIES
        .iter()
        .enumerate()
        .map(|(i, (label, _))| MenuItem::with_id(app, format!("try:{i}"), *label, true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let try_refs: Vec<&dyn IsMenuItem<Wry>> = tries.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let try_menu = Submenu::with_items(app, "Try a signal", true, &try_refs)?;

    let pause = CheckMenuItem::with_id(app, "pause", "Pause", true, false, None::<&str>)?;
    let rotate = CheckMenuItem::with_id(app, "rotate", "Rotate wallpapers", true, saved.rotate.on, None::<&str>)?;
    let fullscreen = CheckMenuItem::with_id(app, "pause-fullscreen", "Pause when an app is fullscreen", true, saved.pause_fullscreen, None::<&str>)?;
    let battery = CheckMenuItem::with_id(app, "pause-battery", "Pause on battery", true, saved.pause_on_battery, None::<&str>)?;
    let covered = CheckMenuItem::with_id(app, "pause-covered", "Pause when hidden by windows", true, saved.pause_covered, None::<&str>)?;
    let quiet = CheckMenuItem::with_id(app, "quiet-dnd", "Quiet during Do Not Disturb", true, saved.quiet_dnd, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start at login", true, autostart_on, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AfterGlow", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &wallpaper_menu,
            &rate_menu,
            &rotate,
            &try_menu,
            &PredefinedMenuItem::separator(app)?,
            &pause,
            &PredefinedMenuItem::separator(app)?,
            &covered,
            &fullscreen,
            &battery,
            &quiet,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &open_settings,
            &quit,
        ],
    )?;

    app.manage(TrayItems { walls: Mutex::new(walls), rates: Mutex::new(rates), rotate: Mutex::new(Some(rotate.clone())) });

    let mut tray = TrayIconBuilder::with_id(TRAY_ID).tooltip(tooltip(&saved)).menu(&menu).show_menu_on_left_click(true);
    // The AG logo made for small sizes (scripts/icon.js): green on a black
    // plate on Windows; a black template image on macOS, recoloured by the
    // menu bar for light and dark mode
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(Image::from_bytes(include_bytes!("../icons/tray/mac/44x44.png"))?).icon_as_template(true);
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
                eprintln!("afterglow: {e}");
            }
            sync(app); // also re-ticks the item if it was clicked while already ticked
            return;
        }
        // Try a signal ▸ <one>
        if let Some(i) = id.strip_prefix("try:").and_then(|n| n.parse::<usize>().ok()) {
            if let Some((_, json)) = TRIES.get(i) {
                if let Some(sig) = try_signal(app, json) {
                    if let Err(e) = signals::handle(app, sig) {
                        eprintln!("afterglow: {e}");
                    }
                }
            }
            return;
        }
        // Frame rate ▸ <one>
        if let Some(fps) = id.strip_prefix("fps:").and_then(|n| n.parse::<u32>().ok()) {
            if let Err(e) = settings::set_fps(app.clone(), fps) {
                eprintln!("afterglow: {e}");
            }
            sync(app);
            return;
        }
        match id {
            // check items flip their own tick when clicked; we read it back
            "pause" => {
                app.state::<Host>().user_paused.store(pause.is_checked().unwrap_or(false), Ordering::Relaxed);
                host::apply_pause(app);
            }
            "pause-covered" | "pause-fullscreen" | "pause-battery" | "quiet-dnd" => {
                let host = app.state::<Host>();
                let snapshot = {
                    let mut s = host.settings.lock().unwrap();
                    s.pause_fullscreen = fullscreen.is_checked().unwrap_or(true);
                    s.pause_on_battery = battery.is_checked().unwrap_or(true);
                    s.pause_covered = covered.is_checked().unwrap_or(true);
                    s.quiet_dnd = quiet.is_checked().unwrap_or(true);
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
                // show what actually happened
                let _ = autostart.set_checked(app.autolaunch().is_enabled().unwrap_or(on));
            }
            "rotate" => {
                let r = app.state::<Host>().settings.lock().unwrap().rotate.clone();
                if let Err(e) = crate::extras::set_rotation(app.clone(), rotate.is_checked().unwrap_or(false), r.minutes, r.walls) {
                    eprintln!("afterglow: {e}");
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

/// Tick the wallpaper and frame rate in use, untick the others, and update
/// the tooltip.
pub fn sync(app: &AppHandle) {
    let s = app.state::<Host>().settings.lock().unwrap().clone();
    if let Some(items) = app.try_state::<TrayItems>() {
        for (id, item) in items.walls.lock().unwrap().iter() {
            let _ = item.set_checked(*id == s.wallpaper);
        }
        if let Some(item) = items.rotate.lock().unwrap().as_ref() {
            let _ = item.set_checked(s.rotate.on);
        }
        for (fps, item) in items.rates.lock().unwrap().iter() {
            let _ = item.set_checked(*fps == s.fps);
        }
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip(&s)));
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
        .inner_size(1040.0, 760.0)
        .min_inner_size(640.0, 480.0)
        .background_color(Color(0, 0, 0, 255))
        .build();
    if let Err(e) = built {
        eprintln!("afterglow: could not open settings: {e}");
    }
}
