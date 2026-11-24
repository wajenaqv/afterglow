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
// - The date glows underneath, drawn as light like the rest (text rendered
//   once a minute into a bitmap, averaged per character cell), not as a line
//   of page text.
//
// Phosphor colour: from the clock's palette menu (?tint=: natural -> P7, a
// blue-white flash cooling to yellow-green like a radar screen; green -> P1;
// warm -> amber P3; cool -> blue; grey -> white P4), or ?phosphor= directly.
// Reactions: a pulse rewrites the digits in the app's colour, which cools back
// into the phosphor over the afterglow; a flash lights the whole tube.
//
// One piece of maths twice: `light` (JS, the CPU renderer) and the GLSL below
// (the GPU renderer). Per-frame values are worked out once in `update` and
// shared by both. Units: screen heights, y down, like every night scene.

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
const MAXSEG = 64; // "88:88" is 64 segments, the most any time needs

const PHOSPHORS = {
  //        hot (beam head)      glow (persistence)    cool (old digits)
  green: { hot: [0.8, 1, 0.9], glow: [0.2, 1, 0.45], cool: [0.05, 0.45, 0.2] },
  amber: { hot: [1, 0.92, 0.7], glow: [1, 0.62, 0.12], cool: [0.55, 0.2, 0.03] },
  p7: { hot: [0.7, 0.82, 1], glow: [0.62, 1, 0.3], cool: [0.75, 0.55, 0.08] },
  blue: { hot: [0.85, 0.92, 1], glow: [0.3, 0.6, 1], cool: [0.1, 0.18, 0.55] },
  white: { hot: [1, 1, 1], glow: [0.78, 0.84, 0.95], cool: [0.3, 0.32, 0.42] },
};
const BY_TINT = { natural: "p7", green: "green", warm: "amber", cool: "blue", grey: "white" };
const P = PHOSPHORS[params.get("phosphor")] ?? PHOSPHORS[BY_TINT[params.get("tint")]] ?? PHOSPHORS.p7;
const HOURS = ["12", "24"].includes(params.get("hours")) ? params.get("hours") : "auto";
const SIZE = Math.min(1.6, Math.max(0.5, parseFloat(params.get("size")) || 1));

const REFRESH = 3.2; // seconds for the beam to retrace everything
const HOLD = 1.6; // how long the glow takes to cool after the beam passes
const FADE = 9; // how long the old digits take to fade (seconds, e-folding)
const HEAD = 0.07; // how long the beam's hot head lasts at a point

