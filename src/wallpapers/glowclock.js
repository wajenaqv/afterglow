// The glowing clock styles of the clock wallpaper:
//   tube     the time as a glowing tube written by a CRT's beam: a white-hot
//            core, and behind the beam's slow round the phosphor cooling. On a
//            new minute the old digits cool away while the beam writes the new
//   jelly    glassy digits with a bright rim and a soft glow, breathing
//   eclipse  dark digits with the light behind them, spilling round the edges
//
// Reactions: a message runs through the digits in the app's colour and fades
// over the afterglow; a flash brightens everything. (Waiting apps are the dots
// under the date: clock.js.)
//
// What a cell holds is worked out once per time and screen size: for a tube its
// distance to the stroke and how far along the beam's path it is, for the
// others its light. Each frame only moves the beam, the breathing and the
// message. Characters are picked by how much of their cell they cover and the
// colour makes up the rest (as points-cpu.js does), so fades are smooth; the
// cells go to both renderers through cells.js.

import { hash, STILL, STILL_AT } from "./common.js";
import { startScene, reduced, preview } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { GLYPHS, INK } from "./points-cpu.js";
import { timeText, dateText } from "./hoverclock.js";
import { onCPU } from "./strands.js";

const cells = cellBuffer(GLYPHS + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [1, 1, 1];
// small characters come out thinner on the GPU (scene-gl.js softens them sideways)
const GPU_GAIN = 1.35;
const DITHER = 0.5; // between neighbouring characters in a wide glow, so its steps don't draw contours

// ---- colours ----
const PHOSPHORS = {
  natural: { hot: [0.86, 0.94, 1], glow: [0.5, 1, 0.42], cool: [0.85, 0.62, 0.1] },
  green: { hot: [0.88, 1, 0.95], glow: [0.2, 1, 0.6], cool: [0.05, 0.5, 0.35] },
  warm: { hot: [1, 0.95, 0.8], glow: [1, 0.66, 0.16], cool: [0.75, 0.22, 0.05] },
  cool: { hot: [0.92, 0.97, 1], glow: [0.34, 0.66, 1], cool: [0.25, 0.2, 0.85] },
  grey: { hot: [1, 1, 1], glow: [0.78, 0.84, 0.95], cool: [0.3, 0.32, 0.42] },
};
const JELLY = [[0.62, 0.95, 1], [0.72, 0.42, 1]]; // the natural palette's gradient

// ---- the tube's digits, in a box 1 wide and 1.4 tall: strokes, corners rounded off ----
const DIGITS = {
  0: [[[0.22, 0], [0.78, 0], [1, 0.22], [1, 1.18], [0.78, 1.4], [0.22, 1.4], [0, 1.18], [0, 0.22], [0.22, 0]]],
  1: [[[0.22, 0.3], [0.58, 0], [0.58, 1.4]], [[0.25, 1.4], [0.92, 1.4]]],
  2: [[[0, 0.3], [0.2, 0], [0.8, 0], [1, 0.24], [1, 0.5], [0.04, 1.4]], [[0.04, 1.4], [1, 1.4]]],
  3: [[[0.02, 0.2], [0.24, 0], [0.76, 0], [0.97, 0.2], [0.97, 0.45], [0.74, 0.64], [0.4, 0.64]], [[0.74, 0.64], [1, 0.86], [1, 1.18], [0.78, 1.4], [0.22, 1.4], [0, 1.18]]],
  4: [[[0.74, 1.4], [0.74, 0]], [[0.74, 0], [0, 1]], [[0, 1], [1, 1]]],
  5: [[[0.95, 0], [0.1, 0]], [[0.1, 0], [0.04, 0.6]], [[0.04, 0.6], [0.3, 0.52], [0.76, 0.54], [1, 0.78], [1, 1.14], [0.78, 1.4], [0.22, 1.4], [0, 1.2]]],
  6: [[[0.86, 0.05], [0.45, 0.08], [0.06, 0.5], [0, 1], [0.04, 1.2], [0.24, 1.4], [0.78, 1.4], [1, 1.16], [1, 0.86], [0.78, 0.62], [0.24, 0.62], [0.02, 0.86]]],
  7: [[[0, 0], [1, 0]], [[1, 0], [0.36, 1.4]]],
  8: [[[0.5, 0.64], [0.2, 0.62], [0.05, 0.45], [0.05, 0.2], [0.24, 0], [0.76, 0], [0.95, 0.2], [0.95, 0.45], [0.8, 0.62], [0.5, 0.64]], [[0.5, 0.64], [0.78, 0.66], [1, 0.88], [1, 1.16], [0.78, 1.4], [0.22, 1.4], [0, 1.16], [0, 0.88], [0.22, 0.66], [0.5, 0.64]]],
  9: [[[0.98, 0.54], [0.78, 0.78], [0.22, 0.78], [0, 0.54], [0, 0.24], [0.22, 0], [0.76, 0], [0.96, 0.2], [1, 0.4], [0.94, 0.9], [0.55, 1.32], [0.14, 1.36]]],
  ":": [[[0.16, 0.42], [0.16, 0.5]], [[0.16, 0.92], [0.16, 1]]],
};
function rounded(p) {
  for (let k = 0; k < 2 && p.length > 2; k++) {
    const o = [p[0]], between = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 0; i < p.length - 1; i++) {
      if (i) o.push(between(p[i], p[i + 1], 0.25));
      if (i < p.length - 2) o.push(between(p[i], p[i + 1], 0.75));
    }
    o.push(p[p.length - 1]);
    p = o;
  }
  return p;
}
const BEAM = 6; // seconds for the beam to go round

