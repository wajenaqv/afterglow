// The per-OS part of the wallpaper host. Each OS file provides:
//   attach(window, x, y, w, h)   put the window behind the desktop icons,
//                                covering that monitor (physical px)
//   restore_desktop()            on quit: repaint the normal wallpaper
//   fullscreen_app_in_front()    a fullscreen app, game or presentation is up
//   on_battery()                 running on battery power
//   has_battery()                this computer has a battery at all
//   cpu_seconds()                CPU time of AfterGlow and its webviews so far
//                                (None where that can't be told)
//   do_not_disturb()             the OS is holding notifications back
//   keep_awake(system, screen)   keep the computer (and screen) from sleeping
//   running_apps()               the apps running now, and which is in front
//   covered(screens)             per monitor (x, y, w, h physical px, scale): are app
//                                windows hiding its desktop?

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
    pub fn has_battery() -> bool {
        true
    }
    pub fn cpu_seconds() -> Option<f64> {
        None
    }
    pub fn do_not_disturb() -> bool {
        false
    }
    pub fn idle_seconds() -> f64 {
        0.0
    }
    pub fn keep_awake(system: bool, _screen: bool) -> Result<(), String> {
        if system { Err("not supported on this OS yet".into()) } else { Ok(()) }
    }
    pub fn running_apps() -> Vec<crate::awake::RunningApp> {
        Vec::new()
    }
    pub fn covered(screens: &[(i32, i32, u32, u32, f64)]) -> Vec<bool> {
        vec![false; screens.len()]
    }
}
#[cfg(not(any(windows, target_os = "macos")))]
pub use other::*;
