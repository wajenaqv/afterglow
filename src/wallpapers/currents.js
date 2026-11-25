// Currents: thousands of fine strands rooted on a grid, combed by a slow
// invisible current. Each bends along the flow where it stands, grows where
// the flow is fast and shrinks to nothing where it is still, so ribbons of
// light swell and wander over the dark. After the flow-field screensavers,
// in characters (own maths and colours).
//
// Reactions: a message lets colour into the water, a patch in the app's colour
// carried along by the current, spreading as it fades. Every app with something
// waiting keeps a patch coloured, breathing slowly; rest the cursor on it to
// mark it seen, and the current takes it away. A flash brightens every strand.
//
// The CPU traces the strands and keeps them apart; the GPU draws them
// (currents-gl.js), or the CPU with the same maths (drawStrand, inkCells).
// Options: ?tint=natural|cool|warm|grey|green ?flow=calm|lively

import { params, seeded, hash, HOVER, STILL, STILL_AT, onReaction } from "./common.js";
import { startScene, reduced, smooth as sstep, clamp } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { watchSeen } from "./techy.js";
import { CURRENTS } from "./palettes.js";
import { strandsGL } from "./currents-gl.js";

const HUES = CURRENTS[params.get("tint")] ?? CURRENTS.natural;
const PACE = { calm: 0.55, lively: 1.8 }[params.get("flow")] ?? 1;
const TAU = Math.PI * 2;
const GLYPHS = "|/\\'-._" + ".:-=+*#%@"; // thin strokes by direction, then by light
const cells = cellBuffer(GLYPHS);