/**
 * kind: tube | jelly | eclipse; tint: the palette's name; colours: [top, low]
 * 0..1, or null for the natural palette. Returns { react(reaction),
 * onLayout(fn({ bottom }) in CSS px) }.
 */
export function startGlowClock({ kind, tint = "natural", colours = null, hours = "auto", size = 1, fps = 20 }) {
  const tube = kind === "tube", eclipse = kind === "eclipse";
  const own = tint === "custom" && colours ? { hot: mix(colours[1], WHITE, 0.8), glow: colours[1], cool: colours[1].map((v) => v * 0.45) } : null;
  const P = own ?? PHOSPHORS[tint] ?? PHOSPHORS.natural, GRAD = colours ?? JELLY;
  let dims = null, K = 1, shown = "", cur = null, old = null, turnedAt = -1e9, placed = null, bottom = 0.6;
  let gain = 1;
  let message = null, flashAt = -1e9; // message: { colour, at, tau }, real seconds
  const secs = () => performance.now() / 1000;
  const wide = () => dims.W > dims.H;

  // ---- tube: the cells near the strokes ----
  function strokes(text) {
    const { W, H, cw, ch, cols, rows } = dims;
    const w = [...text].reduce((s, q) => s + (q === ":" ? 0.32 : 1), 0) + 0.34 * (text.length - 1);
    const k = Math.min(((wide() ? 0.54 : 0.84) * W * size) / w, (0.34 * H * size) / 1.4), y0 = H * 0.43 - 0.7 * k, segs = [];
    K = Math.max(0.6, (1.4 * k) / ch / 44); // the stroke's width goes with the digits' size
    let x = (W - w * k) / 2, len = 0;
    for (const q of text) {
      for (const line of DIGITS[q] ?? []) {
        const p = rounded(line).map(([a, b]) => [x + a * k, y0 + b * k]);
        for (let i = 1; i < p.length; i++) {
          const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
          segs.push([...p[i - 1], ...p[i], len, L]);
          len += L;
        }
      }
      x += ((q === ":" ? 0.32 : 1) + 0.34) * k;
    }
    const reach = ch * 5.5 * K, best = new Map();
    for (const [ax, ay, bx, by, s, L] of segs)
      for (let r = Math.max(0, Math.floor((Math.min(ay, by) - reach) / ch)); r < Math.min(rows, (Math.max(ay, by) + reach) / ch); r++)
        for (let c = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / cw)); c < Math.min(cols, (Math.max(ax, bx) + reach) / cw); c++) {
          const X = (c + 0.5) * cw - ax, Y = (r + 0.5) * ch - ay, u = clamp((X * (bx - ax) + Y * (by - ay)) / (L * L || 1));
          const d = Math.hypot(X - u * (bx - ax), Y - u * (by - ay)), o = best.get(r * cols + c);
          if (d < reach && (!o || d < o[0])) best.set(r * cols + c, [d, s + u * L]);
        }
    bottom = (y0 + 1.4 * k) / H;
    const n = best.size, out = { n, len, at: Int32Array.from(best.keys()), s: new Float32Array(n), body: new Float32Array(n), core: new Float32Array(n), wall: new Float32Array(n) };
    let i = 0;
    for (const [d0, s] of best.values()) {
      const d = d0 / ch / K;
      out.s[i] = s / len;
      out.wall[i] = 1 / (1 + Math.exp((d - 2.1) * 3));
      out.core[i] = Math.exp(-((d / 0.8) ** 2));
      out.body[i] = 0.62 * out.wall[i] + 1.3 * out.core[i] + 0.14 * Math.exp(-Math.max(0, d - 1.8) / 1.1);
      i++;
    }
    return out;
  }

  // ---- jelly and eclipse: the digits of the system's display face, as light ----
  function lightOf(text) {
    const { W, H, cw, ch, cols, rows } = dims, N = cols * rows, SS = 3, c = document.createElement("canvas");
    c.width = cols * SS;
    c.height = rows * SS;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.setTransform(SS / cw, 0, 0, SS / ch, 0, 0);
    g.fillStyle = "#fff"; // coverage, not a colour
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const font = (px) => `${eclipse ? 700 : 600} ${px}px "Segoe UI Variable Display", "Segoe UI", "SF Pro Display", system-ui, sans-serif`;
    g.font = font(100);
    const px = Math.min(((wide() ? 0.56 : 0.86) * W * size) / g.measureText(text).width, (H * 0.36 * size) / 73) * 100, base = H * 0.43 + px * 0.365;
    g.font = font(px);
    g.fillText(text, W / 2, base);
    const d = g.getImageData(0, 0, c.width, c.height).data, cov = new Float32Array(N);
    for (let r = 0; r < rows; r++)
      for (let q = 0; q < cols; q++) {
        let s = 0;
        for (let y = 0; y < SS; y++) for (let x = 0; x < SS; x++) s += d[((r * SS + y) * c.width + q * SS + x) * 4 + 3];
        cov[r * cols + q] = s / (255 * SS * SS);
      }
    K = Math.max(0.5, (px * 0.73) / ch / 46); // the glow goes with the digits' size
    const R = (v) => Math.max(1, Math.round(v * K));
    const near = blur(cov, R(3), R(2), 2), soft = blur(cov, R(6), R(3), 3), far = blur(cov, R(13), R(7), 4);
    const top = (base - px * 0.73) / H;
    bottom = base / H;
    const at = [], still = [], moving = [], u = [], hot = [], dither = [];
    for (let i = 0; i < N; i++) {
      if (far[i] < 0.004) continue;
      const y = (Math.floor(i / cols) * ch) / H, down = clamp((y - top) / (bottom - top)), v = cov[i], out = 1 - v;
      at.push(i);
      if (eclipse) {
        still.push(out ** 1.5 * (3.4 * near[i] ** 1.9 + 0.75 * soft[i] ** 1.2));
        moving.push(out ** 1.5 * 0.5 * far[i] ** 1.2);
        u.push(clamp(down * 0.7 + 0.3 * (1 - near[i])));
        hot.push(clamp(near[i] - 0.25) * 0.8);
        dither.push(DITHER);
      } else {
        const rim = v * clamp(1.55 * (1 - near[i])) ** 1.2;
        still.push(2.6 * rim + v * (0.3 + 0.18 * down) * (1 - rim));
        moving.push(out * (0.5 * near[i] + 0.3 * soft[i] ** 1.3 + 0.22 * far[i] ** 1.4));
        u.push(down);
        hot.push(rim * 0.35);
        dither.push(v > 0.5 ? 0 : 0.35);
      }
    }
    return { n: at.length, at: Int32Array.from(at), still: Float32Array.from(still), moving: Float32Array.from(moving), u: Float32Array.from(u), hot: Float32Array.from(hot), dither: Float32Array.from(dither) };
  }
  function blur(src, rx, ry, passes) {
    const { cols, rows } = dims;
    let a = src;
    for (let pass = 0; pass < passes; pass++) {
      const b = new Float32Array(a.length), e = new Float32Array(a.length);
      for (let r = 0; r < rows; r++) {
        let s = 0;
        for (let c = -rx; c < cols; c++) {
          if (c + rx < cols) s += a[r * cols + c + rx];
          if (c - rx - 1 >= 0) s -= a[r * cols + c - rx - 1];
          if (c >= 0) b[r * cols + c] = s / (2 * rx + 1);
        }
      }
      for (let c = 0; c < cols; c++) {
        let s = 0;
        for (let r = -ry; r < rows; r++) {
          if (r + ry < rows) s += b[(r + ry) * cols + c];
          if (r - ry - 1 >= 0) s -= b[(r - ry - 1) * cols + c];
          if (r >= 0) e[r * cols + c] = s / (2 * ry + 1);
        }
      }
      a = e;
    }
    return a;
  }

  const make = (text) => (tube ? strokes(text) : lightOf(text));
  // each cell of `to` and of `from` (those only in `from` at the end), for a minute turning over
  function join(from, to) {
    const { cols, rows } = dims, where = new Int32Array(cols * rows).fill(-1);
    for (let n = 0; n < from.n; n++) where[from.at[n]] = n;
    const was = new Int32Array(to.n);
    for (let n = 0; n < to.n; n++) {
      was[n] = where[to.at[n]];
      where[to.at[n]] = -1;
    }
    return { from, was, only: from.at.map((i, n) => (where[i] === n ? n : -1)).filter((n) => n >= 0) };
  }
  function setTime(turn) {
    const text = timeText(new Date(), hours);
    if (text === shown && cur && !turn) return;
    const before = cur;
    cur = make(text);
    old = turn && before && !reduced && !STILL ? join(before, cur) : null;
    turnedAt = secs();
    shown = text;
  }
  function layout(d) {
    dims = d;
    gain = onCPU() ? 1 : GPU_GAIN;
    cells.resize(d.cols, d.rows);
    shown = "";
    cur = old = null;
    setTime(false);
    turnedAt = -1e9;
    placed?.({ bottom: bottom * d.H });
  }

  // ---- light to a character ----
  function ink(i, r, g, b, dither) {
    const top = Math.max(r, g, b), full = 1 - Math.exp(-top * 1.5), tone = 0.44 * full * gain, c = i % dims.cols, row = (i / dims.cols) | 0;
    if (tone < 0.012 + 0.016 * hash(c, row, 5)) return;
    const want = tone * (1.2 + (dither ? dither * (hash(c, row, 8) - 0.5) : 0));
    let n = 0;
    while (n < INK.length - 1 && INK[n] < want) n++;
    const hot = 0.3 * smooth(0.65, 1, full), k = Math.min(1, tone / INK[n]), m = k / top;
    cells.putSlot(i, n + 1, (r + (top - r) * hot) * m, (g + (top - g) * hot) * m, (b + (top - b) * hot) * m);
  }
  // how much of the message is at x (0..1 across the screen)
  function messageAt(x, age, tau) {
    if (reduced) return Math.exp(-age / tau);
    const head = age * 0.55;
    return Math.exp(-(((x - head) / 0.12) ** 2)) * (age < 2.4 ? 1 : 0) + 0.6 * smooth(head + 0.02, head - 0.08, x) * Math.exp(-age / tau);
  }

  function drawTube(t, age, lit) {
    const beam = reduced ? 0.5 : (t % BEAM) / BEAM, born = secs() - turnedAt;
    const glow = P.glow, hotC = P.hot, cool = P.cool;
    // what is left of the last minute
    const ghost = old ? 0.9 * Math.exp(-born / 3.5) : 0;
    if (old && ghost > 0.015) {
      for (const n of old.only) {
        const k = ghost * old.from.body[n] * 0.8;
        ink(old.from.at[n], cool[0] * k, cool[1] * k, cool[2] * k, 0);
      }
    } else if (old && born > 4) old = null;
    for (let n = 0; n < cur.n; n++) {
      const s = cur.s[n];
      let d = beam - s;
      if (d < 0) d += 1;
      const a = reduced ? 3 : d * BEAM, hot = reduced ? 0 : Math.exp(-a / 0.3);
      const on = born > 4 ? 1 : smooth(0, 0.15, born / 2.6 - s), core = cur.core[n], wall = cur.wall[n];
      const w = Math.min(1, core * (0.5 + 0.5 * hot) + hot * 0.4 * wall);
      let r = glow[0], g = glow[1], b = glow[2], k = on * (0.62 + 0.5 * Math.exp(-a / 1.8)) * lit;
      if (message) {
        const m = messageAt(((cur.at[n] % dims.cols) * dims.cw) / dims.W, age, message.tau), q = Math.min(1, m * 1.2);
        r += (message.colour[0] - r) * q;
        g += (message.colour[1] - g) * q;
        b += (message.colour[2] - b) * q;
        k *= 1 + 0.7 * m;
      }
      k *= cur.body[n];
      r = (r + (hotC[0] - r) * w) * k;
      g = (g + (hotC[1] - g) * w) * k;
      b = (b + (hotC[2] - b) * w) * k;
      if (ghost > 0.015 && old?.was[n] >= 0) {
        const q = ghost * old.from.body[old.was[n]] * 0.8 * (1 - on);
        r += cool[0] * q;
        g += cool[1] * q;
        b += cool[2] * q;
      }
      ink(cur.at[n], r, g, b, 0);
    }
  }
  function drawLight(t, age, lit) {
    const { cols, cw, ch, W, H } = dims, born = secs() - turnedAt, [A, B] = GRAD;
    if (old && born > 3) old = null;
    const cell = (i, still, moving, u, hot, dither) => {
      const x = ((i % cols) * cw) / W, y = (Math.floor(i / cols) * ch) / H;
      let breathe = 1 + 0.12 * Math.sin(t * 0.8 - x * 5);
      if (eclipse) {
        // uneven light, slowly turning
        const a = Math.atan2(y - 0.43, (x - 0.5) * 1.8);
        breathe = 0.82 + 0.18 * Math.sin(a * 5 + t * 0.25) + 0.12 * Math.sin(a * 13 - t * 0.17);
      }
      let L = (still + moving * breathe) * lit;
      if (eclipse) L *= 1 + 0.08 * Math.sin(t * 0.7);
      if (L < 0.012) return;
      let r = A[0] + (B[0] - A[0]) * u, g = A[1] + (B[1] - A[1]) * u, b = A[2] + (B[2] - A[2]) * u;
      if (message) {
        const m = messageAt(x, age, message.tau), q = Math.min(1, m);
        r += (message.colour[0] - r) * q;
        g += (message.colour[1] - g) * q;
        b += (message.colour[2] - b) * q;
        L *= 1 + 0.75 * m;
      }
      ink(i, (r + (1 - r) * hot) * L, (g + (1 - g) * hot) * L, (b + (1 - b) * hot) * L, dither);
    };
    // a minute turning over: left to right, cell by cell, with a glint where it turns
    const inn = (i) => smooth(0, 0.5, born / 2.2 - 0.55 * (((i % cols) * cw) / W) - (eclipse ? 0 : 0.25 * hash(i % cols, (i / cols) | 0, 9)) + 0.1);
    for (let n = 0; n < cur.n; n++) {
      const i = cur.at[n];
      let still = cur.still[n], moving = cur.moving[n];
      if (old) {
        const k = inn(i), o = old.was[n];
        still = still * k + (o >= 0 ? old.from.still[o] * (1 - k) : 0) + (eclipse ? 0 : 0.25 * k * (1 - k) * Math.min(1, still));
        moving = moving * k + (o >= 0 ? old.from.moving[o] * (1 - k) : 0);
      }
      cell(i, still, moving, cur.u[n], cur.hot[n], cur.dither[n]);
    }
    if (old)
      for (const n of old.only) {
        const i = old.from.at[n], k = 1 - inn(i);
        cell(i, old.from.still[n] * k, old.from.moving[n] * k, old.from.u[n], old.from.hot[n], old.from.dither[n]);
      }
  }
  function frame(t0) {
    if (!dims) return;
    if (timeText(new Date(), hours) !== shown) setTime(true);
    const t = STILL ? STILL_AT : reduced ? 8 : t0, now = secs(), age = message ? now - message.at : 0;
    if (message && age > message.tau * 4 + 3) message = null;
    const lit = 1 + 0.7 * Math.exp(-Math.max(0, now - flashAt) / 0.6);
    cells.clear();
    if (tube) drawTube(t, age, lit);
    else drawLight(t, age, lit);
    // a still has no page around it to hold the date
    if (STILL) {
      const text = dateText(new Date(), hours).toUpperCase().split("").join(" "), c0 = Math.floor(dims.cols / 2 - text.length / 2), r = Math.round(((bottom + 0.1) * dims.H) / dims.ch), ink2 = tube ? P.glow : GRAD[1];
      [...text].forEach((g, k) => cells.putAt(c0 + k, r, g, ink2.map((v) => v * 0.7)));
    }
  }
  startScene({
    label: { tube: "The time as a glowing tube, a beam going slowly round it.", jelly: "The time in glassy, glowing digits.", eclipse: "The time as dark digits with light spilling round their edges." }[kind],
    fps: () => (onCPU() || !tube ? Math.min(15, fps) : fps), // only the beam moves fast enough to need more
    fontPx: (H) => (preview || !onCPU() ? Math.max(4, Math.min(8, Math.min(H, innerWidth) / 128)) : Math.max(7, Math.min(11, Math.min(H, innerWidth) / 105))),
    layout,
    frame,
    sample: cells.sample,
    gpu: cells.gpu,
  });
  return {
    onLayout(fn) {
      placed = fn;
      if (dims) fn({ bottom: bottom * dims.H });
    },
    react(r) {
      if (r.type === "pulse" && Array.isArray(r.colour)) message = { colour: r.colour.map((v) => v / 255), at: secs(), tau: Math.max(1.5, (r.afterglow ?? 6) / 2) };
      else if (r.type === "flash") flashAt = secs();
    },
  };
}
