// Keep awake: stops the computer going to sleep, by hand (tray, Settings →
// awake) or while chosen apps run or are in front.
//
// One thread looks every 2 s, or at once when something is changed (nudge).
// It reads the list of running apps only when the user picked some. The
// system drops our request by itself if AfterGlow ends, crashes included.
//
// The commands and the tray never call the thread's work themselves: on
// macOS reading the apps hops to the main thread, where they run, and the two
// would wait for each other. For the same reason no lock is held while
// calling platform::.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::{platform, tray};

/// By hand: (id, name in the tray)
pub const CHOICES: &[(&str, &str)] = &[("off", "Off"), ("30", "For 30 minutes"), ("60", "For 1 hour"), ("120", "For 2 hours"), ("on", "Until turned off")];

const LINGER_MINUTES: &[u32] = &[0, 1, 5];
const MAX_APPS: usize = 50;

/// Saved in settings.json
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Awake {
    /// Keep the screen on too, not only the computer
    pub screen: bool,
    /// Also on battery
    pub on_battery: bool,
    /// How long to stay awake after the app's gone, in minutes
    pub linger: u32,
    pub apps: Vec<AwakeApp>,
}

impl Default for Awake {
    fn default() -> Self {
        Awake { screen: false, on_battery: false, linger: 1, apps: Vec::new() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AwakeApp {
    /// Windows: the program's file name ("obs64.exe"); macOS: the bundle id
    pub id: String,
    pub name: String,
    /// Only while it's in front, instead of whenever it runs
    #[serde(default)]
    pub front: bool,
}

/// An app running now (platform::running_apps)
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RunningApp {
    pub id: String,
    pub name: String,
    /// It has a window (or on macOS a Dock icon), so it's listed first
    pub windowed: bool,
    pub front: bool,
}

/// The switch by hand. Not saved: AfterGlow always starts with it off.
/// Wall-clock time, so "for 1 hour" also ends if the computer was put to sleep.
#[derive(Clone, Copy, Debug, Default)]
struct Manual {
    /// Index into CHOICES; 0 is off
    choice: usize,
    until: Option<SystemTime>,
}

#[derive(Clone, Debug, Default)]
struct Now {
    held: bool,
    /// Wanted, but the battery rule says no
    battery: bool,
    reason: String,
    since: Option<SystemTime>,
    error: Option<String>,
}

/// Shared state (Tauri's `manage`)
#[derive(Default)]
pub struct Keeper {
    manual: Mutex<Manual>,
    now: Mutex<Now>,
    nudged: Mutex<bool>,
    wake: Condvar,
}

impl Keeper {
    fn nudge(&self) {
        *self.nudged.lock().unwrap() = true;
        self.wake.notify_one();
    }

    /// The tray's line: why it's awake, or why it isn't although it should be
    pub fn line(&self) -> Option<String> {
        let now = self.now.lock().unwrap();
        if now.error.is_some() {
            Some("Couldn't keep it awake".into())
        } else if now.battery {
            Some("Not awake: on battery".into())
        } else if now.held {
            Some(format!("Awake: {}", now.reason))
        } else {
            None
        }
    }

    /// The choice in use, for the tray's ticks
    pub fn choice(&self) -> &'static str {
        CHOICES[self.manual.lock().unwrap().choice].0
    }
}

/// Something else changed (a job): look again now
pub fn nudge(app: &AppHandle) {
    app.state::<Keeper>().nudge();
}

/// Which of the picked apps count right now: the first one's reason.
/// `seen` remembers when each last matched, so it lingers.
fn app_reason(prefs: &Awake, running: &[RunningApp], seen: &mut HashMap<String, SystemTime>, now: SystemTime) -> Option<String> {
    seen.retain(|id, _| prefs.apps.iter().any(|a| a.id == *id));
    let mut lingering = None;
    for app in &prefs.apps {
        if running.iter().any(|r| r.id == app.id && (!app.front || r.front)) {
            seen.insert(app.id.clone(), now);
        }
    }
    for app in &prefs.apps {
        let Some(at) = seen.get(&app.id) else { continue };
        if *at == now {
            return Some(format!("{} is {}", app.name, if app.front { "in front" } else { "running" }));
        }
        // a clock set back gives an error here: then it isn't lingering
        let gone = now.duration_since(*at).unwrap_or(Duration::MAX);
        if gone < Duration::from_secs(prefs.linger as u64 * 60) && lingering.is_none() {
            lingering = Some(format!("{} was {} a moment ago", app.name, if app.front { "in front" } else { "running" }));
        }
    }
    lingering
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut seen = HashMap::new();
        loop {
            tick(&app, &mut seen);
            let keeper = app.state::<Keeper>();
            let guard = keeper.nudged.lock().unwrap();
            // wait 2 s, or until nudged (the flag covers a nudge during tick)
            let (mut guard, _) = keeper.wake.wait_timeout_while(guard, Duration::from_secs(2), |nudged| !*nudged).unwrap();
            *guard = false;
        }
    });
}

