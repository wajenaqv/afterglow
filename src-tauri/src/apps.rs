// The apps AfterGlow has heard from (Settings → apps), saved in
// settings.json: each one is allowed or blocked, and says what its messages
// do. An app is remembered the first time it signals; until then it gets the
// answer for new apps ("allowed" or "blocked") and the built-in behaviour: a
// pulse in its own colour, and what's waiting brings in jellies.
//
// Blocked means nothing at all: no pulse, flash, lantern or jellies. Counts
// keep being recorded (signals.rs), so unblocking shows what's waiting.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::{self, Host};
use crate::settings::{self, Settings};
use crate::signals;

/// Known apps: (source, name, colour). Any other app is brand green.
const KNOWN: &[(&str, &str, [u8; 3])] = &[
    ("whatsapp", "WhatsApp", [0x25, 0xd3, 0x66]),
    ("signal", "Signal", [0x3a, 0x76, 0xf0]),
    ("telegram", "Telegram", [0x29, 0xa9, 0xeb]),
    ("slack", "Slack", [0xe0, 0x1e, 0x5a]),
    ("teams", "Microsoft Teams", [0x7b, 0x83, 0xeb]),
    ("discord", "Discord", [0x58, 0x65, 0xf2]),
    ("gmail", "Gmail", [0xea, 0x43, 0x35]),
    ("outlook", "Outlook", [0x28, 0x8e, 0xe8]),
    ("mail", "Mail", [0x4a, 0xa8, 0xff]),
    ("messages", "Messages", BRAND),
    ("spotify", "Spotify", [0x1d, 0xb9, 0x54]),
    ("steam", "Steam", [0x66, 0xc0, 0xf4]),
    ("onedrive", "OneDrive", BRAND),
    ("microsoft-onedrive", "OneDrive", BRAND),
    ("snipping-tool", "Snipping Tool", BRAND),
    ("windows-security", "Windows Security", BRAND),
    ("windows-powershell", "Windows PowerShell", BRAND),
    ("nvidia-app", "NVIDIA App", BRAND),
];
const BRAND: [u8; 3] = [0x33, 0xff, 0x99];

/// Apps that notify a lot about nothing anyone waits for: blocked until allowed
const NOISY: &[&str] = &["onedrive", "microsoft-onedrive", "snipping-tool", "windows-security", "windows-powershell", "nvidia-app"];

/// At most this many apps are remembered (scripts can invent names)
const MAX: usize = 200;
/// A "last seen" time is written to disk at most this often per app (ms)
const SAVE_EVERY: u64 = 3_600_000;

/// Every app, by source name
pub type Apps = BTreeMap<String, App>;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct App {
    /// The name the system gave it
    pub name: String,
    pub blocked: bool,
    /// What a new message does: "pulse" or "flash"
    pub on_new: String,
    /// "#rrggbb" for the pulse, or "" for the app's own colour
    pub colour: String,
    /// Whether what's waiting brings in jellies
    pub count: bool,
    /// When it last had something new (Unix time, ms; 0 = not yet)
    pub seen: u64,
}

impl Default for App {
    fn default() -> Self {
        App { name: String::new(), blocked: false, on_new: "pulse".into(), colour: String::new(), count: true, seen: 0 }
    }
}

impl App {
    /// The colour for its pulses and lanterns
    pub fn colour_for(&self, source: &str) -> [u8; 3] {
        parse_colour(&self.colour).unwrap_or_else(|| own_colour(source))
    }
}

