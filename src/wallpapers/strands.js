// Strands: thin pointed strokes of dense characters that follow a field, the
// look of currents and magnet. A scene says where each strand starts, how long
// and bright it is and which way the field runs; this traces it, keeps strands
// apart (one that would run into another fades out whole) and draws them, on
// the GPU (strands-gl.js) or on the CPU with the same maths.
//
//   layoutStrands(dims, count, most) from the scene's layout(): ids run below count,
//                                    at most `most` are drawn at once (a GPU
//                                    texture row each: keep it under 16384)
//   beginStrands(dt)                 each frame, then for every strand
//   if (!sittingOut(id)) addStrand(id, x, y, length, light, colour, white, dir)
//                                    dir(x, y) puts the field in V[0], V[1];
//                                    false ends the strand there
//   endStrands()
//   startScene({ ..., ...STRAND_SCENE })
//
// Lengths in screen heights; the order strands are added decides who gets the room.

import { params, hash } from "./common.js";
import { smooth as sstep, clamp } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { strandsGL } from "./strands-gl.js";

export const GLYPHS = "|/\\'-._" + ".:-=+*#%@"; // thin strokes by direction, then by light
const cells = cellBuffer(GLYPHS);


export const V = [0, 0, 0, 0]; // a scene's field at a point, for addStrand's dir()

let cols = 0, rows = 0, cwH = 0, chH = 0, A = 1.78, frameNo = 0, ease = 1, easeHidden = 1;
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

export function layoutStrands(d, count, most = count) {
  ({ cols, rows, A } = d);
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
  TG = chH * 1.3;
  tw = Math.ceil(A / TG) + 2;
  th = Math.ceil(1 / TG) + 2;
  TAKEN = new Uint8Array(tw * th);
  FADE = new Float32Array(count);
  PIECES = new Float32Array(most * 40 * 5);
  STRANDS = new Float32Array(most * 8);
  fresh = true;
}
export function beginStrands(dt) {
  TAKEN.fill(0);
  frameNo++;
  pieces = strands = 0;
  ease = 1 - Math.exp(-dt / 0.8);
  easeHidden = 1 - Math.exp((-6 * dt) / 0.8);
}
// one that has faded out looks for room again every sixth frame (0.3 s)
export const sittingOut = (id) => !fresh && FADE[id] < 0.02 && (id + frameNo) % 6 !== 0;
export function addStrand(id, x, y, len, light, base, white, dir) {
  // walk along the flow from root to tip like a brush stroke: thin and dark
  // at the root, wide and bright at the tip. A cell keeps the brightest
  // light that reaches it
  const step = chH * 1.1, steps = Math.max(2, Math.ceil(len / step));
  let m = Math.min(steps, 299);
  const p0 = pieces * 5;
  if (p0 + 1500 > PIECES.length) {
    const more = new Float32Array(PIECES.length * 2 + 1500);
    more.set(PIECES);
    PIECES = more;
  }
  let hits = 0, seen = 0;
  for (let s = 0, p = p0; s <= m; s++, p += 5) {
    if (dir(x, y) === false) {
      m = s - 1; // it ends here
      len = Math.max(step, m * step);
      break;
    }
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
  if (m < 2) return;
  const want = 1 - sstep(0.12, 0.4, hits / Math.max(1, seen));
  FADE[id] = fresh ? want : FADE[id] + (want - FADE[id]) * (FADE[id] < 0.02 ? easeHidden : ease);
  if (want > 0.5)
    for (let s = Math.ceil(m * 0.25); s <= m; s++) {
      const tx = Math.floor(PIECES[p0 + s * 5] / TG) + 1, ty = Math.floor(PIECES[p0 + s * 5 + 1] / TG) + 1;
      if (tx < 1 || ty < 1 || tx >= tw - 1 || ty >= th - 1) continue;
      const i = ty * tw + tx;
      TAKEN[i] = TAKEN[i - 1] = TAKEN[i + 1] = TAKEN[i - tw] = TAKEN[i + tw] = 1;
    }
  light *= FADE[id];
  if (light < 0.05 || strands * 8 >= STRANDS.length) return;

  // (a strand it doesn't draw leaves its pieces to be written over)
  const q = strands * 8;
  STRANDS[q] = base[0];
  STRANDS[q + 1] = base[1];
  STRANDS[q + 2] = base[2];
  STRANDS[q + 3] = light;
  STRANDS[q + 4] = len;
  STRANDS[q + 5] = m;
  STRANDS[q + 6] = white;
  STRANDS[q + 7] = id;
  strands++;
  pieces += m + 1;
}
export function endStrands() {
  fresh = false;
  if (document.documentElement.dataset.renderer !== "gpu") drawCPU();
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

// the character for a thin line through a cell along (dx, dy), fy down the cell
const steep = (dx, dy) => Math.abs(dy) > 0.9 * Math.abs(dx);
function glyph(dx, dy, fy) {
  if (steep(dx, dy)) return Math.abs(dy) > 2.9 * Math.abs(dx) ? 0 : dx * dy > 0 ? 2 : 1;
  return fy < 0.3 ? 3 : fy < 0.68 ? 4 : fy < 0.86 ? 5 : 6;
}

// ---- the CPU renderer (strands-gl.js is its GPU twin: keep them in step) ----
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

// Without a usable GPU every character is drawn as text, which is dear: larger
// characters and fewer frames (owner, 2026-11-25). ?fine keeps the GPU's size,
// to compare the two renderers
export const onCPU = () => document.documentElement.dataset.renderer !== "gpu" && !params.has("fine");
export const fineFont = (H) => (onCPU() ? Math.max(7, Math.min(11, Math.min(H, innerWidth) / 105)) : Math.max(5, Math.min(7, Math.min(H, innerWidth) / 150)));

// the rest of startScene()'s settings
export const STRAND_SCENE = {
  fps: () => (onCPU() ? 15 : 20), // the motion is slow
  fontPx: fineFont, // finer than the default: the strands look silkier
  sample: cells.sample,
  gpu: strandsGL(GLYPHS, () => ({ pieces: PIECES, count: pieces, strands: STRANDS, strandCount: strands, cwH, chH })),
};
