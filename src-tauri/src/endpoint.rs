// The local endpoint: scripts on this computer send signals with
//
//   curl -X POST http://127.0.0.1:47811/signal -d '{"source":"build","kind":"new"}'
//
// (the JSON is a signals.rs Signal). It listens on 127.0.0.1 only, so other
// computers can't reach it. Web pages can't use it either: browsers add an
// Origin header to every cross-site request, and requests with one are
// refused (curl, scripts and Home Assistant's REST commands don't send it).
// GET / answers with a short usage note.

use std::io::Read;
use std::thread;

use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::signals::{self, Signal};

pub const PORT: u16 = 47811;
const MAX_BODY: u64 = 4096;

pub fn start(app: &AppHandle) {
    let server = match Server::http(("127.0.0.1", PORT)) {
        Ok(s) => s,
        Err(e) => {
            crate::alog!("afterglow: local endpoint not started (port {PORT} busy?): {e}");
            return;
        }
    };
    crate::alog!("afterglow: listening for signals on http://127.0.0.1:{PORT}/signal");
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
                reply(200, serde_json::json!({ "afterglow": usage }).to_string())
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
            } else {
                reply(404, r#"{"error":"POST /signal"}"#.into())
            };
            let _ = req.respond(response);
        }
    });
}
