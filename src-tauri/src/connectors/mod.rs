// Connectors: background watchers that turn activity in other apps into
// signals (signals.rs). Each one reports, now and then, how many things are
// waiting per app ({"whatsapp": 2, "slack": 1}); `report` turns changes into
// signals:
//   a count went up      -> "new" (a pulse in that app's colour)
//   a count changed      -> "unread" with the new count (more jellies)
//   an app's count is 0   -> "clear"
// The first report after a connector starts only records the counts, so
// starting AfterGlow doesn't set off a burst of pulses for old things.
//
// Connectors (each switched on in Settings → connectors, saved):
//   notifications  Windows: the notifications in Windows' notification
//                  centre, per app (notifications.rs). Reads which app, never
//                  the text. Needs AfterGlow registered as a package
//                  (scripts/windows/) and the user's OK.
//   gmail, outlook, spotify   any platform: accounts.rs, signed in with oauth.rs
//   dock           macOS: the badge numbers on Dock icons (platform/macos.rs
//                  dock_badges). Needs the Accessibility permission.
//
// One thread polls every connector that's switched on (every 2 s; each
// connector says how often it wants to run).

#[cfg(windows)]
pub mod notifications;
pub mod accounts;
pub mod oauth;

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::signals::{self, Signal};

/// The connectors this build offers: (id, name in Settings)
pub fn available() -> Vec<(&'static str, &'static str)> {
    let mut v = Vec::new();
    #[cfg(windows)]
    v.push(("notifications", "Windows notifications"));
    #[cfg(target_os = "macos")]
    v.push(("dock", "Dock badges"));
    v.extend(accounts::IDS.iter().copied());
    v
}

/// What each connector last saw, and how it's doing (for Settings)
#[derive(Default)]
pub struct Connectors {
    counts: Mutex<HashMap<String, HashMap<String, u32>>>,
    status: Mutex<BTreeMap<String, Status>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Status {
    /// "ok", "off", "setup" (needs something from the user), "error"
    pub state: String,
    /// One line for Settings
    pub text: String,
}

pub(crate) fn set_status(app: &AppHandle, id: &str, state: &str, text: impl Into<String>) {
    let status = Status { state: state.into(), text: text.into() };
    let before = app.state::<Connectors>().status.lock().unwrap().insert(id.into(), status.clone());
    if before.map(|b| b.state != status.state || (b.state != "ok" && b.text != status.text)).unwrap_or(true) {
        crate::alog!("afterglow: connector {id}: {}: {}", status.state, status.text);
    }
}

/// Compare a connector's new per-app counts with the last ones and send the
/// signals for what changed (see the top of this file).
pub fn report(app: &AppHandle, connector: &str, now: HashMap<String, u32>) {
    let conns = app.state::<Connectors>();
    let mut all = conns.counts.lock().unwrap();
    let first = !all.contains_key(connector);
    let before = all.insert(connector.to_string(), now.clone()).unwrap_or_default();
    drop(all);
    let mut sources: Vec<&String> = before.keys().chain(now.keys()).collect();
    sources.sort();
    sources.dedup();
    for source in sources {
        let (old, new) = (before.get(source).copied().unwrap_or(0), now.get(source).copied().unwrap_or(0));
        if !first && new > old {
            send(app, source, "new", None);
        }
        if first || new != old {
            send(app, source, if new == 0 { "clear" } else { "unread" }, Some(new));
        }
    }
}

/// Forget what a connector saw (it was switched off): its apps' counts go to 0
pub fn forget(app: &AppHandle, connector: &str) {
    let before = app.state::<Connectors>().counts.lock().unwrap().remove(connector).unwrap_or_default();
    for source in before.keys() {
        send(app, source, "clear", None);
    }
}

fn send(app: &AppHandle, source: &str, kind: &str, count: Option<u32>) {
    let sig = Signal { source: source.to_string(), kind: kind.to_string(), count, colour: None, afterglow: None };
    if let Err(e) = signals::handle(app, sig) {
        crate::alog!("afterglow: connector signal for {source}: {e}");
    }
}

/// An app's display name -> a signal source ("Microsoft Teams" -> "teams",
/// "WhatsApp" -> "whatsapp"), so known apps pulse in their own colour
pub fn source_name(display: &str) -> String {
    let lower = display.to_lowercase();
    for known in ["whatsapp", "telegram", "signal", "slack", "teams", "discord", "outlook", "gmail", "spotify", "messages", "mail"] {
        if lower.contains(known) {
            return known.to_string();
        }
    }
    let slug: String = lower.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let slug = slug.trim_matches('-').chars().take(32).collect::<String>();
    if slug.is_empty() { "app".into() } else { slug }
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut due: HashMap<&'static str, Instant> = HashMap::new();
        let mut was_on: HashMap<&'static str, bool> = HashMap::new();
        loop {
            thread::sleep(Duration::from_secs(2));
            let enabled = app.state::<Host>().settings.lock().unwrap().connectors.clone();
            for (id, _) in available() {
                let on = enabled.get(id).copied().unwrap_or(false);
                if !on {
                    if was_on.insert(id, false) == Some(true) {
                        forget(&app, id);
                    }
                    set_status(&app, id, "off", "off");
                    continue;
                }
                was_on.insert(id, true);
                if due.get(id).is_some_and(|t| Instant::now() < *t) {
                    continue;
                }
                let every = poll(&app, id);
                due.insert(id, Instant::now() + every);
            }
        }
    });
}

