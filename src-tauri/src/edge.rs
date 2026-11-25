// Edge: what's waiting, as light at a screen edge while app windows hide the
// desktop (and its lanterns). One thin, see-through, click-through window per
// covered monitor (wallpapers/edge.html, src/wallpapers/edge.js), along the
// chosen edge of its work area, so never over the taskbar or Dock.
//
// The windows only exist while they're needed (a webview costs memory): made
// when something waits on a covered monitor, gone LINGER after nothing does.
// Never shown over a fullscreen app, while paused from the tray, during Do
// Not Disturb (when the user wants that quiet) or while OLED care rests the
// screen.
//
// Also the tray icon: it takes the waiting apps' colours in turn.
//
// One thread does it all, about once a second or when nudged (a lantern
// changed, a setting changed). It holds no lock while calling Tauri.

use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::host::{self, Host};
use crate::signals::{self, Lantern};
use crate::{platform, settings, tray};

pub const LOOKS: &[&str] = &["thread", "glyphs", "embers", "tide"];
pub const SIDES: &[&str] = &["bottom", "top", "left", "right"];
pub const STRENGTHS: &[&str] = &["faint", "soft", "clear"];

/// How deep the windows reach into the screen, in CSS px (tide needs the most)
const DEPTH: f64 = 130.0;
/// Windows with nothing to show are kept this long
const LINGER: Duration = Duration::from_secs(15);
/// "try it" shows its sample for this long
const TRY: Duration = Duration::from_secs(10);
/// The tray icon stays on each waiting app's colour for this long (seconds)
const TRAY_TURN: u64 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Edge {
    pub on: bool,
    pub look: String,
    pub side: String,
    pub strength: String,
    /// The tray icon takes the colour of what's waiting
    pub tray: bool,
}

impl Default for Edge {
    fn default() -> Self {
        Edge { on: false, look: "thread".into(), side: "bottom".into(), strength: "soft".into(), tray: false }
    }
}

impl Edge {
    /// Anything unknown goes back to its default
    pub fn tidy(mut self) -> Self {
        let d = Edge::default();
        if !LOOKS.contains(&self.look.as_str()) {
            self.look = d.look;
        }
        if !SIDES.contains(&self.side.as_str()) {
            self.side = d.side;
        }
        if !STRENGTHS.contains(&self.strength.as_str()) {
            self.strength = d.strength;
        }
        self
    }
}

/// A rectangle in physical px
#[derive(Clone, Copy, PartialEq, Debug)]
struct Rect {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

/// The strip along one side of a monitor's work area
fn strip_of(area: Rect, scale: f64, side: &str) -> Rect {
    let deep = (DEPTH * scale).round() as u32;
    let (dw, dh) = (deep.min(area.w), deep.min(area.h));
    match side {
        "top" => Rect { h: dh, ..area },
        "left" => Rect { w: dw, ..area },
        "right" => Rect { x: area.x + (area.w - dw) as i32, w: dw, ..area },
        _ => Rect { y: area.y + (area.h - dh) as i32, h: dh, ..area },
    }
}

/// One edge window
#[derive(Clone)]
struct Strip {
    label: String,
    rect: Rect,
    scale: f64,
    shown: bool,
    /// When it last had something to show
    used: Instant,
}

/// What edge.js is told
#[derive(Serialize, Clone)]
struct Look {
    items: Vec<Lantern>,
    shown: bool,
    look: String,
    side: String,
    strength: String,
}

#[derive(Default)]
pub struct Edges {
    strips: Mutex<Vec<Strip>>,
    next: Mutex<u32>,
    /// Show the sample until then
    trying: Mutex<Option<Instant>>,
    /// The tray icon's colour now (None: the brand's)
    tray: Mutex<Option<[u8; 3]>>,
    /// Who the tray tooltip names
    named: Mutex<Vec<String>>,
    wake: (Mutex<bool>, Condvar),
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        loop {
            tick(&app);
            let edges = app.state::<Edges>();
            let (flag, bell) = &edges.wake;
            let mut due = flag.lock().unwrap();
            if !*due {
                due = bell.wait_timeout(due, Duration::from_secs(1)).unwrap().0;
            }
            *due = false;
        }
    });
}

/// Something changed: look again now
pub fn nudge(app: &AppHandle) {
    let edges = app.state::<Edges>();
    *edges.wake.0.lock().unwrap() = true;
    edges.wake.1.notify_one();
}

/// Something new from an app: its light swells, also when it's already lit
pub fn pop(app: &AppHandle, source: &str) {
    for s in app.state::<Edges>().strips.lock().unwrap().clone() {
        let _ = app.emit_to(EventTarget::webview_window(&s.label), "edge-pop", source.to_string());
    }
}

