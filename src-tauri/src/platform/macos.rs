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

// Ask macOS for the desktop window level instead of hard-coding it: the
// number moves between releases. On macOS 26 the system wallpaper (drawn by
// the Dock) sits at INT32_MIN + 24 and the desktop level is INT32_MIN + 25;
// the old header value (INT32_MIN + 20) put us under the wallpaper, invisible.
const DESKTOP_WINDOW_LEVEL_KEY: i32 = 2; // kCGDesktopWindowLevelKey

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}
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
        // NSWindowLevel is an NSInteger (isize); CG gives an i32
        let level = CGWindowLevelForKey(DESKTOP_WINDOW_LEVEL_KEY) as isize;
        let _: () = msg_send![ns_window, setLevel: level];
        let _: () = msg_send![ns_window, setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE];
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: true];
    }
    Ok(())
}

// ---- the app's own menu opening and closing ----
//
// AppKit posts these notifications around every menu this app shows. The
// local CFNotificationCenter is the same centre as AppKit's, and takes a
// plain C callback (no Objective-C class needed).
type NotificationCallback = extern "C" fn(*mut c_void, *mut c_void, *const c_void, *const c_void, *const c_void);

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFNotificationCenterGetLocalCenter() -> *mut c_void;
    fn CFNotificationCenterAddObserver(center: *mut c_void, observer: *const c_void, callback: NotificationCallback, name: CFTypeRef, object: *const c_void, behavior: isize);
}

static ON_MENU: std::sync::OnceLock<fn(bool)> = std::sync::OnceLock::new();

/// Call `f(true)` when one of our menus opens and `f(false)` when it closes
/// (on the main thread). Call once, from the main thread.
pub fn watch_menus(f: fn(bool)) {
    extern "C" fn opened(_: *mut c_void, _: *mut c_void, _: *const c_void, _: *const c_void, _: *const c_void) {
        if let Some(f) = ON_MENU.get() {
            f(true);
        }
    }
    extern "C" fn closed(_: *mut c_void, _: *mut c_void, _: *const c_void, _: *const c_void, _: *const c_void) {
        if let Some(f) = ON_MENU.get() {
            f(false);
        }
    }
    const DELIVER_NOW: isize = 4; // CFNotificationSuspensionBehaviorDeliverImmediately
    let _ = ON_MENU.set(f);
    let begin = CfStr::new("NSMenuDidBeginTrackingNotification");
    let end = CfStr::new("NSMenuDidEndTrackingNotification");
    // an observer is told apart by its address; any stable one will do
    let me = &ON_MENU as *const _ as *const c_void;
    unsafe {
        let center = CFNotificationCenterGetLocalCenter();
        CFNotificationCenterAddObserver(center, me, opened, begin.0, std::ptr::null(), DELIVER_NOW);
        CFNotificationCenterAddObserver(center, me, closed, end.0, std::ptr::null(), DELIVER_NOW);
    }
}

// ---- a black system wallpaper while AfterGlow runs ----
//
// Mission Control and the Space-switch slide draw macOS's own copy of the
// system wallpaper, never desktop-level windows like ours. So while AfterGlow
// runs, the system wallpaper is plain black, matching the scenes' black.
//
// Restoring: the public API (desktopImageURLForScreen:) can't describe the
// dynamic / Aerial wallpapers of macOS 14+ (it gives a still placeholder), so
// setting it back that way would turn them into stills. Instead the wallpaper
// store (~/Library/Application Support/com.apple.wallpaper/Store/Index.plist,
// undocumented) is copied aside first and put back on quit, then
// WallpaperAgent is restarted to read it. Tested on macOS 26.6; if a future
// macOS moves the store, black_desktop does nothing rather than risk losing
// the owner's wallpaper.
//
// The backup stays in AfterGlow's config folder until quit, so after a crash
// the next launch keeps the original backup instead of backing up "black".
// (A wallpaper picked in System Settings while AfterGlow runs is replaced by
// the backup on quit.)

static BACKUP: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
const BLACK_PNG: &[u8] = include_bytes!("../../assets/black.png");

fn wallpaper_store() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let path = std::path::Path::new(&home).join("Library/Application Support/com.apple.wallpaper/Store/Index.plist");
    path.is_file().then_some(path)
}

