// The wallpaper host: borderless webview windows placed behind the desktop
// icons (platform::attach), each loading wallpapers/host.html, which shows
// the wallpaper once per monitor the window covers.
//
// How many windows (plan_walls):
//   - Windows, all monitors at the same display scale: ONE window spanning
//     every monitor. Each webview costs ~100 MB before drawing anything, so
//     this saves that much per extra monitor; host.html puts a frame on each.
//   - Otherwise (mixed scales, where one window can't be sharp on both; or
//     macOS, where a window can't span Spaces on different displays): one
//     window per monitor.
//
// Three background loops (plain threads, like goroutines with a ticker):
//   cursor    every 33 ms: windows behind the icons get no mouse events, so we
//             read the cursor position and send it to the window under it as
//             a "cursor" event ({x, y} in CSS px within that window, or null)
//   pause     every 1 s: pause everything when the tray says so, when a fullscreen
//             app or game is in front, or on battery; and any monitor whose
//             desktop is hidden behind app windows. Sent as a "paused" event
//             with one flag per monitor the window covers
//   monitors  every 3 s: if monitors were added, removed or moved, rebuild
//
// Events go to each window by label (emit_to); host.html listens on its own
// window and passes them to its frames.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::platform;
use crate::settings::{self, Settings};

/// What the wallpaper frames show: a page under wallpapers/ and its options.
#[derive(Serialize, Clone)]
struct Showing {
    wall: String,
    query: String,
}

impl Showing {
    fn from(s: &Settings) -> Self {
        Showing { wall: s.wallpaper.clone(), query: s.query() }
    }
}

/// A monitor, in physical pixels.
#[derive(Clone, PartialEq, Debug)]
struct Screen {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    scale: f64,
}

/// One wallpaper window: the rectangle it covers (physical px) and the
/// monitors inside it.
#[derive(Clone)]
struct Wall {
    label: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    scale: f64,
    screens: Vec<Screen>,
}

impl Wall {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x as f64 && y >= self.y as f64 && x < (self.x as f64 + self.w as f64) && y < (self.y as f64 + self.h as f64)
    }

    /// What host.html needs: its monitors in CSS px relative to the window.
    fn init_script(&self, showing: &Showing) -> String {
        let screens: Vec<[f64; 4]> = self
            .screens
            .iter()
            .map(|s| {
                [
                    (s.x - self.x) as f64 / self.scale,
                    (s.y - self.y) as f64 / self.scale,
                    s.w as f64 / self.scale,
                    s.h as f64 / self.scale,
                ]
            })
            .collect();
        let config = serde_json::json!({ "wall": showing.wall, "query": showing.query, "screens": screens });
        format!("window.__AFTERGLOW__ = {config};")
    }
}

/// Shared state (Tauri's `manage`): the windows, the saved settings and the
/// tray's Pause switch.
#[derive(Default)]
pub struct Host {
    walls: Mutex<Vec<Wall>>,
    /// The monitors the windows were built for
    screens: Mutex<Vec<Screen>>,
    /// The wallpaper, its options and the pause rules (settings.rs saves them)
    pub settings: Mutex<Settings>,
    /// Paused from the tray menu (not saved: AfterGlow always starts running)
    pub user_paused: AtomicBool,
    /// What each window was last told (to log changes)
    last_paused: Mutex<std::collections::HashMap<String, Vec<bool>>>,
    /// Bumped on every rebuild, so new windows get fresh labels (a label
    /// can't be reused while its old window is still closing)
    generation: AtomicUsize,
}

#[derive(Serialize, Clone)]
struct Cursor {
    x: f64,
    y: f64,
}

pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let host = app.state::<Host>();
    *host.settings.lock().unwrap() = settings::load(app);
    build_walls(app)?;

    let a = app.clone();
    thread::spawn(move || cursor_loop(a));
    let a = app.clone();
    thread::spawn(move || pause_loop(a));
    let a = app.clone();
    thread::spawn(move || monitor_loop(a));
    Ok(())
}

pub fn stop(_app: &AppHandle) {
    platform::restore_desktop();
}

fn current_screens(app: &AppHandle) -> Vec<Screen> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Screen { x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height, scale: m.scale_factor() })
        .collect()
}

/// Decide the windows for these monitors (see the top of this file).
fn plan_walls(screens: &[Screen], generation: usize) -> Vec<Wall> {
    let one_window = cfg!(windows) && screens.len() > 1 && screens.iter().all(|s| s.scale == screens[0].scale);
    if one_window {
        let x = screens.iter().map(|s| s.x).min().unwrap();
        let y = screens.iter().map(|s| s.y).min().unwrap();
        let right = screens.iter().map(|s| s.x + s.w as i32).max().unwrap();
        let bottom = screens.iter().map(|s| s.y + s.h as i32).max().unwrap();
        return vec![Wall {
            label: format!("wall-{generation}-0"),
            x,
            y,
            w: (right - x) as u32,
            h: (bottom - y) as u32,
            scale: screens[0].scale,
            screens: screens.to_vec(),
        }];
    }
    screens
        .iter()
        .enumerate()
        .map(|(i, s)| Wall {
            label: format!("wall-{generation}-{i}"),
            x: s.x,
            y: s.y,
            w: s.w,
            h: s.h,
            scale: s.scale,
            screens: vec![s.clone()],
        })
        .collect()
}

