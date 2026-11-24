// Steam: three parts, each switched on in Settings → apps (SteamPrefs):
//
//   messages  Windows: Steam chat doesn't post Windows notifications, but it
//             flashes its taskbar button when a message arrives (Steam →
//             Settings → Friends & Chat → "Flash window when I receive a chat
//             message", on by default). A hidden window registered as a shell
//             hook hears every taskbar flash (HSHELL_FLASH); a flash from a
//             Steam process (steam.exe / steamwebhelper.exe) is a "new" from
//             "steam": a lantern in Steam blue until you rest the cursor on
//             it. Steam doesn't say how many, so there's no count.
//   online    a friend signs in        } the Steam Web API with the user's
//   playing   a friend starts a game   } own key, every 60 s: GetFriendList
//             and GetPlayerSummaries. A pulse only (linger: false): nothing
//             is waiting for you. The first look only records.
//
// The key is kept in the OS keychain ("AfterGlow" / "steam-key"), not in
// settings.json. The Steam ID can be the 17-digit number, a profile URL
// (…/profiles/<id> or …/id/<name>) or the custom name; names are resolved
// with ResolveVanityURL when saved.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::signals::{self, Signal};

const KEYRING_SERVICE: &str = "AfterGlow";
const KEYRING_KEY: &str = "steam-key";
const API: &str = "https://api.steampowered.com";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SteamPrefs {
    pub messages: bool,
    pub online: bool,
    pub playing: bool,
    /// the resolved 17-digit Steam ID ("" until set)
    pub steamid: String,
}

impl Default for SteamPrefs {
    fn default() -> Self {
        SteamPrefs { messages: true, online: false, playing: false, steamid: String::new() }
    }
}

fn prefs(app: &AppHandle) -> (bool, SteamPrefs) {
    let host = app.state::<Host>();
    let s = host.settings.lock().unwrap();
    (s.connectors.get("steam").copied().unwrap_or(false), s.steam.clone())
}

fn key() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY).and_then(|e| e.get_password()).ok().filter(|k| !k.is_empty())
}

fn signal(app: &AppHandle, linger: bool) {
    let sig = Signal { source: "steam".into(), kind: "new".into(), count: None, colour: None, afterglow: None, linger: Some(linger) };
    if let Err(e) = signals::handle(app, sig) {
        crate::alog!("afterglow: steam: {e}");
    }
}

// ---- messages (Windows): Steam flashing its taskbar button ----

#[cfg(windows)]
pub fn start_flash_watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || flash::run(app));
}

#[cfg(windows)]
mod flash {
    use super::*;
    use std::sync::OnceLock;
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowThreadProcessId, RegisterClassW, RegisterShellHookWindow,
        RegisterWindowMessageW, TranslateMessage, MSG, WINDOW_EX_STYLE, WNDCLASSW, WS_OVERLAPPED,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static SHELLHOOK: OnceLock<u32> = OnceLock::new();
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    const HSHELL_FLASH: usize = 0x8006;

