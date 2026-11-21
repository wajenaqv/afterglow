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
// Rules (Settings → rules, Rule below) can change what an app's signals do;
// without one, the defaults:
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
// monitor's wallpaper paused or hidden, or no input for AWAY_SECS) are held
// and replayed one after another when you're back (replay_missed, called
// each second by the host's pause loop).
//
// Signals come from the Settings window's simulator (send_signal), the
// local endpoint (endpoint.rs) and the connectors.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host;

/// App colours for pulses (lowercase source name -> RGB); anything else
/// pulses in the brand green
const COLOURS: &[(&str, [u8; 3])] = &[
    ("whatsapp", [0x25, 0xd3, 0x66]),
    ("signal", [0x3a, 0x76, 0xf0]),
    ("telegram", [0x29, 0xa9, 0xeb]),
    ("slack", [0xe0, 0x1e, 0x5a]),
    ("teams", [0x7b, 0x83, 0xeb]),
    ("discord", [0x58, 0x65, 0xf2]),
    ("gmail", [0xea, 0x43, 0x35]),
    ("outlook", [0x28, 0x8e, 0xe8]),
    ("mail", [0x4a, 0xa8, 0xff]),
    ("spotify", [0x1d, 0xb9, 0x54]),
    ("steam", [0x66, 0xc0, 0xf4]),
];
const BRAND: [u8; 3] = [0x33, 0xff, 0x99];

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
    /// pulses and flashes that arrived while you were away (with their app)
    missed: Mutex<Vec<(String, Reaction)>>,
    /// the latest signals and what became of each (Settings → activity)
    activity: Mutex<VecDeque<Activity>>,
}

/// One signal, for the activity page (debugging: which app triggered what,
/// when, and what AfterGlow did with it)
#[derive(Serialize, Clone, Debug)]
pub struct Activity {
    /// Unix time, milliseconds
    pub at: u64,
    pub source: String,
    /// new, unread, clear or flash
    pub kind: String,
    pub count: Option<u32>,
    /// what happened: pulse #rrggbb, flash, counted, ignored by a rule,
    /// held (Do Not Disturb or away), replayed
    pub result: String,
}
const ACTIVITY_MAX: usize = 500;

fn record(app: &AppHandle, source: &str, kind: &str, count: Option<u32>, result: String) {
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let bus = app.state::<Bus>();
    let mut log = bus.activity.lock().unwrap();
    log.push_back(Activity { at, source: source.to_string(), kind: kind.to_string(), count, result });
    while log.len() > ACTIVITY_MAX {
        log.pop_front();
    }
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
    pub fn total(&self) -> u32 {
        self.unread.lock().unwrap().values().sum()
    }
}

fn parse_colour(s: &str) -> Option<[u8; 3]> {
    let hex = s.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(hex, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

fn colour_for(source: &str) -> [u8; 3] {
    COLOURS.iter().find(|(name, _)| *name == source).map(|(_, c)| *c).unwrap_or(BRAND)
}

/// A rule (Settings → rules): what an app's signals do. The first rule whose
/// source matches wins; "*" matches any app. Apps without one: pulse in
/// their own colour, count as waiting.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Rule {
    /// An app name ("whatsapp", "gmail", "build", …) or "*" for any app
    pub source: String,
    /// What a new message does: "pulse", "flash" or "nothing"
    pub on_new: String,
    /// "#rrggbb" for the pulse, or "" for the app's own colour
    pub colour: String,
    /// Whether its waiting count brings in jellies
    pub count: bool,
}

impl Default for Rule {
    fn default() -> Self {
        Rule { source: "*".into(), on_new: "pulse".into(), colour: String::new(), count: true }
    }
}

fn rule_for(app: &AppHandle, source: &str) -> Option<Rule> {
    let host = app.state::<host::Host>();
    let s = host.settings.lock().unwrap();
    s.rules.iter().find(|r| r.source == source).or_else(|| s.rules.iter().find(|r| r.source == "*")).cloned()
}

/// Settings → rules: replace the rules (checked and saved)
#[tauri::command]
pub fn set_rules(app: AppHandle, rules: Vec<Rule>) -> Result<(), String> {
    let mut clean = Vec::new();
    for mut r in rules {
        r.source = r.source.trim().to_ascii_lowercase();
        if r.source.is_empty() || r.source.len() > 32 || !(r.source == "*" || r.source.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))) {
            return Err(format!("rule app name: letters, digits, - _ . or * (got {})", r.source));
        }
        if !["pulse", "flash", "nothing"].contains(&r.on_new.as_str()) {
            return Err("rule: pulse, flash or nothing".into());
        }
        if !r.colour.is_empty() && parse_colour(&r.colour).is_none() {
            return Err(format!("rule colour: #rrggbb (got {})", r.colour));
        }
        clean.push(r);
    }
    let host = app.state::<host::Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.rules = clean;
        s.clone()
    };
    crate::settings::save(&app, &snapshot);
    Ok(())
}

