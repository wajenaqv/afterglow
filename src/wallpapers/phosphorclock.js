// The phosphor clock (clock style "phosphor"): the time drawn by the electron
// beam of a long-persistence CRT, the afterglow made literal.
//
// - The digits are vector strokes (thick glowing tubes), and the beam retraces
//   all of them every few seconds: each point flashes hot as the beam passes
//   and then holds a softer glow that slowly cools until the beam comes back.
// - When the minute turns nothing is erased: the old digits stop being
//   refreshed and fade out slowly as a ghost, cooling in colour, while the
//   beam writes the new time left to right.
// - A faint "88:88" is burned into the tube.
//
// Phosphors (?phosphor=): green (P1, the classic terminal), amber (P3),
// p7 (radar: a blue-white flash cooling to yellow-green), white (P4).
// Reactions: a pulse rewrites the digits in the app's colour, which cools
// back into the phosphor over the afterglow; a flash lights the whole tube.
//
// Units: screen heights, y down, like every night scene. CPU renderer for now
// (the GPU twin comes once the look is agreed).

import { params, onReaction } from "./common.js";
import { startScene, setPalette, reduced } from "./nightscene.js";
import { timeText, dateText } from "./hoverclock.js";

// Vector digits in a box 1 wide, 1.4 tall (y down): each a list of polylines
const DIGITS = {
  0: [[[0.22, 0], [0.78, 0], [1, 0.22], [1, 1.18], [0.78, 1.4], [0.22, 1.4], [0, 1.18], [0, 0.22], [0.22, 0]]],
  1: [[[0.25, 0.28], [0.6, 0], [0.6, 1.4]], [[0.25, 1.4], [0.95, 1.4]]],
  2: [[[0, 0.26], [0.24, 0], [0.76, 0], [1, 0.24], [1, 0.5], [0, 1.4], [1, 1.4]]],
  3: [[[0, 0], [1, 0], [0.45, 0.58], [0.76, 0.58], [1, 0.8], [1, 1.18], [0.78, 1.4], [0.22, 1.4], [0, 1.18]]],
  4: [[[0.72, 1.4], [0.72, 0], [0, 1.0], [1, 1.0]]],
  5: [[[1, 0], [0.05, 0], [0, 0.62], [0.74, 0.58], [1, 0.8], [1, 1.18], [0.78, 1.4], [0.22, 1.4], [0, 1.18]]],
  6: [[[0.88, 0], [0.42, 0], [0, 0.5], [0, 1.18], [0.22, 1.4], [0.78, 1.4], [1, 1.18], [1, 0.86], [0.78, 0.64], [0.22, 0.64], [0, 0.86]]],
  7: [[[0, 0], [1, 0], [0.36, 1.4]]],
  8: [
    [[0.22, 0], [0.78, 0], [0.96, 0.17], [0.96, 0.48], [0.78, 0.64], [0.22, 0.64], [0.04, 0.48], [0.04, 0.17], [0.22, 0]],
    [[0.22, 0.64], [0.78, 0.64], [1, 0.86], [1, 1.18], [0.78, 1.4], [0.22, 1.4], [0, 1.18], [0, 0.86], [0.22, 0.64]],
  ],
  9: [[[0.12, 1.4], [0.58, 1.4], [1, 0.9], [1, 0.22], [0.78, 0], [0.22, 0], [0, 0.22], [0, 0.54], [0.22, 0.76], [0.78, 0.76], [1, 0.54]]],
};

const PHOSPHORS = {
  //        hot (beam head)      glow (persistence)    cooled (old digits)
  green: { hot: [0.8, 1, 0.9], glow: [0.2, 1, 0.45], cool: [0.05, 0.45, 0.2] },
  amber: { hot: [1, 0.92, 0.7], glow: [1, 0.62, 0.12], cool: [0.55, 0.2, 0.03] },
  p7: { hot: [0.7, 0.82, 1], glow: [0.62, 1, 0.3], cool: [0.75, 0.55, 0.08] },
  white: { hot: [1, 1, 1], glow: [0.78, 0.84, 0.95], cool: [0.3, 0.32, 0.42] },
};
const P = PHOSPHORS[params.get("phosphor")] ?? PHOSPHORS.p7;
const HOURS = ["12", "24"].includes(params.get("hours")) ? params.get("hours") : "auto";
const SIZE = Math.min(1.6, Math.max(0.5, parseFloat(params.get("size")) || 1));

