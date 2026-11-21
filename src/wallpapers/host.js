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

// the hover clock in a corner of each monitor (hoverclock.js)
import { hoverClock } from "./hoverclock.js";
const frames = screens.map(([x, y, w, h]) => {
  const f = document.createElement("iframe");
  Object.assign(f.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  f.src = pageFor(config.wall, config.query);
  f.setAttribute("aria-hidden", "true");
  document.body.append(f);
  return { f, x, y, w, h };
});

// the wallpaper's palette (?tint=), for the clock's "match the wallpaper" colour
const tintOf = (query) => new URLSearchParams(query ?? "").get("tint") ?? "";
const clock = hoverClock(frames, config.clock ?? {}, tintOf(config.query));

// Settings or the tray picked another wallpaper: swap every frame's page
function show({ wall, query }) {
  clock.setTint(tintOf(query));
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
  clock.cursor(p);
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
// Reactions (pulse, count, flash, lanterns) go to every frame. The latest
// count and lanterns are kept, so a frame that loads later (another
// wallpaper, a new monitor) starts with them.
let count = null;
let lanterns = null;
function reaction(r) {
  if (r?.type === "count") count = r;
  if (r?.type === "lanterns") lanterns = r;
  frames.forEach((fr) => send(fr, { type: "reaction", reaction: r }));
}
window.__afterglowReact = reaction; // dev aid: fire a reaction from the console

// The app's log gets a line per reaction: received here, handled by a frame
// (these windows sit behind the desktop icons, out of the inspector's reach)
let log = () => {};
if ("__TAURI_INTERNALS__" in window)
  import("@tauri-apps/api/core").then(({ invoke }) => (log = (msg) => invoke("wall_log", { msg }).catch(() => {})));
// A frame says you've seen an app's lantern (rested the cursor on it)
let seen = () => {};
if ("__TAURI_INTERNALS__" in window)
  import("@tauri-apps/api/core").then(({ invoke }) => (seen = (source) => invoke("dismiss_lantern", { source }).catch(() => {})));
addEventListener("message", (e) => {
  if (e.origin === location.origin && e.data?.type === "seen" && typeof e.data.source === "string") seen(e.data.source.slice(0, 32));
  if (e.origin === location.origin && e.data?.type === "reacted") log(`frame ${e.data.page} handled ${e.data.reaction} (${e.data.handlers} handler)`);
});

// a frame that loads (or reloads with another wallpaper) learns its state
frames.forEach((fr) =>
  fr.f.addEventListener("load", () => {
    send(fr, { type: "paused", value: !!fr.paused });
    if (count) send(fr, { type: "reaction", reaction: count });
    if (lanterns) send(fr, { type: "reaction", reaction: lanterns });
  }),
);

if ("__TAURI_INTERNALS__" in window) {
  import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
    const win = getCurrentWebviewWindow();
    win.listen("cursor", ({ payload }) => cursor(payload));
    win.listen("paused", ({ payload }) => pause(payload));
    win.listen("wallpaper", ({ payload }) => show(payload));
    win.listen("clock", ({ payload }) => clock.configure(payload ?? {}));
    win.listen("reaction", ({ payload }) => {
      log(`host got ${payload?.type} for ${frames.length} frame(s)`);
      reaction(payload);
    });
  });
  // the count when this window opened (after a monitor change, say)
  import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("signal_state"))
    .then((n) => n > 0 && reaction({ type: "count", n }))
    .catch(() => {});
  // and the lanterns
  import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("lantern_state"))
    .then((items) => items?.length && reaction({ type: "lanterns", items }))
    .catch(() => {});
} else {
  // in a browser: the real mouse
  addEventListener("pointermove", (e) => cursor({ x: e.clientX, y: e.clientY }));
  document.documentElement.addEventListener("mouseleave", () => cursor(null));
}