pub fn parse_colour(s: &str) -> Option<[u8; 3]> {
    let hex = s.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(hex, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

/// A source name: 1-32 letters, digits, - _ .
pub fn valid_source(s: &str) -> bool {
    !s.is_empty() && s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

fn own_colour(source: &str) -> [u8; 3] {
    KNOWN.iter().find(|(id, _, _)| *id == source).map(|(_, _, c)| *c).unwrap_or(BRAND)
}

fn known_name(source: &str) -> Option<&'static str> {
    KNOWN.iter().find(|(id, _, _)| *id == source).map(|(_, name, _)| *name)
}

/// An app not heard from before
fn new_app(s: &Settings, source: &str) -> App {
    App { blocked: s.new_apps_blocked || NOISY.contains(&source), ..App::default() }
}

/// What this app's signals do
pub fn get(app: &AppHandle, source: &str) -> App {
    if source == "simulator" {
        return App::default();
    }
    let host = app.state::<Host>();
    let s = host.settings.lock().unwrap();
    s.apps.get(source).cloned().unwrap_or_else(|| new_app(&s, source))
}

/// Change the settings, then save them
fn change(app: &AppHandle, f: impl FnOnce(&mut Settings)) {
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        f(&mut s);
        s.clone()
    };
    settings::save(app, &snapshot);
}

/// An app signalled: remember it. `new` = it has something new (not only a count).
pub fn heard(app: &AppHandle, source: &str, new: bool) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        let first = !s.apps.contains_key(source);
        if first {
            if s.apps.len() >= MAX {
                return;
            }
            let fresh = new_app(&s, source);
            s.apps.insert(source.to_string(), fresh);
        }
        let Some(a) = s.apps.get_mut(source) else { return };
        if a.name.is_empty() {
            a.name = crate::connectors::display_name(source).unwrap_or_default();
        }
        let stale = now.saturating_sub(a.seen) > SAVE_EVERY;
        if new {
            a.seen = now;
        }
        if !first && !(new && stale) {
            return; // nothing worth writing to disk
        }
        s.clone()
    };
    settings::save(app, &snapshot);
}

/// An account or Steam was connected on purpose: its app is in the list and
/// allowed, whatever the answer for new apps (one already there is left alone)
pub fn connected(app: &AppHandle, source: &str) {
    change(app, |s| {
        s.apps.entry(source.to_string()).or_default();
    });
}

/// Settings from before this list kept rules: turn them into apps
/// (settings::load). "nothing" becomes blocked; a rule the same as the
/// built-in behaviour only says the app was seen.
pub fn migrate(s: &mut Settings) {
    if !s.rules.is_empty() || s.connectors.values().any(|on| *on) {
        s.apps_setup_done = true;
    }
    for r in std::mem::take(&mut s.rules) {
        if r.source == "*" {
            s.new_apps_blocked |= r.on_new == "nothing";
            continue;
        }
        if s.apps.contains_key(&r.source) || !valid_source(&r.source) {
            continue;
        }
        let plain = r.on_new == "pulse" && r.colour.is_empty() && r.count;
        let a = if plain {
            App { blocked: NOISY.contains(&r.source.as_str()), ..App::default() }
        } else {
            App {
                blocked: r.on_new == "nothing",
                on_new: if r.on_new == "flash" { "flash".into() } else { "pulse".into() },
                colour: r.colour,
                count: r.count,
                ..App::default()
            }
        };
        s.apps.insert(r.source, a);
    }
    // what's connected on purpose stays allowed
    for id in ["gmail", "outlook", "spotify", "steam"] {
        if s.connectors.get(id) == Some(&true) {
            s.apps.entry(id.to_string()).or_default();
        }
    }
}

/// The old rules, only read by migrate
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Rule {
    pub source: String,
    pub on_new: String,
    pub colour: String,
    pub count: bool,
}

impl Default for Rule {
    fn default() -> Self {
        Rule { source: "*".into(), on_new: "pulse".into(), colour: String::new(), count: true }
    }
}

// ---- Settings ----

#[derive(Serialize)]
pub struct AppInfo {
    source: String,
    name: String,
    allowed: bool,
    on_new: String,
    colour: String,
    own_colour: String,
    count: bool,
    seen: u64,
    waiting: u32,
}

#[derive(Serialize)]
pub struct AppsState {
    new_apps_blocked: bool,
    setup_done: bool,
    apps: Vec<AppInfo>,
}

fn shown_name(source: &str, a: &App) -> String {
    match known_name(source) {
        Some(name) => name.to_string(),
        None if a.name.is_empty() => source.to_string(),
        None => a.name.clone(),
    }
}

