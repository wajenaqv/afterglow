// Shared by the techy wallpapers (radar, life, circuit): phosphor palettes,
// the CRT overlay, and "rest the cursor on it to mark it seen".

import { params, HOVER, pointer, seenLantern } from "./common.js";

// ?tint=: the phosphor. green = the brand (P1/P31), amber (P3), ice (P7's
// blue-white flash colour), white (P4)
export const PHOSPHORS = {
  green: { ink: [0.2, 1.0, 0.6], dim: [0.08, 0.42, 0.26], flash: [0.85, 1.0, 0.95] },
  amber: { ink: [1.0, 0.68, 0.2], dim: [0.45, 0.28, 0.06], flash: [1.0, 0.95, 0.8] },
  ice: { ink: [0.55, 0.85, 1.0], dim: [0.18, 0.32, 0.48], flash: [0.95, 0.98, 1.0] },
  white: { ink: [0.88, 0.9, 0.95], dim: [0.32, 0.34, 0.38], flash: [1, 1, 1] },
};
export const PH = PHOSPHORS[params.get("tint")] ?? PHOSPHORS.green;

// the CRT overlay (wallpaper.css body.crt): scanlines and a vignette
export function crt() {
  if (params.get("crt") !== "0") document.body.classList.add("crt");
}

export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

// Rest the cursor on one of `items` for 0.8 s: tell the app it's been seen.
// where(item) -> [x, y] in screen heights; H the screen height in px
let over = null;
export function watchSeen(items, where, H, radius = 0.04) {
  if (!HOVER || !pointer.on || !items.length) return void (over = null);
  const X = pointer.x / H, Y = pointer.y / H;
  const it = items.find((l) => {
    const [x, y] = where(l);
    return Math.hypot(X - x, Y - y) < radius;
  });
  if (!it) return void (over = null);
  if (over?.source !== it.source) over = { source: it.source, at: performance.now() };
  else if (performance.now() - over.at > 800) {
    seenLantern(it.source);
    over = null;
  }
}
