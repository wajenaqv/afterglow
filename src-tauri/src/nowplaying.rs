// Now playing: what music (or video) is playing, for the corner card on the
// wallpaper (src/wallpapers/nowplaying.js): the cover in coloured characters,
// the title, the artist and a progress bar. Resting the cursor on the cover
// pauses or plays it.
//
// Where it comes from:
//   Windows  Windows' own list of what's playing (the media flyout's): the
//            Spotify app, browsers, Apple Music, Media Player, ... with no
//            sign-in (platform::media_sessions, media_windows.rs)
//   macOS    the Spotify and Music apps, asked over AppleScript; macOS asks
//            the user once per app (media_macos.rs)
//   both     the Spotify account, when it's signed in on the apps page
//            (connectors/accounts.rs calls from_account): used when no player
//            on this computer has anything, e.g. music playing on a phone
//
// One thread looks every second (two on macOS, where each look starts a
// small program), only while the feature is on. The wallpapers get a
// "nowplaying" event when the song, play/pause, the cover or the position
// (a jump, not the ticking) changes; they move the bar along by themselves.
//
// Privacy: titles and artists are shown on the wallpaper and never written
// to the log or the activity page.

use std::collections::BTreeSet;
use std::io::Read;
use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::host::{self, Host};
use crate::{platform, settings};

/// Settings → now playing (saved)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Prefs {
    pub on: bool,
    /// "hover" (rest in the corner), "always", or "change" (a few seconds
    /// when the song changes, and on hover)
    pub show: String,
    /// top-right, top-left, bottom-right or bottom-left
    pub corner: String,
    /// small, medium or large (the cover's size in characters)
    pub size: String,
    /// Rest the cursor on the cover to pause or play
    pub rest_to_pause: bool,
    /// Players switched off by the user (Session::player); every other one shows
    pub hidden: Vec<String>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { on: false, show: "hover".into(), corner: "bottom-right".into(), size: "medium".into(), rest_to_pause: true, hidden: Vec::new() }
    }
}

impl Prefs {
    /// Unknown choices go back to the default (an older or hand-edited file),
    /// and the clock's corner moves to the other side of the screen
    pub fn tidy(mut self, clock_corner: &str) -> Self {
        let d = Prefs::default();
        if !["hover", "always", "change"].contains(&self.show.as_str()) {
            self.show = d.show;
        }
        if !crate::extras::CORNERS.contains(&self.corner.as_str()) {
            self.corner = d.corner;
        }
        if !["small", "medium", "large"].contains(&self.size.as_str()) {
            self.size = d.size;
        }
        self.hidden.retain(|p| !p.is_empty() && p.len() <= 64);
        if self.corner == clock_corner {
            self.corner = other_side(clock_corner);
        }
        self.hidden.truncate(100);
        self
    }
}

/// One player's song, as a source reports it
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    /// A short id for the player: "spotify", "chrome", "music", ...
    pub player: String,
    /// Its name for people: "Spotify", "Chrome", "Music"
    pub name: String,
    /// What the source needs to find this player again (to pause it, or
    /// read its cover): Windows' app id, macOS's app name
    pub handle: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    /// Where it is now, and how long the song is (ms), when the player says
    pub position_ms: Option<u64>,
    pub length_ms: Option<u64>,
    /// The cover as a web address, when the source gives one (Spotify)
    pub cover_url: Option<String>,
}

impl Session {
    /// The same song in the same player (ignores position and play/pause)
    fn song_id(&self) -> String {
        format!("{}\u{1}{}\u{1}{}\u{1}{}", self.player, self.title, self.artist, self.album)
    }
}

/// A source the user may need to act on (macOS asks once per app). Windows
/// has none: its list needs no permission.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SourceState {
    pub id: String,
    pub name: String,
    /// "allowed", "denied", "asking", "not-running", "not-asked", "error"
    pub state: String,
    pub text: String,
}

/// What the wallpapers draw (the "nowplaying" event, now_playing_state)
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Track {
    pub player: String,
    pub player_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position_ms: u64,
    pub length_ms: u64,
    /// When position_ms was true (ms since 1970): the wallpaper moves the
    /// bar on from here while it's playing
    pub at: u64,
    /// The cover as a data: URL, or "" (the wallpaper draws a pattern instead)
    pub cover: String,
    /// Changes with every new song
    pub song: String,
}