/// Close any old wallpaper windows and open new ones for the current monitors.
fn build_walls(app: &AppHandle) -> tauri::Result<()> {
    let host = app.state::<Host>();
    let generation = host.generation.fetch_add(1, Ordering::Relaxed);
    let screens = current_screens(app);
    let walls = plan_walls(&screens, generation);
    let showing = Showing::from(&host.settings.lock().unwrap());
    eprintln!("afterglow: {} monitor(s) {:?} -> {} wallpaper window(s)", screens.len(), screens, walls.len());

    for (label, window) in app.webview_windows() {
        if label.starts_with("wall-") {
            let _ = window.destroy();
        }
    }

    for wall in &walls {
        let window = WebviewWindowBuilder::new(app, &wall.label, WebviewUrl::App("wallpapers/host.html".into()))
            .title("AfterGlow wallpaper")
            .initialization_script(&wall.init_script(&showing))
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .focused(false)
            .shadow(false)
            .visible(false)
            .always_on_bottom(true)
            .build()?;
        window.set_position(PhysicalPosition::new(wall.x, wall.y))?;
        window.set_size(PhysicalSize::new(wall.w, wall.h))?;
        if let Err(e) = platform::attach(&window, wall.x, wall.y, wall.w, wall.h) {
            eprintln!("afterglow: could not put {} behind the desktop icons: {e}", wall.label);
        }
        window.show()?;
    }

    *host.walls.lock().unwrap() = walls;
    *host.screens.lock().unwrap() = screens;
    Ok(())
}

fn cursor_loop(app: AppHandle) {
    let mut last: Option<(f64, f64)> = None;
    let mut last_label: Option<String> = None;
    loop {
        thread::sleep(Duration::from_millis(33));
        let Ok(pos) = app.cursor_position() else { continue };
        if last == Some((pos.x, pos.y)) {
            continue;
        }
        last = Some((pos.x, pos.y));

        let walls = app.state::<Host>().walls.lock().unwrap().clone();
        let here = walls.iter().find(|w| w.contains(pos.x, pos.y));
        // the window the cursor left hears that it's gone
        if let Some(prev) = &last_label {
            if here.map(|w| &w.label) != Some(prev) {
                let _ = app.emit_to(EventTarget::webview_window(prev), "cursor", None::<Cursor>);
            }
        }
        if let Some(w) = here {
            let local = Cursor { x: (pos.x - w.x as f64) / w.scale, y: (pos.y - w.y as f64) / w.scale };
            let _ = app.emit_to(EventTarget::webview_window(&w.label), "cursor", Some(local));
        }
        last_label = here.map(|w| w.label.clone());
    }
}

/// Tell every wallpaper window to show the chosen wallpaper (after Settings
/// or the tray changed it). host.html swaps its frames; no window rebuild.
pub fn show_wallpaper(app: &AppHandle) {
    let showing = Showing::from(&app.state::<Host>().settings.lock().unwrap());
    emit_to_walls(app, "wallpaper", showing);
}

/// Send an event to every wallpaper window (host.html passes it to its frames).
pub fn emit_to_walls<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let labels: Vec<String> = app.state::<Host>().walls.lock().unwrap().iter().map(|w| w.label.clone()).collect();
    for label in labels {
        let _ = app.emit_to(EventTarget::webview_window(&label), event, payload.clone());
    }
}

/// Work out whether wallpapers should be paused and tell them. Also called
/// straight away from the tray when Pause is toggled.
pub fn apply_pause(app: &AppHandle) {
    let host = app.state::<Host>();
    let (rule_fullscreen, rule_battery, rule_covered) = {
        let s = host.settings.lock().unwrap();
        (s.pause_fullscreen, s.pause_on_battery, s.pause_covered)
    };
    // Everything pauses...
    let all = host.user_paused.load(Ordering::Relaxed)
        || (rule_fullscreen && platform::fullscreen_app_in_front())
        || (rule_battery && platform::on_battery());
    // ...or just the monitors whose desktop is hidden behind app windows
    let walls = host.walls.lock().unwrap().clone();
    for wall in walls {
        let rects: Vec<(i32, i32, u32, u32)> = wall.screens.iter().map(|s| (s.x, s.y, s.w, s.h)).collect();
        let hidden = if rule_covered && !all { platform::covered(&rects) } else { vec![false; rects.len()] };
        // one flag per monitor, in the order host.html laid out its frames.
        // Sent every time (not only on change): a window that just loaded
        // learns the current state within one tick
        let flags: Vec<bool> = hidden.iter().map(|&h| all || h).collect();
        {
            let mut last = host.last_paused.lock().unwrap();
            if last.get(&wall.label) != Some(&flags) {
                eprintln!("afterglow: {} paused per monitor: {:?}", wall.label, flags);
                last.insert(wall.label.clone(), flags.clone());
            }
        }
        let _ = app.emit_to(EventTarget::webview_window(&wall.label), "paused", flags);
    }
}

fn pause_loop(app: AppHandle) {
    loop {
        apply_pause(&app);
        thread::sleep(Duration::from_secs(1));
    }
}

fn monitor_loop(app: AppHandle) {
    loop {
        thread::sleep(Duration::from_secs(3));
        let now = current_screens(&app);
        let known = app.state::<Host>().screens.lock().unwrap().clone();
        if now != known && !now.is_empty() {
            // windows are created and attached on the main thread (required on macOS)
            let a = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(e) = build_walls(&a) {
                    eprintln!("afterglow: rebuilding wallpapers failed: {e}");
                }
            });
        }
    }
}
