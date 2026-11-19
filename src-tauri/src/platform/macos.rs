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


// ---- the pause rules (parity with Windows) ----
//
// macOS has no "fullscreen app" or "covered desktop" signal of its own, so
// both come from the list of on-screen windows that every app can read
// (CGWindowListCopyWindowInfo; no permission needed, as long as we only read
// window sizes and owners, not titles). Only ordinary app windows count
// (window layer 0): not the menu bar, the Dock, the desktop or overlays.
//
// Units: CoreGraphics measures in points with the origin at the top left of
// the main display, y down. Tauri gives monitors in physical pixels, so they
// are divided by each display's scale.
//
// These are C functions from Apple's frameworks, declared by hand below
// (like cgo's `import "C"` in Go).

use std::ffi::{c_char, c_void};

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFNumberRef = *const c_void;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFArrayGetCount(array: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, idx: isize) -> *const c_void;
    fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;
    fn CFNumberGetValue(number: CFNumberRef, the_type: isize, value_ptr: *mut c_void) -> bool;
    fn CFStringGetCString(s: CFStringRef, buffer: *mut c_char, size: isize, encoding: u32) -> bool;
    fn CFRelease(cf: CFTypeRef);
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> CFArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    static kCGWindowLayer: CFStringRef;
    static kCGWindowBounds: CFStringRef;
    static kCGWindowOwnerPID: CFStringRef;
    static kCGWindowAlpha: CFStringRef;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPSCopyPowerSourcesInfo() -> CFTypeRef;
    fn IOPSGetProvidingPowerSourceType(snapshot: CFTypeRef) -> CFStringRef;
}

const ON_SCREEN_ONLY: u32 = 1 << 0; // kCGWindowListOptionOnScreenOnly
const EXCLUDE_DESKTOP: u32 = 1 << 4; // kCGWindowListExcludeDesktopElements
const CF_NUMBER_SINT64: isize = 4; // kCFNumberSInt64Type
const CF_NUMBER_FLOAT64: isize = 6; // kCFNumberFloat64Type
const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8

/// A number from a window's info dictionary (as f64), if present
unsafe fn info_number(info: CFDictionaryRef, key: CFStringRef, ty: isize) -> Option<f64> {
    unsafe {
        let v = CFDictionaryGetValue(info, key);
        if v.is_null() {
            return None;
        }
        if ty == CF_NUMBER_FLOAT64 {
            let mut f = 0f64;
            if CFNumberGetValue(v, ty, &mut f as *mut f64 as *mut c_void) { Some(f) } else { None }
        } else {
            let mut n = 0i64;
            if CFNumberGetValue(v, ty, &mut n as *mut i64 as *mut c_void) { Some(n as f64) } else { None }
        }
    }
}

/// The frames (in points) of other apps' ordinary, visible windows on screen
fn app_window_frames() -> Vec<CGRect> {
    let mut out = Vec::new();
    let me = std::process::id() as f64;
    unsafe {
        let list = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0);
        if list.is_null() {
            return out;
        }
        for i in 0..CFArrayGetCount(list) {
            let info = CFArrayGetValueAtIndex(list, i);
            if info_number(info, kCGWindowLayer, CF_NUMBER_SINT64) != Some(0.0) {
                continue; // menu bar, Dock, overlays, our own desktop-level windows
            }
            if info_number(info, kCGWindowOwnerPID, CF_NUMBER_SINT64) == Some(me) {
                continue;
            }
            if info_number(info, kCGWindowAlpha, CF_NUMBER_FLOAT64).unwrap_or(1.0) < 0.1 {
                continue; // invisible
            }
            let bounds = CFDictionaryGetValue(info, kCGWindowBounds);
            let mut r = CGRect::default();
            if !bounds.is_null() && CGRectMakeWithDictionaryRepresentation(bounds, &mut r) && r.size.width > 1.0 && r.size.height > 1.0 {
                out.push(r);
            }
        }
        CFRelease(list);
    }
    out
}

fn displays() -> Vec<CGRect> {
    let mut ids = [0u32; 16];
    let mut n = 0u32;
    unsafe {
        if CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut n) != 0 {
            return Vec::new();
        }
        ids[..n as usize].iter().map(|&d| CGDisplayBounds(d)).collect()
    }
}