// ---- layout: the text as segments along the beam's path ----
// Always one line, "4:43", fitted to the width as well as the height (sized
// by height alone, it ran off the sides of a portrait monitor; hours stacked
// above minutes was tried there and the owner preferred one line).
function build(text, A, cy = 0.43) {
  const lines = [text];
  const lineW = (line) => [...line].reduce((w, c) => w + (c === ":" ? 0.3 : 1 / 1.4), 0) + 0.3 * (line.length - 1); // in digit heights
  const hd = Math.min(0.25 * SIZE, (0.86 * A) / Math.max(...lines.map(lineW))); // digit height
  const dw = hd / 1.4;
  const gap = hd * 0.3, colon = hd * 0.3, rowGap = hd * 0.35;
  const blockH = lines.length * hd + (lines.length - 1) * rowGap;
  const segs = [], dots = [];
  let s = 0, left = A, right = 0;
  lines.forEach((line, row) => {
    const total = lineW(line) * hd;
    let x = A / 2 - total / 2;
    left = Math.min(left, x);
    right = Math.max(right, x + total);
    const top = cy - blockH / 2 + row * (hd + rowGap);
    [...line].forEach((c) => {
      if (c === ":") {
        for (const fy of [0.42, 1.0]) dots.push({ x: x + colon / 2, y: top + (fy / 1.4) * hd, s });
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
      x += (c === ":" ? colon : dw) + gap;
    });
  });
  // stroke half-width: a share of the digit, but never thinner than about a
  // character row, so narrow (portrait) screens keep bold strokes
  return { segs: segs.slice(0, MAXSEG), dots, L: s, w: Math.max(hd * 0.045, 0.0072), box: [left, cy - blockH / 2, right, cy + blockH / 2] };
}

// ---- state, worked out once per frame (shared by the CPU and GPU) ----
let A = 16 / 9;
let text = "", cur = null, old = null, ghost = null;
let turnAt = -1e9, nowT = 0;
let pulse = null, flashAt = -1e9;
const F = { since: 0, speed: 1, hot: P.hot, glow: P.glow, oldK: 0, oldCol: P.cool, flash: 0, rev: 0 };
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
    F.rev++;
    onText?.();
  }
  F.since = t - turnAt;
  F.speed = cur.L / REFRESH;
  const pk = pulse ? Math.max(0, 1 - (t - pulse.at) / pulse.life) : 0;
  if (pulse && pk <= 0) pulse = null;
  F.hot = pk > 0 ? pulse.col.map((v, i) => v + (P.hot[i] - v) * (1 - pk)) : P.hot;
  // the app's colour holds, then cools back into the phosphor (mixing early
  // turned red on green into orange)
  F.glow = pk > 0 ? pulse.col.map((v, i) => v + (P.glow[i] - v) * (1 - pk) ** 1.6) : P.glow;
  F.oldK = old ? Math.exp(-(t - turnAt) / FADE) : 0;
  if (old && F.oldK < 0.01) {
    old = null;
    F.oldK = 0;
    F.rev++;
  }
  F.oldCol = P.glow.map((v, i) => v + (P.cool[i] - v) * (1 - F.oldK));
  const f = Math.max(0, 1 - (t - flashAt) / 0.5);
  F.flash = f * f * 0.6;
}
let onText = null;
onReaction((r) => {
  if (reduced) return;
  if (r.type === "pulse" && Array.isArray(r.colour)) pulse = { col: r.colour.map((v) => v / 255), at: nowT, life: Math.max(3, (r.afterglow || 4) + 2) };
  else if (r.type === "flash") flashAt = nowT;
});