const REFRESH = 3.2; // seconds for the beam to retrace everything
const HOLD = 1.6; // how long the glow takes to cool after the beam passes
const FADE = 9; // how long the old digits take to fade (seconds, e-folding)

// ---- layout: the text as segments along the beam's path ----
function build(text, A, cy = 0.45) {
  const hd = 0.25 * SIZE; // digit height
  const dw = hd / 1.4; // digit width
  const gap = hd * 0.3, colon = hd * 0.3;
  const widths = [...text].map((c) => (c === ":" ? colon : dw));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);
  let x = A / 2 - total / 2;
  const top = cy - hd / 2;
  const segs = [], dots = [];
  let s = 0;
  [...text].forEach((c, i) => {
    if (c === ":") {
      for (const fy of [0.42, 1.0]) dots.push({ x: x + colon / 2, y: top + (fy / 1.4) * hd * 1.0, s });
      s += hd * 0.2;
    } else
      for (const poly of DIGITS[c])
        for (let k = 0; k + 1 < poly.length; k++) {
          const ax = x + poly[k][0] * dw, ay = top + (poly[k][1] / 1.4) * hd;
          const bx = x + poly[k + 1][0] * dw, by = top + (poly[k + 1][1] / 1.4) * hd;
          const len = Math.hypot(bx - ax, by - ay);
          segs.push({ ax, ay, bx, by, len, s, x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) });
          s += len;
        }
    x += widths[i] + gap;
  });
  return { segs, dots, L: s, w: hd * 0.045, box: [A / 2 - total / 2, top, A / 2 + total / 2, top + hd] };
}

// ---- state ----
let A = 16 / 9;
let text = "", cur = null, old = null, ghost = null;
let turnAt = -1e9, nowT = 0;
let pulse = null, flashAt = -1e9;
function update(t) {
  nowT = t;
  const want = timeText(new Date(), HOURS);
  if (want !== text || !cur) {
    if (cur && !reduced) {
      old = cur;
      turnAt = t;
    }
    text = want;
    cur = build(text, A);
    ghost = build(text.replace(/\d/g, "8"), A);
    if (!old) turnAt = t - REFRESH; // first draw: already written
  }
}
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) pulse = { col: r.colour.map((v) => v / 255), at: nowT, life: Math.max(3, (r.afterglow || 4) + 2) };
  else if (r.type === "flash") flashAt = nowT;
});

const mod = (a, b) => ((a % b) + b) % b;
// distance from (x, y) to a segment, and how far along it the nearest point is
function seg(x, y, g) {
  const dx = g.bx - g.ax, dy = g.by - g.ay;
  const h = Math.max(0, Math.min(1, ((x - g.ax) * dx + (y - g.ay) * dy) / (dx * dx + dy * dy || 1e-9)));
  return [Math.hypot(x - g.ax - dx * h, y - g.ay - dy * h), h];
}
// a glowing tube: a bright core and a tight halo (a wide halo turned into a
// grey block of faint characters around each digit)
const tube = (d, w) => Math.exp(-((d / w) ** 2)) + 0.1 * Math.exp(-d / (w * 1.8));

