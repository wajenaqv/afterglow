// What's playing on Windows: the list behind the media flyout (the one that
// shows when a media key is pressed). Any player that reports to Windows is
// in it: the Spotify app, browsers (YouTube, SoundCloud, ...), Apple Music,
// Media Player, and others. No sign-in or permission is needed.
//
// WinRT's GlobalSystemMediaTransportControlsSessionManager, through the
// `windows` crate. Its calls return "async operations"; `.get()` waits for
// the answer, which is fine on nowplaying.rs's own thread.

use std::cell::RefCell;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Media::Control::{GlobalSystemMediaTransportControlsSession as MediaSession, GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status};
use windows::Storage::Streams::DataReader;

use crate::nowplaying::{Session, SourceState};

thread_local! {
    // Asking Windows for the manager takes a moment: once per thread is enough
    static MANAGER: RefCell<Option<Manager>> = const { RefCell::new(None) };
}

fn manager() -> Option<Manager> {
    MANAGER.with(|m| {
        let mut m = m.borrow_mut();
        if m.is_none() {
            *m = Manager::RequestAsync().and_then(|op| op.get()).ok();
        }
        m.clone()
    })
}

/// Every player in Windows' list, and no sources to act on (Windows needs
/// no permission for this)
pub fn media_sessions() -> (Vec<Session>, Vec<SourceState>) {
    let Some(m) = manager() else { return (Vec::new(), Vec::new()) };
    let Ok(list) = m.GetSessions() else { return (Vec::new(), Vec::new()) };
    let mut out = Vec::new();
    for i in 0..list.Size().unwrap_or(0) {
        if let Ok(s) = list.GetAt(i) {
            if let Some(session) = read(&s) {
                out.push(session);
            }
        }
    }
    (out, Vec::new())
}

/// 100 ns ticks since 1601 (Windows' DateTime), now
fn ticks_now() -> i64 {
    let unix = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as i64 / 100).unwrap_or(0);
    unix + 116_444_736_000_000_000
}

fn read(s: &MediaSession) -> Option<Session> {
    let handle = s.SourceAppUserModelId().ok()?.to_string();
    let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
    if title.trim().is_empty() {
        return None; // a player with nothing loaded
    }
    let playing = s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).is_ok_and(|st| st == Status::Playing);
    let (mut position_ms, mut length_ms) = (None, None);
    if let Ok(t) = s.GetTimelineProperties() {
        let start = t.StartTime().map(|d| d.Duration).unwrap_or(0);
        let end = t.EndTime().map(|d| d.Duration).unwrap_or(0);
        let mut pos = t.Position().map(|d| d.Duration).unwrap_or(0) - start;
        // the position is as of LastUpdatedTime: add what has played since
        let updated = t.LastUpdatedTime().map(|d| d.UniversalTime).unwrap_or(0);
        if playing && updated > 0 {
            pos += (ticks_now() - updated).max(0);
        }
        if end > start {
            let len = end - start;
            length_ms = Some((len / 10_000) as u64);
            position_ms = Some((pos.clamp(0, len) / 10_000) as u64);
        }
    }
    let (player, name) = player_of(&handle);
    Some(Session {
        player,
        name,
        handle,
        title,
        artist: props.Artist().map(|h| h.to_string()).unwrap_or_default(),
        album: props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default(),
        playing,
        position_ms,
        length_ms,
        cover_url: None,
    })
}

fn find(handle: &str) -> Option<MediaSession> {
    let list = manager()?.GetSessions().ok()?;
    (0..list.Size().unwrap_or(0)).filter_map(|i| list.GetAt(i).ok()).find(|s| s.SourceAppUserModelId().is_ok_and(|id| id == handle))
}

