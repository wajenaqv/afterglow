// What's playing on macOS: the Spotify and Music apps, asked over
// AppleScript. macOS has no public list of what's playing (the private one
// was locked to Apple's own apps in macOS 15.4), so browsers and other
// players aren't seen here; the Spotify account (nowplaying.rs) covers
// Spotify on other devices.
//
// Each look runs /usr/bin/osascript for each of the two apps that's running
// (never one that isn't: a script that talks to an app opens it). The first
// time, macOS asks "AfterGlow wants to control Spotify"; the answer is tied
// to the app's signature, like Accessibility. The release build needs the
// apple-events entitlement for that (src-tauri/entitlements.plist) and the
// reason in Info.plist (NSAppleEventsUsageDescription).
//
// Not run on a Mac yet: written on Windows. Check on the Mac:
//   cargo test --lib live_media -- --ignored --nocapture

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use crate::nowplaying::{Session, SourceState};

/// (player id, app name, bundle id)
const APPS: &[(&str, &str, &str)] = &[("spotify", "Spotify", "com.spotify.client"), ("music", "Music", "com.apple.Music")];

/// What macOS last said about each app: "allowed", "denied", or nothing yet
static ANSWERS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn answer(app: &str) -> Option<String> {
    ANSWERS.lock().unwrap().as_ref().and_then(|m| m.get(app).cloned())
}
fn set_answer(app: &str, state: &str) {
    ANSWERS.lock().unwrap().get_or_insert_with(HashMap::new).insert(app.to_string(), state.to_string());
}

/// Run an AppleScript and return what it printed. Waits up to `timeout`
/// (long the first time: macOS's question waits for the user), then gives up.
fn osascript(script: &str, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new("/usr/bin/osascript").arg("-e").arg(script).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("no answer".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let (mut out, mut err) = (String::new(), String::new());
    if let Some(mut o) = child.stdout.take() {
        let _ = o.read_to_string(&mut out);
    }
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut err);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() { Ok(out.trim_end_matches('\n').to_string()) } else { Err(err.trim().to_string()) }
}

/// A number AppleScript printed ("215.3" or, in some regions, "215,3")
fn number(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse().ok()
}

/// The script that reads one app: its state and, unless stopped, the song,
/// one field per line. Both apps share the words; Spotify adds the cover's
/// address. Spotify gives the length in ms, Music in seconds.
fn script(app: &str) -> String {
    let cover = if app == "Spotify" { "(artwork url of t)" } else { "\"\"" };
    format!(
        r#"if application "{app}" is running then
  tell application "{app}"
    set s to player state as string
    if s is "stopped" then return "stopped"
    set t to current track
    return s & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & ((duration of t) as string) & linefeed & ((player position) as string) & linefeed & {cover}
  end tell
end if
return "off""#
    )
}

pub fn media_sessions() -> (Vec<Session>, Vec<SourceState>) {
    let running: Vec<String> = super::running_apps().into_iter().map(|a| a.id).collect();
    let mut sessions = Vec::new();
    let mut sources = Vec::new();
    for (player, name, bundle) in APPS {
        let source = |state: &str, text: &str| SourceState { id: player.to_string(), name: name.to_string(), state: state.into(), text: text.into() };
        if !running.iter().any(|r| r == bundle) {
            let text = match answer(name).as_deref() {
                Some("denied") => "not allowed: System Settings → Privacy & Security → Automation",
                Some("allowed") => "allowed (not running)",
                _ => "not running; macOS asks once when it's open",
            };
            let state = if answer(name).as_deref() == Some("denied") { "denied" } else { "not-running" };
            sources.push(source(state, text));
            continue;
        }
        // the first time, macOS's question waits for the user
        let timeout = if answer(name).is_some() { Duration::from_secs(5) } else { Duration::from_secs(120) };
        match osascript(&script(name), timeout) {
            Ok(out) => {
                set_answer(name, "allowed");
                sources.push(source("allowed", "allowed"));
                if let Some(s) = parse(player, name, &out) {
                    sessions.push(s);
                }
            }
            // -1743: the user said no (or hasn't been asked and can't be)
            Err(e) if e.contains("-1743") => {
                set_answer(name, "denied");
                sources.push(source("denied", "not allowed: System Settings → Privacy & Security → Automation"));
            }
            Err(e) => {
                crate::alog!("afterglow: now playing: reading {name}: {e}");
                sources.push(source("error", "couldn't read it just now"));
            }
        }
    }
    (sessions, sources)
}