/// An app window filling a whole display: a fullscreen app (they get their
/// own Space; while it's showing, its window covers the display, menu bar
/// included) or a game.
pub fn fullscreen_app_in_front() -> bool {
    let shown = displays();
    app_window_frames().iter().any(|w| {
        shown.iter().any(|d| {
            (w.origin.x - d.origin.x).abs() < 1.0
                && (w.origin.y - d.origin.y).abs() < 1.0
                && (w.size.width - d.size.width).abs() < 1.0
                && (w.size.height - d.size.height).abs() < 1.0
        })
    })
}

/// On battery power, or in Low Power Mode (which can be on while plugged in):
/// both mean "save power" for the "Pause on battery" rule
pub fn on_battery() -> bool {
    let mut battery = false;
    unsafe {
        let snapshot = IOPSCopyPowerSourcesInfo();
        if !snapshot.is_null() {
            let source = IOPSGetProvidingPowerSourceType(snapshot); // not ours to release
            if !source.is_null() {
                let mut buf = [0 as c_char; 64];
                if CFStringGetCString(source, buf.as_mut_ptr(), buf.len() as isize, UTF8) {
                    let name = std::ffi::CStr::from_ptr(buf.as_ptr()).to_string_lossy();
                    battery = name == "Battery Power";
                }
            }
            CFRelease(snapshot);
        }
    }
    battery || low_power_mode()
}

/// NSProcessInfo.processInfo.isLowPowerModeEnabled (macOS 12 and later)
fn low_power_mode() -> bool {
    use objc2::{class, sel};
    unsafe {
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        if info.is_null() {
            return false;
        }
        let info: &AnyObject = &*info;
        let has: bool = msg_send![info, respondsToSelector: sel!(isLowPowerModeEnabled)];
        if !has {
            return false;
        }
        let low: bool = msg_send![info, isLowPowerModeEnabled];
        low
    }
}

/// Per display (physical px and scale, as Tauri reports them): do other
/// apps' windows hide its desktop? The same test as on Windows: a 12 x 12
/// grid of points, covered when 95% of them are inside some window.
pub fn covered(screens: &[(i32, i32, u32, u32, f64)]) -> Vec<bool> {
    let windows = app_window_frames();
    screens
        .iter()
        .map(|&(x, y, w, h, scale)| {
            let s = if scale > 0.0 { scale } else { 1.0 };
            let (x, y, w, h) = (x as f64 / s, y as f64 / s, w as f64 / s, h as f64 / s);
            const N: i32 = 12;
            let mut hit = 0;
            for i in 0..N {
                for j in 0..N {
                    let px = x + (2 * i + 1) as f64 * w / (2 * N) as f64;
                    let py = y + (2 * j + 1) as f64 * h / (2 * N) as f64;
                    let inside = |r: &CGRect| px >= r.origin.x && px < r.origin.x + r.size.width && py >= r.origin.y && py < r.origin.y + r.size.height;
                    if windows.iter().any(inside) {
                        hit += 1;
                    }
                }
            }
            hit * 100 >= N * N * 95
        })
        .collect()
}

// ---- Dock badges (the "dock" connector, connectors/mod.rs) ----
//
// The red badges on Dock icons ("3", or a dot for apps that don't count),
// read through the Accessibility API: the Dock is an app like any other, and
// its icons are elements with a title (the app's name) and a status label
// (the badge). Needs the Accessibility permission (System Settings →
// Privacy & Security → Accessibility). macOS ties that permission to the
// app's code signature, so unsigned test builds need it again after each
// update.

type AXUIElementRef = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef) -> i32;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(alloc: *const c_void, c_str: *const c_char, encoding: u32) -> CFStringRef;
    fn CFDictionaryCreate(
        alloc: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    static kCFBooleanTrue: CFTypeRef;
    static kCFTypeDictionaryKeyCallBacks: [u8; 0];
    static kCFTypeDictionaryValueCallBacks: [u8; 0];
}

