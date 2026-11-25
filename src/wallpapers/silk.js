// Silk: a sheet of sheer silk, see-through, glowing where it folds over itself.
// It is a surface made of points of light lying on its threads: where the
// cloth turns edge-on the points crowd together, so every fold draws its own
// bright line, as real silk does. Two shapes: a veil falling down the screen,
// and a drape gathered at one point with its folds fanning out below. (Opaque
// cloth, single threads and strokes were tried: none of them looked like silk.)
//
// Reactions live on the cloth, so they fold with it: a message is the app's
// colour sliding down it, every waiting app keeps a patch lit in its colour,
// breathing (rest the cursor on it to mark it seen), and a flash lights it all.
//
// Two renderers with the same maths: silk-gl.js (GPU) and light() here, with
// fewer points (CPU).
// Options: ?shape=veil|drape ?tint=natural|cool|warm|grey|green

import { params, hash, HOVER, STILL, STILL_AT } from "./common.js";
import { startScene, reduced, smooth as sstep } from "./nightscene.js";
import { watchSeen } from "./techy.js";
import { SILK } from "./palettes.js";
import { onCPU } from "./strands.js";
import { blur, inkCell, pointFont, pointFps } from "./points-cpu.js";
import { trackApps, now } from "./waiting.js";
import { silkGL } from "./silk-gl.js";

const PAL = SILK[params.get("tint")] ?? SILK.natural;
const DRAPE = params.get("shape") === "drape";
const THREADS = DRAPE ? 240 : 260, GAIN = DRAPE ? 0.52 : 0.55;
const apps = trackApps();

let dims = null, A = 1.78, cols = 0, rows = 0, ACC = null, TMP = null;
function layout(d) {
  dims = d;
  ({ A, cols, rows } = d);
  ACC = null; // the CPU's buffers, made when it's the one drawing
}

// ---- this frame (both renderers) ----
const MAX = 12;
const F = { t: 0, A: 1.78, cx: 1, sx: 1, flash: 0, n: 0, at: new Float32Array(MAX * 4), hue: new Float32Array(MAX * 4) };
// a waiting app's spot on the cloth: across (v) and along (w)
const spot = (i) => [0.14 + 0.72 * ((i * 0.618 + 0.22) % 1), (DRAPE ? 0.42 : 0.28) + 0.4 * ((i * 0.381 + 0.35) % 1)];
function setFrame(t) {
  F.t = t;
  F.A = A;
  F.cx = A * (A < 1 ? 0.52 : 0.6);
  F.sx = A < 1 ? (DRAPE ? 0.42 : 0.56) : 1; // a portrait screen: a narrower sheet
  F.flash = apps.flash();
  F.n = 0;
  const add = (v, w, dv, dw, c, k) => {
    if (F.n === MAX || k < 0.01) return;
    F.at.set([v, w, dv, dw], F.n * 4);
    F.hue.set([c[0], c[1], c[2], k], F.n * 4);
    F.n++;
  };
  for (const a of apps.waiting) add(...spot(a.i), 0.07, 0.13, a.colour, apps.lit(a));
  for (const m of apps.messages) add(spot(m.i)[0], -0.05 + 0.24 * (now() - m.t0), 0.1, 0.16, m.colour, Math.min(1, 1.6 * apps.glow(m)));
}

// ---- the cloth: v across, w along, 0..1 -> screen heights, and how near ----
const wander = (a, b) => 0.5 * Math.sin(a) + 0.3 * Math.sin(1.7 * a + b) + 0.2 * Math.sin(2.9 * a - 1.3 * b);
const O = [0, 0, 0];
function cloth(v, w) {
  const s = v * 2 - 1, t = F.t;
  if (DRAPE) {
    const r = w * 1.35, open = 0.1 + 0.95 * Math.pow(r, 0.8);
    const ph = s * 9.5 + 0.9 * Math.sin(r * 2.6 - t * 0.08 + s * 2) + t * 0.03;
    const an = s * 0.62 * (0.55 + 0.45 * r) + 0.05 * wander(r * 2 - t * 0.06, 3);
    O[0] = F.cx + F.sx * (Math.sin(an) * r * 1.05 + 0.075 * open * Math.sin(ph) + 0.022 * open * Math.sin(2.3 * ph + r * 3) + 0.04 * Math.sin(t * 0.07 + r * 2));
    O[1] = -0.1 + Math.cos(an) * r * 0.92 + 0.05 * open * Math.cos(ph + 0.6) * r;
    O[2] = Math.cos(ph);
  } else {
    const y = w * 1.36 - 0.18, f = 7.5 * s + 3 * y - t * 0.11;
    O[0] = F.cx + F.sx * (0.16 * wander(y * 2 - t * 0.07, 1) + s * (0.36 + 0.07 * Math.sin(y * 1.7 + t * 0.06)) + 0.1 * Math.sin(f) + 0.05 * Math.sin(15 * s - 4.2 * y + t * 0.08) + 0.02 * Math.sin(29 * s + 5 * y));
    O[1] = y + 0.05 * Math.sin(4 * s + 2 * y + t * 0.09);
    O[2] = Math.cos(f);
  }
}

