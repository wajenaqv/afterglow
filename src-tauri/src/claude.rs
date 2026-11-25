// Claude Code as a job (jobs.rs), through its hooks: small commands it runs
// at certain moments. Ours hand the event to the local endpoint
// (POST /hook/claude) with curl, which comes with Windows and macOS.
//
// "connect" in Settings adds them to ~/.claude/settings.json (a copy is kept
// beside it), "disconnect" takes out exactly those. They run in the
// background ("async") and fail silently, so Claude Code never waits for
// AfterGlow nor mentions it when it isn't running. They answer nothing, so
// they can't allow or block anything Claude does.
//
// An event carries the prompt or a tool's output too. Only the fields of
// `Event` are read; the rest is dropped unread.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;

use crate::jobs::{self, Report};

/// How our hooks are told apart from others
const MARK: &str = "127.0.0.1:47811/hook/claude";
/// Asking you something happens in these tools too
const ASKING: &str = "AskUserQuestion|ExitPlanMode";
/// (event, matcher)
const EVENTS: &[(&str, &str)] = &[
    ("UserPromptSubmit", ""),
    ("PreToolUse", ASKING),
    ("PermissionRequest", ""),
    ("Notification", ""),
    ("PostToolUse", ""),
    ("PostToolUseFailure", ""),
    ("Stop", ""),
    ("StopFailure", ""),
    ("SessionEnd", ""),
];

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Event {
    session_id: String,
    hook_event_name: String,
    cwd: String,
    notification_type: String,
    background_tasks: Vec<Task>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Task {
    #[serde(rename = "type")]
    kind: String,
    status: String,
}

fn report_of(e: &Event) -> Option<Report> {
    Some(match e.hook_event_name.as_str() {
        "UserPromptSubmit" => Report::Start,
        "PreToolUse" | "PermissionRequest" => Report::Needs,
        "Notification" => match e.notification_type.as_str() {
            "permission_prompt" | "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => Report::Needs,
            _ => return None,
        },
        "PostToolUse" | "PostToolUseFailure" => Report::Going,
        // a turn can end while its own agents still work; a server left
        // running in the background doesn't count
        "Stop" if e.background_tasks.iter().any(|t| t.kind.contains("agent") && t.status == "running") => Report::Going,
        "Stop" => Report::Done,
        "StopFailure" => Report::Failed,
        "SessionEnd" => Report::End,
        _ => return None,
    })
}

/// The folder's name, from a Windows or Unix path
fn folder(cwd: &str) -> &str {
    cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("")
}

pub fn handle(app: &AppHandle, e: Event) -> Result<(), String> {
    if !jobs::valid_id(&e.session_id) {
        return Err("no session_id".into());
    }
    if let Some(report) = report_of(&e) {
        let name = jobs::tidy_name(&format!("Claude {}", folder(&e.cwd)));
        jobs::report(app, &e.session_id, &name, true, report);
    }
    Ok(())
}

// ---- connecting ----

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Claude Code isn't on this computer
    Missing,
    Off,
    On,
    /// Its settings file can't be read
    Unreadable,
}

fn dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(d.into());
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join(".claude"))
}