#[tauri::command]
pub fn apps_state(app: AppHandle) -> AppsState {
    let waiting = app.state::<signals::Bus>().unread();
    let host = app.state::<Host>();
    let s = host.settings.lock().unwrap();
    let mut apps = Vec::new();
    for (source, a) in &s.apps {
        let c = own_colour(source);
        apps.push(AppInfo {
            source: source.clone(),
            name: shown_name(source, a),
            allowed: !a.blocked,
            on_new: a.on_new.clone(),
            colour: a.colour.clone(),
            own_colour: format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]),
            count: a.count,
            seen: a.seen,
            waiting: waiting.get(source).copied().unwrap_or(0),
        });
    }
    AppsState { new_apps_blocked: s.new_apps_blocked, setup_done: s.apps_setup_done, apps }
}

/// Change one app (saved, and shown on the wallpaper at once)
#[tauri::command]
pub fn set_app(app: AppHandle, source: String, allowed: bool, on_new: String, colour: String, count: bool) -> Result<(), String> {
    if !["pulse", "flash"].contains(&on_new.as_str()) {
        return Err("pulse or flash".into());
    }
    if !colour.is_empty() && parse_colour(&colour).is_none() {
        return Err("colour: #rrggbb".into());
    }
    change(&app, |s| {
        if let Some(a) = s.apps.get_mut(&source) {
            a.blocked = !allowed;
            a.on_new = on_new;
            a.colour = colour;
            a.count = count;
        }
    });
    if !allowed {
        signals::drop_waiting(&app, &source);
    }
    signals::refresh(&app);
    Ok(())
}

/// Add an app before it has been heard from (allowed); returns its source name
#[tauri::command]
pub fn add_app(app: AppHandle, name: String) -> Result<String, String> {
    let name: String = name.trim().chars().take(32).collect();
    let source = crate::connectors::source_name(&name);
    if name.is_empty() || !valid_source(&source) || source == "simulator" {
        return Err("type the app's name".into());
    }
    let full = app.state::<Host>().settings.lock().unwrap().apps.len() >= MAX;
    if full {
        return Err("the list is full".into());
    }
    change(&app, |s| {
        s.apps.entry(source.clone()).or_insert_with(|| App { name, ..App::default() });
    });
    signals::refresh(&app);
    Ok(source)
}

/// What apps not heard from before get
#[tauri::command]
pub fn set_new_apps(app: AppHandle, blocked: bool) {
    change(&app, |s| s.new_apps_blocked = blocked);
}

/// The first-time card was finished or skipped
#[tauri::command]
pub fn finish_apps_setup(app: AppHandle) {
    change(&app, |s| s.apps_setup_done = true);
}

/// Show what this app's message looks like (nothing is left waiting, and it
/// shows even while you're away or in Do Not Disturb: you asked)
#[tauri::command]
pub fn preview_app(app: AppHandle, source: String) {
    let a = get(&app, &source);
    let reaction = if a.on_new == "flash" {
        signals::Reaction::Flash
    } else {
        signals::Reaction::Pulse { colour: a.colour_for(&source), afterglow: 4.0, source }
    };
    host::emit_to_walls(&app, "reaction", reaction);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(source: &str, on_new: &str, colour: &str) -> Rule {
        Rule { source: source.into(), on_new: on_new.into(), colour: colour.into(), count: true }
    }

    #[test]
    fn old_rules_become_apps() {
        let mut s = Settings::default();
        s.rules = vec![rule("teams", "nothing", ""), rule("claude", "pulse", "#f20707"), rule("onedrive", "pulse", ""), rule("build", "pulse", "")];
        migrate(&mut s);
        assert!(s.rules.is_empty() && s.apps_setup_done);
        assert!(s.apps["teams"].blocked);
        assert!(!s.apps["claude"].blocked && s.apps["claude"].colour == "#f20707");
        assert!(s.apps["onedrive"].blocked);
        assert!(!s.apps["build"].blocked);
    }

    #[test]
    fn star_nothing_blocks_new_apps_only() {
        let mut s = Settings::default();
        s.rules = vec![rule("*", "nothing", ""), rule("slack", "pulse", "")];
        migrate(&mut s);
        assert!(s.new_apps_blocked && !s.apps["slack"].blocked);
    }

    #[test]
    fn a_fresh_install_still_needs_setup() {
        let mut s = Settings::default();
        migrate(&mut s);
        assert!(!s.apps_setup_done && s.apps.is_empty());
    }
}
