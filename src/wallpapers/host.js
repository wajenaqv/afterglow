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
// frames with postMessage (src/wallpapers/common.js listens for them); a
// "wallpaper" event ({ wall, query }) swaps the page every frame shows.

const config = window.__AFTERGLOW__ ?? {};
const screens = Array.isArray(config.screens) && config.screens.length ? config.screens : [[0, 0, innerWidth, innerHeight]];

// The page a frame shows: only known-looking names and options get through
function pageFor(wall, query) {
  const name = /^[a-z-]+$/.test(wall ?? "") ? wall : "jellyfish";
  const q = /^[a-z0-9=&-]*$/i.test(query ?? "") && query ? `?${query}` : "";
  return `/wallpapers/${name}.html${q}`;
}

const frames = screens.map(([x, y, w, h]) => {
  const f = document.createElement("iframe");
  Object.assign(f.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  f.src = pageFor(config.wall, config.query);
  f.setAttribute("aria-hidden", "true");
  document.body.append(f);
  return { f, x, y, w, h };
});

// Settings or the tray picked another wallpaper: swap every frame's page
function show({ wall, query }) {
  const src = pageFor(wall, query);
  frames.forEach((fr) => {
    if (fr.f.getAttribute("src") !== src) fr.f.src = src;
  });
}

const send = (frame, msg) => frame.f.contentWindow?.postMessage(msg, location.origin);
let under = null; // the frame the cursor is over

function cursor(p) {
  const hit = p ? frames.find((fr) => p.x >= fr.x && p.y >= fr.y && p.x < fr.x + fr.w && p.y < fr.y + fr.h) : null;
  if (under && under !== hit) send(under, { type: "cursor", at: null });
  if (hit) send(hit, { type: "cursor", at: { x: p.x - hit.x, y: p.y - hit.y } });
  under = hit ?? null;
}

// Pause: the app sends one flag per frame (a monitor hidden behind app
// windows pauses on its own), or a single flag for all of them
function pause(p) {
  frames.forEach((fr, i) => {
    const value = Array.isArray(p) ? !!p[i] : !!p;
    if (fr.paused === value) return;
    fr.paused = value;
    send(fr, { type: "paused", value });
  });
}
// a frame that loads (or reloads with another wallpaper) learns its state
frames.forEach((fr) => fr.f.addEventListener("load", () => send(fr, { type: "paused", value: !!fr.paused })));

if ("__TAURI_INTERNALS__" in window) {
  import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
    const win = getCurrentWebviewWindow();
    win.listen("cursor", ({ payload }) => cursor(payload));
    win.listen("paused", ({ payload }) => pause(payload));
    win.listen("wallpaper", ({ payload }) => show(payload));
  });
} else {
  // in a browser: the real mouse
  addEventListener("pointermove", (e) => cursor({ x: e.clientX, y: e.clientY }));
  document.documentElement.addEventListener("mouseleave", () => cursor(null));
}