fn parse(player: &str, name: &str, out: &str) -> Option<Session> {
    let f: Vec<&str> = out.split('\n').collect();
    if f.len() < 7 || !(f[0] == "playing" || f[0] == "paused") {
        return None;
    }
    let length = number(f[4])?;
    // Spotify: ms; Music: seconds
    let length_ms = if player == "spotify" { length as u64 } else { (length * 1000.0) as u64 };
    let position_ms = number(f[5]).map(|p| (p * 1000.0) as u64);
    // Spotify gives "http://i.scdn.co/image/…"; the same address works over https
    let cover = f[6].trim();
    let cover_url = if let Some(rest) = cover.strip_prefix("http://") {
        Some(format!("https://{rest}"))
    } else {
        cover.starts_with("https://").then(|| cover.to_string())
    };
    Some(Session {
        player: player.into(),
        name: name.into(),
        handle: name.into(),
        title: f[1].to_string(),
        artist: f[2].to_string(),
        album: f[3].to_string(),
        playing: f[0] == "playing",
        position_ms,
        length_ms: (length_ms > 0).then_some(length_ms),
        cover_url,
    })
}

/// Music's cover: the artwork's own bytes, written to a file by the script
/// (AppleScript can't print raw data). Spotify's comes as a web address.
pub fn media_cover(handle: &str) -> Option<Vec<u8>> {
    if handle != "Music" {
        return None;
    }
    let path = std::env::temp_dir().join("afterglow-cover");
    let _ = std::fs::remove_file(&path);
    let p = path.to_str()?.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"if application "Music" is running then
  tell application "Music"
    try
      set d to raw data of artwork 1 of current track
    on error
      return "none"
    end try
  end tell
  set f to open for access (POSIX file "{p}") with write permission
  set eof f to 0
  write d to f
  close access f
  return "ok"
end if
return "off""#
    );
    if osascript(&script, Duration::from_secs(5)).ok()? != "ok" {
        return None;
    }
    let bytes = std::fs::read(&path).ok();
    let _ = std::fs::remove_file(&path);
    bytes
}

/// Pause or play (handle is the app's name)
pub fn media_toggle(handle: &str) -> Result<(), String> {
    if !APPS.iter().any(|(_, name, _)| *name == handle) {
        return Err("not a player AfterGlow knows".into());
    }
    osascript(&format!(r#"if application "{handle}" is running then tell application "{handle}" to playpause"#), Duration::from_secs(5)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_scripts_print() {
        let s = parse("spotify", "Spotify", "playing\nLow Tide\nHarbour Lights\nShore\n214000\n31,5\nhttps://i.scdn.co/image/abc").unwrap();
        assert_eq!((s.title.as_str(), s.playing, s.length_ms, s.position_ms), ("Low Tide", true, Some(214_000), Some(31_500)));
        assert_eq!(s.cover_url.as_deref(), Some("https://i.scdn.co/image/abc"));
        // Spotify's AppleScript says http
        let s = parse("spotify", "Spotify", "playing\nA\nB\nC\n1000\n0\nhttp://i.scdn.co/image/abc").unwrap();
        assert_eq!(s.cover_url.as_deref(), Some("https://i.scdn.co/image/abc"));
        let m = parse("music", "Music", "paused\nSong\nArtist\nAlbum\n200.5\n12.25\n").unwrap();
        assert_eq!((m.playing, m.length_ms, m.position_ms, m.cover_url), (false, Some(200_500), Some(12_250), None));
        assert!(parse("music", "Music", "stopped").is_none());
        assert!(parse("music", "Music", "off").is_none());
    }

    /// Prints what Spotify and Music say right now (open one and play something):
    /// cargo test --lib live_media -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_media() {
        let t = Instant::now();
        let (sessions, sources) = media_sessions();
        println!("read in {:?}: {sources:?}", t.elapsed());
        for s in &sessions {
            println!("{s:?}");
            println!("  cover: {:?} bytes", media_cover(&s.handle).map(|c| c.len()));
        }
    }
}
