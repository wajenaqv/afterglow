// Windows: put a window behind the desktop icons.
//
// The desktop is a window called Progman. Sending it the undocumented message
// 0x052C makes Explorer create a "WorkerW" window that sits between the
// wallpaper and the icons; making our window its child puts it right there.
// Two layouts exist:
//   - before Windows 11 24H2: the new WorkerW is a top-level window, the
//     sibling right after the one that holds the icons (SHELLDLL_DefView)
//   - 24H2 and later: the WorkerW is a child of Progman itself
// We look for the first, then fall back to the second.
// (Same approach as Lively Wallpaper and Wallpaper Engine; no code copied.)

use std::ffi::c_void;

use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetSystemMetrics, GetWindowLongPtrW, SendMessageTimeoutW, SetParent,
    SetWindowLongPtrW, SetWindowPos, SystemParametersInfoW, GWL_EXSTYLE, SMTO_NORMAL, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, SPI_GETDESKWALLPAPER, SPI_SETDESKWALLPAPER, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW,
    SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

/// Finds the WorkerW behind the desktop icons, asking Explorer to create it first.
fn wallpaper_layer() -> Option<HWND> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), PCWSTR::null()).ok()?;
        let mut _result = 0usize;
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut _result));

        // Pre-24H2: the top-level WorkerW after the one holding SHELLDLL_DefView
        let mut found = HWND::default();
        let _ = EnumWindows(Some(find_worker), LPARAM(&mut found as *mut HWND as isize));
        if !found.is_invalid() {
            return Some(found);
        }
        // 24H2+: a WorkerW child of Progman
        FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null()).ok()
    }
}

unsafe extern "system" fn find_worker(top: HWND, out: LPARAM) -> BOOL {
    unsafe {
        let icons = FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), PCWSTR::null());
        if icons.is_ok() {
            // the WorkerW right after this window (in z-order) is ours
            if let Ok(worker) = FindWindowExW(None, Some(top), w!("WorkerW"), PCWSTR::null()) {
                *(out.0 as *mut HWND) = worker;
            }
        }
    }
    true.into()
}

pub fn attach(window: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    // Tauri's HWND comes from its own copy of the `windows` crate; rebuild ours
    // from the raw pointer
    let raw = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd = HWND(raw.0 as *mut c_void);
    let layer = wallpaper_layer().ok_or("could not find the desktop's wallpaper layer (WorkerW)")?;
    unsafe {
        // never take focus, never appear in Alt+Tab
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
        SetParent(hwnd, Some(layer)).map_err(|e| e.to_string())?;
        // child coordinates: the layer's origin is the virtual screen's top-left
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        SetWindowPos(hwnd, None, x - vx, y - vy, w as i32, h as i32, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Re-applies the current desktop wallpaper so Explorer repaints it; without
/// this the last AfterGlow frame stays on the desktop after quitting.
/// (Same image, not saved to the user's settings.)
pub fn restore_desktop() {
    unsafe {
        let mut path = [0u16; 260];
        if SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            path.len() as u32,
            Some(path.as_mut_ptr() as *mut c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .is_ok()
        {
            let _ = SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                Some(path.as_mut_ptr() as *mut c_void),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            );
        }
    }
}

/// Windows' own "do not disturb" signal: a fullscreen app, a DirectX game or
/// presentation mode is running.
pub fn fullscreen_app_in_front() -> bool {
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

pub fn on_battery() -> bool {
    let mut status = SYSTEM_POWER_STATUS::default();
    // ACLineStatus: 0 = on battery, 1 = plugged in, 255 = unknown (desktops)
    unsafe { GetSystemPowerStatus(&mut status).is_ok() && status.ACLineStatus == 0 }
}
