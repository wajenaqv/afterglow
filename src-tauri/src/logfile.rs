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

/// "2026-11-21 16:04:09", local time
#[cfg(windows)]
fn stamp() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

/// "2026-11-21 16:04:09", local time (C's localtime_r; no date crate needed)
#[cfg(not(windows))]
fn stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    #[repr(C)]
    struct Tm {
        sec: i32,
        min: i32,
        hour: i32,
        mday: i32,
        mon: i32,
        year: i32,
        wday: i32,
        yday: i32,
        isdst: i32,
        gmtoff: std::ffi::c_long,
        zone: *const std::ffi::c_char,
    }
    unsafe extern "C" {
        fn localtime_r(time: *const i64, out: *mut Tm) -> *mut Tm;
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let mut t = std::mem::MaybeUninit::<Tm>::zeroed();
    let t = unsafe {
        localtime_r(&secs, t.as_mut_ptr());
        t.assume_init()
    };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", t.year + 1900, t.mon + 1, t.mday, t.hour, t.min, t.sec)
}

/// Settings → general: open the log in the default text editor
#[tauri::command]
pub fn open_log() -> Result<(), String> {
    let path = PATH.lock().unwrap().clone().ok_or("no log file")?;
    open::that(path).map_err(|e| e.to_string())
}
