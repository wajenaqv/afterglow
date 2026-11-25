// Commands from the local endpoint (endpoint.rs, POST /command), for buttons
// such as a Stream Deck's:
//
//   {"do":"pause"}   {"do":"resume"}   {"do":"toggle-pause"}
//   {"do":"next"}    {"do":"previous"} {"do":"wallpaper","id":"sakura"}
//
// next and previous go through the rotation's list (every wallpaper when it
// names none), whether or not rotation is on.

use std::sync::atomic::Ordering;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::host::{self, Host};
use crate::{extras, settings};

#[derive(Deserialize)]
pub struct Command {
    /// `do` is a Rust keyword, so the field has another name here
    #[serde(rename = "do")]
    pub action: String,
    /// "wallpaper" only: which one
    #[serde(default)]
    pub id: Option<String>,
}

pub fn handle(app: &AppHandle, cmd: Command) -> Result<(), String> {
    match cmd.action.as_str() {
        "pause" => host::set_paused(app.clone(), true),
        "resume" => host::set_paused(app.clone(), false),
        "toggle-pause" => {
            let on = app.state::<Host>().user_paused.load(Ordering::Relaxed);
            host::set_paused(app.clone(), !on);
        }
        "next" => extras::step_wallpaper(app, true)?,
        "previous" => extras::step_wallpaper(app, false)?,
        "wallpaper" => settings::choose(app, &cmd.id.unwrap_or_default(), None)?,
        _ => return Err("do: pause, resume, toggle-pause, next, previous or wallpaper (with id)".into()),
    }
    crate::alog!("afterglow: command {}", cmd.action);
    Ok(())
}
