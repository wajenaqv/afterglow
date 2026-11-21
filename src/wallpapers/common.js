// Shared by every wallpaper page (wallpapers/*.html). Adapted from
// heywajih.com's src/wallpapers/common.js: URL options, the cursor for hover
// effects, colour helpers and still mode, plus what the AfterGlow app adds:
//   - the cursor arrives from the app (Rust polls it and emits "cursor"),
//     because a window behind the desktop icons gets no mouse events
//   - pause/resume from the app ("paused" event: fullscreen game, battery,
//     or the tray's Pause), so a paused wallpaper uses no CPU at all
// In the app, wallpapers run inside frames of wallpapers/host.html (one per
// monitor), which passes both on with postMessage. Opened directly in a
// browser (bun run dev), the DOM's own pointer events are used and nothing is
// ever paused, so wallpapers can be developed there.
//
// URL options every wallpaper understands:
//   ?size=<0.3-2.5> scale of the main object (1 = default)
//   ?preview        low frame rate (thumbnails)
//   ?hover=0        no hover effects (see `pointer` below)
//   ?still=<id>&at=<seconds>  draw one frame at that moment (device pixel
//                   ratio 1) and post it to the parent page as a PNG blob

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "../brand.css";
import "./wallpaper.css";

// Only the brand theme exists in AfterGlow; kept so wallpapers ported from
// heywajih can keep their theme code paths (they stay off).
export const THEME_NAMES = ["green"];
export const params = new URLSearchParams(location.search);
// Inside a frame (host.html in the app, or a dev tool): cursor and pause come
// from the parent page
export const FRAMED = window.parent !== window;

// ---- still mode ----
export const STILL = params.has("still");
export const STILL_AT = (() => {
  const v = parseFloat(params.get("at"));
  return v >= 0 && v < 1e7 ? v : 40;
})();
// The font has to be loaded before drawing (a canvas doesn't trigger the load)
export async function fontReady() {
  try {
    await document.fonts.load('700 20px "JetBrains Mono"');
    await document.fonts.ready;
  } catch {}
}
export function sendStill(canvas) {
  canvas.toBlob((blob) => parent.postMessage({ still: params.get("still"), blob }, location.origin), "image/png");
}

// ---- the cursor, for hover effects ----
// pointer: x, y in CSS px within this window, on (over this screen), at (time
// of the last move, ms), vx, vy (smoothed velocity, px/s). Every wallpaper
// must look complete without its hover effect.
export const HOVER = !STILL && !params.has("preview") && params.get("hover") !== "0" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
export const pointer = { x: -1, y: -1, on: false, at: -1e9, vx: 0, vy: 0 };
function movePointer(x, y) {
  const now = performance.now();
  if (pointer.on) {
    const dt = Math.max(8, now - pointer.at) / 1000;
    pointer.vx = pointer.vx * 0.5 + ((x - pointer.x) / dt) * 0.5;
    pointer.vy = pointer.vy * 0.5 + ((y - pointer.y) / dt) * 0.5;
  }
  Object.assign(pointer, { x, y, on: true, at: now });
}
// Seconds since the cursor last moved
export const stillFor = () => (performance.now() - pointer.at) / 1000;

// ---- pause ----
let paused = false;
const resumers = [];
export const isPaused = () => paused;
// Call fn once when the wallpaper is resumed (used to restart the frame loop)
export const whenResumed = (fn) => resumers.push(fn);
function setPaused(p) {
  paused = p;
  if (!p) resumers.splice(0).forEach((fn) => fn());
}

// ---- reactions (signals.rs) ----
// { type: "pulse", colour: [r, g, b] (0..255), afterglow: seconds, source }
// { type: "count", n }   how many things are waiting, across all apps
// { type: "flash" }
// { type: "lanterns", items: [{ source, colour }] }   every app with something
//   waiting that you haven't seen: the whole list, on every change
// A wallpaper handles the ones it can (catalog.js lists which).
const reactionHandlers = [];
export const onReaction = (fn) => reactionHandlers.push(fn);
function react(r) {
  if (!r || typeof r.type !== "string") return;
  reactionHandlers.forEach((fn) => fn(r));
  // tell the host page it arrived (it logs to the app; see host.js)
  if (FRAMED) parent.postMessage({ type: "reacted", reaction: r.type, handlers: reactionHandlers.length, page: location.pathname }, location.origin);
}
// You rested the cursor on an app's lantern: tell the app it's been seen
// (host.js -> signals.rs dismiss_lantern; the app sends the new list back)
let testLanterns = []; // in a browser, the L / K keys' lanterns
export function seenLantern(source) {
  if (FRAMED) parent.postMessage({ type: "seen", source }, location.origin);
  else {
    testLanterns = testLanterns.filter((l) => l.source !== source);
    react({ type: "lanterns", items: testLanterns });
  }
}

if (FRAMED) {
  // { type: "cursor", at: { x, y } | null } in CSS px within this frame,
  // { type: "paused", value: bool }, { type: "reaction", reaction }
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const d = e.data;
    if (d?.type === "cursor" && HOVER) {
      if (d.at) movePointer(d.at.x, d.at.y);
      else pointer.on = false;
    } else if (d?.type === "paused") setPaused(!!d.value);
    else if (d?.type === "reaction") react(d.reaction);
  });
} else if (!STILL) {
  // Opened directly in a browser: keys fire reactions, for tuning them
  //   P pulse (brand green), G pulse (another colour), F flash,
  //   C or + three more waiting, - three fewer, X none waiting
  //   L light another app's lantern (and pulse it), K all lanterns out
  let count = 0;
  const TEST_APPS = [
    ["whatsapp", [37, 211, 102]],
    ["gmail", [234, 67, 53]],
    ["slack", [224, 30, 90]],
    ["discord", [88, 101, 242]],
    ["spotify", [29, 185, 84]],
  ];
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "l") {
      const next = TEST_APPS.find(([s]) => !testLanterns.some((l) => l.source === s));
      if (!next) return;
      testLanterns = [...testLanterns, { source: next[0], colour: next[1] }];
      react({ type: "lanterns", items: testLanterns });
      react({ type: "pulse", colour: next[1], afterglow: 4, source: next[0] });
    } else if (k === "k") react({ type: "lanterns", items: (testLanterns = []) });
    else if (k === "p") react({ type: "pulse", colour: [51, 255, 153], afterglow: 4, source: "test" });
    else if (k === "g") react({ type: "pulse", colour: [234, 67, 53], afterglow: 4, source: "test" });
    else if (k === "f") react({ type: "flash" });
    else if (k === "c" || k === "+" || k === "=") react({ type: "count", n: (count += 3) });
    else if (k === "-") react({ type: "count", n: (count = Math.max(0, count - 3)) });
    else if (k === "x") react({ type: "count", n: (count = 0) });
  });
}
if (!FRAMED && HOVER) {
  addEventListener("pointermove", (e) => movePointer(e.clientX, e.clientY));
  document.addEventListener("pointerleave", () => (pointer.on = false));
  document.documentElement.addEventListener("mouseleave", () => (pointer.on = false));
  addEventListener("blur", () => (pointer.on = false));
}

// A brand colour variable as [r, g, b]. Let the browser resolve it rather
// than parsing hex: production builds minify #000000 to #000.
export function cssRGB(varName) {
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}

export function num(name, fallback, min, max) {
  const v = parseFloat(params.get(name));
  return v >= min && v <= max ? v : fallback;
}

// Small seeded random, so random layouts look the same every load
export function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Stable 0..1 noise for a cell (and an optional time bucket)
export const hash = (x, y, z = 0) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