fn read(file: &PathBuf) -> Result<Value, String> {
    match fs::read_to_string(file) {
        Ok(text) if text.trim().is_empty() => Ok(json!({})),
        Ok(text) => match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
            Ok(v @ Value::Object(_)) => Ok(v),
            _ => Err(format!("{} isn't valid JSON, so it was left alone", file.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn is_ours(handler: &Value) -> bool {
    let said = |v: &Value| v.as_str().is_some_and(|s| s.contains(MARK));
    said(&handler["command"]) || handler["args"].as_array().is_some_and(|a| a.iter().any(said))
}

/// The hooks for one event: no shell (args), so quoting can't go wrong
fn group(event: &str, matcher: &str) -> Value {
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut handler = json!({
        "type": "command",
        "command": curl,
        "args": ["-s", "-m", "2", "-o", if cfg!(windows) { "NUL" } else { "/dev/null" }, "-H", "Expect:", "--data-binary", "@-", format!("http://{MARK}")],
        "timeout": 3,
        "async": true
    });
    // the session is going away: a background one would be cut off
    if event == "SessionEnd" {
        handler.as_object_mut().unwrap().remove("async");
    }
    if matcher.is_empty() { json!({ "hooks": [handler] }) } else { json!({ "matcher": matcher, "hooks": [handler] }) }
}

/// Take our hooks out, leaving everything else as it was
fn without(mut settings: Value) -> Value {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else { return settings };
    let mut emptied = Vec::new();
    let mut touched = false;
    for (event, groups) in hooks.iter_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        let mut mine = false;
        groups.retain_mut(|g| {
            let Some(list) = g.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let before = list.len();
            list.retain(|h| !is_ours(h));
            mine |= list.len() != before;
            !(list.is_empty() && before > 0)
        });
        touched |= mine;
        if mine && groups.is_empty() {
            emptied.push(event.clone());
        }
    }
    for event in emptied {
        hooks.shift_remove(&event);
    }
    if touched && hooks.is_empty() {
        settings.as_object_mut().unwrap().shift_remove("hooks");
    }
    settings
}

fn with(settings: Value) -> Result<Value, String> {
    let mut settings = without(settings);
    let odd = "its hooks aren't in the usual form, so they were left alone";
    let hooks = settings.as_object_mut().ok_or(odd)?.entry("hooks").or_insert(json!({})).as_object_mut().ok_or(odd)?;
    for (event, matcher) in EVENTS {
        hooks.entry(*event).or_insert(json!([])).as_array_mut().ok_or(odd)?.push(group(event, matcher));
    }
    Ok(settings)
}

fn connected(settings: &Value) -> bool {
    settings["hooks"].as_object().is_some_and(|h| {
        h.values().filter_map(Value::as_array).flatten().filter_map(|g| g["hooks"].as_array()).flatten().any(is_ours)
    })
}

pub fn status() -> Status {
    match dir() {
        Some(d) if d.is_dir() => match read(&d.join("settings.json")) {
            Ok(v) if connected(&v) => Status::On,
            Ok(_) => Status::Off,
            Err(_) => Status::Unreadable,
        },
        _ => Status::Missing,
    }
}

#[tauri::command]
pub fn connect_claude(on: bool) -> Result<(), String> {
    let dir = dir().filter(|d| d.is_dir()).ok_or("Claude Code isn't on this computer")?;
    connect_in(&dir, on)?;
    crate::alog!("afterglow: Claude Code hooks {}", if on { "added" } else { "removed" });
    Ok(())
}

fn connect_in(dir: &std::path::Path, on: bool) -> Result<(), String> {
    let file = dir.join("settings.json");
    let before = read(&file)?;
    let after = if on { with(before.clone())? } else { without(before.clone()) };
    if after == before {
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&after).map_err(|e| e.to_string())? + "\n";
    if file.exists() {
        fs::copy(&file, dir.join("settings.before-afterglow.json")).map_err(|e| e.to_string())?;
    }
    // written beside it, then swapped in: never half a file
    let next = dir.join("settings.afterglow-new.json");
    fs::write(&next, text).map_err(|e| e.to_string())?;
    // (a settings.json that links elsewhere stays a link)
    let target = fs::canonicalize(&file).unwrap_or(file);
    if let Err(e) = fs::rename(&next, &target) {
        let _ = fs::remove_file(&next);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theirs() -> Value {
        json!({ "model": "opus", "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }], "Odd": "x" }, "env": {} })
    }

    #[test]
    fn connecting_keeps_the_rest_and_disconnecting_undoes_it() {
        let on = with(theirs()).unwrap();
        assert!(connected(&on) && !connected(&theirs()));
        assert_eq!(on["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(with(on.clone()).unwrap(), on); // twice is once
        let off = without(on);
        assert_eq!(off.to_string(), theirs().to_string()); // the order too
        assert_eq!(without(with(json!({})).unwrap()), json!({}));
    }

    #[test]
    fn the_file_round_trips_and_a_broken_one_is_left_alone() {
        let dir = std::env::temp_dir().join(format!("afterglow-claude-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        fs::write(&file, theirs().to_string()).unwrap();
        connect_in(&dir, true).unwrap();
        assert!(connected(&read(&file).unwrap()));
        assert_eq!(fs::read_to_string(dir.join("settings.before-afterglow.json")).unwrap(), theirs().to_string());
        connect_in(&dir, false).unwrap();
        assert_eq!(read(&file).unwrap(), theirs());
        fs::write(&file, "{ oops").unwrap();
        assert!(connect_in(&dir, true).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{ oops");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn odd_hooks_are_left_alone() {
        assert!(with(json!({ "hooks": [] })).is_err());
        assert!(with(json!({ "hooks": { "Stop": "x" } })).is_err());
    }

    #[test]
    fn events_become_reports() {
        let e = |text: &str| report_of(&serde_json::from_str::<Event>(text).unwrap());
        assert_eq!(e(r#"{"hook_event_name":"UserPromptSubmit","prompt":"hi"}"#), Some(Report::Start));
        assert_eq!(e(r#"{"hook_event_name":"Notification","notification_type":"permission_prompt"}"#), Some(Report::Needs));
        assert_eq!(e(r#"{"hook_event_name":"Notification","notification_type":"idle_prompt"}"#), None);
        assert_eq!(e(r#"{"hook_event_name":"Stop","background_tasks":[]}"#), Some(Report::Done));
        assert_eq!(e(r#"{"hook_event_name":"Stop","background_tasks":[{"type":"subagent","status":"running"}]}"#), Some(Report::Going));
        assert_eq!(e(r#"{"hook_event_name":"Stop","background_tasks":[{"type":"shell","status":"running"}]}"#), Some(Report::Done));
    }

    #[test]
    fn the_folder_names_it() {
        assert_eq!(folder(r"C:\Users\me\Projects\afterglow"), "afterglow");
        assert_eq!(folder("/home/me/site/"), "site");
    }
}
