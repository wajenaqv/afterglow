// The account connectors (any platform), signed in through oauth.rs:
//   gmail    the inbox's unread count, every minute (Gmail API, label INBOX,
//            messagesUnread; read-only label counts, no message content)
//   outlook  the inbox's unread count, every minute (Microsoft Graph,
//            mailFolders/inbox unreadItemCount)
//   spotify  a pulse in Spotify green when the song changes, every 5 s
//            (currently-playing; only while something is playing)
// Counts go through connectors::report like the other connectors, so a
// count going up pulses, and the count brings in jellies.

use std::collections::HashMap;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::oauth::{self, Client, Provider};
use super::{report, set_status};
use crate::host::Host;
use crate::signals::{self, Signal};

pub const IDS: &[(&str, &str)] = &[("gmail", "Gmail"), ("outlook", "Outlook"), ("spotify", "Spotify (a pulse when the song changes)")];

fn client_for(app: &AppHandle, id: &str) -> Client {
    app.state::<Host>().settings.lock().unwrap().clients.get(id).cloned().unwrap_or_default()
}

/// Run one account connector once; returns how long until it wants to run again
pub fn poll(app: &AppHandle, id: &str) -> Duration {
    let Some(p) = oauth::provider(id) else { return Duration::from_secs(60) };
    let client = client_for(app, id);
    if client.client_id.trim().is_empty() {
        set_status(app, id, "setup", "add your app's client id below, then sign in (see the guide)");
        return Duration::from_secs(5);
    }
    if !oauth::signed_in(p) {
        set_status(app, id, "setup", "not signed in: use Sign in below");
        return Duration::from_secs(5);
    }
    match id {
        "gmail" => match oauth::get_json(p, &client, "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX") {
            Ok(Some(v)) => {
                let n = v["messagesUnread"].as_u64().unwrap_or(0) as u32;
                set_status(app, id, "ok", format!("{n} unread in the inbox"));
                report(app, id, HashMap::from([("gmail".to_string(), n)]));
                Duration::from_secs(60)
            }
            Ok(None) => Duration::from_secs(60),
            Err(e) => {
                set_status(app, id, "error", e);
                Duration::from_secs(60)
            }
        },
        "outlook" => match oauth::get_json(p, &client, "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount") {
            Ok(Some(v)) => {
                let n = v["unreadItemCount"].as_u64().unwrap_or(0) as u32;
                set_status(app, id, "ok", format!("{n} unread in the inbox"));
                report(app, id, HashMap::from([("outlook".to_string(), n)]));
                Duration::from_secs(60)
            }
            Ok(None) => Duration::from_secs(60),
            Err(e) => {
                set_status(app, id, "error", e);
                Duration::from_secs(60)
            }
        },
        "spotify" => {
            static LAST: Mutex<Option<String>> = Mutex::new(None);
            match oauth::get_json(p, &client, "https://api.spotify.com/v1/me/player/currently-playing") {
                Ok(Some(v)) if v["is_playing"].as_bool() == Some(true) => {
                    let track = v["item"]["id"].as_str().unwrap_or("").to_string();
                    let name = v["item"]["name"].as_str().unwrap_or("something");
                    set_status(app, id, "ok", format!("playing {name}"));
                    let mut last = LAST.lock().unwrap();
                    if last.as_deref().is_some_and(|l| l != track) && !track.is_empty() {
                        let sig = Signal { source: "spotify".into(), kind: "new".into(), count: None, colour: None, afterglow: Some(6.0), linger: Some(false) };
                        let _ = signals::handle(app, sig);
                    }
                    *last = Some(track);
                }
                Ok(_) => set_status(app, id, "ok", "nothing playing"),
                Err(e) => set_status(app, id, "error", e),
            }
            Duration::from_secs(5)
        }
        _ => Duration::from_secs(60),
    }
}

/// What Settings shows for each account
#[derive(Serialize)]
pub struct AccountInfo {
    id: String,
    name: String,
    client_id: String,
    has_secret: bool,
    signed_in: bool,
    /// The redirect URI to register with the provider
    redirect: String,
}

#[tauri::command]
pub fn accounts_state(app: AppHandle) -> Vec<AccountInfo> {
    IDS.iter()
        .filter_map(|(id, name)| {
            let p: &Provider = oauth::provider(id)?;
            let c = client_for(&app, id);
            Some(AccountInfo {
                id: id.to_string(),
                name: name.to_string(),
                client_id: c.client_id.clone(),
                has_secret: !c.client_secret.is_empty(),
                signed_in: oauth::signed_in(p),
                redirect: oauth::redirect_uri(p),
            })
        })
        .collect()
}

/// Save an app registration (client id, and secret for Google). An empty
/// secret keeps the saved one.
#[tauri::command]
pub fn set_client(app: AppHandle, id: String, client_id: String, client_secret: String) -> Result<(), String> {
    oauth::provider(&id).ok_or("unknown account")?;
    let host = app.state::<Host>();
    let snapshot = {
        let mut s = host.settings.lock().unwrap();
        let entry = s.clients.entry(id).or_default();
        entry.client_id = client_id.trim().to_string();
        if !client_secret.trim().is_empty() {
            entry.client_secret = client_secret.trim().to_string();
        }
        s.clone()
    };
    crate::settings::save(&app, &snapshot);
    Ok(())
}

/// Start the browser sign-in (runs in the background; the connector's
/// status line shows how it went)
#[tauri::command]
pub fn account_sign_in(app: AppHandle, id: String) -> Result<(), String> {
    let p = oauth::provider(&id).ok_or("unknown account")?;
    let client = client_for(&app, &id);
    set_status(&app, &id, "setup", "signing in: finish in your browser");
    thread::spawn(move || match oauth::sign_in(p, &client) {
        Ok(()) => set_status(&app, p.id, "ok", "signed in"),
        Err(e) => set_status(&app, p.id, "error", e),
    });
    Ok(())
}

#[tauri::command]
pub fn account_sign_out(app: AppHandle, id: String) -> Result<(), String> {
    let p = oauth::provider(&id).ok_or("unknown account")?;
    oauth::sign_out(p);
    super::forget(&app, &id);
    set_status(&app, &id, "setup", "signed out");
    Ok(())
}