// ---- the date, as light: average coverage of its text per character cell ----
const DATE = { c0: 0, r0: 0, nc: 0, nr: 0, v: new Float32Array(0), label: "", rev: 0 };
function buildDate(dims) {
  const label = dateText(new Date(), HOURS);
  if (!dims || !cur) return;
  // big enough that each letter is several character rows tall (smaller, the
  // letters smeared into blobs)
  // ... and never wider than the screen (a portrait monitor cut it off)
  const fpx = Math.min(Math.max(7 * dims.ch, 0.055 * dims.H * SIZE), (0.9 * dims.W) / (label.length * 0.62));
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const font = `600 ${fpx}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
  c.font = font;
  const tw = c.measureText(label).width;
  const left = (dims.W - tw) / 2, top = (cur.box[3] + 0.07 * SIZE) * dims.H;
  const c0 = Math.max(0, Math.floor(left / dims.cw) - 1), r0 = Math.max(0, Math.floor(top / dims.ch) - 1);
  const nc = Math.min(dims.cols - c0, Math.ceil(tw / dims.cw) + 3), nr = Math.min(dims.rows - r0, Math.ceil((fpx * 1.3) / dims.ch) + 2);
  if (nc <= 0 || nr <= 0) return;
  const pw = Math.ceil(nc * dims.cw), ph = Math.ceil(nr * dims.ch);
  c.canvas.width = pw;
  c.canvas.height = ph;
  c.font = font;
  c.textBaseline = "top";
  c.fillStyle = "#fff";
  c.fillText(label, left - c0 * dims.cw, top - r0 * dims.ch);
  const px = c.getImageData(0, 0, pw, ph).data;
  const v = new Float32Array(nc * nr);
  for (let r = 0; r < nr; r++)
    for (let k = 0; k < nc; k++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r * dims.ch); y < Math.min(ph, Math.floor((r + 1) * dims.ch)); y++)
        for (let x = Math.floor(k * dims.cw); x < Math.min(pw, Math.floor((k + 1) * dims.cw)); x++) {
          sum += px[(y * pw + x) * 4 + 3];
          n++;
        }
      v[r * nc + k] = n ? sum / n / 255 : 0;
    }
  Object.assign(DATE, { c0, r0, nc, nr, v, label, rev: DATE.rev + 1 });
}
const dateLight = (v) => Math.min(1, Math.max(0, (v - 0.08) / 0.5)) * 0.55;

const mod = (a, b) => ((a % b) + b) % b;
function seg(x, y, g) {
  const dx = g.bx - g.ax, dy = g.by - g.ay;
  const h = Math.max(0, Math.min(1, ((x - g.ax) * dx + (y - g.ay) * dy) / (dx * dx + dy * dy || 1e-9)));
  return [Math.hypot(x - g.ax - dx * h, y - g.ay - dy * h), h];
}
// a glowing tube: a bright core and a tight halo (a wide halo turned into a
// grey block of faint characters around each digit)
const tube = (d, w) => Math.exp(-((d / w) ** 2)) + 0.1 * Math.exp(-d / (w * 1.8));

/** The light at (x, y); cell (optional) for the date */
function light(x, y, out, cell) {
  out[0] = out[1] = out[2] = 0;
  if (!cur) return;
  if (cell && DATE.nc) {
    const k = cell[0] - DATE.c0, r = cell[1] - DATE.r0;
    if (k >= 0 && r >= 0 && k < DATE.nc && r < DATE.nr) {
      const v = dateLight(DATE.v[r * DATE.nc + k]);
      for (let i = 0; i < 3; i++) out[i] += P.glow[i] * v;
    }
  }
  const [bx0, by0, bx1, by1] = cur.box;
  const w = cur.w, m = w * 14;
  if (x < bx0 - m || x > bx1 + m || y < by0 - m || y > by1 + m) return;
  let g = 0, h = 0;
  const point = (d, s) => {
    if (d > m || F.since * F.speed < s) return; // too far, or not written yet
    const age = F.since < REFRESH ? F.since - s / F.speed : mod(F.since - s / F.speed, REFRESH);
    const f = tube(d, w);
    // the brightest stroke wins (adding them made beads where strokes meet)
    g = Math.max(g, f * (0.32 + 0.68 * Math.exp(-age / HOLD)));
    h = Math.max(h, f * Math.exp(-age / HEAD));
  };
  for (const sg of cur.segs) {
    if (x < sg.x0 - m || x > sg.x1 + m || y < sg.y0 - m || y > sg.y1 + m) continue;
    const [d, k] = seg(x, y, sg);
    point(d, sg.s + k * sg.len);
  }
  for (const dt of cur.dots) point(Math.max(0, Math.hypot(x - dt.x, y - dt.y) - w * 0.6), dt.s);
  for (let i = 0; i < 3; i++) out[i] += F.glow[i] * g + F.hot[i] * h * 1.4;
  if (old) {
    let o = 0;
    for (const sg of old.segs) {
      if (x < sg.x0 - m || x > sg.x1 + m || y < sg.y0 - m || y > sg.y1 + m) continue;
      o = Math.max(o, tube(seg(x, y, sg)[0], w));
    }
    for (const dt of old.dots) o = Math.max(o, tube(Math.max(0, Math.hypot(x - dt.x, y - dt.y) - w * 0.6), w));
    for (let i = 0; i < 3; i++) out[i] += F.oldCol[i] * o * 0.6 * F.oldK;
  }
  let b = 0;
  for (const sg of ghost.segs) {
    if (x < sg.x0 - w * 2 || x > sg.x1 + w * 2 || y < sg.y0 - w * 2 || y > sg.y1 + w * 2) continue;
    b = Math.max(b, Math.exp(-((seg(x, y, sg)[0] / w) ** 2)));
  }
  for (let i = 0; i < 3; i++) out[i] += P.glow[i] * b * 0.05 + P.glow[i] * F.flash * Math.min(1, g + b);
}

// ---- the GPU renderer: the same maths in GLSL ----
const f5 = (v) => v.toFixed(5);
const GLSL = `
uniform sampler2D uSegs; // row 0: current (ax, ay, bx, by), row 1: current (s, len), row 2: old, row 3: the 88:88
uniform sampler2D uDate; // the date's coverage per cell
uniform ivec4 uDateRect; // c0, r0, nc, nr
uniform int uNCur, uNOld, uNGhost;
uniform vec3 uDot[2], uOldDot[2]; // the colon: x, y, s
uniform vec4 uBox;
uniform float uW, uSince, uSpeed, uOldK, uFlash;
uniform vec3 uHot, uGlow, uOldCol, uPGlow;
const float REFRESH = ${f5(REFRESH)}, HOLD = ${f5(HOLD)}, HEAD = ${f5(HEAD)};
float tube(float d, float w) { return exp(-(d / w) * (d / w)) + 0.1 * exp(-d / (w * 1.8)); }
vec2 seg(vec2 p, vec4 g) {
  vec2 a = g.xy, e = g.zw - g.xy;
  float h = clamp(dot(p - a, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
  return vec2(length(p - a - e * h), h);
}
float fmod2(float a, float b) { return a - b * floor(a / b); }
vec3 sampleCell(vec2 P) {
  vec2 cs = uCell / uH;
  ivec2 cell = ivec2(floor(P / cs));
  vec2 p = (vec2(cell) + 0.5) * cs;
  vec3 col = vec3(0.0);
  ivec2 dc = cell - uDateRect.xy;
  if (dc.x >= 0 && dc.y >= 0 && dc.x < uDateRect.z && dc.y < uDateRect.w) {
    float v = texelFetch(uDate, dc, 0).r;
    col += uPGlow * clamp((v - 0.08) / 0.5, 0.0, 1.0) * 0.55;
  }
  float w = uW, m = w * 14.0;
  if (p.x < uBox.x - m || p.x > uBox.z + m || p.y < uBox.y - m || p.y > uBox.w + m) return col;
  float g = 0.0, h = 0.0;
  for (int i = 0; i < ${MAXSEG}; i++) {
    if (i >= uNCur) break;
    vec4 sg = texelFetch(uSegs, ivec2(i, 0), 0);
    vec2 sl = texelFetch(uSegs, ivec2(i, 1), 0).xy;
    vec2 dk = seg(p, sg);
    float s = sl.x + dk.y * sl.y;
    if (dk.x > m || uSince * uSpeed < s) continue;
    float age = uSince < REFRESH ? uSince - s / uSpeed : fmod2(uSince - s / uSpeed, REFRESH);
    float f = tube(dk.x, w);
    g = max(g, f * (0.32 + 0.68 * exp(-age / HOLD)));
    h = max(h, f * exp(-age / HEAD));
  }
  for (int i = 0; i < 2; i++) {
    float d = max(0.0, length(p - uDot[i].xy) - w * 0.6);
    float s = uDot[i].z;
    if (d > m || uSince * uSpeed < s) continue;
    float age = uSince < REFRESH ? uSince - s / uSpeed : fmod2(uSince - s / uSpeed, REFRESH);
    float f = tube(d, w);
    g = max(g, f * (0.32 + 0.68 * exp(-age / HOLD)));
    h = max(h, f * exp(-age / HEAD));
  }
  col += uGlow * g + uHot * h * 1.4;
  if (uOldK > 0.0) {
    float o = 0.0;
    for (int i = 0; i < ${MAXSEG}; i++) {
      if (i >= uNOld) break;
      o = max(o, tube(seg(p, texelFetch(uSegs, ivec2(i, 2), 0)).x, w));
    }
    for (int i = 0; i < 2; i++) o = max(o, tube(max(0.0, length(p - uOldDot[i].xy) - w * 0.6), w));
    col += uOldCol * o * 0.6 * uOldK;
  }
  float b = 0.0;
  for (int i = 0; i < ${MAXSEG}; i++) {
    if (i >= uNGhost) break;
    float d = seg(p, texelFetch(uSegs, ivec2(i, 3), 0)).x;
    b = max(b, exp(-(d / w) * (d / w)));
  }
  col += uPGlow * b * 0.05 + uPGlow * uFlash * min(1.0, g + b);
  return col;
}`;

let glSegs = null, glDate = null, segRev = -1, dateRev = -1;
const gpu = {
  glsl: GLSL,
  bind(gl, u, unit) {
    if (!cur) return;
    if (!glSegs) {
      glSegs = gl.createTexture();
      glDate = gl.createTexture();
      for (const t of [glSegs, glDate]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }
    if (segRev !== F.rev) {
      segRev = F.rev;
      const data = new Float32Array(MAXSEG * 4 * 4);
      const put = (row, i, a, b, c, d) => data.set([a, b, c, d], (row * MAXSEG + i) * 4);
      cur.segs.forEach((s, i) => (put(0, i, s.ax, s.ay, s.bx, s.by), put(1, i, s.s, s.len, 0, 0)));
      (old?.segs ?? []).forEach((s, i) => put(2, i, s.ax, s.ay, s.bx, s.by));
      ghost.segs.forEach((s, i) => put(3, i, s.ax, s.ay, s.bx, s.by));
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, glSegs);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAXSEG, 4, 0, gl.RGBA, gl.FLOAT, data);
    }
    if (dateRev !== DATE.rev && DATE.nc) {
      dateRev = DATE.rev;
      const bytes = new Uint8Array(DATE.nc * DATE.nr);
      DATE.v.forEach((v, i) => (bytes[i] = Math.round(v * 255)));
      gl.activeTexture(gl.TEXTURE0 + unit + 1);
      gl.bindTexture(gl.TEXTURE_2D, glDate);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, DATE.nc, DATE.nr, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, glSegs);
    gl.uniform1i(u.uSegs, unit);
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    gl.bindTexture(gl.TEXTURE_2D, glDate);
    gl.uniform1i(u.uDate, unit + 1);
    gl.uniform4i(u.uDateRect, DATE.c0, DATE.r0, DATE.nc, DATE.nr);
    gl.uniform1i(u.uNCur, cur.segs.length);
    gl.uniform1i(u.uNOld, old ? old.segs.length : 0);
    gl.uniform1i(u.uNGhost, ghost.segs.length);
    const dots = (d) => [0, 1].flatMap((i) => (d?.[i] ? [d[i].x, d[i].y, d[i].s] : [-9, -9, 0]));
    gl.uniform3fv(u["uDot[0]"], dots(cur.dots));
    gl.uniform3fv(u["uOldDot[0]"], dots(old?.dots));
    gl.uniform4f(u.uBox, ...cur.box);
    gl.uniform1f(u.uW, cur.w);
    gl.uniform1f(u.uSince, F.since);
    gl.uniform1f(u.uSpeed, F.speed);
    gl.uniform1f(u.uOldK, F.oldK);
    gl.uniform1f(u.uFlash, F.flash);
    gl.uniform3f(u.uHot, ...F.hot);
    gl.uniform3f(u.uGlow, ...F.glow);
    gl.uniform3f(u.uOldCol, ...F.oldCol);
    gl.uniform3f(u.uPGlow, ...P.glow);
  },
};

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
    if (Math.abs(A - w / hgt) > 1e-6) (A = w / hgt), (text = ""), (cur = null);
    update((ms - t0) / 1000);
    const img = ctx.createImageData(w, hgt);
    for (let j = 0; j < hgt; j++)
      for (let i = 0; i < w; i++) {
        light((i / w) * A, j / hgt, o);
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
  const relayout = () => {
    buildDate(dims);
    if (DATE.nr) onLayout?.({ bottom: (DATE.r0 + DATE.nr) * dims.ch });
  };
  onText = () => dims && relayout(); // the date can change with the minute
  startScene({
    label: "The time drawn by the beam of a glowing CRT: the beam retraces the digits, and old digits fade slowly when the minute turns. The date glows underneath.",
    fps: 30,
    layout: (d) => {
      dims = d;
      A = d.A;
      text = "";
      cur = null;
      old = null;
      update(nowT);
    },
    frame: (t) => update(reduced ? 20 : t),
    sample: (X, Y, t, cell) => {
      light(X, Y, out, cell);
      return [out, null];
    },
    gpu,
  });
}
