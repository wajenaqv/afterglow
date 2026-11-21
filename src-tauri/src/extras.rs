// Two small features of Settings:
//   rotation   every N minutes, the next wallpaper in the chosen list (each
//              keeps its own options); switched in Settings or the tray
//   save_png   a still of a wallpaper (rendered by the Settings page at the
//              screen's size), saved to Pictures/AfterGlow

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::settings::{self, WALLPAPERS};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Rotate {
    pub on: bool,
    pub minutes: u32,
    /// Wallpaper ids to rotate through (empty = all of them)
    pub walls: Vec<String>,
}

impl Default for Rotate {
    fn default() -> Self {
        Rotate { on: false, minutes: 10, walls: Vec::new() }
    }
}

pub const MINUTES: &[u32] = &[5, 10, 30, 60];

static LAST_SWITCH: Mutex<Option<Instant>> = Mutex::new(None);

pub fn start_rotation(app: &AppHandle) {
    *LAST_SWITCH.lock().unwrap() = Some(Instant::now());
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(15));
        let (rot, current) = {
            let host = app.state::<Host>();
            let s = host.settings.lock().unwrap();
            (s.rotate.clone(), s.wallpaper.clone())
        };
        if !rot.on {
            continue;
        }
        let due = LAST_SWITCH.lock().unwrap().is_none_or(|t| t.elapsed() >= Duration::from_secs(rot.minutes.max(1) as u64 * 60));
        if !due {
            continue;
        }
        let list: Vec<String> = if rot.walls.is_empty() { WALLPAPERS.iter().map(|(id, _)| id.to_string()).collect() } else { rot.walls.clone() };
        if list.len() < 2 {
            continue;
        }
        let next = list.iter().position(|w| *w == current).map(|i| list[(i + 1) % list.len()].clone()).unwrap_or_else(|| list[0].clone());
        if let Err(e) = settings::choose(&app, &next, None) {
            crate::alog!("afterglow: rotation: {e}");
        }
        *LAST_SWITCH.lock().unwrap() = Some(Instant::now());
    });
}

/// Settings → rotation (saved). Turning it on starts the clock afresh.
#[tauri::command]
pub fn set_rotation(app: AppHandle, on: bool, minutes: u32, walls: Vec<String>) -> Result<(), String> {
    if !MINUTES.contains(&minutes) {
        return Err(format!("rotate every 5, 10, 30 or 60 minutes (got {minutes})"));
    }
    let walls: Vec<String> = walls.into_iter().filter(|w| settings::is_known(w)).collect();
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        if on && !s.rotate.on {
            *LAST_SWITCH.lock().unwrap() = Some(Instant::now());
        }
        s.rotate = Rotate { on, minutes, walls };
        s.clone()
    };
    settings::save(&app, &snapshot);
    crate::tray::sync(&app);
    Ok(())
}

/// Save a PNG (base64) as Pictures/AfterGlow/<name>.png; returns the path
#[tauri::command]
pub fn save_png(app: AppHandle, name: String, data: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| format!("not a PNG: {e}"))?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err("not a PNG".into());
    }
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "-_".contains(*c)).take(80).collect();
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("AfterGlow");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.png", if safe.is_empty() { "afterglow" } else { &safe }));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Open the folder the stills are saved in
#[tauri::command]
pub fn open_stills_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("AfterGlow");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

/// Pages Settings may open: the project, the developer consoles the apps
/// page's setup guides point to, and the OS settings pages for notification
/// access (Windows) and Accessibility (macOS). Anything else is refused, so
/// a page can't open arbitrary links or programs.
const LINKS: &[&str] = &[
    "https://github.com/wajenaqv/afterglow",
    "https://console.cloud.google.com/",
    "https://entra.microsoft.com/",
    "https://developer.spotify.com/dashboard",
    "https://steamcommunity.com/dev/apikey",
    "https://steamcommunity.com/my/edit/settings",
    "ms-settings:privacy-notifications",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
];

/// Open one of LINKS in the browser (or the OS settings page)
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    let ok = LINKS.iter().any(|l| if l.starts_with("https://") { url.starts_with(l) } else { url == *l });
    if !ok {
        return Err("not a link AfterGlow opens".into());
    }
    open::that(url).map_err(|e| e.to_string())
}
