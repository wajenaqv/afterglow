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
// ({ "type": "pulse" | "count" | "flash", ... }); each wallpaper does what it
// can with them (src/wallpapers/catalog.js lists which).
//
// Signals come from the Settings window's simulator (send_signal) and the
// local endpoint (endpoint.rs). Real app connectors come next.

use std::collections::BTreeMap;
use std::sync::Mutex;

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
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Reaction {
    Pulse { colour: [u8; 3], afterglow: f32, source: String },
    Count { n: u32 },
    Flash,
}

/// Unread counts per app (Tauri's `manage`)
#[derive(Default)]
pub struct Bus {
    unread: Mutex<BTreeMap<String, u32>>,
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
            match on_new {
                "nothing" => {
                    eprintln!("afterglow: signal from {source} ignored by a rule");
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
                    Reaction::Pulse { colour, afterglow, source }
                }
            }
        }
        "unread" => {
            let n = sig.count.ok_or("unread needs a count")?.min(9999);
            // a rule can keep an app's count out of "waiting"
            if rule.as_ref().is_some_and(|r| !r.count) {
                bus.unread.lock().unwrap().remove(&source);
            } else {
                bus.unread.lock().unwrap().insert(source, n);
            }
            Reaction::Count { n: bus.total() }
        }
        "clear" => {
            bus.unread.lock().unwrap().remove(&source);
            Reaction::Count { n: bus.total() }
        }
        "flash" => Reaction::Flash,
        other => return Err(format!("kind: new, unread, clear or flash (got {other})")),
    };
    // Do Not Disturb: no pulses or flashes (counts still update)
    if matches!(reaction, Reaction::Pulse { .. } | Reaction::Flash)
        && app.state::<host::Host>().settings.lock().unwrap().quiet_dnd
        && crate::platform::do_not_disturb()
    {
        eprintln!("afterglow: signal -> {reaction:?} held back: Do Not Disturb");
        return Ok(());
    }
    eprintln!("afterglow: signal -> {reaction:?}");
    host::emit_to_walls(app, "reaction", reaction);
    Ok(())
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
    eprintln!("afterglow: wall: {}", msg.chars().take(200).collect::<String>());
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
