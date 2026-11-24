// Signing in to Google, Microsoft and Spotify the way desktop apps should
// (OAuth 2.0 with PKCE, RFC 8252): AfterGlow opens the provider's sign-in
// page in your browser; after you agree, the provider sends the browser back
// to http://127.0.0.1:47812/callback (or localhost for Microsoft), where
// AfterGlow is listening for that one request; AfterGlow trades the code it
// gets for tokens. Your password never passes through AfterGlow.
//
// The refresh token (what lets AfterGlow ask again without a new sign-in) is
// kept in the OS credential store (Windows Credential Manager / macOS
// Keychain), never in a file. Access tokens live in memory only.
//
// Each provider needs an app registration of the user's own (a client id;
// Google also gives a client secret, which for desktop apps isn't secret):
// Settings → apps has a step-by-step guide (src/guides.js).

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const CALLBACK_PORT: u16 = 47812;
const KEYRING_SERVICE: &str = "AfterGlow";

pub struct Provider {
    pub id: &'static str,
    pub auth_url: &'static str,
    pub token_url: &'static str,
    pub scopes: &'static str,
    /// The redirect host: "127.0.0.1" (Google, Spotify) or "localhost" (Microsoft)
    pub host: &'static str,
    /// Extra query parameters for the sign-in page
    pub extra: &'static [(&'static str, &'static str)],
}

pub const GOOGLE: Provider = Provider {
    id: "gmail",
    auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    // read label counts only (no message content)
    scopes: "https://www.googleapis.com/auth/gmail.labels",
    host: "127.0.0.1",
    extra: &[("access_type", "offline"), ("prompt", "consent")],
};

pub const MICROSOFT: Provider = Provider {
    id: "outlook",
    auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // the inbox's unread count (basic mail data, not message bodies)
    scopes: "offline_access Mail.ReadBasic",
    host: "localhost",
    extra: &[],
};

pub const SPOTIFY: Provider = Provider {
    id: "spotify",
    auth_url: "https://accounts.spotify.com/authorize",
    token_url: "https://accounts.spotify.com/api/token",
    scopes: "user-read-currently-playing",
    host: "127.0.0.1",
    extra: &[],
};

pub fn provider(id: &str) -> Option<&'static Provider> {
    [&GOOGLE, &MICROSOFT, &SPOTIFY].into_iter().find(|p| p.id == id)
}

pub fn redirect_uri(p: &Provider) -> String {
    format!("http://{}:{CALLBACK_PORT}/callback", p.host)
}

/// The user's app registration for a provider
#[derive(Clone, Default, Debug, serde::Serialize, Deserialize)]
#[serde(default)]
pub struct Client {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn random_string(n: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..n).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn token_request(p: &Provider, client: &Client, form: &[(&str, &str)]) -> Result<TokenReply, String> {
    let mut fields: Vec<(&str, &str)> = form.to_vec();
    fields.push(("client_id", &client.client_id));
    if !client.client_secret.is_empty() {
        fields.push(("client_secret", &client.client_secret));
    }
    match ureq::post(p.token_url).timeout(Duration::from_secs(20)).send_form(&fields) {
        Ok(r) => r.into_json::<TokenReply>().map_err(|e| format!("unexpected answer from {}: {e}", p.id)),
        Err(ureq::Error::Status(code, r)) => Err(format!("{} said {code}: {}", p.id, r.into_string().unwrap_or_default().chars().take(200).collect::<String>())),
        Err(e) => Err(format!("couldn't reach {}: {e}", p.id)),
    }
}

/// The whole browser sign-in; blocks until it finishes (up to 5 minutes).
/// Stores the refresh token and returns Ok on success.
pub fn sign_in(p: &Provider, client: &Client) -> Result<(), String> {
    if client.client_id.trim().is_empty() {
        return Err("add the app's client id first (see the guide)".into());
    }
    let server = tiny_http::Server::http(("127.0.0.1", CALLBACK_PORT)).map_err(|e| format!("couldn't listen on port {CALLBACK_PORT}: {e}"))?;
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);
    let redirect = redirect_uri(p);
    let mut url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        p.auth_url,
        enc(&client.client_id),
        enc(&redirect),
        enc(p.scopes),
        state,
        challenge
    );
    for (k, v) in p.extra {
        url.push_str(&format!("&{k}={}", enc(v)));
    }
    open::that(&url).map_err(|e| format!("couldn't open the browser: {e}"))?;

    // wait for the browser to come back with the code
    let deadline = Instant::now() + Duration::from_secs(300);
    let code = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err("sign-in timed out".into());
        }
        let Ok(Some(req)) = server.recv_timeout(left) else { continue };
        let path = req.url().to_string();
        if !path.starts_with("/callback") {
            let _ = req.respond(tiny_http::Response::from_string("").with_status_code(404));
            continue;
        }
        let page = |msg: &str| {
            tiny_http::Response::from_string(format!(
                "<!doctype html><meta charset=utf-8><title>AfterGlow</title><body style=\"background:#000;color:#33ff99;font:16px monospace;padding:40px\">{msg}</body>"
            ))
            .with_header(tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap())
        };
        if query_param(&path, "state").as_deref() != Some(state.as_str()) {
            let _ = req.respond(page("That sign-in link is stale. Try again from AfterGlow's Settings."));
            continue;
        }
        if let Some(err) = query_param(&path, "error") {
            let _ = req.respond(page("Sign-in was cancelled. You can close this tab."));
            return Err(format!("sign-in cancelled ({err})"));
        }
        match query_param(&path, "code") {
            Some(code) => {
                let _ = req.respond(page("Signed in to AfterGlow. You can close this tab."));
                break code;
            }
            None => {
                let _ = req.respond(page("Something went wrong. Try again from AfterGlow's Settings."));
                return Err("no code in the answer".into());
            }
        }
    };
    let tokens = token_request(p, client, &[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("code_verifier", &verifier)])?;
    let refresh = tokens.refresh_token.ok_or("the provider gave no refresh token")?;
    keyring::Entry::new(KEYRING_SERVICE, p.id)
        .and_then(|e| e.set_password(&refresh))
        .map_err(|e| format!("couldn't store the token in the credential store: {e}"))?;
    remember(p.id, tokens.access_token, tokens.expires_in);
    Ok(())
}

