// Jobs: long work on this computer (a build, a render, a coding agent) that
// says when it's done, failed or needs you. Off until switched on
// (Settings → jobs).
//
//   POST /job  {"id":"build-1","name":"cargo","state":"start"}
//   states: start, needs (waiting for you), done, failed, end (forget it)
//   POST /hook/claude   Claude Code's own hook events (claude.rs)
//
// A running job shows nothing on the wallpaper (edge has a dim drifting
// light) and can keep the computer awake. One that's done, failed or needs
// you becomes a lantern ("job:<id>") with a pulse, like an app with something
// waiting, until it's seen or goes on. Work shorter than `after` seconds ends
// quietly: you were there. Being asked something only lights after GRACE, for
// the same reason.
//
// Kept in memory only: an id, a name (a program or folder), a state.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::signals::{self, Lantern};
use crate::settings;

pub const PREFIX: &str = "job:";
/// "Say so only when it took at least" (seconds)
pub const AFTER: &[u32] = &[0, 10, 30, 120];
const GRACE: Duration = Duration::from_secs(4);
/// A coding agent that went silent (interrupted, its window closed)
const AGENT_SILENT: Duration = Duration::from_secs(45 * 60);
/// A job that never reported its end
const FORGET: Duration = Duration::from_secs(12 * 3600);
const MAX: usize = 30;

const DONE: [u8; 3] = [0x33, 0xff, 0x99];
const FAILED: [u8; 3] = [0xff, 0x46, 0x3c];
const NEEDS: [u8; 3] = [0xff, 0xb4, 0x32];
const RUNNING: [u8; 3] = [0xbe, 0xe1, 0xff];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Prefs {
    pub on: bool,
    /// A running job keeps the computer awake
    pub awake: bool,
    /// Shorter work than this ends quietly (seconds)
    pub after: u32,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { on: false, awake: true, after: 30 }
    }
}

impl Prefs {
    pub fn tidy(mut self) -> Self {
        if !AFTER.contains(&self.after) {
            self.after = 30;
        }
        self
    }
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Running,
    Needs,
    Done,
    Failed,
}

impl State {
    fn word(self) -> &'static str {
        match self {
            State::Running => "running",
            State::Needs => "needs",
            State::Done => "done",
            State::Failed => "failed",
        }
    }
    fn colour(self) -> [u8; 3] {
        match self {
            State::Running => RUNNING,
            State::Needs => NEEDS,
            State::Done => DONE,
            State::Failed => FAILED,
        }
    }
}

/// What a job reports
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Report {
    Start,
    /// Still at it: answered, or just working (agents only)
    Going,
    Needs,
    Done,
    Failed,
    End,
}

#[derive(Clone, Debug)]
struct Job {
    id: String,
    name: String,
    state: State,
    started: Instant,
    /// When it last reported something
    heard: Instant,
    /// When it got into this state
    since: Instant,
    /// It's a lantern now
    lit: bool,
    /// Needs you, and its lantern was seen: stays dark
    seen: bool,
    agent: bool,
}

#[derive(Default)]
pub struct Jobs {
    list: Mutex<Vec<Job>>,
}

