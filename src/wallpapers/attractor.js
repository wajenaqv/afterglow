// Attractor: the veils of a strange attractor (a Clifford map: the same two
// lines of trigonometry over and over). Hundreds of thousands of points of
// light fall on thin folded sheets; the numbers drift very slowly, so the
// folds breathe and slide without ever jumping to another shape.
//
// Reactions: a short line put through the map a few times comes out as a long
// thread lying exactly in the folds. A message is such a thread in the app's
// colour, sliding along as it fades; every waiting app keeps one, breathing,
// with a bright bead on it: rest the cursor on the bead to mark it seen. A
// flash lights every fold.
//
// Two renderers with the same maths: attractor-gl.js (points on the GPU) and
// light() here (fewer points on the CPU). Options: ?tint=natural|cool|warm|grey|green

import { params, HOVER, STILL, STILL_AT } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { watchSeen } from "./techy.js";
import { ATTRACTOR } from "./palettes.js";
import { blur, pointFont, pointFps } from "./points-cpu.js";
import { trackApps, now } from "./waiting.js";
import { attractorGL } from "./attractor-gl.js";

const PAL = ATTRACTOR[params.get("tint")] ?? ATTRACTOR.natural;
const apps = trackApps({ onSeen: (a) => apps.messages.push({ colour: a.colour, t0: now() - 0.5, tau: 2, i: a.i }) });

let dims = null, A = 1.78, cols = 0, rows = 0, ACC = null, TMP = null;
function layout(d) {
  dims = d;
  ({ A, cols, rows } = d);
  ACC = null; // the CPU's buffers, made when it's the one drawing
}

// ---- this moment's shape ----
// Round one good, sparse set of numbers: further out it fills up into a disc
const F = { a: 0, b: 0, c: 0, d: 0, cs: 1, sn: 0, cx: 1, cy: 0.5, sx: 0.3, sy: 0.24, flash: 0, t: 0, threads: [] };
function setShape(t) {
  F.t = t;
  F.a = -1.62 + 0.035 * Math.sin(t * 0.05);
  F.b = 1.7 + 0.03 * Math.sin(t * 0.037 + 1);
  F.c = 0.68 + 0.05 * Math.sin(t * 0.043 + 2);
  F.d = -0.85 + 0.04 * Math.cos(t * 0.031);
  const rot = 1.25 + 0.1 * Math.sin(t * 0.02);
  F.cs = Math.cos(rot);
  F.sn = Math.sin(rot);
  F.cx = A * (A < 1 ? 0.52 : 0.59);
  F.cy = 0.5;
  // as large as fits (it spans about 3.3 x 3.8 in its own units)
  const s = Math.min(0.245, (A < 1 ? 0.27 : 0.235) * A);
  F.sx = s * (A < 1 ? 1 : 1.25);
  F.sy = s;
  F.flash = apps.flash();
  // threads: a short line from (x, y) towards (dx, dy), put through the map n times
  F.threads.length = 0;
  for (const w of apps.waiting) {
    const k = apps.lit(w), h = w.i * 2.399;
    const th = { x: 0.35 * Math.cos(h), y: 0.35 * Math.sin(h), dx: Math.cos(h + 1) * 0.09, dy: Math.sin(h + 1) * 0.09, n: 4, k, colour: w.colour };
    F.threads.push(th, { ...th, dx: 0.0035, dy: 0.0025, n: 4, k: k * 1.2, bead: true });
  }
  for (const m of apps.messages) {
    const k = apps.glow(m), h = m.i * 2.399 + 0.3, slide = 0.05 * (now() - m.t0);
    F.threads.push({ x: 0.35 * Math.cos(h) + slide * Math.cos(h + 1), y: 0.35 * Math.sin(h) + slide * Math.sin(h + 1), dx: Math.cos(h + 1) * 0.16, dy: Math.sin(h + 1) * 0.16, n: 4, k: 1.3 * k, colour: m.colour });
  }
}
function map(p) {
  const x = Math.sin(F.a * p[1]) + F.c * Math.cos(F.a * p[0]);
  p[1] = Math.sin(F.b * p[0]) + F.d * Math.cos(F.b * p[1]);
  p[0] = x;
}
const toScreen = (x, y) => [F.cx + (x * F.cs - y * F.sn) * F.sx, F.cy + (x * F.sn + y * F.cs) * F.sy];
// where a waiting app's bead is
function beadOf(w) {
  const h = w.i * 2.399, p = [0.35 * Math.cos(h), 0.35 * Math.sin(h)];
  for (let i = 0; i < 4; i++) map(p);
  return toScreen(...p);
}

