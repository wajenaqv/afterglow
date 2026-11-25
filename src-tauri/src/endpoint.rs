// The local endpoint: scripts on this computer send signals with
//
//   curl -X POST http://127.0.0.1:47811/signal -d '{"source":"build","kind":"new"}'
//
// (the JSON is a signals.rs Signal), and buttons send commands.rs commands
// (pause, next wallpaper) to /command. Jobs report to /job (jobs.rs), Claude
// Code's hooks to /hook/claude (claude.rs). It listens on 127.0.0.1 only, so other
// computers can't reach it. Web pages can't use it either: browsers add an
// Origin header to every cross-site request, and requests with one are
// refused (curl, scripts and Home Assistant's REST commands don't send it).
// GET / answers with a short usage note.

use std::io::Read;
use std::thread;

use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::commands::{self, Command};
use crate::signals::{self, Signal};
use crate::{claude, jobs};

pub const PORT: u16 = 47811;
const MAX_BODY: u64 = 4096;
/// A hook event can carry a whole tool result (dropped unread)
const MAX_HOOK: u64 = 16 * 1024 * 1024;

/// (AFTERGLOW_PORT overrides it, to test a second copy beside a running one)
fn port() -> u16 {
    std::env::var("AFTERGLOW_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(PORT)
}

pub fn start(app: &AppHandle) {
    let port = port();
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            crate::alog!("afterglow: local endpoint not started (port {port} busy?): {e}");
            return;
        }
    };
    crate::alog!("afterglow: listening for signals on http://127.0.0.1:{port}/signal");
    let app = app.clone();
    thread::spawn(move || {
        let json = Header::from_bytes("Content-Type", "application/json").unwrap();
        for mut req in server.incoming_requests() {
            let from_a_web_page = req.headers().iter().any(|h| h.field.equiv("Origin"));
            let reply = |status: u16, body: String| Response::from_string(body).with_status_code(status).with_header(json.clone());
            let response = if from_a_web_page {
                reply(403, r#"{"error":"requests from web pages are not accepted"}"#.into())
            } else if req.method() == &Method::Get && req.url() == "/" {
                let usage = format!("POST http://127.0.0.1:{PORT}/signal with JSON: source (a name), kind (new, unread, clear or flash), optional count, colour (#rrggbb), afterglow (seconds)");
                let commands = format!("POST http://127.0.0.1:{PORT}/command with JSON: do (pause, resume, toggle-pause, next, previous or wallpaper with id)");
                reply(200, serde_json::json!({ "afterglow": usage, "commands": commands, "jobs": format!("POST http://127.0.0.1:{PORT}/job with JSON: id, state (start, needs, done, failed or end), optional name") }).to_string())
            } else if req.method() == &Method::Post && req.url() == "/signal" {
                let mut body = String::new();
                match req.as_reader().take(MAX_BODY).read_to_string(&mut body) {
                    Err(_) => reply(400, r#"{"error":"unreadable body"}"#.into()),
                    Ok(_) => match serde_json::from_str::<Signal>(&body) {
                        Err(e) => reply(400, serde_json::json!({ "error": e.to_string() }).to_string()),
                        Ok(sig) => match signals::handle(&app, sig) {
                            Ok(()) => reply(200, r#"{"ok":true}"#.into()),
                            Err(e) => reply(400, serde_json::json!({ "error": e }).to_string()),
                        },
                    },
                }
            } else if req.method() == &Method::Post && req.url() == "/command" {
                let mut body = String::new();
                match req.as_reader().take(MAX_BODY).read_to_string(&mut body) {
                    Err(_) => reply(400, r#"{"error":"unreadable body"}"#.into()),
                    Ok(_) => match serde_json::from_str::<Command>(&body) {
                        Err(e) => reply(400, serde_json::json!({ "error": e.to_string() }).to_string()),
                        Ok(cmd) => match commands::handle(&app, cmd) {
                            Ok(()) => reply(200, r#"{"ok":true}"#.into()),
                            Err(e) => reply(400, serde_json::json!({ "error": e }).to_string()),
                        },
                    },
                }
            } else if req.method() == &Method::Post && req.url() == "/job" {
                let mut body = String::new();
                let read = req.as_reader().take(MAX_BODY).read_to_string(&mut body).map_err(|e| e.to_string());
                let done = read.and_then(|_| serde_json::from_str(&body).map_err(|e| e.to_string())).and_then(|post| jobs::handle(&app, post));
                match done {
                    Ok(()) => reply(200, r#"{"ok":true}"#.into()),
                    Err(e) => reply(400, serde_json::json!({ "error": e }).to_string()),
                }
            } else if req.method() == &Method::Post && req.url() == "/hook/claude" {
                let done = serde_json::from_reader(req.as_reader().take(MAX_HOOK)).map_err(|e| e.to_string()).and_then(|event| claude::handle(&app, event));
                // no body: Claude Code reads none as "no opinion"
                match done {
                    Ok(()) => reply(200, String::new()),
                    Err(e) => reply(400, serde_json::json!({ "error": e }).to_string()),
                }
            } else {
                reply(404, r#"{"error":"POST /signal, /command or /job"}"#.into())
            };
            let _ = req.respond(response);
        }
    });
}