fn samples() -> Vec<Lantern> {
    // names of their own: looking at a sample must not mark the real app seen
    ["whatsapp", "slack", "gmail"].iter().map(|s| Lantern { source: format!("sample-{s}"), colour: crate::apps::own_colour(s), kind: "" }).collect()
}

fn tick(app: &AppHandle) {
    let edges = app.state::<Edges>();
    let (cfg, quiet_dnd) = {
        let host = app.state::<Host>();
        let s = host.settings.lock().unwrap();
        (s.edge.clone(), s.quiet_dnd)
    };
    let waiting = signals::lanterns(app);
    tray_icon(app, &cfg, &waiting);

    let trying = edges.trying.lock().unwrap().is_some_and(|until| Instant::now() < until);
    let mut items = if trying { samples() } else { waiting };
    if !trying {
        items.extend(crate::jobs::running_light(app));
    }
    let allowed = (cfg.on || trying)
        && !items.is_empty()
        && !platform::fullscreen_app_in_front()
        && (trying || !(app.state::<Host>().user_paused.load(std::sync::atomic::Ordering::Relaxed) || host::resting_now(app) || (quiet_dnd && platform::do_not_disturb())));

    // where the strips go, and on which monitors they're wanted
    let mut wanted: Vec<(Rect, f64, bool)> = Vec::new();
    if cfg.on || trying {
        let monitors = app.available_monitors().unwrap_or_default();
        let full: Vec<(i32, i32, u32, u32, f64)> = monitors.iter().map(|m| (m.position().x, m.position().y, m.size().width, m.size().height, m.scale_factor())).collect();
        let hidden = if allowed && !trying { platform::covered(&full) } else { vec![trying && allowed; full.len()] };
        for (m, show) in monitors.iter().zip(hidden) {
            let a = m.work_area();
            let area = Rect { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height };
            wanted.push((strip_of(area, m.scale_factor(), &cfg.side), m.scale_factor(), show));
        }
    }

    // which windows to make, show, hide and close
    let now = Instant::now();
    let (mut make, mut close, mut turn) = (Vec::new(), Vec::new(), Vec::new());
    let strips = {
        let mut strips = edges.strips.lock().unwrap();
        strips.retain(|s| {
            let keep = wanted.iter().any(|(r, _, _)| *r == s.rect) && now.duration_since(s.used) < LINGER;
            if !keep {
                close.push(s.label.clone());
            }
            keep
        });
        for (rect, scale, show) in &wanted {
            match strips.iter_mut().find(|s| s.rect == *rect) {
                Some(s) => {
                    if *show {
                        s.used = now;
                    }
                    if s.shown != *show {
                        s.shown = *show;
                        turn.push((s.label.clone(), *show));
                    }
                }
                None if *show => {
                    let mut next = edges.next.lock().unwrap();
                    *next += 1;
                    let s = Strip { label: format!("edge-{}", *next), rect: *rect, scale: *scale, shown: true, used: now };
                    make.push(s.clone());
                    strips.push(s);
                }
                None => {}
            }
        }
        strips.clone()
    };
    if !make.is_empty() || !close.is_empty() || !turn.is_empty() {
        let a = app.clone();
        let fullscreen = platform::fullscreen_app_in_front();
        // windows belong to the main thread
        let _ = app.run_on_main_thread(move || {
            for label in close {
                if let Some(w) = a.get_webview_window(&label) {
                    let _ = w.destroy();
                }
            }
            for s in make {
                if let Err(e) = build(&a, &s) {
                    crate::alog!("afterglow: edge window: {e}");
                    a.state::<Edges>().strips.lock().unwrap().retain(|o| o.label != s.label);
                }
            }
            for (label, show) in turn {
                // otherwise it stays a moment, to fade out (edge.js)
                if show || fullscreen {
                    if let Some(w) = a.get_webview_window(&label) {
                        platform::show_overlay(&w, show);
                    }
                }
            }
        });
    }
    // told every time, so a window that just loaded learns it too
    for s in strips {
        let look = Look { items: items.clone(), shown: s.shown, look: cfg.look.clone(), side: cfg.side.clone(), strength: cfg.strength.clone() };
        let _ = app.emit_to(EventTarget::webview_window(&s.label), "edge", look);
    }
}

fn build(app: &AppHandle, s: &Strip) -> Result<(), String> {
    let window = WebviewWindowBuilder::new(app, &s.label, WebviewUrl::App("wallpapers/edge.html".into()))
        .title("AfterGlow edge")
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .shadow(false)
        .visible(false)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    let e = |e: tauri::Error| e.to_string();
    window.set_position(PhysicalPosition::new(s.rect.x, s.rect.y)).map_err(e)?;
    window.set_size(PhysicalSize::new(s.rect.w, s.rect.h)).map_err(e)?;
    window.set_ignore_cursor_events(true).map_err(e)?;
    if let Err(err) = platform::overlay(&window) {
        let _ = window.destroy();
        return Err(err);
    }
    platform::show_overlay(&window, true);
    crate::alog!("afterglow: {} at {:?}", s.label, s.rect);
    Ok(())
}