fn tick(app: &AppHandle, seen: &mut HashMap<String, SystemTime>) {
    let keeper = app.state::<Keeper>();
    let prefs = app.state::<Host>().settings.lock().unwrap().awake.clone();
    let now = SystemTime::now();

    let (manual, ended) = {
        let mut m = keeper.manual.lock().unwrap();
        let ended = m.until.is_some_and(|t| now >= t);
        if ended {
            *m = Manual::default();
        }
        (*m, ended)
    };
    let running = if prefs.apps.is_empty() { Vec::new() } else { platform::running_apps() };
    let by_app = app_reason(&prefs, &running, seen, now);
    let reason = if manual.choice != 0 { Some("you turned it on".to_string()) } else { by_app.or_else(|| crate::jobs::awake_reason(app)) };
    let battery = reason.is_some() && !prefs.on_battery && platform::on_battery();
    let hold = reason.is_some() && !battery;

    let result = platform::keep_awake(hold, hold && prefs.screen);
    let next_held = hold && result.is_ok();
    let reason = reason.unwrap_or_default();
    let mut last = keeper.now.lock().unwrap();
    let changed = last.held != next_held || last.reason != reason || last.battery != battery || last.error != result.clone().err();
    if changed {
        match (&result, next_held) {
            (Err(e), _) => crate::alog!("afterglow: keep awake failed: {e}"),
            (_, true) => crate::alog!("afterglow: keeping the computer awake: {reason}"),
            (_, false) if battery => crate::alog!("afterglow: not keeping awake: on battery ({reason})"),
            (_, false) => crate::alog!("afterglow: no longer keeping the computer awake"),
        }
    }
    let since = if next_held { last.since.or(Some(now)) } else { None };
    *last = Now { held: next_held, battery, reason, since, error: result.err() };
    drop(last);
    if changed || ended {
        tray::sync(app);
    }
}

/// By hand, from the tray or Settings
pub fn choose(app: &AppHandle, choice: &str) -> Result<(), String> {
    let index = CHOICES.iter().position(|(id, _)| *id == choice).ok_or_else(|| format!("unknown choice {choice}"))?;
    // "off" and "on" aren't numbers: no end time
    let until = choice.parse::<u64>().ok().map(|m| SystemTime::now() + Duration::from_secs(m * 60));
    let keeper = app.state::<Keeper>();
    *keeper.manual.lock().unwrap() = Manual { choice: index, until };
    keeper.nudge();
    tray::sync(app);
    Ok(())
}

// ---- Settings → awake ----

#[tauri::command]
pub fn set_awake_now(app: AppHandle, choice: String) -> Result<(), String> {
    choose(&app, &choice)
}