// ---- the current: the curl of slowly changing noise ----
const PERM = (() => {
  const rnd = seeded(4711), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return Uint8Array.from([...p, ...p]);
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
// gradient noise, about -1..1
function noise(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx;
  y -= fy;
  z -= fz;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, B = PERM[X + 1] + Y;
  const AA = PERM[A] + Z, AB = PERM[A + 1] + Z, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  return lerp(
    lerp(
      lerp(grad(PERM[AA & 255], x, y, z), grad(PERM[BA & 255], x1, y, z), u),
      lerp(grad(PERM[AB & 255], x, y1, z), grad(PERM[BB & 255], x1, y1, z), u),
      v,
    ),
    lerp(
      lerp(grad(PERM[(AA + 1) & 255], x, y, z1), grad(PERM[(BA + 1) & 255], x1, y, z1), u),
      lerp(grad(PERM[(AB + 1) & 255], x, y1, z1), grad(PERM[(BB + 1) & 255], x1, y1, z1), u),
      v,
    ),
    w,
  );
}
// How far to the right of the main ribbon's middle a point is: one wide ribbon
// always runs down the screen, its bends wandering. Down, because rows of
// characters are nearly twice as far apart as columns: a strand lying flat
// crosses them so seldom that its light pulses (it looked like colour banding),
// a steep one meets a new row every few pixels (owner's observation)
const beside = (x, y, t) => x - MID - WIDE * (0.2 * Math.sin(y * 2.3 - t * 0.04) + 0.1 * Math.sin(y * 4.1 + t * 0.055 + 2));
// the stream function: a stream along the ribbon (its lines run along lines of
// equal distance from the middle), with broad sweeps and faint eddies added, all
// carried slowly across the screen
function psi(x, y, t) {
  const dx = x - 0.018 * t, dy = y + 0.006 * t;
  return 0.48 * WIDE * Math.tanh(beside(x, y, t) / (0.34 * WIDE)) + 0.47 * noise(dx * 0.95, dy * 0.95, t * 0.045) + 0.1 * noise(dx * 2.2 + 31, dy * 2.2 + 7, t * 0.07 + 9);
}

// The field on a coarse grid (it is smooth), read between the nodes
const LEAN = 0.62; // the sideways part of the flow is held back, so few strands lie flat
const G = 0.04; // node spacing, screen heights
let WIDE = 1; // a wide screen gets a wider ribbon
let MID = 1; // where across the screen the ribbon runs
let S = 1; // scale of everything: smaller on a portrait screen
let gw = 0, gh = 0, PS = null, VX = null, VY = null, HU = null, RB = null;
function field(t) {
  const pw = gw + 2; // one node more on every side, for the differences
  for (let j = 0; j < gh + 2; j++) for (let i = 0; i < pw; i++) PS[j * pw + i] = S * psi(((i - 1) * G) / S, ((j - 1) * G) / S, t);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const k = (j + 1) * pw + i + 1, n = j * gw + i;
      VX[n] = (LEAN * (PS[k + pw] - PS[k - pw])) / (2 * G);
      VY[n] = -(PS[k + 1] - PS[k - 1]) / (2 * G);
      // where in the palette: about two neighbouring hues at any moment, the
      // pair moving slowly round the loop (one turn in some seven minutes)
      HU[n] = 0.0024 * t + 0.26 * noise(i * G * 0.7 + 50 - 0.01 * t, j * G * 0.7 + 20, t * 0.03 + 3);
      // where the ribbons are: the rest of the screen stays black
      const off = beside((i * G) / S, (j * G) / S, t) / (0.36 * WIDE);
      RB[n] = Math.min(1, Math.exp(-off * off) + 0.8 * sstep(0.08, 0.35, noise((i * G - 0.02 * t) * 1.1 + 80, j * G * 1.1 + 60, t * 0.035 + 17)));
    }
}
const V = [0, 0, 0, 0];
function flowAt(x, y) {
  const gx = clamp(x / G, 0, gw - 1.001), gy = clamp(y / G, 0, gh - 1.001);
  const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j, n = j * gw + i;
  const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
  V[0] = VX[n] * a + VX[n + 1] * b + VX[n + gw] * c + VX[n + gw + 1] * d;
  V[1] = VY[n] * a + VY[n + 1] * b + VY[n + gw] * c + VY[n + gw + 1] * d;
  V[3] = RB[n] * a + RB[n + 1] * b + RB[n + gw] * c + RB[n + gw + 1] * d;
  V[2] = HU[n] * a + HU[n + 1] * b + HU[n + gw] * c + HU[n + gw + 1] * d;
}

// the same, the direction only
function dirAt(x, y) {
  const gx = clamp(x / G, 0, gw - 1.001), gy = clamp(y / G, 0, gh - 1.001);
  const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j, n = j * gw + i;
  const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
  V[0] = VX[n] * a + VX[n + 1] * b + VX[n + gw] * c + VX[n + gw + 1] * d;
  V[1] = VY[n] * a + VY[n + 1] * b + VY[n + gw] * c + VY[n + gw + 1] * d;
}

// ---- the strands ----
let dims = null, cols = 0, rows = 0, cwH = 0, chH = 0, A = 1.78;
let roots = []; // x, y, length factor, brightness factor
// Room between strands: taken in a fixed (shuffled) order, each marks where it
// runs on a coarse grid; one that runs into strands before it fades out whole
let TAKEN = null, tw = 0, th = 0, TG = 0.01;
let FADE = null, fresh = true; // per strand, 0..1, eased over about a second
// this frame's pieces, for either renderer: x, y, direction, strand * 512 + place
let PIECES = new Float32Array(0), pieces = 0;
// and its strands: r, g, b, light, length, pieces, how white the head, id
let STRANDS = new Float32Array(0), strands = 0;
let USED = null, used = 0, DITHER = null; // the cells drawn this frame; each cell's dither
let OWN = null, SLOT = null, RGB = null; // per cell: whose strand, its direction's character (7 = beside it), its colour
let BEST = null; // per cell: the brightest light so far (strands don't add up: crossings would blot)
function layout(d) {
  dims = d;
  ({ cols, rows, A } = d);
  S = A < 1 ? 0.62 : 1;
  WIDE = A > 1.2 ? 1.65 : 1;
  MID = (A * 0.57) / S; // in units of S, like the stream function
  cwH = d.cw / d.H;
  chH = d.ch / d.H;
  cells.resize(cols, rows);
  BEST = new Float32Array(cols * rows);
  USED = new Int32Array(cols * rows);
  used = 0;
  DITHER = new Float64Array(cols * rows);
  for (let i = 0; i < DITHER.length; i++) DITHER[i] = (hash(i % cols, (i / cols) | 0, 7) - 0.5) / 63;
  OWN = new Int32Array(cols * rows);
  SLOT = new Uint8Array(cols * rows);
  RGB = new Float32Array(cols * rows * 3);
  gw = Math.ceil(A / G) + 2;
  gh = Math.ceil(1 / G) + 2;
  PS = new Float32Array((gw + 2) * (gh + 2));
  VX = new Float32Array(gw * gh);
  VY = new Float32Array(gw * gh);
  HU = new Float32Array(gw * gh);
  RB = new Float32Array(gw * gh);
  // a staggered grid, nudged a little: a plain one shows through as columns
  const rnd = seeded(99), SX = 0.048 * S, SY = 0.043 * S;
  roots = [];
  const list = [];
  for (let j = 0, y = -0.04; y < 1.04; y += SY, j++)
    for (let x = -0.06 + (j % 2) * SX * 0.5; x < A + 0.06; x += SX) list.push([x + (rnd() - 0.5) * SX * 0.5, y + (rnd() - 0.5) * SY * 0.5, 0.75 + 0.5 * rnd(), 0.75 + 0.25 * rnd()]);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  roots = list.flat();
  TG = chH * 1.3;
  tw = Math.ceil(A / TG) + 2;
  th = Math.ceil(1 / TG) + 2;
  TAKEN = new Uint8Array(tw * th);
  FADE = new Float32Array(list.length);
  PIECES = new Float32Array(list.length * 40 * 5);
  STRANDS = new Float32Array(list.length * 8);
  fresh = true;
}

// What changes along a strand, worked out once for each number of pieces m:
// how far the light has risen, its slope, the width (in rows) and the head's white
const PROFILES = new Map();
function profile(m) {
  let p = PROFILES.get(m);
  if (p) return p;
  p = new Float64Array((m + 1) * 4);
  for (let i = 0; i <= m; i++) {
    const fr = i / m;
    p[i * 4] = 0.1 + 0.95 * fr ** 1.3;
    p[i * 4 + 1] = 0.95 * 1.3 * Math.max(fr, 0.02) ** 0.3;
    // thin, and pointed at both ends (wide strokes with blunt heads looked
    // like sausages)
    p[i * 4 + 2] = 0.34 + 0.26 * sstep(0, 0.65, fr) * (1 - sstep(0.75, 1, fr));
    p[i * 4 + 3] = 0.2 * sstep(0.7, 1, fr); // tips run towards white
  }
  PROFILES.set(m, p);
  return p;
}
// the characters by light: RAMP_AT[k] = the light the k-th starts at
const RAMP_AT = Array.from({ length: 9 }, (_, k) => (k / 9) ** (1 / 0.55) / 1.1);
// 1.8 * v ** 0.7 (characters cover little of their cell), from a table
const LIFT_N = 4096, LIFT_MAX = 3;
const LIFT = Float64Array.from({ length: LIFT_N + 2 }, (_, i) => 1.8 * ((i / LIFT_N) * LIFT_MAX) ** 0.7);
function liftAt(v) {
  const x = (Math.min(v, LIFT_MAX) / LIFT_MAX) * LIFT_N, i = x | 0;
  return LIFT[i] + (LIFT[i + 1] - LIFT[i]) * (x - i);
}

// the palette as a loop: k (any number) -> colour
function hue(k, out) {
  const n = HUES.length, f = (((k % 1) + 1) % 1) * n, i = Math.floor(f), u = f - i;
  const a = HUES[i % n], b = HUES[(i + 1) % n];
  for (let q = 0; q < 3; q++) out[q] = a[q] + (b[q] - a[q]) * u; // straight: easing left a flat band at every hue
}
// the character for a thin line through a cell along (dx, dy), fy down the cell
const steep = (dx, dy) => Math.abs(dy) > 0.9 * Math.abs(dx);
function glyph(dx, dy, fy) {
  if (steep(dx, dy)) return Math.abs(dy) > 2.9 * Math.abs(dx) ? 0 : dx * dy > 0 ? 2 : 1;
  return fy < 0.3 ? 3 : fy < 0.68 ? 4 : fy < 0.86 ? 5 : 6;
}

// ---- reactions ----
// Times are real seconds, so a reaction fades at reduced motion too
const now = () => performance.now() / 1000;
let lanterns = []; // { source, colour, i, born }
let dyes = []; // { x, y, colour, t0, tau }
let flashAt = -1e9, spot = 0;
const release = (x, y, colour, tau) => {
  dyes.push({ x, y, colour, t0: now(), tau });
  if (dyes.length > 8) dyes.shift();
};
// clear of the left fifth; the golden ratio keeps them apart
function place(i) {
  return [A * (0.28 + 0.62 * ((i * 0.618 + 0.42) % 1)), 0.2 + 0.6 * ((i * 0.381 + 0.3) % 1)];
}
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    const l = lanterns.find((l) => l.source === r.source); // from its own patch, or clear of the waiting ones
    const [x, y] = place(l ? l.i : 8 + (spot++ % 5));
    release(x, y, r.colour.map((v) => v / 255), Math.max(2, r.afterglow ?? 6));
  } else if (r.type === "flash") flashAt = now();
  else if (r.type === "lanterns") {
    const next = (Array.isArray(r.items) ? r.items : []).filter((l) => Array.isArray(l.colour)).slice(0, 8);
    // seen: the current carries its colour off
    for (const l of lanterns) if (!next.some((n) => n.source === l.source)) release(...place(l.i), l.colour, 3);
    // an app keeps its place while others come and go
    const kept = next.map((n) => lanterns.find((l) => l.source === n.source));
    const taken = new Set(kept.filter(Boolean).map((l) => l.i));
    lanterns = next.map((n, k) => {
      let i = kept[k]?.i;
      if (i == null) {
        for (i = 0; taken.has(i); ) i++;
        taken.add(i);
      }
      return { source: n.source, colour: n.colour.map((v) => v / 255), i, born: kept[k]?.born ?? now() };
    });
  }
});