/// The cover the player gave Windows (bytes of a PNG or JPEG), if any
pub fn media_cover(handle: &str) -> Option<Vec<u8>> {
    let s = find(handle)?;
    let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok()?;
    if size == 0 || size > 4_000_000 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let loaded = reader.LoadAsync(size).ok()?.get().ok()?;
    let mut bytes = vec![0u8; loaded as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}

/// Pause or play that player
pub fn media_toggle(handle: &str) -> Result<(), String> {
    let s = find(handle).ok_or("that player isn't playing anything any more")?;
    match s.TryTogglePlayPauseAsync().and_then(|op| op.get()) {
        Ok(true) => Ok(()),
        Ok(false) => Err("the player didn't take it".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Windows names players by app id ("Spotify.exe", "MSEdge",
/// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"): a short id and a name.
fn player_of(handle: &str) -> (String, String) {
    const KNOWN: &[(&str, &str, &str)] = &[
        ("spotify", "spotify", "Spotify"),
        ("applemusic", "apple-music", "Apple Music"),
        ("zunemusic", "media-player", "Media Player"),
        ("msedge", "edge", "Edge"),
        ("chrome", "chrome", "Chrome"),
        ("308046b0af4a39cb", "firefox", "Firefox"), // Firefox's app id
        ("firefox", "firefox", "Firefox"),
        ("brave", "brave", "Brave"),
        ("opera", "opera", "Opera"),
        ("vivaldi", "vivaldi", "Vivaldi"),
        ("vlc", "vlc", "VLC"),
        ("foobar2000", "foobar2000", "foobar2000"),
        ("musicbee", "musicbee", "MusicBee"),
        ("tidal", "tidal", "TIDAL"),
        ("amazon music", "amazon-music", "Amazon Music"),
        ("amazonmobilellc", "amazon-music", "Amazon Music"),
        ("deezer", "deezer", "Deezer"),
        ("youtube music", "youtube-music", "YouTube Music"),
        ("discord", "discord", "Discord"),
    ];
    let low = handle.to_lowercase();
    if let Some((_, id, name)) = KNOWN.iter().find(|(needle, _, _)| low.contains(needle)) {
        return (id.to_string(), name.to_string());
    }
    // "Publisher.App_hash!App" -> "App"; "something.exe" -> "something"
    let base = handle.rsplit('!').next().unwrap_or(handle);
    let base = base.strip_suffix(".exe").or(base.strip_suffix(".EXE")).unwrap_or(base);
    let base = base.rsplit(['\\', '/']).next().unwrap_or(base);
    let name: String = base.chars().take(40).collect();
    let id: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let id = id.trim_matches('-').to_string();
    if id.is_empty() { ("player".into(), "a player".into()) } else { (id, name) }
}

#[cfg(test)]
mod tests {
    use super::player_of;

    #[test]
    fn players_get_short_names() {
        assert_eq!(player_of("Spotify.exe"), ("spotify".into(), "Spotify".into()));
        assert_eq!(player_of("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), ("spotify".into(), "Spotify".into()));
        assert_eq!(player_of("MSEdge"), ("edge".into(), "Edge".into()));
        assert_eq!(player_of("308046B0AF4A39CB"), ("firefox".into(), "Firefox".into()));
        assert_eq!(player_of("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), ("media-player".into(), "Media Player".into()));
        assert_eq!(player_of("C:\\Tools\\Strange Player.exe"), ("strange-player".into(), "Strange Player".into()));
    }

    /// Prints what Windows says is playing right now (play something first):
    /// cargo test --lib live_media -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_media() {
        let t = std::time::Instant::now();
        let (sessions, _) = super::media_sessions();
        println!("read {} session(s) in {:?}", sessions.len(), t.elapsed());
        for s in &sessions {
            println!("{} ({}): {} / {} / {} playing={} {:?}/{:?} ms", s.name, s.handle, s.title, s.artist, s.album, s.playing, s.position_ms, s.length_ms);
            let t = std::time::Instant::now();
            let cover = super::media_cover(&s.handle);
            println!("  cover: {:?} bytes in {:?}", cover.map(|c| c.len()), t.elapsed());
        }
    }
}
