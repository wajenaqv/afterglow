// macOS: put a window behind the desktop icons.
//
// Finder draws the desktop icons in a window at "desktop icon" level; our
// window goes one step below, at desktop level, so it sits between the
// system wallpaper and the icons. It also joins every Space, stays put when
// switching Spaces, skips Cmd+Tab/Mission Control cycling and lets clicks
// through to the desktop. (The approach Plash uses; no code copied.)
//
// These are plain Objective-C messages to the NSWindow (like calling methods
// through an interface{} in Go): setLevel:, setCollectionBehavior:,
// setIgnoresMouseEvents:. They must run on the main thread, which is where
// Tauri's setup and run_on_main_thread run.

use objc2::msg_send;
use objc2::runtime::AnyObject;

// CGWindowLevelForKey(kCGDesktopWindowLevelKey) = kCGMinimumWindowLevel + 20
const DESKTOP_WINDOW_LEVEL: isize = (i32::MIN + 20) as isize;
// NSWindowCollectionBehavior bits
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;

pub fn attach(window: &tauri::WebviewWindow, _x: i32, _y: i32, _w: u32, _h: u32) -> Result<(), String> {
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
    if ns_window.is_null() {
        return Err("no NSWindow".into());
    }
    unsafe {
        let ns_window: &AnyObject = &*ns_window;
        let _: () = msg_send![ns_window, setLevel: DESKTOP_WINDOW_LEVEL];
        let _: () = msg_send![ns_window, setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE];
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: true];
    }
    Ok(())
}

/// macOS repaints the desktop by itself when our windows close.
pub fn restore_desktop() {}

/// TODO: detect fullscreen apps on macOS (CGWindowList or NSWorkspace).
pub fn fullscreen_app_in_front() -> bool {
    false
}

/// TODO: read the power source on macOS (IOKit IOPSCopyPowerSourcesInfo).
pub fn on_battery() -> bool {
    false
}
