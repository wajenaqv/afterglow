// The per-OS part of the wallpaper host. Each OS file provides:
//   attach(window, x, y, w, h)   put the window behind the desktop icons,
//                                covering that monitor (physical px)
//   restore_desktop()            on quit: repaint the normal wallpaper
//   fullscreen_app_in_front()    a fullscreen app, game or presentation is up
//   on_battery()                 running on battery power

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use self::macos::*;

// Anything else (Linux): no desktop integration yet, windows stay normal
#[cfg(not(any(windows, target_os = "macos")))]
mod other {
    pub fn attach(_: &tauri::WebviewWindow, _: i32, _: i32, _: u32, _: u32) -> Result<(), String> {
        Err("not supported on this OS yet".into())
    }
    pub fn restore_desktop() {}
    pub fn fullscreen_app_in_front() -> bool {
        false
    }
    pub fn on_battery() -> bool {
        false
    }
}
#[cfg(not(any(windows, target_os = "macos")))]
pub use other::*;
