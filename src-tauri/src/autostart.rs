//! Start at login.
//!
//! A normal install uses the autostart plugin, which writes a Run entry in
//! the registry. Inside the Microsoft Store's MSIX package that registry
//! write lands in the package's private copy of the registry, which Windows
//! never reads at login, so there it's the package's StartupTask instead
//! (declared in scripts/windows/store/AppxManifest.xml, id below). The task
//! only exists inside that package: anywhere else (plain install, dev build,
//! the sparse dev package, macOS) we fall back to the plugin.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Is AfterGlow set to start at login?
pub fn is_enabled(app: &AppHandle) -> bool {
    if let Some(on) = store::is_enabled() {
        return on;
    }
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turns start at login on or off; returns what is actually set afterwards.
pub fn set(app: &AppHandle, on: bool) -> Result<bool, String> {
    if let Some(result) = store::set(on) {
        return result;
    }
    let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
    result.map_err(|e| e.to_string())?;
    Ok(app.autolaunch().is_enabled().unwrap_or(on))
}

#[cfg(windows)]
mod store {
    use windows::core::HSTRING;
    use windows::ApplicationModel::{StartupTask, StartupTaskState};

    /// Must match TaskId in the Store package's AppxManifest.xml.
    const TASK_ID: &str = "AfterGlowStartup";

    /// The package's startup task, or None when not running from the Store
    /// package (Windows returns an error then).
    fn task() -> Option<StartupTask> {
        StartupTask::GetAsync(&HSTRING::from(TASK_ID)).and_then(|op| op.get()).ok()
    }

    fn enabled(state: StartupTaskState) -> bool {
        state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy
    }

    pub fn is_enabled() -> Option<bool> {
        let task = task()?;
        Some(task.State().map(enabled).unwrap_or(false))
    }

    pub fn set(on: bool) -> Option<Result<bool, String>> {
        let task = task()?;
        if !on {
            return Some(task.Disable().map(|_| false).map_err(|e| e.to_string()));
        }
        let state = match task.RequestEnableAsync().and_then(|op| op.get()) {
            Ok(state) => state,
            Err(e) => return Some(Err(e.to_string())),
        };
        Some(if enabled(state) {
            Ok(true)
        } else if state == StartupTaskState::DisabledByUser {
            // Windows won't let an app undo the user's own choice.
            Err("start at login is switched off for AfterGlow in Task Manager → Startup apps; switch it on there".into())
        } else {
            Err("Windows policy doesn't allow AfterGlow to start at login".into())
        })
    }
}

#[cfg(not(windows))]
mod store {
    pub fn is_enabled() -> Option<bool> {
        None
    }
    pub fn set(_on: bool) -> Option<Result<bool, String>> {
        None
    }
}
