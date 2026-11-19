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
use std::collections::HashMap;

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

/// Notifications waiting, per app (source name -> count)
pub fn counts() -> Result<HashMap<String, u32>, Problem> {
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
    for i in 0..list.Size().unwrap_or(0) {
        let Ok(n) = list.GetAt(i) else { continue };
        let name = n
            .AppInfo()
            .and_then(|a| a.DisplayInfo())
            .and_then(|d| d.DisplayName())
            .map(|h| h.to_string())
            .unwrap_or_else(|_| "app".into());
        *out.entry(source_name(&name)).or_insert(0) += 1;
    }
    Ok(out)
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
            Err(e) => eprintln!("afterglow: asking for notification access failed: {e}"),
        },
        Err(_) => eprintln!("afterglow: notifications connector: {NO_IDENTITY}"),
    }
}
