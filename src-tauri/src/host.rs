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
// Three background loops (plain threads):
//   cursor    every 33 ms: windows behind the icons get no mouse events, so we
//             read the cursor position and send it to the window under it as
//             a "cursor" event ({x, y} in CSS px within that window, or null)
//   pause     every 1 s: pause everything when the tray says so, when a fullscreen
//             app or game is in front, or on battery; and any monitor whose
//             desktop is hidden behind app windows. Sent as a "paused" event
//             with one flag per monitor the window covers. With OLED care on,
//             also everything once you've been away a while (an "oled" event
//             tells host.html to go black)
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
    clock: crate::extras::Clock,
}

impl Showing {
    fn from(s: &Settings) -> Self {
        Showing { wall: s.wallpaper.clone(), query: s.query(), clock: s.clock.clone() }
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
        let config = serde_json::json!({ "wall": showing.wall, "query": showing.query, "screens": screens, "clock": showing.clock });
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
    /// The tray menu is open or just closing (macOS, see menu_tracking)
    menu_busy: AtomicBool,
    /// Bumped each time the menu opens or closes, so an old delayed resume is ignored
    #[cfg(target_os = "macos")]
    menu_turn: AtomicUsize,
    /// What each window was last told (to log changes)
    pub(crate) last_paused: Mutex<std::collections::HashMap<String, Vec<bool>>>,
    /// Why each window's monitors are paused ("" = running), for Settings → performance
    reasons: Mutex<std::collections::HashMap<String, Vec<&'static str>>>,
    /// What draws each monitor ("gpu" or "cpu"), as its wallpaper reported
    renderers: Mutex<std::collections::HashMap<(String, usize), String>>,
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
    #[cfg(target_os = "macos")]
    {
        let a = app.clone();
        thread::spawn(move || fullscreen_loop(a));
        let _ = MENU_APP.set(app.clone());
        platform::watch_menus(menu_tracking);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
static MENU_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// macOS: hold the wallpapers still while AfterGlow's menu is open and while
/// it fades out, so drawing them doesn't compete with the menu (opening and
/// closing it stalled the screen for up to 0.9 s).
/// Called on the main thread when the menu opens (true) and closes (false).
#[cfg(target_os = "macos")]
fn menu_tracking(open: bool) {
    let Some(app) = MENU_APP.get() else { return };
    let host = app.state::<Host>();
    let turn = host.menu_turn.fetch_add(1, Ordering::SeqCst) + 1;
    if open {
        host.menu_busy.store(true, Ordering::SeqCst);
        emit_to_walls(app, "paused", true);
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        let host = app.state::<Host>();
        // opened again meanwhile: that menu's own close will resume
        if host.menu_turn.load(Ordering::SeqCst) == turn {
            host.menu_busy.store(false, Ordering::SeqCst);
            apply_pause(&app);
        }
    });
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
    crate::alog!("afterglow: {} monitor(s) {:?} -> {} wallpaper window(s)", screens.len(), screens, walls.len());

    for (label, window) in app.webview_windows() {
        if label.starts_with("wall-") {
            let _ = window.destroy();
        }
    }

    for wall in &walls {
        let window = WebviewWindowBuilder::new(app, &wall.label, WebviewUrl::App("wallpapers/host.html".into()))
            .title("AfterGlow wallpaper")
            .initialization_script(wall.init_script(&showing))
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
            crate::alog!("afterglow: could not put {} behind the desktop icons: {e}", wall.label);
        }
        window.show()?;
    }

    *host.walls.lock().unwrap() = walls;
    *host.screens.lock().unwrap() = screens;
    // macOS: a black system wallpaper for Mission Control / Space switches,
    // also on displays plugged in later (this runs on every rebuild)
    #[cfg(target_os = "macos")]
    if let Ok(dir) = app.path().app_config_dir() {
        platform::black_desktop(&dir);
    }
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
        crate::edge::cursor(&app, pos.x, pos.y);

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

/// OLED care, for host.html (src/wallpapers/oled.js).
#[derive(Serialize, Clone)]
struct Oled {
    on: bool,
    rest: bool,
}

/// How long without keyboard or mouse before OLED care rests the screen, in
/// seconds (AFTERGLOW_REST_SECS overrides it for testing).
fn rest_secs(minutes: u32) -> f64 {
    std::env::var("AFTERGLOW_REST_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(minutes as f64 * 60.0)
}

fn resting(oled: bool, idle: f64, after: f64) -> bool {
    oled && idle >= after
}

/// OLED care has the screen resting right now
pub fn resting_now(app: &AppHandle) -> bool {
    let (oled, minutes) = {
        let host = app.state::<Host>();
        let s = host.settings.lock().unwrap();
        (s.oled, s.oled_minutes)
    };
    resting(oled, platform::idle_seconds(), rest_secs(minutes))
}

/// Work out whether wallpapers should be paused and tell them. Also called
/// straight away from the tray when Pause is toggled.
pub fn apply_pause(app: &AppHandle) {
    let host = app.state::<Host>();
    let (rule_fullscreen, rule_battery, rule_covered, oled, oled_minutes) = {
        let s = host.settings.lock().unwrap();
        (s.pause_fullscreen, s.pause_on_battery, s.pause_covered, s.oled, s.oled_minutes)
    };
    // OLED care: away long enough, so the screen goes black (and pauses).
    // Sent every time, like "paused" below, so new windows learn it too
    let rest = resting(oled, platform::idle_seconds(), rest_secs(oled_minutes));
    emit_to_walls(app, "oled", Oled { on: oled, rest });
    // Everything pauses (and why)...
    let why = if host.user_paused.load(Ordering::Relaxed) {
        "you"
    } else if rule_fullscreen && platform::fullscreen_app_in_front() {
        "fullscreen"
    } else if rule_battery && platform::on_battery() {
        "battery"
    } else if rest {
        "resting"
    } else {
        ""
    };
    let all = !why.is_empty();
    // ...or just the monitors whose desktop is hidden behind app windows
    let walls = host.walls.lock().unwrap().clone();
    for wall in walls {
        let rects: Vec<(i32, i32, u32, u32, f64)> = wall.screens.iter().map(|s| (s.x, s.y, s.w, s.h, s.scale)).collect();
        let hidden = if rule_covered && !all { platform::covered(&rects) } else { vec![false; rects.len()] };
        // one flag per monitor, in the order host.html laid out its frames.
        // Sent every time (not only on change): a window that just loaded
        // learns the current state within one tick
        let flags: Vec<bool> = hidden.iter().map(|&h| all || h).collect();
        let reasons = hidden.iter().map(|&h| if all { why } else if h { "covered" } else { "" }).collect();
        host.reasons.lock().unwrap().insert(wall.label.clone(), reasons);
        {
            let mut last = host.last_paused.lock().unwrap();
            if last.get(&wall.label) != Some(&flags) {
                crate::alog!("afterglow: {} paused per monitor: {:?}", wall.label, flags);
                last.insert(wall.label.clone(), flags.clone());
            }
        }
        // the menu's hold isn't in last_paused: you're still watching, so
        // messages must not count as missed
        let menu = host.menu_busy.load(Ordering::SeqCst);
        let told: Vec<bool> = flags.iter().map(|&f| f || menu).collect();
        let _ = app.emit_to(EventTarget::webview_window(&wall.label), "paused", told);
    }
}

// ---- Settings → performance ----

/// The Pause switch (the tray's and Settings')
#[tauri::command]
pub fn set_paused(app: AppHandle, on: bool) {
    app.state::<Host>().user_paused.store(on, Ordering::Relaxed);
    apply_pause(&app);
    crate::tray::sync(&app);
}

/// A wallpaper window: what draws this monitor (after a GPU failure it's the CPU)
#[tauri::command]
pub fn wall_renderer(window: tauri::WebviewWindow, index: usize, renderer: String) {
    let app = window.app_handle();
    let renderer = if renderer == "gpu" || renderer == "cpu" { renderer } else { String::new() };
    app.state::<Host>().renderers.lock().unwrap().insert((window.label().to_string(), index), renderer);
}

#[derive(Serialize)]
pub struct PowerScreen {
    w: u32,
    h: u32,
    /// "" running, else you, fullscreen, battery, covered or resting
    reason: &'static str,
    /// "gpu", "cpu" or "" (not reported)
    renderer: String,
}

#[derive(Serialize)]
pub struct PowerState {
    paused: bool,
    screens: Vec<PowerScreen>,
    has_battery: bool,
    os: &'static str,
    /// AfterGlow's share of the whole CPU, percent (None: not known here)
    cpu: Option<f64>,
}

#[tauri::command]
pub fn power_state(app: AppHandle) -> PowerState {
    let host = app.state::<Host>();
    let walls = host.walls.lock().unwrap().clone();
    let reasons = host.reasons.lock().unwrap().clone();
    let renderers = host.renderers.lock().unwrap().clone();
    let mut screens = Vec::new();
    for wall in &walls {
        for (i, s) in wall.screens.iter().enumerate() {
            screens.push(PowerScreen {
                w: s.w,
                h: s.h,
                reason: reasons.get(&wall.label).and_then(|r| r.get(i)).copied().unwrap_or(""),
                renderer: renderers.get(&(wall.label.clone(), i)).cloned().unwrap_or_default(),
            });
        }
    }
    PowerState {
        paused: host.user_paused.load(Ordering::Relaxed),
        screens,
        has_battery: platform::has_battery(),
        os: std::env::consts::OS,
        cpu: cpu_percent(),
    }
}

/// The CPU used since the last call (Settings asks every 2 s)
fn cpu_percent() -> Option<f64> {
    static LAST: Mutex<Option<(std::time::Instant, f64)>> = Mutex::new(None);
    let total = platform::cpu_seconds()?;
    let now = std::time::Instant::now();
    let before = LAST.lock().unwrap().replace((now, total));
    let (at, used) = before?;
    let secs = now.duration_since(at).as_secs_f64();
    // too close together, or so long ago that it's another visit to the page
    if !(0.5..30.0).contains(&secs) {
        return None;
    }
    let cores = thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
    Some(((total - used).max(0.0) / secs / cores * 100.0).min(100.0))
}

/// macOS: hide a display's wall window while a fullscreen app is in front of
/// it. The window is on every Space, fullscreen ones included, and showed
/// through the see-through strip beside the notch. Checked every 250 ms so
/// the jellies are back soon after swiping out of fullscreen.
#[cfg(target_os = "macos")]
fn fullscreen_loop(app: AppHandle) {
    let mut shown: std::collections::HashMap<String, bool> = Default::default();
    let mut tick = 0u32;
    loop {
        thread::sleep(Duration::from_millis(250));
        // about once a second: black system wallpaper on the Space we're on
        tick += 1;
        // (not while the menu is open: the check waits on the window server)
        if tick % 4 == 0 && !app.state::<Host>().menu_busy.load(Ordering::SeqCst) {
            let _ = app.run_on_main_thread(platform::keep_desktop_black);
        }
        let walls = app.state::<Host>().walls.lock().unwrap().clone();
        for wall in walls {
            let rects: Vec<(i32, i32, u32, u32, f64)> = wall.screens.iter().map(|s| (s.x, s.y, s.w, s.h, s.scale)).collect();
            let visible = !platform::fullscreen_on(&rects).iter().any(|&f| f);
            if shown.get(&wall.label) == Some(&visible) {
                continue;
            }
            shown.insert(wall.label.clone(), visible);
            if let Some(window) = app.get_webview_window(&wall.label) {
                // AppKit calls belong on the main thread
                let w = window.clone();
                let _ = window.run_on_main_thread(move || platform::set_visible(&w, visible));
            }
        }
    }
}

fn pause_loop(app: AppHandle) {
    loop {
        apply_pause(&app);
        crate::signals::replay_missed(&app);
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
                    crate::alog!("afterglow: rebuilding wallpapers failed: {e}");
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::resting;

    #[test]
    fn rests_only_with_oled_care_on_and_after_the_wait() {
        assert!(!resting(false, 9999.0, 300.0));
        assert!(!resting(true, 299.0, 300.0));
        assert!(resting(true, 300.0, 300.0));
    }
}
