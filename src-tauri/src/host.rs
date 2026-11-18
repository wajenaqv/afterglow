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
//   pause     every 2 s: pause when the tray says so, when a fullscreen app or
//             game is in front, or on battery; sent as a "paused" event
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

// The wallpaper every monitor shows, for now (picking one comes with
// settings): a page under wallpapers/, and its options
const WALLPAPER: &str = "jellyfish";
const WALLPAPER_QUERY: &str = "";

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
    fn init_script(&self) -> String {
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
        let config = serde_json::json!({ "wall": WALLPAPER, "query": WALLPAPER_QUERY, "screens": screens });
        format!("window.__AFTERGLOW__ = {config};")
    }
}

/// Shared state (Tauri's `manage`): the windows, and the pause switches.
#[derive(Default)]
pub struct Host {
    walls: Mutex<Vec<Wall>>,
    /// The monitors the windows were built for
    screens: Mutex<Vec<Screen>>,
    /// Paused from the tray menu
    pub user_paused: AtomicBool,
    /// Pause rules, on by default
    pub pause_fullscreen: AtomicBool,
    pub pause_on_battery: AtomicBool,
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
    host.pause_fullscreen.store(true, Ordering::Relaxed);
    host.pause_on_battery.store(true, Ordering::Relaxed);
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
    eprintln!("afterglow: {} monitor(s) {:?} -> {} wallpaper window(s)", screens.len(), screens, walls.len());

    for (label, window) in app.webview_windows() {
        if label.starts_with("wall-") {
            let _ = window.destroy();
        }
    }

    for wall in &walls {
        let window = WebviewWindowBuilder::new(app, &wall.label, WebviewUrl::App("wallpapers/host.html".into()))
            .title("AfterGlow wallpaper")
            .initialization_script(&wall.init_script())            .decorations(false)
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

/// Work out whether wallpapers should be paused and tell them. Also called
/// straight away from the tray when Pause is toggled.
pub fn apply_pause(app: &AppHandle) {
    let host = app.state::<Host>();
    let pause = host.user_paused.load(Ordering::Relaxed)
        || (host.pause_fullscreen.load(Ordering::Relaxed) && platform::fullscreen_app_in_front())
        || (host.pause_on_battery.load(Ordering::Relaxed) && platform::on_battery());
    // Sent every time (not only on change): a window that just loaded learns
    // the current state within one tick
    let labels: Vec<String> = host.walls.lock().unwrap().iter().map(|w| w.label.clone()).collect();
    for label in labels {
        let _ = app.emit_to(EventTarget::webview_window(&label), "paused", pause);
    }
}

fn pause_loop(app: AppHandle) {
    loop {
        apply_pause(&app);
        thread::sleep(Duration::from_secs(2));
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