/// Check a signal and turn it into reactions.
pub fn handle(app: &AppHandle, sig: Signal) -> Result<(), String> {
    let source = sig.source.trim().to_ascii_lowercase();
    if source.is_empty() || source.len() > 32 || !source.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err("source: 1-32 letters, digits, - _ .".into());
    }
    let bus = app.state::<Bus>();
    // The user's rule for this app (Settings → rules), if any
    let rule = rule_for(app, &source);
    let reaction = match sig.kind.as_str() {
        "new" => {
            let on_new = rule.as_ref().map(|r| r.on_new.as_str()).unwrap_or("pulse");
            let reaction = match on_new {
                "nothing" => {
                    crate::alog!("afterglow: signal from {source} ignored by a rule");
                    record(app, &source, "new", None, "ignored (its rule says nothing)".into());
                    return Ok(());
                }
                "flash" => Reaction::Flash,
                _ => {
                    let colour = match (&sig.colour, rule.as_ref().and_then(|r| parse_colour(&r.colour))) {
                        (_, Some(ruled)) => ruled,
                        (Some(c), None) => parse_colour(c).ok_or("colour: #rrggbb")?,
                        (None, None) => colour_for(&source),
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
            // a rule can keep an app's count out of "waiting"
            if rule.as_ref().is_some_and(|r| !r.count) {
                bus.unread.lock().unwrap().remove(&source);
            } else {
                bus.unread.lock().unwrap().insert(source.clone(), n);
            }
            // read down below what was seen: the next rise lights it again
            if let Some(s) = bus.seen.lock().unwrap().get_mut(&source) {
                *s = (*s).min(n);
            }
            if n == 0 {
                bus.pending.lock().unwrap().remove(&source);
            }
            Reaction::Count { n: bus.total() }
        }
        "clear" => {
            bus.unread.lock().unwrap().remove(&source);
            bus.pending.lock().unwrap().remove(&source);
            bus.seen.lock().unwrap().remove(&source);
            Reaction::Count { n: bus.total() }
        }
        "flash" => Reaction::Flash,
        other => return Err(format!("kind: new, unread, clear or flash (got {other})")),
    };
    if sig.kind != "flash" {
        emit_lanterns(app);
    }
    // Do Not Disturb: no pulses or flashes (counts and lanterns still update)
    if matches!(reaction, Reaction::Pulse { .. } | Reaction::Flash)
        && app.state::<host::Host>().settings.lock().unwrap().quiet_dnd
        && crate::platform::do_not_disturb()
    {
        crate::alog!("afterglow: signal -> {reaction:?} held back: Do Not Disturb");
        record(app, &source, &sig.kind, sig.count, "held back (Do Not Disturb)".into());
        return Ok(());
    }
    // Away: held, and replayed when you're back
    if matches!(reaction, Reaction::Pulse { .. } | Reaction::Flash) && !watching(app) {
        let mut missed = bus.missed.lock().unwrap();
        if missed.len() < MISSED_MAX {
            missed.push((source.clone(), reaction.clone()));
        }
        crate::alog!("afterglow: signal -> {reaction:?} held: you're away ({} held)", missed.len());
        drop(missed);
        record(app, &source, &sig.kind, sig.count, "held (you're away)".into());
        return Ok(());
    }
    crate::alog!("afterglow: signal -> {reaction:?}");
    let result = match &reaction {
        Reaction::Pulse { colour, .. } => format!("pulse #{:02x}{:02x}{:02x}", colour[0], colour[1], colour[2]),
        Reaction::Flash => "flash".to_string(),
        Reaction::Count { n } => format!("counted ({n} waiting in all)"),
        Reaction::Lanterns { .. } => "lanterns".to_string(),
    };
    record(app, &source, &sig.kind, sig.count, result);
    host::emit_to_walls(app, "reaction", reaction);
    Ok(())
}

// ---- lanterns ----

/// Every app with something waiting that hasn't been seen, in its colour.
/// An app whose rule says "nothing" gets none.
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
            let rule = rule_for(app, &source);
            if rule.as_ref().is_some_and(|r| r.on_new == "nothing") {
                return None;
            }
            let colour = rule.and_then(|r| parse_colour(&r.colour)).unwrap_or_else(|| colour_for(&source));
            Some(Lantern { source, colour })
        })
        .collect()
}

fn emit_lanterns(app: &AppHandle) {
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
    if bus.missed.lock().unwrap().is_empty() || !watching(app) {
        return;
    }
    let held: Vec<(String, Reaction)> = std::mem::take(&mut *bus.missed.lock().unwrap());
    crate::alog!("afterglow: you're back: replaying {} missed", held.len());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        for (source, r) in held {
            record(&app, &source, "new", None, "replayed (you're back)".into());
            host::emit_to_walls(&app, "reaction", r);
            std::thread::sleep(Duration::from_millis(1400));
        }
    });
}

/// The Settings window's simulator
#[tauri::command]
pub fn send_signal(app: AppHandle, signal: Signal) -> Result<(), String> {
    handle(&app, signal)
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
    app.state::<Bus>().total()
}

/// Settings → apps: how many are waiting, per app
#[tauri::command]
pub fn unread_by_app(app: AppHandle) -> BTreeMap<String, u32> {
    app.state::<Bus>().unread.lock().unwrap().clone()
}
