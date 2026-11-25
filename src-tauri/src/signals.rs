// The signal bus: signals come in, reactions go out to the wallpapers.
//
// A signal says something happened in some app:
//   { "source": "whatsapp", "kind": "new" }                 a message arrived
//   { "source": "gmail", "kind": "unread", "count": 14 }    how many are waiting
//   { "source": "whatsapp", "kind": "clear" }               none waiting any more
//   { "source": "test", "kind": "flash" }                   a quick flash
//   optional: "colour": "#rrggbb" (else the app's own colour, see COLOURS),
//             "afterglow": seconds the pulse takes to fade (default 4)
//
// Each app is allowed or blocked, and can change what its signals do
// (Settings → apps, apps.rs); the defaults:
//   new    -> pulse in the app's colour
//   unread -> count: the total waiting across all apps
//   clear  -> that app's count back to 0
//   flash  -> flash
// Reactions go to every wallpaper window as a "reaction" event
// ({ "type": "pulse" | "count" | "flash" | "lanterns", ... }); each wallpaper
// does what it can with them (src/wallpapers/catalog.js lists which).
//
// Lanterns: so nothing is missed when you weren't looking. Every app with
// something waiting gets a lantern: a jelly that stays lit in its colour
// until the count goes back to 0, or until you rest the cursor on it
// ("seen", dismiss_lantern). An app that only says "new" (a script) keeps
// its lantern until it's seen or cleared. Sent as the whole list on every
// change ({ "type": "lanterns", items: [{ source, colour }] }).
//
// Away: pulses and flashes that arrive while you can't see them (every
// monitor's wallpaper paused or hidden, or no input for AWAY_SECS), or during
// Do Not Disturb when the user wants that quiet, are held
// and replayed one after another when you're back (replay_missed, called
// each second by the host's pause loop).
//
// Signals come from the Settings window's simulator (send_signal), the
// local endpoint (endpoint.rs) and the connectors.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{apps, host};