/// Take in a report. True: this job just lit up.
fn apply(list: &mut Vec<Job>, id: &str, name: &str, agent: bool, report: Report, after: Duration, now: Instant) -> bool {
    let at = list.iter().position(|j| j.id == id);
    if report == Report::End {
        if let Some(i) = at {
            list.remove(i);
        }
        return false;
    }
    let known = at.is_some();
    let i = match at {
        Some(i) => i,
        // an agent whose start was never heard: how long it worked isn't known
        None if agent && matches!(report, Report::Done | Report::Failed) => return false,
        None => {
            if list.len() >= MAX {
                list.remove(0);
            }
            list.push(Job { id: id.into(), name: name.into(), state: State::Running, started: now, heard: now, since: now, lit: false, seen: false, agent });
            list.len() - 1
        }
    };
    let j = &mut list[i];
    j.heard = now;
    if !name.is_empty() {
        j.name = name.into();
    }
    match report {
        Report::Start => {
            (j.state, j.started, j.since, j.lit) = (State::Running, now, now, false);
        }
        // reports can overtake each other: after it ended this is an old one
        Report::Going if j.state == State::Needs => {
            (j.state, j.since, j.lit) = (State::Running, now, false);
        }
        Report::Needs if matches!(j.state, State::Running) => {
            // lights after GRACE (due)
            (j.state, j.since, j.seen) = (State::Needs, now, false);
        }
        Report::Done | Report::Failed if matches!(j.state, State::Running | State::Needs) => {
            // (a job first heard of at its end is meant to be shown)
            if known && now.duration_since(j.started) < after {
                list.remove(i);
                return false;
            }
            j.state = if report == Report::Done { State::Done } else { State::Failed };
            (j.since, j.lit) = (now, true);
            return true;
        }
        _ => {}
    }
    false
}

/// As time passes: who has waited for you long enough to light up, and drop
/// what's been forgotten. Returns (ids that lit up, anything dropped).
fn due(list: &mut Vec<Job>, now: Instant) -> (Vec<String>, bool) {
    let before = list.len();
    list.retain(|j| {
        let silent = now.duration_since(j.heard);
        silent < FORGET && !(j.agent && j.state == State::Running && silent >= AGENT_SILENT)
    });
    let mut lit = Vec::new();
    for j in list.iter_mut() {
        if j.state == State::Needs && !j.lit && now.duration_since(j.since) >= GRACE && !j.seen {
            j.lit = true;
            lit.push(j.id.clone());
        }
    }
    (lit, list.len() != before)
}

fn prefs(app: &AppHandle) -> Prefs {
    app.state::<Host>().settings.lock().unwrap().jobs.clone()
}

pub fn report(app: &AppHandle, id: &str, name: &str, agent: bool, report: Report) {
    let p = prefs(app);
    if !p.on {
        return;
    }
    let after = Duration::from_secs(p.after as u64);
    let lit = apply(&mut app.state::<Jobs>().list.lock().unwrap(), id, name, agent, report, after, Instant::now());
    if lit {
        announce(app, id);
    } else if report != Report::Going {
        crate::alog!("afterglow: job {report:?}");
    }
    signals::emit_lanterns(app);
    crate::awake::nudge(app);
}

fn announce(app: &AppHandle, id: &str) {
    let found = app.state::<Jobs>().list.lock().unwrap().iter().find(|j| j.id == id).cloned();
    if let Some(j) = found {
        signals::announce(app, &format!("{PREFIX}{}", j.id), &label(&j), j.state.colour());
    }
}

fn label(j: &Job) -> String {
    match j.state {
        State::Running => format!("{}: running", j.name),
        State::Needs => format!("{}: needs you", j.name),
        State::Done => format!("{}: done", j.name),
        State::Failed => format!("{}: failed", j.name),
    }
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(1));
            let (lit, dropped) = due(&mut app.state::<Jobs>().list.lock().unwrap(), Instant::now());
            for id in &lit {
                announce(&app, id);
            }
            if dropped || !lit.is_empty() {
                signals::emit_lanterns(&app);
                crate::awake::nudge(&app);
            }
        }
    });
}

/// The lanterns of jobs (signals::lanterns adds them to the apps')
pub fn lanterns(app: &AppHandle) -> Vec<Lantern> {
    let list = app.state::<Jobs>().list.lock().unwrap().clone();
    list.iter().filter(|j| j.lit).map(|j| Lantern { source: format!("{PREFIX}{}", j.id), colour: j.state.colour(), kind: j.state.word() }).collect()
}

/// Edge's one drifting light while anything runs
pub fn running_light(app: &AppHandle) -> Option<Lantern> {
    running(app).map(|_| Lantern { source: format!("{PREFIX}:running"), colour: RUNNING, kind: "running" })
}