/// Shared state (Tauri's `manage`)
#[derive(Default)]
pub struct NowPlaying {
    /// What the wallpapers were last told
    track: Mutex<Option<Track>>,
    /// The session shown, to pause it
    chosen: Mutex<Option<Session>>,
    /// Players seen since AfterGlow started: (player, name)
    players: Mutex<Vec<(String, String)>>,
    sources: Mutex<Vec<SourceState>>,
    /// The Spotify account's song and when it was read
    account: Mutex<Option<(Option<Session>, Instant)>>,
    /// The last thing that went wrong pausing, for Settings
    note: Mutex<String>,
    nudged: Mutex<bool>,
    wake: Condvar,
}

/// The Spotify account counts while it was read in the last 15 s
const ACCOUNT_FRESH: Duration = Duration::from_secs(15);
/// The account's player id (so it can be switched off on its own)
const ACCOUNT: &str = "spotify-account";
/// Browsers (media_windows.rs player ids): when nothing plays, a paused
/// music player is shown before a paused browser tab
const BROWSERS: &[&str] = &["chrome", "edge", "firefox", "brave", "opera", "vivaldi"];
/// Covers bigger than this aren't sent to the wallpapers
const MAX_COVER: usize = 1_500_000;

/// The same corner on the other side of the screen ("bottom-right" ->
/// "bottom-left"): where the card goes when a saved file puts it on the clock
fn other_side(corner: &str) -> String {
    if corner.ends_with("-right") { corner.replace("-right", "-left") } else { corner.replace("-left", "-right") }
}

fn every() -> Duration {
    if cfg!(target_os = "macos") { Duration::from_secs(2) } else { Duration::from_secs(1) }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Look again now (a change in Settings, a pause)
pub fn nudge(app: &AppHandle) {
    let np = app.state::<NowPlaying>();
    *np.nudged.lock().unwrap() = true;
    np.wake.notify_one();
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut covers = CoverCache::default();
        loop {
            {
                let np = app.state::<NowPlaying>();
                let nudged = np.nudged.lock().unwrap();
                let (mut nudged, _) = np.wake.wait_timeout_while(nudged, every(), |n| !*n).unwrap();
                *nudged = false;
            }
            let prefs = app.state::<Host>().settings.lock().unwrap().now_playing.clone();
            if !prefs.on {
                tell(&app, None);
                *app.state::<NowPlaying>().chosen.lock().unwrap() = None;
                continue;
            }
            look(&app, &prefs, &mut covers);
        }
    });
}

/// One look: read the players, pick one, tell the wallpapers if it changed.
/// No lock is held while calling platform:: (on macOS it may wait for the
/// main thread, or for the user to answer macOS's question).
fn look(app: &AppHandle, prefs: &Prefs, covers: &mut CoverCache) {
    let (sessions, sources) = platform::media_sessions();
    let np = app.state::<NowPlaying>();
    *np.sources.lock().unwrap() = sources;
    {
        let mut players = np.players.lock().unwrap();
        for s in &sessions {
            if !players.iter().any(|(p, _)| *p == s.player) {
                players.push((s.player.clone(), s.name.clone()));
            }
        }
    }
    let account = match np.account.lock().unwrap().as_ref() {
        Some((s, at)) if at.elapsed() < ACCOUNT_FRESH => s.clone(),
        _ => None,
    };
    if let Some(a) = &account {
        let mut players = np.players.lock().unwrap();
        if !players.iter().any(|(p, _)| p == ACCOUNT) {
            players.push((a.player.clone(), a.name.clone()));
        }
    }
    let before = np.chosen.lock().unwrap().as_ref().map(|s| s.player.clone());
    let chosen = choose(&sessions, account, &prefs.hidden, before.as_deref());
    *np.chosen.lock().unwrap() = chosen.clone();
    let track = chosen.map(|s| {
        let cover = covers.get(&s);
        Track {
            player: s.player.clone(),
            player_name: s.name.clone(),
            title: s.title.clone(),
            artist: s.artist.clone(),
            album: s.album.clone(),
            playing: s.playing,
            position_ms: s.position_ms.unwrap_or(0),
            length_ms: s.length_ms.unwrap_or(0),
            at: now_ms(),
            cover,
            song: s.song_id(),
        }
    });
    tell(app, track);
}