#[derive(Deserialize, Clone, Debug)]
pub struct Signal {
    pub source: String,
    pub kind: String,
    #[serde(default)]
    pub count: Option<u32>,
    #[serde(default)]
    pub colour: Option<String>,
    #[serde(default)]
    pub afterglow: Option<f32>,
    /// "new" only: false = a pulse and nothing more (no lantern left lit),
    /// for things that aren't waiting for you (a song change, a friend online)
    #[serde(default)]
    pub linger: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Reaction {
    Pulse { colour: [u8; 3], afterglow: f32, source: String },
    Count { n: u32 },
    Flash,
    Lanterns { items: Vec<Lantern> },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Lantern {
    pub source: String,
    pub colour: [u8; 3],
}

/// No keyboard or mouse input for this long counts as away (the
/// AFTERGLOW_AWAY_SECS environment variable overrides it, for testing)
const AWAY_SECS: f64 = 120.0;
fn away_secs() -> f64 {
    std::env::var("AFTERGLOW_AWAY_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(AWAY_SECS)
}
/// At most this many held reactions are replayed
const MISSED_MAX: usize = 12;

/// Unread counts per app, lanterns and held reactions (Tauri's `manage`)
#[derive(Default)]
pub struct Bus {
    unread: Mutex<BTreeMap<String, u32>>,
    /// apps that said "new" without a count: lit until seen or cleared
    pending: Mutex<BTreeSet<String>>,
    /// the count an app had when its lantern was seen (hovered); it lights
    /// again only when the count goes above that
    seen: Mutex<BTreeMap<String, u32>>,
    /// pulses and flashes held back: you were away, or Do Not Disturb was on
    missed: Mutex<Vec<Missed>>,
    /// the latest signals and what became of each (Settings → activity)
    activity: Mutex<VecDeque<Activity>>,
    /// the next activity entry's number
    next_id: AtomicU64,
}

/// A reaction held for later, and its line on the activity page
struct Missed {
    source: String,
    reaction: Reaction,
    entry: u64,
}

/// One signal, for the activity page (debugging: which app triggered what,
/// when, and what AfterGlow did with it)
#[derive(Serialize, Clone, Debug)]
pub struct Activity {
    id: u64,
    /// Unix time, milliseconds
    pub at: u64,
    pub source: String,
    /// new, unread, clear or flash
    pub kind: String,
    pub count: Option<u32>,
    /// what became of it: pulse, flash, counted, blocked, held-away,
    /// held-dnd, replayed, missed (too many were held) or dropped (the app
    /// was blocked while it was held)
    pub outcome: &'static str,
    /// a pulse's colour, "#rrggbb", else ""
    pub colour: String,
}
const ACTIVITY_MAX: usize = 500;

fn record(app: &AppHandle, source: &str, kind: &str, count: Option<u32>, outcome: &'static str, colour: String) -> u64 {
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let bus = app.state::<Bus>();
    let id = bus.next_id.fetch_add(1, Ordering::Relaxed);
    let mut log = bus.activity.lock().unwrap();
    log.push_back(Activity { id, at, source: source.to_string(), kind: kind.to_string(), count, outcome, colour });
    while log.len() > ACTIVITY_MAX {
        log.pop_front();
    }
    id
}

/// A held signal was replayed or dropped: its line says so (no second line,
/// which counted the message twice)
fn settle(app: &AppHandle, id: u64, outcome: &'static str) {
    if let Some(e) = app.state::<Bus>().activity.lock().unwrap().iter_mut().find(|e| e.id == id) {
        e.outcome = outcome;
    }
}

/// The activity page's colour for a reaction
fn colour_of(r: &Reaction) -> String {
    match r {
        Reaction::Pulse { colour: c, .. } => format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]),
        _ => String::new(),
    }
}

/// Keep a pulse or flash for later (replay_missed)
fn hold(app: &AppHandle, sig: &Signal, source: &str, reaction: Reaction, why: &'static str) {
    let bus = app.state::<Bus>();
    let full = bus.missed.lock().unwrap().len() >= MISSED_MAX;
    let entry = record(app, source, &sig.kind, sig.count, if full { "missed" } else { why }, colour_of(&reaction));
    crate::alog!("afterglow: signal -> {reaction:?} {}", if full { "missed: too many held" } else { why });
    if !full {
        bus.missed.lock().unwrap().push(Missed { source: source.to_string(), reaction, entry });
    }
}

/// Do Not Disturb is on, and the user wants it quiet then
fn quiet(app: &AppHandle) -> bool {
    app.state::<host::Host>().settings.lock().unwrap().quiet_dnd && crate::platform::do_not_disturb()
}

/// The activity page: newest first
#[tauri::command]
pub fn activity_log(app: AppHandle) -> Vec<Activity> {
    app.state::<Bus>().activity.lock().unwrap().iter().rev().cloned().collect()
}

#[tauri::command]
pub fn clear_activity(app: AppHandle) {
    app.state::<Bus>().activity.lock().unwrap().clear();
}

impl Bus {
    /// How many are waiting per app, blocked ones too
    pub fn unread(&self) -> BTreeMap<String, u32> {
        self.unread.lock().unwrap().clone()
    }
}

/// How many are waiting in all (the jellies): not blocked apps, nor those
/// whose count is switched off
pub fn total(app: &AppHandle) -> u32 {
    let mut n = 0;
    for (source, waiting) in app.state::<Bus>().unread() {
        let a = apps::get(app, &source);
        if !a.blocked && a.count {
            n += waiting;
        }
    }
    n
}

/// An app was blocked: nothing of it stays lit or held for later
pub fn drop_waiting(app: &AppHandle, source: &str) {
    let bus = app.state::<Bus>();
    bus.pending.lock().unwrap().remove(source);
    let mut dropped = Vec::new();
    bus.missed.lock().unwrap().retain(|m| {
        if m.source == source {
            dropped.push(m.entry);
        }
        m.source != source
    });
    for entry in dropped {
        settle(app, entry, "dropped");
    }
}

/// An app's choices changed: bring the wallpapers up to date
pub fn refresh(app: &AppHandle) {
    emit_lanterns(app);
    host::emit_to_walls(app, "reaction", Reaction::Count { n: total(app) });
}

/// Check a signal and turn it into reactions.
pub fn handle(app: &AppHandle, sig: Signal) -> Result<(), String> {
    process(app, sig, true)
}

/// The same for a try-out (the tray, the simulator): the app isn't
/// remembered as heard from
pub fn handle_test(app: &AppHandle, sig: Signal) -> Result<(), String> {
    process(app, sig, false)
}

fn process(app: &AppHandle, sig: Signal, real: bool) -> Result<(), String> {
    let source = sig.source.trim().to_ascii_lowercase();
    if !apps::valid_source(&source) {
        return Err("source: 1-32 letters, digits, - _ .".into());
    }
    let bus = app.state::<Bus>();
    if real && source != "simulator" && (sig.kind == "new" || (sig.kind == "unread" && sig.count.unwrap_or(0) > 0)) {
        apps::heard(app, &source, sig.kind == "new");
    }
    // What the user chose for this app (Settings → apps)
    let chosen = apps::get(app, &source);
    if chosen.blocked && (sig.kind == "new" || sig.kind == "flash") {
        crate::alog!("afterglow: signal from {source} ignored: blocked");
        record(app, &source, &sig.kind, None, "blocked", String::new());
        return Ok(());
    }
    let reaction = match sig.kind.as_str() {
        "new" => {
            let reaction = match chosen.on_new.as_str() {
                "flash" => Reaction::Flash,
                _ => {
                    let colour = match (&sig.colour, apps::parse_colour(&chosen.colour)) {
                        (Some(c), None) => apps::parse_colour(c).ok_or("colour: #rrggbb")?,
                        _ => chosen.colour_for(&source),
                    };
                    let afterglow = sig.afterglow.unwrap_or(4.0).clamp(0.5, 30.0);
                    Reaction::Pulse { colour, afterglow, source: source.clone() }
                }
            };
            // no count from this app (a script, the simulator): its lantern
            // stays lit until it's seen or cleared
            let unread = bus.unread.lock().unwrap().get(&source).copied().unwrap_or(0);
            if sig.linger != Some(false) && unread == 0 {
                bus.pending.lock().unwrap().insert(source.clone());
                bus.seen.lock().unwrap().remove(&source);
            } else if sig.linger != Some(false) {
                // something new from an app whose waiting ones were all seen
                // (a notification replaced by a new one keeps the count the
                // same): its lantern lights again
                if let Some(seen) = bus.seen.lock().unwrap().get_mut(&source) {
                    if *seen >= unread {
                        *seen = unread - 1;
                    }
                }
            }
            reaction
        }
        "unread" => {
            let n = sig.count.ok_or("unread needs a count")?.min(9999);
            bus.unread.lock().unwrap().insert(source.clone(), n);
            // read down below what was seen: the next rise lights it again
            if let Some(s) = bus.seen.lock().unwrap().get_mut(&source) {
                *s = (*s).min(n);
            }
            if n == 0 {
                bus.pending.lock().unwrap().remove(&source);
            }
            Reaction::Count { n: total(app) }
        }
        "clear" => {
            bus.unread.lock().unwrap().remove(&source);
            bus.pending.lock().unwrap().remove(&source);
            bus.seen.lock().unwrap().remove(&source);
            Reaction::Count { n: total(app) }
        }
        "flash" => Reaction::Flash,
        other => return Err(format!("kind: new, unread, clear or flash (got {other})")),
    };
    if chosen.blocked {
        // recorded (it shows if you unblock the app), nothing drawn
        record(app, &source, &sig.kind, sig.count, "blocked", String::new());
        return Ok(());
    }
    if sig.kind != "flash" {
        emit_lanterns(app);
    }
    if sig.kind == "new" && sig.linger != Some(false) {
        crate::edge::pop(app, &source);
    }
    // Pulses and flashes wait while Do Not Disturb is on or you're away, and
    // are replayed after (counts and lanterns still update)
    if matches!(reaction, Reaction::Pulse { .. } | Reaction::Flash) {
        let why = if quiet(app) { Some("held-dnd") } else if !watching(app) { Some("held-away") } else { None };
        if let Some(why) = why {
            hold(app, &sig, &source, reaction, why);
            return Ok(());
        }
    }
    crate::alog!("afterglow: signal -> {reaction:?}");
    let outcome = match &reaction {
        Reaction::Pulse { .. } => "pulse",
        Reaction::Flash => "flash",
        _ => "counted",
    };
    record(app, &source, &sig.kind, sig.count, outcome, colour_of(&reaction));
    host::emit_to_walls(app, "reaction", reaction);
    Ok(())
}

// ---- lanterns ----

/// Every app with something waiting that hasn't been seen, in its colour.
/// A blocked app gets none.
pub fn lanterns(app: &AppHandle) -> Vec<Lantern> {
    let bus = app.state::<Bus>();
    let unread = bus.unread.lock().unwrap().clone();
    let pending = bus.pending.lock().unwrap().clone();
    let seen = bus.seen.lock().unwrap().clone();
    let mut sources: BTreeSet<String> = unread.iter().filter(|(s, n)| **n > seen.get(*s).copied().unwrap_or(0)).map(|(s, _)| s.clone()).collect();
    sources.extend(pending);
    sources
        .into_iter()
        .filter_map(|source| {
            let chosen = apps::get(app, &source);
            if chosen.blocked {
                return None;
            }
            let colour = chosen.colour_for(&source);
            Some(Lantern { source, colour })
        })
        .collect()
}

fn emit_lanterns(app: &AppHandle) {
    crate::edge::nudge(app);
    host::emit_to_walls(app, "reaction", Reaction::Lanterns { items: lanterns(app) });
}

/// A wallpaper: you rested the cursor on this app's lantern
#[tauri::command]
pub fn dismiss_lantern(app: AppHandle, source: String) {
    let bus = app.state::<Bus>();
    bus.pending.lock().unwrap().remove(&source);
    let n = bus.unread.lock().unwrap().get(&source).copied().unwrap_or(0);
    bus.seen.lock().unwrap().insert(source.clone(), n);
    crate::alog!("afterglow: lantern {source} seen");
    emit_lanterns(&app);
}

/// The lanterns now (for a wallpaper that just loaded)
#[tauri::command]
pub fn lantern_state(app: AppHandle) -> Vec<Lantern> {
    lanterns(&app)
}

// ---- away ----

/// Can you see the wallpaper? Some monitor's wallpaper is showing (not
/// paused or hidden behind windows) and you've touched the keyboard or
/// mouse in the last AWAY_SECS.
pub fn watching(app: &AppHandle) -> bool {
    let host = app.state::<host::Host>();
    let flags = host.last_paused.lock().unwrap();
    let showing = flags.is_empty() || flags.values().any(|f| f.iter().any(|p| !p));
    showing && crate::platform::idle_seconds() < away_secs()
}

/// Each second (host's pause loop): once you're back, replay what you
/// missed, one after another, so the first thing you see is what happened
pub fn replay_missed(app: &AppHandle) {
    let bus = app.state::<Bus>();
    if bus.missed.lock().unwrap().is_empty() || !watching(app) || quiet(app) {
        return;
    }
    let held: Vec<Missed> = std::mem::take(&mut *bus.missed.lock().unwrap());
    crate::alog!("afterglow: you're back: replaying {} missed", held.len());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        for m in held {
            settle(&app, m.entry, "replayed");
            host::emit_to_walls(&app, "reaction", m.reaction);
            std::thread::sleep(Duration::from_millis(1400));
        }
    });
}

/// The Settings window's simulator
#[tauri::command]
pub fn send_signal(app: AppHandle, signal: Signal) -> Result<(), String> {
    handle_test(&app, signal)
}

/// Wallpaper windows report what they did with a reaction (they sit behind
/// the desktop icons, out of reach of the web inspector); printed in the
/// app's log
#[tauri::command]
pub fn wall_log(msg: String) {
    crate::alog!("afterglow: wall: {}", msg.chars().take(200).collect::<String>());
}

/// What a wallpaper that just loaded needs to know (the current count)
#[tauri::command]
pub fn signal_state(app: AppHandle) -> u32 {
    total(&app)
}

/// The Settings status bar: how many are waiting, per app (not blocked ones)
#[tauri::command]
pub fn unread_by_app(app: AppHandle) -> BTreeMap<String, u32> {
    app.state::<Bus>().unread().into_iter().filter(|(s, _)| !apps::get(&app, s).blocked).collect()
}