/// For the tray tooltip
pub fn name_of(app: &AppHandle, source: &str) -> Option<String> {
    let id = source.strip_prefix(PREFIX)?;
    app.state::<Jobs>().list.lock().unwrap().iter().find(|j| j.id == id).map(label)
}

/// The cursor rested on its lantern
pub fn seen(app: &AppHandle, source: &str) {
    let Some(id) = source.strip_prefix(PREFIX) else { return };
    see(&mut app.state::<Jobs>().list.lock().unwrap(), id);
}

fn see(list: &mut Vec<Job>, id: &str) {
    if let Some(i) = list.iter().position(|j| j.id == id) {
        if list[i].state == State::Needs {
            // still waiting, but you know
            list[i].lit = false;
            list[i].seen = true;
        } else if list[i].state != State::Running {
            list.remove(i);
        }
    }
}

fn running(app: &AppHandle) -> Option<String> {
    if !prefs(app).on {
        return None;
    }
    app.state::<Jobs>().list.lock().unwrap().iter().find(|j| j.state == State::Running).map(|j| j.name.clone())
}

/// Why the computer should stay awake (awake.rs)
pub fn awake_reason(app: &AppHandle) -> Option<String> {
    if !prefs(app).awake {
        return None;
    }
    running(app).map(|name| format!("{name} is working"))
}

// ---- the endpoint ----

#[derive(Deserialize)]
pub struct JobPost {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub state: String,
}

/// A name for people: short, no control characters
pub fn tidy_name(s: &str) -> String {
    let s: String = s.chars().filter(|c| !c.is_control()).take(40).collect();
    s.trim().to_string()
}

pub fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

pub fn handle(app: &AppHandle, post: JobPost) -> Result<(), String> {
    if !valid_id(&post.id) {
        return Err("id: 1-64 letters, digits, - _ .".into());
    }
    let what = match post.state.as_str() {
        "start" => Report::Start,
        "needs" => Report::Needs,
        "done" => Report::Done,
        "failed" => Report::Failed,
        "end" => Report::End,
        _ => return Err("state: start, needs, done, failed or end".into()),
    };
    if !prefs(app).on {
        return Err("jobs are off (Settings → jobs)".into());
    }
    let mut name = tidy_name(post.name.as_deref().unwrap_or(""));
    if name.is_empty() {
        name = post.id.clone();
    }
    report(app, &post.id, &name, false, what);
    Ok(())
}

// ---- Settings → jobs ----

#[derive(Serialize)]
pub struct JobRow {
    id: String,
    name: String,
    state: State,
    /// Seconds in this state (running: since it started)
    secs: u64,
}

#[derive(Serialize)]
pub struct JobsState {
    jobs: Vec<JobRow>,
    claude: crate::claude::Status,
}

#[tauri::command]
pub fn jobs_state(app: AppHandle) -> JobsState {
    let now = Instant::now();
    let list = app.state::<Jobs>().list.lock().unwrap().clone();
    let jobs = list
        .iter()
        .rev()
        .map(|j| {
            let from = if j.state == State::Running { j.started } else { j.since };
            JobRow { id: j.id.clone(), name: j.name.clone(), state: j.state, secs: now.duration_since(from).as_secs() }
        })
        .collect();
    JobsState { jobs, claude: crate::claude::status() }
}

#[tauri::command]
pub fn set_jobs(app: AppHandle, jobs: Prefs) {
    let jobs = jobs.tidy();
    if !jobs.on {
        app.state::<Jobs>().list.lock().unwrap().clear();
    }
    let snapshot = {
        let host = app.state::<Host>();
        let mut s = host.settings.lock().unwrap();
        s.jobs = jobs;
        s.clone()
    };
    settings::save(&app, &snapshot);
    signals::emit_lanterns(&app);
    crate::awake::nudge(&app);
}