// ---- the CPU renderer (currents-gl.js is its GPU twin: keep them in step) ----
function drawCPU() {
  cells.clear();
  // only the cells drawn last time need clearing
  for (let i = 0; i < used; i++) BEST[USED[i]] = 0;
  used = 0;
  for (let n = 0, p = 0; n < strands; n++) p = drawStrand(n, p);
  inkCells();
}
// each short straight piece of strand n (the first at PIECES[p]), by the cells'
// distance from its line (round dots along it left beads). A cell keeps the
// brightest light that reaches it
function drawStrand(n, p) {
  const q = n * 8, b0 = STRANDS[q], b1 = STRANDS[q + 1], b2 = STRANDS[q + 2], light = STRANDS[q + 3], len = STRANDS[q + 4], m = STRANDS[q + 5], white = STRANDS[q + 6];
  const prof = profile(m), step = chH * 1.1, reach = step * 0.62;
  for (let s = 0; s <= m; s++, p += 5) {
    const x = PIECES[p], y = PIECES[p + 1], dx = PIECES[p + 2], dy = PIECES[p + 3];
    const t = s * 4, L0 = light * prof[t], slope = (light * prof[t + 1]) / len, w = chH * prof[t + 2];
    const iw = 1 / (w * w), hx = Math.abs(dx) * step * 0.5 + w * 1.6, hy = Math.abs(dy) * step * 0.5 + w * 1.6;
    const c0 = Math.max(0, Math.floor((x - hx) / cwH)), c1 = Math.min(cols - 1, Math.floor((x + hx) / cwH));
    const r0 = Math.max(0, Math.floor((y - hy) / chH)), r1 = Math.min(rows - 1, Math.floor((y + hy) / chH));
    const hot = prof[t + 3] * white, dir = glyph(dx, dy, y / chH - Math.floor(y / chH));
    for (let r = r0; r <= r1; r++) {
      const ey = (r + 0.5) * chH - y;
      for (let c = c0, i = r * cols + c0; c <= c1; c++, i++) {
        const ex = (c + 0.5) * cwH - x, al = ex * dx + ey * dy;
        if (al > reach || al < -reach) continue;
        const pe = ex * dy - ey * dx, e2 = pe * pe * iw;
        if (e2 > 2.6) continue;
        const most = L0 + slope * al, best = BEST[i];
        if (most < 0.045 || most <= best) continue; // (exp is at most 1: it can't win)
        const v = most * Math.exp(-e2);
        if (v < 0.045 || v <= best) continue;
        if (best === 0) USED[used++] = i;
        BEST[i] = v;
        OWN[i] = n;
        SLOT[i] = e2 < 0.8 ? dir : 7;
        const h = hot * v, j = i * 3;
        RGB[j] = b0 + (1 - b0) * h;
        RGB[j + 1] = b1 + (1 - b1) * h;
        RGB[j + 2] = b2 + (1 - b2) * h;
      }
    }
  }
  return p;
}
// where a brighter strand touches, the dimmer one gives way: its edge goes
// dark, its middle sinks back, so strands never run into each other. Then
// light becomes characters
function inkCells() {
  const N = BEST.length, around = [-cols - 1, -cols, -cols + 1, -1, 1, cols - 1, cols, cols + 1];
  for (let u = 0; u < used; u++) {
    const i = USED[u], own = OWN[i], slot = SLOT[i];
    let v = BEST[i], touched = false;
    for (let q = 0; q < 8; q++) {
      const j = i + around[q];
      if (j >= 0 && j < N && BEST[j] > v && OWN[j] !== own) {
        touched = true;
        break;
      }
    }
    if (touched) {
      if (slot === 7) continue;
      v *= 0.35;
    }
    // dense characters early on: the colour carries the fade, so a strand reads
    // as one solid stroke (evening out the light per character instead took
    // away its thin outline and bright head)
    let g = slot;
    if (v >= 0.13 || slot === 7) for (g = 7; g < 15 && v >= RAMP_AT[g - 6]; ) g++;
    const lift = liftAt(v), j = i * 3;
    let r = RGB[j] * lift, gr = RGB[j + 1] * lift, b = RGB[j + 2] * lift;
    // Brighter than full: all three channels come down together, easing in,
    // and the rest goes towards white. (Cut off one by one they shifted the
    // hue: a blue strand banded blue, mint, grey.)
    const top = Math.max(r, gr, b);
    if (top >= 0.75) {
      const held = 1 - 0.25 * Math.exp((0.75 - top) / 0.25), k = held / top, white = 0.6 * (1 - Math.exp((held - top) / 0.8));
      r = r * k + (1 - r * k) * white;
      gr = gr * k + (1 - gr * k) * white;
      b = b * k + (1 - b * k) * white;
    }
    // cells.js keeps colours in steps of 4: dithered, so fades don't band
    const d = DITHER[i];
    cells.putSlot(i, g + 1, r + d, gr + d, b + d);
  }
}