/// Is AfterGlow allowed to use Accessibility? With prompt = true, macOS
/// shows its "allow in System Settings" prompt if not (once per launch).
pub fn accessibility_trusted(prompt: bool) -> bool {
    unsafe {
        if !prompt {
            return AXIsProcessTrusted();
        }
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let opts = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks as *const [u8; 0] as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const [u8; 0] as *const c_void,
        );
        let ok = AXIsProcessTrustedWithOptions(opts);
        if !opts.is_null() {
            CFRelease(opts);
        }
        ok
    }
}

/// A CFString we own, released when dropped
struct CfStr(CFStringRef);
impl CfStr {
    fn new(s: &str) -> Self {
        let c = std::ffi::CString::new(s).unwrap();
        CfStr(unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) })
    }
}
impl Drop for CfStr {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

/// An attribute of an Accessibility element; the caller releases it
unsafe fn ax_attr(el: AXUIElementRef, name: &str) -> Option<CFTypeRef> {
    let key = CfStr::new(name);
    let mut v: CFTypeRef = std::ptr::null();
    unsafe {
        if AXUIElementCopyAttributeValue(el, key.0, &mut v) == 0 && !v.is_null() { Some(v) } else { None }
    }
}

/// A string attribute as a Rust String (None if missing or not a string)
unsafe fn ax_string(el: AXUIElementRef, name: &str) -> Option<String> {
    unsafe {
        let v = ax_attr(el, name)?;
        let out = if CFGetTypeID(v) == CFStringGetTypeID() {
            let mut buf = [0 as c_char; 256];
            if CFStringGetCString(v, buf.as_mut_ptr(), buf.len() as isize, UTF8) {
                Some(std::ffi::CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
            } else {
                None
            }
        } else {
            None
        };
        CFRelease(v);
        out
    }
}

/// The Dock's process id (via NSRunningApplication)
fn dock_pid() -> Option<i32> {
    use objc2::class;
    unsafe {
        let id = std::ffi::CString::new("com.apple.dock").unwrap();
        let ns_id: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: id.as_ptr()];
        if ns_id.is_null() {
            return None;
        }
        let apps: *mut AnyObject = msg_send![class!(NSRunningApplication), runningApplicationsWithBundleIdentifier: ns_id];
        if apps.is_null() {
            return None;
        }
        let apps: &AnyObject = &*apps;
        let first: *mut AnyObject = msg_send![apps, firstObject];
        if first.is_null() {
            return None;
        }
        let first: &AnyObject = &*first;
        let pid: i32 = msg_send![first, processIdentifier];
        Some(pid)
    }
}

/// Every Dock icon with a badge: (app name, count). A badge that isn't a
/// number (a dot) counts as 1.
pub fn dock_badges() -> Result<Vec<(String, u32)>, String> {
    let pid = dock_pid().ok_or("the Dock isn't running")?;
    let mut out = Vec::new();
    unsafe {
        let dock = AXUIElementCreateApplication(pid);
        if dock.is_null() {
            return Err("couldn't reach the Dock".into());
        }
        // Dock app -> its list (AXList) -> the icons in it
        if let Some(lists) = ax_attr(dock, "AXChildren") {
            if CFGetTypeID(lists) == CFArrayGetTypeID() {
                for i in 0..CFArrayGetCount(lists) {
                    let list = CFArrayGetValueAtIndex(lists, i);
                    if ax_string(list, "AXRole").as_deref() != Some("AXList") {
                        continue;
                    }
                    let Some(items) = ax_attr(list, "AXChildren") else { continue };
                    if CFGetTypeID(items) == CFArrayGetTypeID() {
                        for k in 0..CFArrayGetCount(items) {
                            let item = CFArrayGetValueAtIndex(items, k);
                            let Some(badge) = ax_string(item, "AXStatusLabel") else { continue };
                            let badge = badge.trim();
                            if badge.is_empty() {
                                continue;
                            }
                            let name = ax_string(item, "AXTitle").unwrap_or_else(|| "app".into());
                            let n = badge.trim_end_matches('+').parse::<u32>().unwrap_or(1).max(1);
                            out.push((name, n));
                        }
                    }
                    CFRelease(items);
                }
            }
            CFRelease(lists);
        }
        CFRelease(dock);
    }
    Ok(out)
}

/// macOS has no public way to read Focus / Do Not Disturb, so the "quiet
/// during Do Not Disturb" rule does nothing on Mac for now.
pub fn do_not_disturb() -> bool {
    false
}