/// Which session to show. Something playing beats something paused; the one
/// shown last keeps its place while it plays (two players at once don't
/// flicker), and stays while paused so it can be played again. The Spotify
/// account only counts when no player here has anything, or it plays while
/// they're paused, and never next to the Spotify app itself (same music).
fn choose(sessions: &[Session], account: Option<Session>, hidden: &[String], before: Option<&str>) -> Option<Session> {
    let shown: Vec<&Session> = sessions.iter().filter(|s| !hidden.contains(&s.player)).collect();
    let playing: Vec<&&Session> = shown.iter().filter(|s| s.playing).collect();
    let local = if let Some(s) = playing.iter().find(|s| Some(s.player.as_str()) == before) {
        Some((**s).clone())
    } else if let Some(s) = playing.first() {
        Some((**s).clone())
    } else if let Some(s) = shown.iter().find(|s| Some(s.player.as_str()) == before) {
        Some((*s).clone())
    } else {
        // all paused: a music player before a browser (an old video tab)
        shown.iter().find(|s| !BROWSERS.contains(&s.player.as_str())).or(shown.first()).map(|s| (*s).clone())
    };
    let account = account.filter(|a| !hidden.contains(&a.player) && !sessions.iter().any(|s| s.player == "spotify"));
    match (local, account) {
        (Some(l), Some(a)) if !l.playing && a.playing => Some(a),
        (Some(l), _) => Some(l),
        (None, a) => a,
    }
}

/// Send the track to the wallpapers when it changed enough to matter
fn tell(app: &AppHandle, track: Option<Track>) {
    let np = app.state::<NowPlaying>();
    let mut last = np.track.lock().unwrap();
    if !differs(last.as_ref(), track.as_ref()) {
        return;
    }
    // which player and its state, never the song (titles stay out of the log)
    let what = match &track {
        Some(t) if last.as_ref().is_none_or(|o| o.song != t.song || o.playing != t.playing) => {
            Some(format!("{} {}, cover {} KB", t.player_name, if t.playing { "playing" } else { "paused" }, t.cover.len() * 3 / 4 / 1024))
        }
        None => Some("nothing".to_string()),
        _ => None,
    };
    if let Some(what) = what {
        crate::alog!("afterglow: now playing: {what}");
    }
    *last = track.clone();
    drop(last);
    host::emit_to_walls(app, "nowplaying", track);
}

/// A new song, play/pause, a new cover, or the position jumping (a seek) by
/// more than 2.5 s from where the bar would be by now
fn differs(old: Option<&Track>, new: Option<&Track>) -> bool {
    match (old, new) {
        (None, None) => false,
        (Some(o), Some(n)) => {
            if o.song != n.song || o.playing != n.playing || o.cover != n.cover || o.length_ms != n.length_ms {
                return true;
            }
            let expected = o.position_ms + if o.playing { n.at.saturating_sub(o.at) } else { 0 };
            expected.abs_diff(n.position_ms) > 2500
        }
        _ => true,
    }
}

/// The cover of the song showing, read once per song
#[derive(Default)]
struct CoverCache {
    song: String,
    cover: String,
}

impl CoverCache {
    fn get(&mut self, s: &Session) -> String {
        let id = s.song_id();
        if id != self.song {
            self.song = id;
            self.cover = read_cover(s).unwrap_or_default();
        }
        self.cover.clone()
    }
}

