// What the user picked, saved as JSON in the app's config folder
// (Windows: %APPDATA%\com.wajenaqv.afterglow\settings.json,
//  macOS: ~/Library/Application Support/com.wajenaqv.afterglow/settings.json):
//   wallpaper         which one (an id below)
//   options           per wallpaper, its URL options, e.g. {"jellyfish": {"tint": "cool"}}
//   pause_fullscreen  the tray's pause rules
//   pause_on_battery
//   pause_covered     pause a monitor's wallpaper while app windows hide it
//   fps              frame rate for every wallpaper: 30 (smooth), 20 (light), 15 (eco)
//
// Also the commands the Settings window calls (get_settings, set_wallpaper, set_fps).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::{self, Host};
use crate::tray;

/// The wallpapers: (id, name in the tray). Each is a page wallpapers/<id>.html.
/// Keep in sync with src/wallpapers/catalog.js.
pub const WALLPAPERS: &[(&str, &str)] = &[("jellyfish", "Jellyfish"), ("big-jellyfish", "Big jellyfish"), ("paws", "Paw prints")];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub wallpaper: String,
    pub options: BTreeMap<String, BTreeMap<String, String>>,
    pub pause_fullscreen: bool,
    pub pause_on_battery: bool,
    pub pause_covered: bool,
    pub fps: u32,
}

/// The frame rates on offer (Settings → performance)
pub const FPS_CHOICES: &[u32] = &[30, 20, 15];

impl Default for Settings {
    fn default() -> Self {
        Settings { wallpaper: "jellyfish".into(), options: BTreeMap::new(), pause_fullscreen: true, pause_on_battery: true, pause_covered: true, fps: 30 }
    }
}

impl Settings {
    /// The chosen wallpaper's options as a URL query ("tint=cool&count=3"),
    /// plus the frame rate when it isn't the default 30.
    pub fn query(&self) -> String {
        let mut parts: Vec<String> = self
            .options
            .get(&self.wallpaper)
            .map(|opts| opts.iter().filter(|(k, v)| safe(k) && safe(v)).map(|(k, v)| format!("{k}={v}")).collect())
            .unwrap_or_default();
        if self.fps != 30 && FPS_CHOICES.contains(&self.fps) {
            parts.push(format!("fps={}", self.fps));
        }
        parts.join("&")
    }
}

pub fn is_known(id: &str) -> bool {
    WALLPAPERS.iter().any(|(w, _)| *w == id)
}

/// Option keys and values are short words like "cool" or "3": anything else
/// is dropped, so nothing odd ever reaches a page URL.
fn safe(s: &str) -> bool {
    !s.is_empty() && s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let mut s: Settings = path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if !is_known(&s.wallpaper) {
        s.wallpaper = Settings::default().wallpaper;
    }
    if !FPS_CHOICES.contains(&s.fps) {
        s.fps = 30;
    }
    s
}

pub fn save(app: &AppHandle, s: &Settings) {
    let Some(p) = path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(s) {
        if let Err(e) = fs::write(&p, text) {
            eprintln!("afterglow: could not save settings to {}: {e}", p.display());
        }
    }
}

/// Switch every monitor to wallpaper `id`. `options` replaces that
/// wallpaper's saved options; None keeps them (the tray's quick switch).
pub fn choose(app: &AppHandle, id: &str, options: Option<BTreeMap<String, String>>) -> Result<(), String> {
    if !is_known(id) {
        return Err(format!("unknown wallpaper {id}"));
    }
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.wallpaper = id.to_string();
        if let Some(opts) = options {
            let clean = opts.into_iter().filter(|(k, v)| safe(k) && safe(v)).collect();
            s.options.insert(id.to_string(), clean);
        }
        s.clone()
    };
    save(app, &snapshot);
    host::show_wallpaper(app);
    tray::sync(app);
    Ok(())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    app.state::<Host>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_wallpaper(app: AppHandle, id: String, options: BTreeMap<String, String>) -> Result<(), String> {
    choose(&app, &id, Some(options))
}

/// The frame rate for every wallpaper (reloads them with the new rate).
#[tauri::command]
pub fn set_fps(app: AppHandle, fps: u32) -> Result<(), String> {
    if !FPS_CHOICES.contains(&fps) {
        return Err(format!("unsupported frame rate {fps}"));
    }
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.fps = fps;
        s.clone()
    };
    save(&app, &snapshot);
    host::show_wallpaper(&app);
    tray::sync(&app);
    Ok(())
}