/// From the host's cursor loop: the edge windows take no mouse events, so
/// they're told where the cursor is ({x, y} in CSS px, null: not here)
pub fn cursor(app: &AppHandle, x: f64, y: f64) {
    for s in app.state::<Edges>().strips.lock().unwrap().clone() {
        if !s.shown {
            continue;
        }
        let (lx, ly) = (x - s.rect.x as f64, y - s.rect.y as f64);
        let here = lx >= 0.0 && ly >= 0.0 && lx < s.rect.w as f64 && ly < s.rect.h as f64;
        let at = here.then(|| [lx / s.scale, ly / s.scale]);
        let _ = app.emit_to(EventTarget::webview_window(&s.label), "edge-cursor", at);
    }
}

// ---- the tray icon ----

fn tray_icon(app: &AppHandle, cfg: &Edge, waiting: &[Lantern]) {
    let edges = app.state::<Edges>();
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let colour = match waiting.len() {
        _ if !cfg.tray => None,
        0 => None,
        n => Some(waiting[(secs / TRAY_TURN) as usize % n].colour),
    };
    let before = std::mem::replace(&mut *edges.tray.lock().unwrap(), colour);
    if before != colour {
        tray::set_colour(app, colour);
    }
    let names: Vec<String> = waiting.iter().map(|l| crate::apps::name_of(app, &l.source)).collect();
    let changed = {
        let mut named = edges.named.lock().unwrap();
        let changed = *named != names;
        *named = names;
        changed
    };
    if changed {
        tray::sync(app);
    }
}

/// For the tooltip: "waiting: WhatsApp, Slack" (short: Windows cuts it off)
pub fn waiting_line(app: &AppHandle) -> Option<String> {
    names_line(&app.state::<Edges>().named.lock().unwrap())
}

fn names_line(names: &[String]) -> Option<String> {
    if names.is_empty() {
        return None;
    }
    let first: Vec<String> = names.iter().take(3).map(|n| n.chars().take(20).collect()).collect();
    let more = if names.len() > 3 { format!(" and {} more", names.len() - 3) } else { String::new() };
    Some(format!("waiting: {}{more}", first.join(", ")))
}

// ---- Settings → edge ----

#[tauri::command]
pub fn set_edge(app: AppHandle, edge: Edge) {
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.edge = edge.tidy();
        s.clone()
    };
    settings::save(&app, &snapshot);
    nudge(&app);
}

/// Show a sample on every monitor for a few seconds, whatever is in front
#[tauri::command]
pub fn try_edge(app: AppHandle) {
    *app.state::<Edges>().trying.lock().unwrap() = Some(Instant::now() + TRY);
    nudge(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: -1080, y: 40, w: 1080, h: 1880 };

    #[test]
    fn strips_hug_their_side() {
        assert_eq!(strip_of(AREA, 1.0, "bottom"), Rect { x: -1080, y: 1790, w: 1080, h: 130 });
        assert_eq!(strip_of(AREA, 1.0, "top"), Rect { x: -1080, y: 40, w: 1080, h: 130 });
        assert_eq!(strip_of(AREA, 1.0, "left"), Rect { x: -1080, y: 40, w: 130, h: 1880 });
        assert_eq!(strip_of(AREA, 2.0, "right"), Rect { x: -260, y: 40, w: 260, h: 1880 });
    }

    #[test]
    fn unknown_choices_go_back_to_the_default() {
        let e = Edge { look: "lasers".into(), side: "".into(), strength: "clear".into(), ..Edge::default() }.tidy();
        assert_eq!((e.look.as_str(), e.side.as_str(), e.strength.as_str()), ("thread", "bottom", "clear"));
    }

    #[test]
    fn off_in_older_settings() {
        let s: settings::Settings = serde_json::from_str(r#"{"wallpaper": "paws"}"#).unwrap();
        assert!(!s.edge.on && !s.edge.tray);
    }

    #[test]
    fn the_tooltip_stays_short() {
        let names: Vec<String> = ["WhatsApp", "Slack", "Gmail", "Teams", "Discord"].iter().map(|s| s.to_string()).collect();
        assert_eq!(names_line(&names[..2]).unwrap(), "waiting: WhatsApp, Slack");
        assert_eq!(names_line(&names).unwrap(), "waiting: WhatsApp, Slack, Gmail and 2 more");
        assert_eq!(names_line(&[]), None);
    }
}
