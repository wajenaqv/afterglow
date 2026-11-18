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
// Until the rule editor exists, the rules are fixed:
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

/// Check a signal and turn it into reactions.
pub fn handle(app: &AppHandle, sig: Signal) -> Result<(), String> {
    let source = sig.source.trim().to_ascii_lowercase();
    if source.is_empty() || source.len() > 32 || !source.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err("source: 1-32 letters, digits, - _ .".into());
    }
    let bus = app.state::<Bus>();
    let reaction = match sig.kind.as_str() {
        "new" => {
            let colour = match &sig.colour {
                Some(c) => parse_colour(c).ok_or("colour: #rrggbb")?,
                None => colour_for(&source),
            };
            let afterglow = sig.afterglow.unwrap_or(4.0).clamp(0.5, 30.0);
            Reaction::Pulse { colour, afterglow, source }
        }
        "unread" => {
            let n = sig.count.ok_or("unread needs a count")?.min(9999);
            bus.unread.lock().unwrap().insert(source, n);
            Reaction::Count { n: bus.total() }
        }
        "clear" => {
            bus.unread.lock().unwrap().remove(&source);
            Reaction::Count { n: bus.total() }
        }
        "flash" => Reaction::Flash,
        other => return Err(format!("kind: new, unread, clear or flash (got {other})")),
    };
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