    pub fn run(app: AppHandle) {
        let _ = APP.set(app);
        unsafe {
            let Ok(module) = GetModuleHandleW(None) else { return };
            let class = w!("AfterGlowShellHook");
            let wc = WNDCLASSW { lpfnWndProc: Some(proc_), hInstance: module.into(), lpszClassName: class, ..Default::default() };
            RegisterClassW(&wc);
            // a hidden top-level window (never shown): shell hooks need one
            let Ok(hwnd) = CreateWindowExW(WINDOW_EX_STYLE(0), class, PCWSTR::null(), WS_OVERLAPPED, 0, 0, 0, 0, None, None, Some(module.into()), None) else {
                crate::alog!("afterglow: steam: could not create the shell hook window");
                return;
            };
            let _ = SHELLHOOK.set(RegisterWindowMessageW(w!("SHELLHOOK")));
            if !RegisterShellHookWindow(hwnd).as_bool() {
                crate::alog!("afterglow: steam: could not register the shell hook");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    unsafe extern "system" fn proc_(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if SHELLHOOK.get() == Some(&msg) && wparam.0 == HSHELL_FLASH {
            let flashing = HWND(lparam.0 as *mut std::ffi::c_void);
            if is_steam(flashing) {
                if let Some(app) = APP.get() {
                    let (on, p) = prefs(app);
                    // one lantern per burst: Steam flashes several times per message
                    let mut last = LAST.lock().unwrap();
                    if on && p.messages && last.is_none_or(|t| t.elapsed() > Duration::from_secs(3)) {
                        *last = Some(Instant::now());
                        crate::alog!("afterglow: steam: a chat window flashed");
                        signal(app, true);
                    }
                }
            }
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    fn is_steam(hwnd: HWND) -> bool {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(process);
            if !ok {
                return false;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
            let name = path.rsplit(['\\', '/']).next().unwrap_or("");
            name == "steam.exe" || name == "steamwebhelper.exe"
        }
    }
}

// ---- friends (any platform): the Steam Web API ----

/// What friends were doing at the last look: steamid -> (online, game id)
static FRIENDS: Mutex<Option<HashMap<String, (bool, String)>>> = Mutex::new(None);
static FRIEND_LIST: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);

fn get(url: &str) -> Result<Value, String> {
    let resp = ureq::get(url).timeout(Duration::from_secs(15)).call().map_err(|e| match e {
        ureq::Error::Status(401 | 403, _) => "Steam refused: check the key, and that your friends list is public (Steam → Edit Profile → Privacy)".to_string(),
        other => other.to_string(),
    })?;
    resp.into_json::<Value>().map_err(|e| e.to_string())
}

/// The connector loop (connectors/mod.rs): once a minute
pub fn poll(app: &AppHandle) -> Duration {
    let (_, p) = prefs(app);
    let every = Duration::from_secs(60);
    if !p.online && !p.playing {
        let text = if cfg!(windows) && p.messages { "watching for Steam chat messages" } else { "nothing chosen yet" };
        crate::connectors::set_status(app, "steam", if p.messages && cfg!(windows) { "ok" } else { "setup" }, text);
        *FRIENDS.lock().unwrap() = None;
        return every;
    }
    let (Some(key), false) = (key(), p.steamid.is_empty()) else {
        crate::connectors::set_status(app, "steam", "setup", "friends need your Steam key and profile");
        return every;
    };
    match look(&key, &p.steamid) {
        Ok(now) => {
            let mut seen = FRIENDS.lock().unwrap();
            if let Some(before) = seen.as_ref() {
                for (id, (online, game)) in &now {
                    let (was_online, was_game) = before.get(id).cloned().unwrap_or((false, String::new()));
                    if p.online && *online && !was_online {
                        crate::alog!("afterglow: steam: a friend came online");
                        signal(app, false);
                    } else if p.playing && !game.is_empty() && *game != was_game {
                        crate::alog!("afterglow: steam: a friend started a game");
                        signal(app, false);
                    }
                }
            }
            let online = now.values().filter(|(o, _)| *o).count();
            let playing = now.values().filter(|(_, g)| !g.is_empty()).count();
            crate::connectors::set_status(app, "steam", "ok", format!("{} friends; {online} online, {playing} playing", now.len()));
            *seen = Some(now);
        }
        Err(e) => crate::connectors::set_status(app, "steam", "error", e),
    }
    every
}

fn look(key: &str, me: &str) -> Result<HashMap<String, (bool, String)>, String> {
    // the friend list changes rarely: fetched every 10 minutes
    let ids = {
        let cached = FRIEND_LIST.lock().unwrap().clone();
        match cached {
            Some((at, ids)) if at.elapsed() < Duration::from_secs(600) => ids,
            _ => {
                let v = get(&format!("{API}/ISteamUser/GetFriendList/v1/?key={key}&steamid={me}&relationship=friend"))?;
                let ids: Vec<String> = v["friendslist"]["friends"].as_array().into_iter().flatten().filter_map(|f| f["steamid"].as_str().map(String::from)).collect();
                *FRIEND_LIST.lock().unwrap() = Some((Instant::now(), ids.clone()));
                ids
            }
        }
    };
    let mut out = HashMap::new();
    for chunk in ids.chunks(100) {
        let v = get(&format!("{API}/ISteamUser/GetPlayerSummaries/v2/?key={key}&steamids={}", chunk.join(",")))?;
        for p in v["response"]["players"].as_array().into_iter().flatten() {
            let id = p["steamid"].as_str().unwrap_or_default().to_string();
            let online = p["personastate"].as_u64().unwrap_or(0) > 0;
            let game = p["gameid"].as_str().unwrap_or_default().to_string();
            out.insert(id, (online, game));
        }
    }
    Ok(out)
}

/// A Steam ID from what the user pasted: the number, a profile URL or a
/// custom name (resolved with the key)
fn resolve(input: &str, key: Option<&str>) -> Result<String, String> {
    let s = input.trim().trim_end_matches('/');
    let last = s.rsplit('/').next().unwrap_or(s);
    if last.len() == 17 && last.chars().all(|c| c.is_ascii_digit()) {
        return Ok(last.to_string());
    }
    let key = key.ok_or("add your Steam Web API key first, or paste the 17-digit Steam ID")?;
    let name: String = last.chars().filter(|c| c.is_ascii_alphanumeric() || "_-".contains(*c)).collect();
    if name.is_empty() {
        return Err("that doesn't look like a Steam ID or profile link".into());
    }
    let v = get(&format!("{API}/ISteamUser/ResolveVanityURL/v1/?key={key}&vanityurl={name}"))?;
    v["response"]["steamid"].as_str().map(String::from).ok_or_else(|| format!("Steam doesn't know the profile name {name}"))
}

// ---- Settings ----

#[derive(Serialize)]
pub struct SteamState {
    messages: bool,
    online: bool,
    playing: bool,
    steamid: String,
    has_key: bool,
    /// messages work on this OS
    can_messages: bool,
}

#[tauri::command]
pub fn steam_state(app: AppHandle) -> SteamState {
    let (_, p) = prefs(&app);
    SteamState { messages: p.messages, online: p.online, playing: p.playing, steamid: p.steamid, has_key: key().is_some(), can_messages: cfg!(windows) }
}

/// Save Steam's switches, ID and key (an empty key keeps the saved one)
#[tauri::command]
pub fn set_steam(app: AppHandle, messages: bool, online: bool, playing: bool, steamid: String, api_key: String) -> Result<String, String> {
    if !api_key.trim().is_empty() {
        let k = api_key.trim();
        if k.len() != 32 || !k.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("a Steam Web API key is 32 letters and digits".into());
        }
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY).and_then(|e| e.set_password(k)).map_err(|e| e.to_string())?;
    }
    let steamid = if steamid.trim().is_empty() { String::new() } else { resolve(&steamid, key().as_deref())? };
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        s.steam = SteamPrefs { messages, online, playing, steamid: steamid.clone() };
        s.clone()
    };
    crate::settings::save(&app, &snapshot);
    *FRIEND_LIST.lock().unwrap() = None;
    *FRIENDS.lock().unwrap() = None;
    Ok(steamid)
}