/// The cover as a data: URL. A web address (Spotify) is downloaded; anything
/// else is asked of the player (Windows' thumbnail, Music's artwork).
fn read_cover(s: &Session) -> Option<String> {
    let bytes = match &s.cover_url {
        Some(url) if url.starts_with("https://") => download(url)?,
        _ => platform::media_cover(&s.handle)?,
    };
    if bytes.is_empty() || bytes.len() > MAX_COVER {
        return None;
    }
    let mime = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") {
        "image/webp"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

fn download(url: &str) -> Option<Vec<u8>> {
    let r = ureq::get(url).timeout(Duration::from_secs(10)).call().ok()?;
    let mut bytes = Vec::new();
    r.into_reader().take(MAX_COVER as u64 + 1).read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

// ---- the Spotify account (connectors/accounts.rs) ----

/// The account's song, from currently-playing (None: nothing playing)
pub fn from_account(app: &AppHandle, v: Option<&serde_json::Value>) {
    let session = v.and_then(|v| {
        let item = &v["item"];
        let title = item["name"].as_str()?.to_string();
        let artist = item["artists"].as_array().map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        // the album covers come biggest first: 640, 300, 64 px; 300 is plenty
        let images = item["album"]["images"].as_array();
        let cover = images.and_then(|i| i.get(1).or(i.first())).and_then(|i| i["url"].as_str()).map(String::from);
        Some(Session {
            player: ACCOUNT.into(),
            name: "Spotify (account)".into(),
            handle: String::new(),
            title,
            artist,
            album: item["album"]["name"].as_str().unwrap_or("").to_string(),
            playing: v["is_playing"].as_bool() == Some(true),
            position_ms: v["progress_ms"].as_u64(),
            length_ms: item["duration_ms"].as_u64(),
            cover_url: cover,
        })
    });
    *app.state::<NowPlaying>().account.lock().unwrap() = Some((session, Instant::now()));
}

// ---- commands ----

#[derive(Serialize)]
pub struct State {
    prefs: Prefs,
    track: Option<Track>,
    /// Players seen since AfterGlow started, and the ones switched off
    players: Vec<Player>,
    sources: Vec<SourceState>,
    note: String,
}

#[derive(Serialize)]
struct Player {
    id: String,
    name: String,
    shown: bool,
}

/// Settings → now playing, and the wallpapers when they load
#[tauri::command]
pub fn now_playing_state(app: AppHandle) -> State {
    let prefs = app.state::<Host>().settings.lock().unwrap().now_playing.clone();
    let np = app.state::<NowPlaying>();
    let mut players: Vec<Player> = np.players.lock().unwrap().iter().map(|(id, name)| Player { id: id.clone(), name: name.clone(), shown: !prefs.hidden.contains(id) }).collect();
    let seen: BTreeSet<String> = players.iter().map(|p| p.id.clone()).collect();
    for id in prefs.hidden.iter().filter(|id| !seen.contains(*id)) {
        players.push(Player { id: id.clone(), name: id.clone(), shown: false });
    }
    let track = np.track.lock().unwrap().clone();
    let sources = np.sources.lock().unwrap().clone();
    let note = np.note.lock().unwrap().clone();
    State { prefs, track, players, sources, note }
}

/// Save Settings → now playing and tell the wallpapers straight away. The
/// clock's corner is refused: the two never share one.
#[tauri::command]
pub fn set_now_playing(app: AppHandle, prefs: Prefs) -> Result<(), String> {
    let host = app.state::<Host>();
    let (prefs, snapshot) = {
        let mut s = host.settings.lock().unwrap();
        if prefs.corner == s.clock.corner {
            return Err("the clock is in that corner".into());
        }
        let prefs = prefs.tidy(&s.clock.corner);
        s.now_playing = prefs.clone();
        (prefs, s.clone())
    };
    settings::save(&app, &snapshot);
    host::emit_to_walls(&app, "nowplaying-prefs", prefs);
    nudge(&app);
    Ok(())
}

/// Pause or play what's showing (resting on the cover). Runs on its own
/// thread: asking a player can take a moment, and commands run on the main
/// thread. The next look shows the result.
#[tauri::command]
pub fn now_playing_toggle(app: AppHandle) {
    let Some(s) = app.state::<NowPlaying>().chosen.lock().unwrap().clone() else { return };
    thread::spawn(move || {
        let result = if s.player == ACCOUNT { account_toggle(&app, s.playing) } else { platform::media_toggle(&s.handle) };
        let np = app.state::<NowPlaying>();
        match result {
            Ok(()) => np.note.lock().unwrap().clear(),
            Err(e) => {
                crate::alog!("afterglow: now playing: couldn't pause or play {}: {e}", s.name);
                *np.note.lock().unwrap() = e;
            }
        }
        // players take a moment to say they've changed
        thread::sleep(Duration::from_millis(300));
        nudge(&app);
    });
}

fn account_toggle(app: &AppHandle, playing: bool) -> Result<(), String> {
    let p = crate::connectors::oauth::provider("spotify").ok_or("no Spotify")?;
    let client = app.state::<Host>().settings.lock().unwrap().clients.get("spotify").cloned().unwrap_or_default();
    let url = if playing { "https://api.spotify.com/v1/me/player/pause" } else { "https://api.spotify.com/v1/me/player/play" };
    crate::connectors::oauth::put(p, &client, url)?;
    // the account is read every 5 s: show the change now
    if let Some((Some(s), at)) = app.state::<NowPlaying>().account.lock().unwrap().as_mut() {
        s.playing = !playing;
        *at = Instant::now();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(player: &str, playing: bool) -> Session {
        Session {
            player: player.into(),
            name: player.into(),
            handle: player.into(),
            title: format!("{player} song"),
            artist: "someone".into(),
            album: String::new(),
            playing,
            position_ms: Some(1000),
            length_ms: Some(200_000),
            cover_url: None,
        }
    }

    fn pick(sessions: &[Session], account: Option<Session>, hidden: &[&str], before: Option<&str>) -> Option<String> {
        let hidden: Vec<String> = hidden.iter().map(|s| s.to_string()).collect();
        choose(sessions, account, &hidden, before).map(|s| s.player)
    }

    #[test]
    fn playing_beats_paused_and_the_shown_one_keeps_its_place() {
        let s = [session("chrome", false), session("spotify", true), session("music", true)];
        assert_eq!(pick(&s, None, &[], None).as_deref(), Some("spotify"));
        assert_eq!(pick(&s, None, &[], Some("music")).as_deref(), Some("music"));
        // paused, the one shown stays (so it can be played again)
        let paused = [session("chrome", false), session("spotify", false)];
        assert_eq!(pick(&paused, None, &[], Some("spotify")).as_deref(), Some("spotify"));
        // nothing shown yet: the music player before the browser tab
        assert_eq!(pick(&paused, None, &[], None).as_deref(), Some("spotify"));
    }

    #[test]
    fn hidden_players_never_show() {
        let s = [session("chrome", true), session("spotify", false)];
        assert_eq!(pick(&s, None, &["chrome"], None).as_deref(), Some("spotify"));
        assert_eq!(pick(&s, None, &["chrome", "spotify"], None), None);
    }

    #[test]
    fn the_account_fills_in() {
        let phone = session(ACCOUNT, true);
        assert_eq!(pick(&[], Some(phone.clone()), &[], None).as_deref(), Some(ACCOUNT));
        // playing on the phone while the browser here is paused
        assert_eq!(pick(&[session("chrome", false)], Some(phone.clone()), &[], None).as_deref(), Some(ACCOUNT));
        // never next to the Spotify app: that's the same music
        assert_eq!(pick(&[session("spotify", false)], Some(phone.clone()), &[], None).as_deref(), Some("spotify"));
        assert_eq!(pick(&[], Some(phone), &[ACCOUNT], None), None);
    }

    fn track(song: &str, playing: bool, position_ms: u64, at: u64) -> Track {
        Track { player: "p".into(), player_name: "P".into(), title: String::new(), artist: String::new(), album: String::new(), playing, position_ms, length_ms: 100_000, at, cover: String::new(), song: song.into() }
    }

    #[test]
    fn ticking_along_is_not_a_change_but_a_seek_is() {
        let old = track("a", true, 10_000, 1_000_000);
        assert!(!differs(Some(&old), Some(&track("a", true, 11_000, 1_001_000))));
        assert!(differs(Some(&old), Some(&track("a", true, 40_000, 1_001_000))));
        assert!(differs(Some(&old), Some(&track("b", true, 11_000, 1_001_000))));
        assert!(differs(Some(&old), Some(&track("a", false, 11_000, 1_001_000))));
        assert!(differs(Some(&old), None));
        assert!(!differs(None, None));
    }

    #[test]
    fn unknown_choices_go_back_to_the_default() {
        let p = Prefs { show: "sometimes".into(), corner: "middle".into(), size: "huge".into(), ..Prefs::default() }.tidy("top-right");
        assert_eq!((p.show.as_str(), p.corner.as_str(), p.size.as_str()), ("hover", "bottom-right", "medium"));
    }

    #[test]
    fn never_in_the_clocks_corner() {
        let at = |corner: &str, clock: &str| Prefs { corner: corner.into(), ..Prefs::default() }.tidy(clock).corner;
        assert_eq!(at("bottom-right", "bottom-right"), "bottom-left");
        assert_eq!(at("top-left", "top-left"), "top-right");
        assert_eq!(at("top-left", "top-right"), "top-left");
        // an unknown corner goes to the default, unless that's the clock's
        assert_eq!(at("middle", "bottom-right"), "bottom-left");
    }
}