/** The light at (x, y) */
function light(x, y, t, out) {
  out[0] = out[1] = out[2] = 0;
  if (!cur) return;
  const [bx0, by0, bx1, by1] = cur.box;
  const m = cur.w * 14;
  if (x < bx0 - m || x > bx1 + m || y < by0 - m || y > by1 + m) return;
  const w = cur.w;
  const speed = cur.L / REFRESH;
  const since = t - turnAt; // time since this text started being written
  const pk = pulse ? Math.max(0, 1 - (t - pulse.at) / pulse.life) : 0;
  const hot = pk > 0 ? pulse.col.map((v, i) => v + (P.hot[i] - v) * (1 - pk)) : P.hot;
  const glow = pk > 0 ? pulse.col.map((v, i) => v + (P.glow[i] - v) * (1 - pk) ** 0.5) : P.glow;
  let g = 0, h = 0;
  const point = (d, s) => {
    if (d > m) return;
    if (since * speed < s) return; // not written yet
    const age = since < REFRESH ? since - s / speed : mod((since - s / speed), REFRESH);
    const f = tube(d, w);
    // the brightest stroke wins (adding them made beads where strokes meet)
    g = Math.max(g, f * (0.32 + 0.68 * Math.exp(-age / HOLD)));
    h = Math.max(h, f * Math.exp(-age / 0.07));
  };
  for (const sg of cur.segs) {
    if (x < sg.x0 - m || x > sg.x1 + m || y < sg.y0 - m || y > sg.y1 + m) continue;
    const [d, k] = seg(x, y, sg);
    point(d, sg.s + k * sg.len);
  }
  for (const dt of cur.dots) point(Math.max(0, Math.hypot(x - dt.x, y - dt.y) - w * 0.6), dt.s);
  for (let i = 0; i < 3; i++) out[i] += glow[i] * g + hot[i] * h * 1.4;
  // the old time, fading and cooling
  if (old) {
    const k = Math.exp(-(t - turnAt) / FADE);
    if (k < 0.01) old = null;
    else {
      let o = 0;
      for (const sg of old.segs) {
        if (x < sg.x0 - m || x > sg.x1 + m || y < sg.y0 - m || y > sg.y1 + m) continue;
        o = Math.max(o, tube(seg(x, y, sg)[0], w));
      }
      for (const dt of old.dots) o = Math.max(o, tube(Math.hypot(x - dt.x, y - dt.y), w));
      const c = P.glow.map((v, i) => v + (P.cool[i] - v) * (1 - k));
      for (let i = 0; i < 3; i++) out[i] += c[i] * o * 0.6 * k;
    }
  }
  // the burned-in 88:88
  let b = 0;
  for (const sg of ghost.segs) {
    if (x < sg.x0 - w * 2 || x > sg.x1 + w * 2 || y < sg.y0 - w * 2 || y > sg.y1 + w * 2) continue;
    b = Math.max(b, Math.exp(-((seg(x, y, sg)[0] / w) ** 2)));
  }
  for (let i = 0; i < 3; i++) out[i] += P.glow[i] * b * 0.05;
  const f = Math.max(0, 1 - (t - flashAt) / 0.5);
  if (f > 0) for (let i = 0; i < 3; i++) out[i] += P.glow[i] * f * f * 0.6 * Math.min(1, g + b);
}

// ---- smooth mock (?smooth) ----
function smooth() {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh" });
  document.body.append(canvas);
  document.body.style.background = "#000";
  const ctx = canvas.getContext("2d");
  const o = [0, 0, 0];
  const t0 = performance.now();
  const draw = (ms) => {
    requestAnimationFrame(draw);
    const w = Math.max(2, Math.floor(innerWidth / 3)), hgt = Math.max(2, Math.floor(innerHeight / 3));
    if (canvas.width !== w) (canvas.width = w), (canvas.height = hgt);
    A = w / hgt;
    const t = (ms - t0) / 1000;
    if (cur && Math.abs(cur.box[0] + cur.box[2] - A) > 1e-6) (text = ""), (cur = null);
    update(t);
    const img = ctx.createImageData(w, hgt);
    for (let j = 0; j < hgt; j++)
      for (let i = 0; i < w; i++) {
        light((i / w) * A, j / hgt, t, o);
        const p = (j * w + i) * 4;
        for (let k = 0; k < 3; k++) img.data[p + k] = 255 * (1 - Math.exp(-1.4 * o[k]));
        img.data[p + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  };
  requestAnimationFrame(draw);
}

// ---- characters ----
export function startPhosphorClock({ onLayout } = {}) {
  if (params.has("smooth")) return smooth();
  setPalette();
  let dims = null;
  const out = [0, 0, 0];
  startScene({
    label: "The time drawn by the beam of a glowing CRT: the beam retraces the digits, and old digits fade slowly when the minute turns.",
    fps: 30,
    layout: (d) => {
      dims = d;
      A = d.A;
      text = "";
      cur = null;
      old = null;
      update(nowT);
      onLayout?.({ bottom: cur.box[3] * d.H });
    },
    frame: (t) => update(reduced ? 20 : t),
    sample: (X, Y, t) => {
      light(X, Y, reduced ? 20 : t, out);
      return [out, null];
    },
    // the date in the same grid of characters, dim, under the digits (a
    // separate line of page text didn't fit the look)
    overlay: (t, list) => {
      if (!dims || !cur) return;
      const label = dateText(new Date(), HOURS);
      const row = Math.round((cur.box[3] + cur.w * 9) / (dims.ch / dims.H));
      const col0 = Math.round((dims.A / 2) / (dims.cw / dims.H) - label.length / 2);
      const c = P.glow.map((v) => v * 0.32);
      [...label].forEach((ch, i) => ch !== " " && list.push([col0 + i, row, ch, c]));
    },
  });
}
