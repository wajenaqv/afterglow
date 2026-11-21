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
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, WS_EX_TRANSPARENT};
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

// ---- which monitors are covered by app windows ----
//
// For each monitor (physical px, as Tauri reports them), whether app windows
// hide its desktop: a 12 x 12 grid of points across the monitor, covered when
// at least 95% of them fall inside some visible window. A single maximized
// window does it, and so do two windows snapped side by side.
// Ignored: minimized and cloaked windows (other virtual desktops, suspended
// UWP apps), our own windows, the desktop and taskbars, tool windows and
// click-through overlays (game and recording overlays span the screen but
// are see-through).

pub fn covered(screens: &[(i32, i32, u32, u32, f64)]) -> Vec<bool> {
    let mut rects: Vec<RECT> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect_window), LPARAM(&mut rects as *mut Vec<RECT> as isize));
    }
    screens
        .iter()
        .map(|&(x, y, w, h, _scale)| {
            const N: i32 = 12;
            let mut hit = 0;
            for i in 0..N {
                for j in 0..N {
                    let px = x + ((2 * i + 1) * w as i32) / (2 * N);
                    let py = y + ((2 * j + 1) * h as i32) / (2 * N);
                    if rects.iter().any(|r| px >= r.left && px < r.right && py >= r.top && py < r.bottom) {
                        hit += 1;
                    }
                }
            }
            hit * 100 >= N * N * 95
        })
        .collect()
}

unsafe extern "system" fn collect_window(hwnd: HWND, out: LPARAM) -> BOOL {
    unsafe {
        let rects = &mut *(out.0 as *mut Vec<RECT>);
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return true.into();
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0) != 0 {
            return true.into();
        }
        let mut cloaked: u32 = 0;
        if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4).is_ok() && cloaked != 0 {
            return true.into();
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return true.into();
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(hwnd, &mut class) as usize;
        let class = String::from_utf16_lossy(&class[..n]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return true.into();
        }
        // the visible frame (without the invisible resize borders)
        let mut r = RECT::default();
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32).is_ok()
            && r.right > r.left
            && r.bottom > r.top
        {
            rects.push(r);
        }
    }
    true.into()
}

// ---- Do Not Disturb ----

/// Windows' Do Not Disturb (Focus assist on Windows 10): notifications are
/// held back. Read from the setting Windows itself flips
/// (Notifications\Settings NOC_GLOBAL_SETTING_TOASTS_ENABLED = 0), or the
/// shell's "quiet time" state.
pub fn do_not_disturb() -> bool {
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows::Win32::UI::Shell::QUNS_QUIET_TIME;
    let mut value: u32 = 1;
    let mut size = std::mem::size_of::<u32>() as u32;
    let toasts_off = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings"),
            w!("NOC_GLOBAL_SETTING_TOASTS_ENABLED"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut c_void),
            Some(&mut size),
        )
        .is_ok()
            && value == 0
    };
    toasts_off || matches!(unsafe { SHQueryUserNotificationState() }, Ok(s) if s == QUNS_QUIET_TIME)
}

// ---- the taskbar icon ----

/// Give a window the big icon the taskbar shows. Tauri only sets the small
/// (title bar) icon, so the Settings window's taskbar button was blank. The
/// app icon is in the exe's resources (tauri-build embeds icon.ico as
/// resource 32512).
pub fn set_taskbar_icon(window: &tauri::WebviewWindow) {
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{LoadImageW, SendMessageW, ICON_BIG, IMAGE_ICON, LR_DEFAULTCOLOR, SM_CXICON, SM_CYICON, WM_SETICON};
    let Ok(raw) = window.hwnd() else { return };
    let hwnd = HWND(raw.0 as *mut c_void);
    unsafe {
        let Ok(module) = GetModuleHandleW(None) else { return };
        let icon = LoadImageW(
            Some(module.into()),
            PCWSTR(32512 as *const u16), // MAKEINTRESOURCE(32512)
            IMAGE_ICON,
            GetSystemMetrics(SM_CXICON),
            GetSystemMetrics(SM_CYICON),
            LR_DEFAULTCOLOR,
        );
        if let Ok(icon) = icon {
            SendMessageW(hwnd, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(icon.0 as isize)));
        }
    }
}
