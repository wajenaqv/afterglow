// What the user picked, saved as JSON in the app's config folder
// (Windows: %APPDATA%\com.wajenaqv.afterglow\settings.json,
//  macOS: ~/Library/Application Support/com.wajenaqv.afterglow/settings.json):
//   wallpaper         which one (an id below)
//   options           per wallpaper, its URL options, e.g. {"jellyfish": {"tint": "cool"}}
//   pause_fullscreen  the pause rules
//   pause_on_battery
//   pause_covered     pause a monitor's wallpaper while app windows hide it
//   quiet_dnd         no pulses or flashes during Do Not Disturb
//   oled             OLED care: slow shift, black when paused or you're away
//   awake            keep awake: the apps, screen too, battery, how long after
//   edge             light at a screen edge while windows hide the desktop (edge.rs)
//   jobs             long work that says when it's done (jobs.rs)
//   fps              frame rate for every wallpaper: 30 (smooth), 20 (light), 15 (eco)
//   theme            the Settings window's colours: afterglow, dark or light
//
// Also the commands the Settings window calls (get_settings, set_wallpaper, set_fps, set_renderer).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::{self, Host};
use crate::tray;

/// The wallpapers: (id, name in the tray). Each is a page wallpapers/<id>.html.
/// Keep in sync with src/wallpapers/catalog.js.
pub const WALLPAPERS: &[(&str, &str)] = &[("jellyfish", "Jellyfish"), ("big-jellyfish", "Big jellyfish"), ("paws", "Paw prints"), ("cloudsea", "Cloud sea"), ("sakura", "Sakura"), ("constellation", "Constellation"), ("startrails", "Star trails"), ("currents", "Currents"), ("magnet", "Magnet"), ("attractor", "Attractor"), ("silk", "Silk"), ("radar", "Radar"), ("life", "Phosphor life"), ("circuit", "Circuit board"), ("impossible", "Impossible"), ("clock", "Clock")];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub wallpaper: String,
    pub options: BTreeMap<String, BTreeMap<String, String>>,
    pub pause_fullscreen: bool,
    pub pause_on_battery: bool,
    pub pause_covered: bool,
    /// No pulses or flashes while the OS is in Do Not Disturb (counts still update)
    pub quiet_dnd: bool,
    pub fps: u32,
    /// "auto" (GPU when it works, else CPU), "gpu" or "cpu"
    pub renderer: String,
    /// Connectors switched on (connectors/mod.rs), by id
    pub connectors: BTreeMap<String, bool>,
    /// App registrations for the account connectors (client id, secret), by id
    pub clients: BTreeMap<String, crate::connectors::oauth::Client>,
    /// The apps heard from: allowed or blocked, and what they do (apps.rs)
    pub apps: crate::apps::Apps,
    /// Apps not heard from before start blocked
    pub new_apps_blocked: bool,
    /// The apps page's first-time card was finished or skipped
    pub apps_setup_done: bool,
    /// What older versions saved instead; load() turns them into apps
    #[serde(skip_serializing)]
    pub rules: Vec<crate::apps::Rule>,
    /// Rotating through wallpapers (extras.rs)
    pub rotate: crate::extras::Rotate,
    /// Steam connector parts and Steam ID (connectors/steam.rs; the key is in the keychain)
    pub steam: crate::connectors::steam::SteamPrefs,
    /// The hover clock (extras.rs, hoverclock.js)
    pub clock: crate::extras::Clock,
    /// Hovering a jelly scrambles its characters (off: ?scramble=0)
    pub scramble: bool,
    /// OLED care (src/wallpapers/oled.js; host.rs apply_pause says when to rest)
    pub oled: bool,
    /// ...which rests the screen after this many minutes away
    pub oled_minutes: u32,
    /// Keep awake: which apps, screen, battery (awake.rs)
    pub awake: crate::awake::Awake,
    /// Long work that says when it's done (jobs.rs)
    pub jobs: crate::jobs::Prefs,
    /// Light at a screen edge, and the tray icon's colour (edge.rs)
    pub edge: crate::edge::Edge,
    /// Look for a newer version once a day (updates.rs)
    pub check_updates: bool,
    /// The Settings window's colours (src/themes.css)
    /// New installs start dark; a settings file from before themes stays green
    #[serde(default = "theme_before_themes")]
    pub theme: String,
}

/// The frame rates on offer (Settings → power)
pub const FPS_CHOICES: &[u32] = &[30, 20, 15];
/// OLED care's choices of minutes away
pub const OLED_MINUTES: &[u32] = &[2, 5, 10, 30];
/// The rendering choices (Settings → power)
pub const RENDERERS: &[&str] = &["auto", "gpu", "cpu"];
/// The themes (Settings → general)
pub const THEMES: &[&str] = &["afterglow", "dark", "light"];

