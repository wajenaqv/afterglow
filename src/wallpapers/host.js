// The page every wallpaper window loads (wallpapers/host.html).
//
// One window can cover several monitors (on Windows, when they share a
// display scale: one webview instead of one per monitor saves ~100 MB each).
// This page puts one frame per monitor, at that monitor's spot, each showing
// the wallpaper. Same-origin frames share this page's process, so a second
// monitor costs a frame (~10-20 MB), not a whole browser page.
//
// The app passes the layout in window.__AFTERGLOW__ (an initialization
// script, see src-tauri/src/host.rs):
//   { wall: "jellyfish", query: "tint=cool", screens: [[x, y, w, h], ...] }
// screens are CSS px relative to this window. Without it (opened in a
// browser), one frame fills the page.
//
// The app's "cursor" and "paused" events arrive here and are passed on to the
// frames with postMessage (src/wallpapers/common.js listens for them).

const config = window.__AFTERGLOW__ ?? {};
const wall = /^[a-z-]+$/.test(config.wall ?? "") ? config.wall : "jellyfish";
const query = config.query ? `?${config.query}` : "";
const screens = Array.isArray(config.screens) && config.screens.length ? config.screens : [[0, 0, innerWidth, innerHeight]];

const frames = screens.map(([x, y, w, h]) => {
  const f = document.createElement("iframe");
  Object.assign(f.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  f.src = `/wallpapers/${wall}.html${query}`;
  f.setAttribute("aria-hidden", "true");
  document.body.append(f);
  return { f, x, y, w, h };
});

const send = (frame, msg) => frame.f.contentWindow?.postMessage(msg, location.origin);
let under = null; // the frame the cursor is over

function cursor(p) {
  const hit = p ? frames.find((fr) => p.x >= fr.x && p.y >= fr.y && p.x < fr.x + fr.w && p.y < fr.y + fr.h) : null;
  if (under && under !== hit) send(under, { type: "cursor", at: null });
  if (hit) send(hit, { type: "cursor", at: { x: p.x - hit.x, y: p.y - hit.y } });
  under = hit ?? null;
}

let paused = false;
function pause(p) {
  paused = !!p;
  frames.forEach((fr) => send(fr, { type: "paused", value: paused }));
}
// a frame that loads late learns the current state
frames.forEach((fr) => fr.f.addEventListener("load", () => send(fr, { type: "paused", value: paused })));

if ("__TAURI_INTERNALS__" in window) {
  import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
    const win = getCurrentWebviewWindow();
    win.listen("cursor", ({ payload }) => cursor(payload));
    win.listen("paused", ({ payload }) => pause(payload));
  });
} else {
  // in a browser: the real mouse
  addEventListener("pointermove", (e) => cursor({ x: e.clientX, y: e.clientY }));
  document.documentElement.addEventListener("mouseleave", () => cursor(null));
}
