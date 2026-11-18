// Shared by every wallpaper page (wallpapers/*.html). Adapted from
// heywajih.com's src/wallpapers/common.js: URL options, the cursor for hover
// effects, colour helpers and still mode, plus what the AfterGlow app adds:
//   - the cursor arrives from the app (Rust polls it and emits "cursor"),
//     because a window behind the desktop icons gets no mouse events
//   - pause/resume from the app ("paused" event: fullscreen game, battery,
//     or the tray's Pause), so a paused wallpaper uses no CPU at all
// In a plain browser (bun run dev) the DOM's own pointer events are used and
// nothing is ever paused, so wallpapers can be developed there.
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
export const IN_APP = "__TAURI_INTERNALS__" in window;

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

if (IN_APP) {
  // Events are sent to this window only (one window per monitor)
  import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
    const win = getCurrentWebviewWindow();
    // payload: { x, y } in CSS px relative to this window, or null when the
    // cursor is on another screen
    if (HOVER)
      win.listen("cursor", ({ payload }) => {
        if (payload) movePointer(payload.x, payload.y);
        else pointer.on = false;
      });
    win.listen("paused", ({ payload }) => setPaused(!!payload));
  });
} else if (HOVER) {
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