/// Run one connector once; returns how long until it wants to run again
fn poll(app: &AppHandle, id: &str) -> Duration {
    match id {
        #[cfg(windows)]
        "notifications" => match notifications::counts() {
            Ok(counts) => {
                let total: u32 = counts.values().sum();
                set_status(app, id, "ok", format!("watching; {total} notification(s) waiting"));
                report(app, id, counts);
                Duration::from_secs(2)
            }
            Err(notifications::Problem::Setup(text)) => {
                set_status(app, id, "setup", text);
                Duration::from_secs(10)
            }
            Err(notifications::Problem::Error(text)) => {
                set_status(app, id, "error", text);
                Duration::from_secs(10)
            }
        },
        #[cfg(target_os = "macos")]
        "dock" => {
            if !crate::platform::accessibility_trusted(false) {
                set_status(app, id, "setup", "needs the Accessibility permission: System Settings → Privacy & Security → Accessibility → AfterGlow");
                return Duration::from_secs(5);
            }
            match crate::platform::dock_badges() {
                Ok(badges) => {
                    let counts: HashMap<String, u32> = badges.into_iter().map(|(name, n)| (source_name(&name), n)).fold(HashMap::new(), |mut m, (k, n)| {
                        *m.entry(k).or_insert(0) += n;
                        m
                    });
                    let total: u32 = counts.values().sum();
                    set_status(app, id, "ok", format!("watching; {total} waiting on Dock badges"));
                    report(app, id, counts);
                }
                Err(e) => set_status(app, id, "error", e),
            }
            Duration::from_secs(2)
        }
        "gmail" | "outlook" | "spotify" => accounts::poll(app, id),
        _ => Duration::from_secs(60),
    }
}

/// Settings: which connectors exist here, whether they're on, how they're doing
#[derive(Serialize)]
pub struct ConnectorInfo {
    id: String,
    name: String,
    on: bool,
    status: Option<Status>,
}

#[tauri::command]
pub fn connectors_state(app: AppHandle) -> Vec<ConnectorInfo> {
    let enabled = app.state::<Host>().settings.lock().unwrap().connectors.clone();
    let status = app.state::<Connectors>().status.lock().unwrap().clone();
    available()
        .into_iter()
        .map(|(id, name)| ConnectorInfo { id: id.into(), name: name.into(), on: enabled.get(id).copied().unwrap_or(false), status: status.get(id).cloned() })
        .collect()
}

/// Switch a connector on or off (saved). Switching one on asks the system
/// for whatever permission it needs.
#[tauri::command]
pub fn set_connector(app: AppHandle, id: String, on: bool) -> Result<(), String> {
    if !available().iter().any(|(c, _)| *c == id) {
        return Err(format!("unknown connector {id}"));
    }
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.connectors.insert(id.clone(), on);
        s.clone()
    };
    crate::settings::save(&app, &snapshot);
    if on {
        match id.as_str() {
            #[cfg(windows)]
            "notifications" => {
                // Windows asks the user once; it must be asked from the UI thread
                let _ = app.run_on_main_thread(notifications::request_access);
            }
            #[cfg(target_os = "macos")]
            "dock" => {
                crate::platform::accessibility_trusted(true); // shows macOS's prompt
            }
            _ => {}
        }
    }
    Ok(())
}