/// Back up the system wallpaper (once) and set every display to black.
/// `dir` is AfterGlow's config folder. Main thread only (NSWorkspace).
pub fn black_desktop(dir: &std::path::Path) {
    let Some(store) = wallpaper_store() else {
        crate::alog!("afterglow: no wallpaper store found; leaving the system wallpaper alone");
        return;
    };
    let backup = dir.join("wallpaper-store-backup.plist");
    if !backup.exists() {
        if let Err(e) = std::fs::create_dir_all(dir).and_then(|_| std::fs::copy(&store, &backup)) {
            crate::alog!("afterglow: could not back up the wallpaper ({e}); leaving it alone");
            return;
        }
    }
    let _ = BACKUP.set(backup);
    let black = dir.join("black.png");
    if std::fs::write(&black, BLACK_PNG).is_err() {
        return;
    }
    let _ = BLACK.set(black);
    set_black(false);
}

static BLACK: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// setDesktopImageURL only changes the Space you're on, so the host calls
/// this about once a second (main thread): a Space that isn't black yet
/// becomes black when you first switch to it. (All Spaces are in the one
/// store, so the backup restores them all.)
pub fn keep_desktop_black() {
    if BLACK.get().is_some() {
        set_black(true);
    }
}

/// Set the black picture on every display; with `only_if_needed`, only
/// where the current picture is something else. Main thread only.
fn set_black(only_if_needed: bool) {
    use objc2::class;
    let Some(black) = BLACK.get() else { return };
    let black_str = black.to_string_lossy().into_owned();
    unsafe {
        let path = std::ffi::CString::new(black_str.as_bytes()).unwrap();
        let ns_path: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: path.as_ptr()];
        let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: ns_path];
        let options: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if url.is_null() || options.is_null() || workspace.is_null() || screens.is_null() {
            return;
        }
        let (workspace, screens) = (&*workspace, &*screens);
        let n: usize = msg_send![screens, count];
        for i in 0..n {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
            if only_if_needed {
                // the current picture's file path, compared with ours
                let current: *mut AnyObject = msg_send![workspace, desktopImageURLForScreen: screen];
                if !current.is_null() {
                    let p: *mut AnyObject = msg_send![&*current, path];
                    if !p.is_null() {
                        let c: *const c_char = msg_send![&*p, UTF8String];
                        if !c.is_null() && std::ffi::CStr::from_ptr(c).to_string_lossy() == black_str {
                            continue;
                        }
                    }
                }
            }
            let mut error: *mut AnyObject = std::ptr::null_mut();
            let ok: bool = msg_send![workspace, setDesktopImageURL: url, forScreen: screen, options: options, error: &mut error];
            if !ok {
                crate::alog!("afterglow: could not set a black wallpaper on display {i}");
            }
        }
    }
}

/// On quit: put the owner's wallpaper back (see black_desktop).
pub fn restore_desktop() {
    let (Some(backup), Some(store)) = (BACKUP.get(), wallpaper_store()) else { return };
    match std::fs::copy(backup, &store) {
        Ok(_) => {
            // WallpaperAgent only reads the store when it starts; launchd
            // restarts it straight away
            let _ = std::process::Command::new("/usr/bin/killall").arg("WallpaperAgent").status();
            let _ = std::fs::remove_file(backup);
        }
        Err(e) => crate::alog!("afterglow: could not restore the wallpaper ({e}); the backup stays at {}", backup.display()),
    }
}


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

/// Does window `w` look like a fullscreen app on display `d` (both in
/// points)? Full width, down to the bottom edge, and starting at the top or
/// just under it: on a MacBook with a notch, fullscreen apps start below the
/// notch (y = 38 pt) and macOS leaves that strip see-through, so a plain
/// "window == display" test never matched there. (A zoomed window with the
/// Dock hidden matches too; it hides the desktop anyway.)
fn fullscreen_frame(w: &CGRect, d: &CGRect) -> bool {
    const TOP_STRIP: f64 = 50.0; // the tallest menu bar / notch inset, points
    let top = w.origin.y - d.origin.y;
    (w.origin.x - d.origin.x).abs() < 1.0
        && (w.size.width - d.size.width).abs() < 1.0
        && ((w.origin.y + w.size.height) - (d.origin.y + d.size.height)).abs() < 1.0
        && top > -1.0
        && top <= TOP_STRIP
}

/// A fullscreen app or game on any display
pub fn fullscreen_app_in_front() -> bool {
    let shown = displays();
    app_window_frames().iter().any(|w| shown.iter().any(|d| fullscreen_frame(w, d)))
}

/// Per display (physical px and scale, as Tauri reports them): is a
/// fullscreen app showing on it? Our window joins every Space, fullscreen
/// ones included, and would show through the strip beside the notch, so the
/// host hides it there (set_visible).
pub fn fullscreen_on(screens: &[(i32, i32, u32, u32, f64)]) -> Vec<bool> {
    fullscreen_on_by(screens, &app_window_frames())
}

