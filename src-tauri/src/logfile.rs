// The app's log: every message (the `alog!` macro) goes to the console, as
// before, and to afterglow.log in the settings folder, with a time stamp:
//   Windows  %APPDATA%\com.wajenaqv.afterglow\afterglow.log
//   macOS    ~/Library/Application Support/com.wajenaqv.afterglow/afterglow.log
// The installed app has no console, so this is the only record of what it
// did. A panic is written with where it happened and a backtrace; quitting
// and exiting are written too, so a log that just stops means the app was
// killed or crashed hard. Over 1 MB at start, the log moves to
// afterglow.old.log (one old copy kept).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static FILE: Mutex<Option<File>> = Mutex::new(None);
static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
const MAX_BYTES: u64 = 1024 * 1024;

/// Write a message to the console and the log file
#[macro_export]
macro_rules! alog {
    ($($t:tt)*) => { $crate::logfile::line(&format!($($t)*)) };
}

/// The settings folder (the same one Tauri's app_config_dir gives), found
/// without an AppHandle so the log starts before anything else
fn folder() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(not(any(windows, target_os = "macos")))]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"));
    base.map(|b| b.join("com.wajenaqv.afterglow"))
}

/// Open the log (call first thing) and catch panics into it
pub fn init(version: &str) {
    if let Some(dir) = folder() {
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("afterglow.log");
        if fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
            let _ = fs::rename(&path, dir.join("afterglow.old.log"));
        }
        if let Ok(f) = OpenOptions::new().create(true).append(true).open(&path) {
            *FILE.lock().unwrap() = Some(f);
            *PATH.lock().unwrap() = Some(path);
        }
    }
    line(&format!("afterglow: --- started, version {version}, {} ---", std::env::consts::OS));
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        let where_ = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
        line(&format!("afterglow: PANIC in thread {thread} at {where_}: {what}\n{}", std::backtrace::Backtrace::force_capture()));
        default(info);
    }));
}

pub fn line(msg: &str) {
    eprintln!("{msg}");
    // never let logging itself take the app down (a poisoned lock, a full disk)
    if let Ok(mut guard) = FILE.lock() {
        if let Some(f) = guard.as_mut() {
            let _ = writeln!(f, "{} {msg}", stamp());
        }
    }
}

/// "2026-11-21 16:04:09Z" (UTC; no date crate needed)
fn stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // days since 1970-01-01 -> civil date (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Settings → about: open the log in the default text editor
#[tauri::command]
pub fn open_log() -> Result<(), String> {
    let path = PATH.lock().unwrap().clone().ok_or("no log file")?;
    open::that(path).map_err(|e| e.to_string())
}