// ---- the CPU renderer ----
const POINTS = params.has("fine") ? 90000 : 36000, JIT = Float32Array.from({ length: POINTS }, (_, i) => 0.2 + 0.6 * hash(i, 1, 3));
function light() {
  if (!ACC) {
    ACC = new Float32Array(cols * rows * 3);
    TMP = new Float32Array(cols * rows * 3);
  }
  ACC.fill(0);
  const cw = dims.cw / dims.H, ch = dims.ch / dims.H, gain = ((GAIN * (1 + 0.9 * F.flash)) * cols * rows) / POINTS / F.sx;
  for (let i = 0; i < POINTS; i++) {
    // spread evenly (a low-discrepancy sequence), most of it on the threads
    const a = (Math.imul(i, 3242174889) >>> 0) / 4294967296, w = (Math.imul(i, 2447445414) >>> 0) / 4294967296;
    const th = Math.floor(a * THREADS), v = (th + JIT[i]) / THREADS;
    cloth(v, w);
    const x = O[0], y = O[1], c = Math.floor(x / cw), r = Math.floor(y / ch);
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const near = 0.5 + 0.5 * O[2];
    let e = gain * (0.35 + 0.65 * Math.pow(near, 1.6)) * (0.75 + 0.25 * Math.sin(w * 9 + th * 0.31 - F.t * 0.25)) * sstep(0.1 * A, 0.34 * A, x);
    const u = Math.min(1, Math.max(0, 0.5 + 0.5 * wander(v * 3.2 + y * 1.4 + F.t * 0.04, 1)));
    let R = PAL.a[0] + (PAL.b[0] - PAL.a[0]) * u, G = PAL.a[1] + (PAL.b[1] - PAL.a[1]) * u, B = PAL.a[2] + (PAL.b[2] - PAL.a[2]) * u;
    for (let n = 0; n < F.n; n++) {
      const q = n * 4, dv = (v - F.at[q]) / F.at[q + 2], dw = (w - F.at[q + 1]) / F.at[q + 3], k = Math.min(1, F.hue[q + 3] * 1.6 * Math.exp(-dv * dv - dw * dw));
      R += (F.hue[q] - R) * k;
      G += (F.hue[q + 1] - G) * k;
      B += (F.hue[q + 2] - B) * k;
      e *= 1 + 1.6 * k;
    }
    const j = (r * cols + c) * 3;
    ACC[j] += R * e;
    ACC[j + 1] += G * e;
    ACC[j + 2] += B * e;
  }
  blur(ACC, TMP, cols);
  blur(ACC, TMP, cols); // twice: there are fewer points than on the GPU
}
let faint = 0;
const sample = (X, Y, t, cell) => inkCell(ACC, (cell[1] * cols + cell[0]) * 3, cell, faint);

function where(a) {
  cloth(...spot(a.i));
  return [O[0], O[1]];
}
function frame(t) {
  if (!dims) return;
  apps.tidy();
  setFrame(STILL ? STILL_AT : reduced ? 40 : t);
  faint = onCPU() ? 0.045 : 0;
  if (document.documentElement.dataset.renderer !== "gpu") light();
  if (HOVER) watchSeen(apps.waiting, where, dims.H, 0.09);
}

startScene({
  label: "A sheet of sheer silk, see-through, glowing where it folds over itself.",
  fps: pointFps,
  layout,
  frame,
  fontPx: pointFont,
  sample,
  gpu: silkGL({ THREADS, GAIN, DRAPE, MAX }, () => ({ F, PAL, cw: dims.cw / dims.H, ch: dims.ch / dims.H })),
});
