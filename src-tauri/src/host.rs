// The wallpaper host: one borderless webview window per monitor, placed
// behind the desktop icons (platform::attach), showing a wallpaper page.
//
// Three background loops (plain threads, like goroutines with a ticker):
//   cursor    every 33 ms: windows behind the icons get no mouse events, so we
//             read the cursor position and send it to the wallpaper on that
//             monitor as a "cursor" event ({x, y} in CSS px, or null)
//   pause     every 2 s: pause when the tray says so, when a fullscreen app or
//             game is in front, or on battery; sent as a "paused" event
//   monitors  every 3 s: if monitors were added, removed or moved, rebuild
//             the wallpaper windows
//
// Events go to each wallpaper window by label (emit_to), and the page listens
// on its own window (src/wallpapers/common.js).

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::platform;

// The wallpaper every monitor shows, for now. (Picking one comes with settings.)
const WALLPAPER: &str = "wallpapers/jellyfish.html";

/// One monitor's wallpaper window and where it sits, in physical pixels.
#[derive(Clone)]
struct Wall {
    label: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    scale: f64,
}

impl Wall {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x as f64 && y >= self.y as f64 && x < (self.x as f64 + self.w as f64) && y < (self.y as f64 + self.h as f64)
    }
}

/// Same monitors in the same places (labels aside)?
fn same_layout(a: &[Wall], b: &[Wall]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(p, q)| p.x == q.x && p.y == q.y && p.w == q.w && p.h == q.h && p.scale == q.scale)
}

/// Shared state (Tauri's `manage`): the windows, and the pause switches.
#[derive(Default)]
pub struct Host {
    walls: Mutex<Vec<Wall>>,
    /// Paused from the tray menu
    pub user_paused: AtomicBool,
    /// Pause rules, on by default
    pub pause_fullscreen: AtomicBool,
    pub pause_on_battery: AtomicBool,
    /// What the wallpapers were last told
    paused: AtomicBool,
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

/// The monitors as Walls (labels wall-<generation>-<n>), in physical pixels.
fn current_walls(app: &AppHandle, generation: usize) -> Vec<Wall> {
    let monitors = app.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| Wall {
            label: format!("wall-{generation}-{i}"),
            x: m.position().x,
            y: m.position().y,
            w: m.size().width,
            h: m.size().height,
            scale: m.scale_factor(),
        })
        .collect()
}

/// Close any old wallpaper windows and open one per monitor.
fn build_walls(app: &AppHandle) -> tauri::Result<()> {
    let host = app.state::<Host>();
    let generation = host.generation.fetch_add(1, Ordering::Relaxed);
    let walls = current_walls(app, generation);

    for (label, window) in app.webview_windows() {
        if label.starts_with("wall-") {
            let _ = window.destroy();
        }
    }

    for wall in &walls {
        let window = WebviewWindowBuilder::new(app, &wall.label, WebviewUrl::App(WALLPAPER.into()))
            .title("AfterGlow wallpaper")
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
        // the monitor the cursor left hears that it's gone
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
    host.paused.store(pause, Ordering::Relaxed);
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
        let now = current_walls(&app, 0);
        let known = app.state::<Host>().walls.lock().unwrap().clone();
        if !same_layout(&now, &known) && !now.is_empty() {
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