fn fullscreen_on_by(screens: &[(i32, i32, u32, u32, f64)], windows: &[CGRect]) -> Vec<bool> {
    screens
        .iter()
        .map(|&(x, y, w, h, scale)| {
            let s = if scale > 0.0 { scale } else { 1.0 };
            let d = CGRect {
                origin: CGPoint { x: x as f64 / s, y: y as f64 / s },
                size: CGSize { width: w as f64 / s, height: h as f64 / s },
            };
            windows.iter().any(|w| fullscreen_frame(w, &d))
        })
        .collect()
}

/// Show or hide a wall window without taking it off its Spaces (alpha 0
/// rather than orderOut, so it's back instantly). Main thread only.
pub fn set_visible(window: &tauri::WebviewWindow, visible: bool) {
    let Ok(ns_window) = window.ns_window() else { return };
    let ns_window = ns_window as *mut AnyObject;
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let ns_window: &AnyObject = &*ns_window;
        let alpha: f64 = if visible { 1.0 } else { 0.0 }; // CGFloat is f64 on 64-bit
        let _: () = msg_send![ns_window, setAlphaValue: alpha];
    }
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

// ---- each display's visible area (NSScreen.visibleFrame) ----
//
// AppKit wants NSScreen read on the main thread, and the pause loop runs on
// its own thread, so the read hops to the main thread with libdispatch
// (dispatch_sync_f, part of libSystem: no extra crate). The tray calls
// apply_pause on the main thread itself, where a dispatch_sync to the main
// queue would wait for itself forever, so there it reads directly.