// ---- the CPU renderer ----
const CPU_POINTS = params.has("fine") ? 70000 : 48000;
const VEIL = 0.23, THREAD = 0.11;
const rand = (n, k) => {
  let h = Math.imul(n, 374761393) + Math.imul(k, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function light() {
  if (!ACC) {
    ACC = new Float32Array(cols * rows * 3);
    TMP = new Float32Array(cols * rows * 3);
  }
  ACC.fill(0);
  const cw = dims.cw / dims.H, ch = dims.ch / dims.H, p = [0, 0];
  const put = (x, y, r, g, b) => {
    const s = toScreen(x, y), c = Math.floor(s[0] / cw), q = Math.floor(s[1] / ch);
    if (c < 0 || q < 0 || c >= cols || q >= rows) return;
    const i = (q * cols + c) * 3;
    ACC[i] += r;
    ACC[i + 1] += g;
    ACC[i + 2] += b;
  };
  const w = ((VEIL * (1 + 1.2 * F.flash) * cols * rows) / CPU_POINTS) * (0.06 / (F.sx * F.sy)) * 0.9;
  const per = 48; // points from one start, so few are spent finding the shape
  for (let n = 0; n < CPU_POINTS / per; n++) {
    p[0] = rand(n, 1) * 2 - 1;
    p[1] = rand(n, 2) * 2 - 1;
    for (let k = 0; k < 14; k++) map(p);
    for (let k = 0; k < per; k++) {
      const x0 = p[0], y0 = p[1];
      map(p);
      const h = 0.5 + 0.5 * Math.sin(1.1 * (p[0] - x0) + 0.7 * (p[1] - y0) + 0.03 * F.t);
      put(p[0], p[1], (PAL.a[0] + (PAL.b[0] - PAL.a[0]) * h) * w, (PAL.a[1] + (PAL.b[1] - PAL.a[1]) * h) * w, (PAL.a[2] + (PAL.b[2] - PAL.a[2]) * h) * w);
    }
  }
  for (const t of F.threads) {
    const N = t.bead ? 500 : 5000, g = ((THREAD * t.k * 5000) / N) * (t.bead ? 0.35 : 1) * (0.0076 / ch);
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N - 0.5;
      p[0] = t.x + t.dx * u;
      p[1] = t.y + t.dy * u;
      for (let k = 0; k < t.n; k++) map(p);
      put(p[0], p[1], t.colour[0] * g, t.colour[1] * g, t.colour[2] * g);
    }
  }
  blur(ACC, TMP, cols);
}
// points add up without limit: hold the brightest folds, keeping their colour
const col = [0, 0, 0];
function sample(X, Y, t, cell) {
  const i = (cell[1] * cols + cell[0]) * 3, top = Math.max(ACC[i], ACC[i + 1], ACC[i + 2]);
  const k = top > 0 ? (1.15 * (1 - Math.exp(-top / 0.6))) / top : 0;
  col[0] = ACC[i] * k;
  col[1] = ACC[i + 1] * k;
  col[2] = ACC[i + 2] * k;
  return [col, null];
}

function frame(t) {
  if (!dims) return;
  apps.tidy();
  setShape(STILL ? STILL_AT : reduced ? 40 : t);
  if (document.documentElement.dataset.renderer !== "gpu") light();
  if (HOVER) watchSeen(apps.waiting, beadOf, dims.H, 0.06);
}

startScene({
  label: "Thin folded veils of light, the shape of a strange attractor, slowly breathing.",
  fps: pointFps,
  layout,
  frame,
  fontPx: pointFont,
  sample,
  gpu: attractorGL(() => ({ F, PAL, cw: dims.cw / dims.H, ch: dims.ch / dims.H, VEIL, THREAD })),
});
