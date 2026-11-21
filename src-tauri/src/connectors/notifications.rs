// Windows notifications: which apps have notifications waiting in Windows'
// notification centre, and how many each. Reads each notification's app
// name only, never its title or text.
//
// The API (UserNotificationListener) only works for apps with "package
// identity": AfterGlow registered as a package, signed by a certificate the
// PC trusts (scripts/windows/register-package.ps1 does this once), and with
// the user's OK (Windows asks the first time; Settings → Privacy & security →
// Notifications → "Allow apps to access your notifications" can change it).
// Without identity, Current() fails and the connector says what's needed.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
use windows::UI::Notifications::NotificationKinds;

use super::source_name;

pub enum Problem {
    /// Needs something from the user (one line saying what)
    Setup(String),
    Error(String),
}

const NO_IDENTITY: &str =
    "needs AfterGlow registered as a package: run scripts\\windows\\register-package.ps1 once (see the README)";

fn listener() -> Result<UserNotificationListener, Problem> {
    UserNotificationListener::Current().map_err(|_| Problem::Setup(NO_IDENTITY.into()))
}

/// Every notification id seen so far (None until the first read). A new
/// notification is one whose id wasn't seen before: counting alone missed
/// apps that replace their last notification with the new one (Claude does),
/// where the count stays the same.
static SEEN: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

/// Notifications waiting, per app (source name -> count), and the apps with
/// a notification not seen before (none on the first read: those were
/// already there when AfterGlow started)
pub fn counts() -> Result<(HashMap<String, u32>, HashSet<String>), Problem> {
    let l = listener()?;
    match l.GetAccessStatus() {
        Ok(s) if s == UserNotificationListenerAccessStatus::Allowed => {}
        Ok(s) if s == UserNotificationListenerAccessStatus::Denied => {
            return Err(Problem::Setup(
                "Windows says no: allow it in Settings → Privacy & security → Notifications → Allow apps to access your notifications".into(),
            ));
        }
        Ok(_) => return Err(Problem::Setup("waiting for your OK: switch the connector off and on again to see Windows' question".into())),
        Err(_) => return Err(Problem::Setup(NO_IDENTITY.into())),
    }
    let list = l
        .GetNotificationsAsync(NotificationKinds::Toast)
        .and_then(|op| op.get())
        .map_err(|e| Problem::Error(format!("couldn't read notifications: {e}")))?;
    let mut out = HashMap::new();
    let mut fresh = HashSet::new();
    let mut seen = SEEN.lock().unwrap();
    let first = seen.is_none();
    let known = seen.get_or_insert_with(HashSet::new);
    let mut ids = HashSet::new();
    for i in 0..list.Size().unwrap_or(0) {
        let Ok(n) = list.GetAt(i) else { continue };
        let id = n.Id().ok();
        let name = n
            .AppInfo()
            .and_then(|a| a.DisplayInfo())
            .and_then(|d| d.DisplayName())
            .map(|h| h.to_string())
            .unwrap_or_else(|_| "app".into());
        let source = source_name(&name);
        if let Some(id) = id {
            if !first && !known.contains(&id) {
                fresh.insert(source.clone());
            }
            ids.insert(id);
        }
        *out.entry(source).or_insert(0) += 1;
    }
    // remember only what's still there, so the set never grows
    *known = ids;
    Ok((out, fresh))
}

thread_local! {
    // Keeps Windows' question alive until the user answers it
    static ASKING: RefCell<Option<Box<dyn std::any::Any>>> = const { RefCell::new(None) };
}

/// Ask the user for access (Windows shows its own question the first time).
/// Must run on the UI thread; doesn't wait for the answer (the connector's
/// poll sees it).
pub fn request_access() {
    match UserNotificationListener::Current() {
        Ok(l) => match l.RequestAccessAsync() {
            Ok(op) => ASKING.with(|a| *a.borrow_mut() = Some(Box::new(op))),
            Err(e) => crate::alog!("afterglow: asking for notification access failed: {e}"),
        },
        Err(_) => crate::alog!("afterglow: notifications connector: {NO_IDENTITY}"),
    }
}