// Let msg_send! return these structs (it checks the Objective-C type
// encoding); the field encodings say "two doubles", as on 64-bit macOS.
unsafe impl objc2::Encode for CGPoint {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl objc2::Encode for CGSize {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl objc2::Encode for CGRect {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

unsafe extern "C" {
    static _dispatch_main_q: c_void; // what the dispatch_get_main_queue() macro returns
    fn dispatch_sync_f(queue: *const c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
    fn pthread_main_np() -> i32;
}

/// (frame, visible frame) of every display, in CoreGraphics points (top-left
/// origin, y down; AppKit's are bottom-left, y up, so they're flipped here)
fn visible_frames() -> Vec<(CGRect, CGRect)> {
    extern "C" fn work(out: *mut c_void) {
        let out = unsafe { &mut *(out as *mut Vec<(CGRect, CGRect)>) };
        *out = visible_frames_here();
    }
    let mut out: Vec<(CGRect, CGRect)> = Vec::new();
    unsafe {
        if pthread_main_np() != 0 {
            return visible_frames_here();
        }
        dispatch_sync_f(&_dispatch_main_q, &mut out as *mut _ as *mut c_void, work);
    }
    out
}

/// visible_frames' body; main thread only
fn visible_frames_here() -> Vec<(CGRect, CGRect)> {
    use objc2::class;
    let mut out = Vec::new();
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return out;
        }
        let screens: &AnyObject = &*screens;
        let n: usize = msg_send![screens, count];
        // AppKit's y is measured up from the bottom of the primary display
        // (the first screen); CoreGraphics' y down from its top
        let mut primary_h = 0.0;
        for i in 0..n {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
            let screen: &AnyObject = &*screen;
            let frame: CGRect = msg_send![screen, frame];
            let visible: CGRect = msg_send![screen, visibleFrame];
            if i == 0 {
                primary_h = frame.size.height;
            }
            let flip = |r: CGRect| CGRect {
                origin: CGPoint { x: r.origin.x, y: primary_h - (r.origin.y + r.size.height) },
                size: r.size,
            };
            out.push((flip(frame), flip(visible)));
        }
    }
    out
}

/// Per display (physical px and scale, as Tauri reports them): do other
/// apps' windows hide its desktop? The same test as on Windows: a 12 x 12
/// grid of points, covered when 95% of them are inside some window.
///
/// The grid covers the display's *visible* area (without the menu bar and
/// the Dock, NSScreen.visibleFrame): a zoomed window stops at the Dock, which
/// on a MacBook is ~6% of the height, so measured over the whole display a
/// zoomed window never reached 95%.
pub fn covered(screens: &[(i32, i32, u32, u32, f64)]) -> Vec<bool> {
    covered_by(screens, &app_window_frames(), &visible_frames())
}

fn covered_by(screens: &[(i32, i32, u32, u32, f64)], windows: &[CGRect], visible: &[(CGRect, CGRect)]) -> Vec<bool> {
    screens
        .iter()
        .map(|&(x, y, w, h, scale)| {
            let s = if scale > 0.0 { scale } else { 1.0 };
            let (x, y, w, h) = (x as f64 / s, y as f64 / s, w as f64 / s, h as f64 / s);
            // this display's visible area, if NSScreen knows it
            let same = |f: &CGRect| (f.origin.x - x).abs() < 1.0 && (f.origin.y - y).abs() < 1.0 && (f.size.width - w).abs() < 1.0 && (f.size.height - h).abs() < 1.0;
            let (x, y, w, h) = match visible.iter().find(|(frame, _)| same(frame)) {
                Some((_, v)) => (v.origin.x, v.origin.y, v.size.width, v.size.height),
                None => (x, y, w, h),
            };
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> CGRect {
        CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } }
    }

    // The owner's MacBook: 1920 x 1243 pt at 2x, notch strip 38 pt tall
    const BUILT_IN: (i32, i32, u32, u32, f64) = (0, 0, 3840, 2486, 2.0);
    // An external display to the left, 1x, at a negative origin
    const LEFT: (i32, i32, u32, u32, f64) = (-2560, 0, 2560, 1440, 1.0);

    #[test]
    fn fullscreen_under_the_notch() {
        let app = rect(0.0, 38.0, 1920.0, 1205.0); // as measured on the owner's Mac
        assert_eq!(fullscreen_on_by(&[BUILT_IN, LEFT], &[app]), vec![true, false]);
    }

    #[test]
    fn fullscreen_without_a_notch() {
        let app = rect(-2560.0, 0.0, 2560.0, 1440.0);
        assert_eq!(fullscreen_on_by(&[BUILT_IN, LEFT], &[app]), vec![false, true]);
    }

    #[test]
    fn ordinary_windows_are_not_fullscreen() {
        let half = rect(0.0, 38.0, 960.0, 1205.0); // tiled left half
        let above_dock = rect(0.0, 38.0, 1920.0, 1100.0); // zoomed, Dock showing
        let small = rect(200.0, 200.0, 800.0, 600.0);
        assert_eq!(fullscreen_on_by(&[BUILT_IN], &[half, above_dock, small]), vec![false]);
    }

    #[test]
    fn covered_per_display() {
        // 38 pt menu bar and a default-size Dock (~80 pt; the owner's is a
        // small 38 pt one, which happened to stay under the old 95% limit)
        let visible = [
            (rect(0.0, 0.0, 1920.0, 1243.0), rect(0.0, 38.0, 1920.0, 1125.0)),
            (rect(-2560.0, 0.0, 2560.0, 1440.0), rect(-2560.0, 25.0, 2560.0, 1415.0)),
        ];
        let zoomed = rect(0.0, 38.0, 1920.0, 1125.0); // stops at the Dock
        assert_eq!(covered_by(&[BUILT_IN, LEFT], &[zoomed], &visible), vec![true, false]);
        // the bug this fixes: measured over the whole display it never counted
        assert_eq!(covered_by(&[BUILT_IN], &[zoomed], &[]), vec![false]);
        let small = rect(200.0, 200.0, 800.0, 600.0);
        assert_eq!(covered_by(&[BUILT_IN, LEFT], &[small], &visible), vec![false, false]);
        let halves = [rect(0.0, 38.0, 960.0, 1125.0), rect(960.0, 38.0, 960.0, 1125.0)];
        assert_eq!(covered_by(&[BUILT_IN], &halves, &visible), vec![true]);
    }

    /// Live values from this Mac: `cargo test live_power -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_power() {
        println!("on_battery (incl. Low Power Mode): {}", on_battery());
        println!("low_power_mode: {}", low_power_mode());
        println!("fullscreen_app_in_front: {}", fullscreen_app_in_front());
        println!("accessibility_trusted: {}", accessibility_trusted(false));
        // visible_frames() would wait for the main thread, which cargo test
        // doesn't run a loop on; read directly (fine for a one-off check)
        for (f, v) in visible_frames_here() {
            println!("display {:?} visible {:?}", (f.origin.x, f.origin.y, f.size.width, f.size.height), (v.origin.x, v.origin.y, v.size.width, v.size.height));
        }
    }
}

// ---- away ----

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
}

/// Seconds since the last keyboard or mouse input (signals.rs uses it to
/// tell whether you're at the computer)
pub fn idle_seconds() -> f64 {
    // kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType
    unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
}