pub fn signed_in(p: &Provider) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, p.id).and_then(|e| e.get_password()).is_ok()
}

pub fn sign_out(p: &Provider) {
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, p.id) {
        let _ = e.delete_credential();
    }
    if let Some(m) = ACCESS.lock().unwrap().as_mut() {
        m.remove(p.id);
    }
}

/// Access tokens in memory: provider id -> (token, good until)
static ACCESS: Mutex<Option<HashMap<&'static str, (String, Instant)>>> = Mutex::new(None);

fn remember(id: &'static str, token: String, expires_in: Option<u64>) {
    let until = Instant::now() + Duration::from_secs(expires_in.unwrap_or(3600).saturating_sub(60));
    ACCESS.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, (token, until));
}

/// A working access token, refreshed when needed
pub fn access_token(p: &'static Provider, client: &Client) -> Result<String, String> {
    if let Some((t, until)) = ACCESS.lock().unwrap().as_ref().and_then(|m| m.get(p.id)).cloned() {
        if Instant::now() < until {
            return Ok(t);
        }
    }
    let refresh = keyring::Entry::new(KEYRING_SERVICE, p.id).and_then(|e| e.get_password()).map_err(|_| "not signed in".to_string())?;
    let tokens = token_request(p, client, &[("grant_type", "refresh_token"), ("refresh_token", &refresh)])?;
    if let Some(new_refresh) = &tokens.refresh_token {
        // some providers rotate refresh tokens
        let _ = keyring::Entry::new(KEYRING_SERVICE, p.id).and_then(|e| e.set_password(new_refresh));
    }
    remember(p.id, tokens.access_token.clone(), tokens.expires_in);
    Ok(tokens.access_token)
}

/// GET a JSON API with the provider's token. Ok(None) for 204 No Content.
pub fn get_json(p: &'static Provider, client: &Client, url: &str) -> Result<Option<serde_json::Value>, String> {
    let token = access_token(p, client)?;
    match ureq::get(url).set("Authorization", &format!("Bearer {token}")).timeout(Duration::from_secs(20)).call() {
        Ok(r) if r.status() == 204 => Ok(None),
        Ok(r) => {
            let mut body = String::new();
            r.into_reader().take(1 << 20).read_to_string(&mut body).map_err(|e| e.to_string())?;
            if body.trim().is_empty() {
                return Ok(None);
            }
            serde_json::from_str(&body).map(Some).map_err(|e| format!("unexpected answer: {e}"))
        }
        Err(ureq::Error::Status(401, _)) => {
            if let Some(m) = ACCESS.lock().unwrap().as_mut() {
                m.remove(p.id);
            }
            Err("the sign-in expired; it will be renewed".into())
        }
        Err(ureq::Error::Status(code, r)) => Err(format!("{} said {code}: {}", p.id, r.into_string().unwrap_or_default().chars().take(160).collect::<String>())),
        Err(e) => Err(format!("couldn't reach {}: {e}", p.id)),
    }
}