#[tauri::command]
pub fn set_awake(app: AppHandle, awake: Awake) -> Result<(), String> {
    if !LINGER_MINUTES.contains(&awake.linger) {
        return Err(format!("unsupported number of minutes {}", awake.linger));
    }
    if awake.apps.len() > MAX_APPS || awake.apps.iter().any(|a| a.id.is_empty() || a.id.len() > 260 || a.name.len() > 260) {
        return Err("too many apps, or a name that's too long".into());
    }
    let snapshot = {
        let host = app.state::<Host>();
        let mut s = host.settings.lock().unwrap();
        s.awake = awake;
        s.clone()
    };
    crate::settings::save(&app, &snapshot);
    app.state::<Keeper>().nudge();
    tray::sync(&app);
    Ok(())
}

#[derive(Serialize)]
pub struct AwakeState {
    choice: &'static str,
    held: bool,
    battery: bool,
    reason: String,
    /// Minutes kept awake so far, and left on the switch by hand
    minutes: u64,
    left: Option<u64>,
    error: Option<String>,
}

#[tauri::command]
pub fn awake_state(app: AppHandle) -> AwakeState {
    let keeper = app.state::<Keeper>();
    let manual = *keeper.manual.lock().unwrap();
    let now = keeper.now.lock().unwrap().clone();
    let clock = SystemTime::now();
    AwakeState {
        choice: CHOICES[manual.choice].0,
        held: now.held,
        battery: now.battery,
        reason: now.reason,
        minutes: now.since.and_then(|t| clock.duration_since(t).ok()).map_or(0, |d| d.as_secs() / 60),
        left: manual.until.map(|t| t.duration_since(clock).map_or(0, |d| d.as_secs().div_ceil(60))),
        error: now.error,
    }
}

/// The apps running now, for the picker
#[tauri::command]
pub fn awake_apps() -> Vec<RunningApp> {
    let mut apps = platform::running_apps();
    apps.sort_by_key(|a| (!a.windowed, a.name.to_lowercase()));
    apps
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs(front: bool, linger: u32) -> Awake {
        Awake { linger, apps: vec![AwakeApp { id: "obs64.exe".into(), name: "obs64".into(), front }], ..Default::default() }
    }
    fn running(front: bool) -> Vec<RunningApp> {
        vec![RunningApp { id: "obs64.exe".into(), name: "obs64".into(), windowed: true, front }]
    }
    fn at(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000 + secs)
    }

    #[test]
    fn running_is_enough_unless_it_must_be_in_front() {
        let mut seen = HashMap::new();
        assert!(app_reason(&prefs(false, 0), &running(false), &mut seen, at(0)).is_some());
        let mut seen = HashMap::new();
        assert!(app_reason(&prefs(true, 0), &running(false), &mut seen, at(0)).is_none());
        assert!(app_reason(&prefs(true, 0), &running(true), &mut seen, at(0)).is_some());
    }

    #[test]
    fn lingers_after_the_app_closes() {
        let p = prefs(false, 1);
        let mut seen = HashMap::new();
        app_reason(&p, &running(false), &mut seen, at(0));
        assert!(app_reason(&p, &[], &mut seen, at(59)).is_some());
        assert!(app_reason(&p, &[], &mut seen, at(60)).is_none());
    }

    #[test]
    fn no_linger_lets_go_at_once() {
        let p = prefs(false, 0);
        let mut seen = HashMap::new();
        app_reason(&p, &running(false), &mut seen, at(0));
        assert!(app_reason(&p, &[], &mut seen, at(2)).is_none());
    }

    #[test]
    fn a_removed_app_stops_counting() {
        let mut seen = HashMap::new();
        app_reason(&prefs(false, 5), &running(false), &mut seen, at(0));
        assert!(app_reason(&Awake::default(), &running(false), &mut seen, at(1)).is_none());
        assert!(seen.is_empty());
    }

    #[test]
    fn other_apps_do_not_count() {
        let other = vec![RunningApp { id: "notepad.exe".into(), name: "notepad".into(), windowed: true, front: true }];
        assert!(app_reason(&prefs(false, 1), &other, &mut HashMap::new(), at(0)).is_none());
    }

    #[test]
    fn older_settings_get_the_defaults() {
        let a: Awake = serde_json::from_str("{}").unwrap();
        assert!(!a.screen && !a.on_battery && a.linger == 1 && a.apps.is_empty());
    }
}