#[tauri::command]
pub fn forget_job(app: AppHandle, id: String) {
    report(&app, &id, "", false, Report::End);
}

/// "try it": a sample that's over at once
#[tauri::command]
pub fn try_job(app: AppHandle, state: String) -> Result<(), String> {
    let post = |state: &str| JobPost { id: "try-it".into(), name: Some("try it".into()), state: state.into() };
    handle(&app, post("end"))?;
    handle(&app, post(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AFTER30: Duration = Duration::from_secs(30);
    fn s(n: u64) -> Duration {
        Duration::from_secs(n)
    }
    fn send(list: &mut Vec<Job>, agent: bool, r: Report, now: Instant) -> bool {
        apply(list, "a", "a", agent, r, AFTER30, now)
    }

    #[test]
    fn long_work_lights_up_and_short_work_ends_quietly() {
        let (mut l, t) = (Vec::new(), Instant::now());
        send(&mut l, false, Report::Start, t);
        assert!(!send(&mut l, false, Report::Done, t + s(29)));
        assert!(l.is_empty());
        send(&mut l, false, Report::Start, t);
        assert!(send(&mut l, false, Report::Failed, t + s(30)));
        assert_eq!((l[0].state, l[0].lit), (State::Failed, true));
    }

    #[test]
    fn a_job_first_heard_of_at_its_end_is_shown_unless_an_agent() {
        let (mut l, t) = (Vec::new(), Instant::now());
        assert!(!send(&mut l, true, Report::Done, t) && l.is_empty());
        assert!(send(&mut l, false, Report::Done, t));
    }

    #[test]
    fn needing_you_lights_after_a_moment_and_goes_out_when_answered() {
        let (mut l, t) = (Vec::new(), Instant::now());
        send(&mut l, true, Report::Start, t);
        send(&mut l, true, Report::Needs, t + s(5));
        // Claude Code says it twice (PermissionRequest, then Notification)
        send(&mut l, true, Report::Needs, t + s(6));
        assert!(due(&mut l, t + s(8)).0.is_empty());
        assert_eq!(due(&mut l, t + s(9)).0, vec!["a"]);
        send(&mut l, true, Report::Going, t + s(20));
        assert_eq!((l[0].state, l[0].lit), (State::Running, false));
    }

    #[test]
    fn a_late_report_does_not_restart_what_ended() {
        let (mut l, t) = (Vec::new(), Instant::now());
        send(&mut l, true, Report::Start, t);
        send(&mut l, true, Report::Done, t + s(60));
        send(&mut l, true, Report::Going, t + s(61));
        assert_eq!(l[0].state, State::Done);
        // the next prompt does
        send(&mut l, true, Report::Start, t + s(90));
        assert_eq!((l[0].state, l[0].lit), (State::Running, false));
    }

    #[test]
    fn seen_goes_dark_and_stays_dark() {
        let (mut l, t) = (Vec::new(), Instant::now());
        send(&mut l, true, Report::Start, t);
        send(&mut l, true, Report::Needs, t + s(1));
        due(&mut l, t + s(6));
        see(&mut l, "a");
        assert!(!l[0].lit && due(&mut l, t + s(20)).0.is_empty());
        send(&mut l, true, Report::Done, t + s(60));
        see(&mut l, "a");
        assert!(l.is_empty());
    }

    #[test]
    fn a_silent_agent_is_forgotten_but_a_long_build_is_not() {
        let (mut l, t) = (Vec::new(), Instant::now());
        apply(&mut l, "a", "a", true, Report::Start, AFTER30, t);
        apply(&mut l, "b", "b", false, Report::Start, AFTER30, t);
        assert!(due(&mut l, t + AGENT_SILENT).1);
        assert_eq!(l.len(), 1);
        assert!(due(&mut l, t + FORGET).1 && l.is_empty());
    }

    #[test]
    fn off_in_older_settings() {
        let s: settings::Settings = serde_json::from_str("{}").unwrap();
        assert!(!s.jobs.on);
    }
}