fn theme_before_themes() -> String {
    "afterglow".into()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            wallpaper: "jellyfish".into(),
            options: BTreeMap::new(),
            pause_fullscreen: true,
            pause_on_battery: true,
            pause_covered: true,
            quiet_dnd: true,
            fps: 30,
            renderer: "auto".into(),
            connectors: BTreeMap::new(),
            clients: BTreeMap::new(),
            apps: Default::default(),
            new_apps_blocked: false,
            apps_setup_done: false,
            rules: Vec::new(),
            rotate: Default::default(),
            steam: Default::default(),
            clock: Default::default(),
            scramble: true,
            oled: false,
            oled_minutes: 5,
            awake: Default::default(),
            edge: Default::default(),
            jobs: Default::default(),
            check_updates: true,
            theme: "dark".into(),
        }
    }
}

impl Settings {
    /// The chosen wallpaper's options as a URL query ("tint=cool&count=3"),
    /// plus the frame rate and renderer when they aren't the defaults.
    pub fn query(&self) -> String {
        let mut parts: Vec<String> = self
            .options
            .get(&self.wallpaper)
            .map(|opts| opts.iter().filter(|(k, v)| safe(k) && safe(v)).map(|(k, v)| format!("{k}={v}")).collect())
            .unwrap_or_default();
        if self.fps != 30 && FPS_CHOICES.contains(&self.fps) {
            parts.push(format!("fps={}", self.fps));
        }
        if self.renderer != "auto" && RENDERERS.contains(&self.renderer.as_str()) {
            parts.push(format!("render={}", self.renderer));
        }
        if !self.scramble {
            parts.push("scramble=0".into());
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
    // A file that can't be read must not be lost: the next save would write
    // defaults over it. So a byte-order mark (some editors add one) is
    // ignored, and a file that still doesn't parse is copied aside to
    // settings.unreadable.json and logged before starting from defaults.
    let mut s: Settings = match path(app).and_then(|p| fs::read_to_string(&p).ok().map(|t| (p, t))) {
        None => Settings::default(),
        Some((p, text)) => match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
            Ok(s) => s,
            Err(e) => {
                let aside = p.with_file_name("settings.unreadable.json");
                let _ = fs::copy(&p, &aside);
                crate::alog!("afterglow: settings.json couldn't be read ({e}); kept a copy at {}; starting from defaults", aside.display());
                Settings::default()
            }
        },
    };
    crate::apps::migrate(&mut s);
    s.edge = s.edge.tidy();
    s.jobs = s.jobs.tidy();
    if !is_known(&s.wallpaper) {
        s.wallpaper = Settings::default().wallpaper;
    }
    if !FPS_CHOICES.contains(&s.fps) {
        s.fps = 30;
    }
    if !OLED_MINUTES.contains(&s.oled_minutes) {
        s.oled_minutes = 5;
    }
    if !RENDERERS.contains(&s.renderer.as_str()) {
        s.renderer = "auto".into();
    }
    if !THEMES.contains(&s.theme.as_str()) {
        s.theme = "dark".into();
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
            crate::alog!("afterglow: could not save settings to {}: {e}", p.display());
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
    Ok(())
}

/// Settings → wallpaper: the hover scramble on or off (reloads the wallpaper)
#[tauri::command]
pub fn set_scramble(app: AppHandle, on: bool) {
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.scramble = on;
        s.clone()
    };
    save(&app, &snapshot);
    host::show_wallpaper(&app);
}

/// Settings → general: the window's colours. The page recolours itself; only
/// the window's own background (seen while resizing) is set from here.
#[tauri::command]
pub fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    if !THEMES.contains(&theme.as_str()) {
        return Err(format!("unknown theme {theme}"));
    }
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.theme = theme;
        s.clone()
    };
    save(&app, &snapshot);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_background_color(Some(tray::settings_background(&snapshot.theme)));
    }
    Ok(())
}

/// Settings → power: OLED care on or off (no reload needed)
#[tauri::command]
pub fn set_oled(app: AppHandle, on: bool, minutes: u32) -> Result<(), String> {
    if !OLED_MINUTES.contains(&minutes) {
        return Err(format!("unsupported number of minutes {minutes}"));
    }
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.oled = on;
        s.oled_minutes = minutes;
        s.clone()
    };
    save(&app, &snapshot);
    host::apply_pause(&app);
    Ok(())
}

/// How wallpapers are drawn: "auto", "gpu" or "cpu" (reloads them).
#[tauri::command]
pub fn set_renderer(app: AppHandle, renderer: String) -> Result<(), String> {
    if !RENDERERS.contains(&renderer.as_str()) {
        return Err(format!("unknown renderer {renderer}"));
    }
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.renderer = renderer;
        s.clone()
    };
    save(&app, &snapshot);
    host::show_wallpaper(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_new_installs_start_dark() {
        assert_eq!(Settings::default().theme, "dark");
        let old: Settings = serde_json::from_str(r#"{"wallpaper": "paws"}"#).unwrap();
        assert_eq!(old.theme, "afterglow");
        let picked: Settings = serde_json::from_str(r#"{"theme": "light"}"#).unwrap();
        assert_eq!(picked.theme, "light");
    }
}