let lastT = null, frameNo = 0;
function frame(t) {
  if (!dims) return;
  const T = (STILL ? STILL_AT : reduced ? 40 : t) * PACE, real = now();
  field(T);
  TAKEN.fill(0);
  const dt = lastT == null ? 0 : clamp(t - lastT, 0, 0.1);
  lastT = t;
  frameNo++;
  dyes = dyes.filter((d) => real - d.t0 < d.tau * 3);
  for (const d of dyes) {
    flowAt(d.x, d.y);
    d.x += V[0] * 0.03 * dt;
    d.y += V[1] * 0.03 * dt;
  }
  const flash = 0.8 * Math.exp(-Math.max(0, real - flashAt) / 0.7);
  // patches of colour: x, y, 1/radius^2, strength, colour
  const patches = [];
  for (const l of lanterns) {
    const [x, y] = place(l.i);
    const k = sstep(0, 1.2, real - l.born) * (0.86 + 0.14 * Math.sin(((real - l.born) * TAU) / 5));
    patches.push([x, y, 1 / 0.13 ** 2, k, l.colour]);
  }
  for (const d of dyes) {
    const s = real - d.t0, rad = 0.12 + 0.16 * (1 - Math.exp(-s / d.tau));
    patches.push([d.x, d.y, 1 / rad ** 2, Math.min(1, s / 0.5) * Math.exp(-((s / d.tau) ** 1.5)), d.colour]);
  }

  pieces = strands = 0;
  const base = [0, 0, 0], ease = 1 - Math.exp(-dt / 0.8), easeHidden = 1 - Math.exp((-6 * dt) / 0.8);
  for (let n = 0; n < roots.length; n += 4) {
    let x = roots[n], y = roots[n + 1];
    flowAt(x, y);
    const sp = Math.sqrt(V[0] * V[0] + V[1] * V[1]), sin = V[1] / (sp || 1);
    // the desktop icons' fifth stays quiet
    const quiet = 0.22 + 0.78 * sstep(0.1 * A, 0.3 * A, x);
    let k = sstep(0.2, 1, sp) * V[3] * quiet;
    hue(V[2] + 0.04 * sin, base);
    // a patch: its own colour in the middle, the strands around it dimmed, so
    // it stands out from any palette
    let lit = 0, dim = 1;
    for (const [px, py, inv, s, c] of patches) {
      const d2 = ((x - px) ** 2 + (y - py) ** 2) * inv;
      if (d2 > 9) continue;
      const w = Math.min(1, s * 1.3) * sstep(1.25, 0.65, Math.sqrt(d2));
      dim *= 1 - 0.75 * s * Math.exp(-d2 / 3) * (1 - w);
      lit = Math.max(lit, w);
      for (let q = 0; q < 3; q++) base[q] += (c[q] - base[q]) * w;
      k = Math.max(k, 0.95 * w); // it shows in still water too
    }
    k = Math.min(1.5, k * (1 + flash) + 0.15 * flash);
    if (k < 0.03) continue;
    // one that has faded out looks for room again every sixth frame (0.3 s)
    if (!fresh && FADE[n / 4] < 0.02 && (n / 4 + frameNo) % 6) continue;
    const len = 0.27 * S * Math.min(1.2, k) * roots[n + 2];
    let light = (0.42 + 0.63 * Math.min(1, k)) * roots[n + 3] * (1 + 0.5 * flash) * dim * (1 + 0.35 * lit);

    // walk along the flow from root to tip like a brush stroke: thin and dark
    // at the root, wide and bright at the tip. A cell keeps the brightest
    // light that reaches it
    const step = chH * 1.1, steps = Math.max(2, Math.ceil(len / step));
    const m = Math.min(steps, 299), p0 = pieces * 5;
    if (p0 + 1500 > PIECES.length) {
      const more = new Float32Array(PIECES.length * 2 + 1500);
      more.set(PIECES);
      PIECES = more;
    }
    let hits = 0, seen = 0;
    for (let s = 0, p = p0; s <= m; s++, p += 5) {
      dirAt(x, y);
      const v = Math.sqrt(V[0] * V[0] + V[1] * V[1]) || 1, dx = V[0] / v, dy = V[1] / v;
      PIECES[p] = x;
      PIECES[p + 1] = y;
      PIECES[p + 2] = dx;
      PIECES[p + 3] = dy;
      PIECES[p + 4] = strands * 512 + s;
      if (s > m * 0.25) {
        // (the dark root doesn't matter)
        const i = (Math.floor(y / TG) + 1) * tw + Math.floor(x / TG) + 1;
        seen++;
        if (x >= 0 && x < A && y >= 0 && y < 1 && TAKEN[i]) hits++;
      }
      x += dx * step;
      y += dy * step;
    }
    const id = n / 4, want = 1 - sstep(0.12, 0.4, hits / Math.max(1, seen));
    FADE[id] = fresh ? want : FADE[id] + (want - FADE[id]) * (FADE[id] < 0.02 ? easeHidden : ease);
    if (want > 0.5)
      for (let s = Math.ceil(m * 0.25); s <= m; s++) {
        const tx = Math.floor(PIECES[p0 + s * 5] / TG) + 1, ty = Math.floor(PIECES[p0 + s * 5 + 1] / TG) + 1;
        if (tx < 1 || ty < 1 || tx >= tw - 1 || ty >= th - 1) continue;
        const i = ty * tw + tx;
        TAKEN[i] = TAKEN[i - 1] = TAKEN[i + 1] = TAKEN[i - tw] = TAKEN[i + tw] = 1;
      }
    light *= FADE[id];
    if (light < 0.05) continue;

    // (a strand it doesn't draw leaves its pieces to be written over)
    const q = strands * 8;
    STRANDS[q] = base[0];
    STRANDS[q + 1] = base[1];
    STRANDS[q + 2] = base[2];
    STRANDS[q + 3] = light;
    STRANDS[q + 4] = len;
    STRANDS[q + 5] = m;
    STRANDS[q + 6] = (1 - 0.8 * lit) * Math.min(1, k);
    STRANDS[q + 7] = n / 4;
    strands++;
    pieces += m + 1;
  }
  fresh = false;
  if (document.documentElement.dataset.renderer !== "gpu") drawCPU();
  if (HOVER) watchSeen(lanterns, (l) => place(l.i), dims.H, 0.09);
}

// Without a usable GPU every character is drawn as text, which is dear: larger
// characters and fewer frames (owner, 2026-11-25). ?fine keeps the GPU's size,
// to compare the two renderers
const onCPU = () => document.documentElement.dataset.renderer !== "gpu" && !params.has("fine");

startScene({
  label: "Fine strands of light combed by a slow invisible current, swelling into ribbons and shrinking away over the dark.",
  fps: () => (onCPU() ? 15 : 20), // the motion is slow
  layout,
  frame,
  // finer than the default: the strands look silkier
  fontPx: (H) => (onCPU() ? Math.max(7, Math.min(11, Math.min(H, innerWidth) / 105)) : Math.max(5, Math.min(7, Math.min(H, innerWidth) / 150))),
  sample: cells.sample,
  gpu: strandsGL(GLYPHS, () => ({ pieces: PIECES, count: pieces, strands: STRANDS, strandCount: strands, cwH, chH })),
});
