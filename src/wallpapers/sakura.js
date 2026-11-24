// Sakura: an old cherry limb reaching in from the top right on a spring night,
// crossing the moon, with twigs hanging off it in clusters of blossom. The
// wind is a steady breeze from the left broken by gusts; the twigs sway on
// their parents and bend downwind in a gust, and petals torn loose flutter
// down, turning as they fall (a petal face-on is an o, tilted a bracket, edge-on
// a line at the angle it is turning).
//
// Reactions: a new message opens a blossom in the app's colour (it swells with
// a flash, sheds a few petals in that colour and fades back over the
// afterglow); every app with something waiting keeps one big blossom in its
// colour, breathing, until you rest the cursor on it (it then drops its petals
// and turns pink again); a flash lights the whole branch.
//
// Everything is a closed-form function of time (no simulation, no memory
// between frames), so a GPU version can run the same maths per cell. For now
// this is the CPU version: frame() lays the branch, blossoms and petals into
// per-cell buffers, sample() reads them back ("direct" scene: it picks each
// cell's character and colour itself).
//
// Options: ?tint=natural|cool|warm|grey|green ?moon=0

import { params, hash, seeded, STILL, HOVER, pointer, onReaction, seenLantern } from "./common.js";
import { setPalette, startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- palettes ----
const TINTS = {
  natural: { pale: [1.0, 0.86, 0.92], petal: [1.0, 0.62, 0.78], deep: [0.95, 0.36, 0.56], heart: [1.0, 0.4, 0.55], bark: [0.5, 0.34, 0.36], leaf: [0.42, 0.48, 0.22], moon: [0.85, 0.88, 0.95], anther: [1.0, 0.84, 0.5] },
  cool: { pale: [0.9, 0.95, 1.0], petal: [0.72, 0.82, 1.0], deep: [0.5, 0.58, 0.95], heart: [0.6, 0.55, 1.0], bark: [0.45, 0.48, 0.58], leaf: [0.3, 0.48, 0.45], moon: [0.85, 0.92, 1.0], anther: [0.95, 0.97, 1.0] },
  warm: { pale: [1.0, 0.9, 0.8], petal: [1.0, 0.68, 0.55], deep: [0.98, 0.45, 0.38], heart: [1.0, 0.5, 0.3], bark: [0.62, 0.42, 0.32], leaf: [0.5, 0.48, 0.2], moon: [1.0, 0.9, 0.75], anther: [1.0, 0.8, 0.4] },
  grey: { pale: [0.95, 0.95, 0.95], petal: [0.78, 0.78, 0.8], deep: [0.55, 0.55, 0.58], heart: [0.7, 0.7, 0.72], bark: [0.42, 0.42, 0.42], leaf: [0.4, 0.4, 0.4], moon: [0.92, 0.92, 0.92], anther: [1.0, 1.0, 1.0] },
  green: { pale: [0.8, 1.0, 0.9], petal: [0.3, 1.0, 0.6], deep: [0.15, 0.75, 0.45], heart: [0.5, 1.0, 0.75], bark: [0.3, 0.56, 0.43], leaf: [0.2, 0.6, 0.4], moon: [0.75, 1.0, 0.86], anther: [0.85, 1.0, 0.7] },
};
const PAL = TINTS[params.get("tint")] ?? TINTS.natural;
const MOON = params.get("moon") !== "0";

// ---- wind: a breeze from the left, and three gusts every GP seconds ----
// A gust is a raised-cosine bump, so how far it has pushed things (its
// integral) has a closed form: petals can be placed at any moment directly.
const GP = 24;
const GUSTS = [ // start, duration, strength
  [3, 2.4, 1.0],
  [10, 3.6, 1.5],
  [17.5, 2.2, 0.9],
];
const bump = (x) => (x <= 0 || x >= 1 ? 0 : (1 - Math.cos(TAU * x)) / 2);
const bumpInt = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x - Math.sin(TAU * x) / TAU);
function gust(t) {
  const tc = t - Math.floor(t / GP) * GP;
  let g = 0;
  for (const [s, d, a] of GUSTS) g += a * bump((tc - s) / d);
  return g;
}
// integral of gust() from 0 to t
function gustInt(t) {
  const n = Math.floor(t / GP), tc = t - n * GP;
  let g = 0;
  for (const [s, d, a] of GUSTS) g += a * d * (n + bumpInt((tc - s) / d));
  return g;
}
// how far the air has carried something since time 0, in screen heights
const W0 = 0.012, W1 = 0.007, WG = 0.055;
const drift = (t) => W0 * t - (W1 / 0.31) * Math.cos(0.31 * t) + WG * gustInt(t);

// ---- the tree, in design space: (0, 0) is the top-right corner, x runs left
// (negative), one unit is a screen height on a 16:9 screen; place() fits it ----
let SC = 1, RX = 1.78; // scale and right edge, set by layout()
const place = (p) => [RX + p[0] * SC, p[1] * SC];

const rot = (x, y, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};
function bezier(c, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1), u = 1 - s;
    const w = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
    out.push([0, 1].map((k) => w[0] * c[0][k] + w[1] * c[1][k] + w[2] * c[2][k] + w[3] * c[3][k]));
  }
  return out;
}

const BRANCHES = []; // { parent, base, pts, rad, amp, om, ph }
const FLOWERS = []; // { b, pos, R, rot, sq, sqa, kind 0 blossom | 1 bud | 2 leaf, ph, white, slot }
const SLOTS = []; // indices of the big blossoms that can carry an app's colour
function buildTree() {
  BRANCHES.length = FLOWERS.length = SLOTS.length = 0;
  const r = seeded(7);
  const between = (a, b) => a + (b - a) * r();
  const normal = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
  const add = (parent, ctrl, r0, r1, amp, n = 18) => {
    const pts = bezier(ctrl, n);
    // old wood is knotty: the girth swells and pinches along the limb
    const k1 = between(0, TAU), k2 = between(0, TAU);
    const rad = pts.map((_, i) => (r0 + ((r1 - r0) * i) / (n - 1)) * (1 + 0.13 * Math.sin(i * 1.1 + k1) + 0.08 * Math.sin(i * 2.9 + k2)));
    BRANCHES.push({ parent, base: pts[0], pts, rad, amp, om: between(0.8, 1.3), ph: between(0, TAU) });
    return BRANCHES.length - 1;
  };
  const at = (i, s) => {
    const p = BRANCHES[i].pts, k = s * (p.length - 1), j = Math.min(Math.floor(k), p.length - 2), f = k - j;
    return [p[j][0] + (p[j + 1][0] - p[j][0]) * f, p[j][1] + (p[j + 1][1] - p[j][1]) * f];
  };
  const off = (p, dx, dy) => [p[0] + dx, p[1] + dy];
  const cluster = (i, s, n, spread = 0.018, slot = false) => {
    const p = at(i, s);
    if (slot) {
      SLOTS.push(FLOWERS.length);
      FLOWERS.push({ b: i, pos: p, R: 0.034, rot: between(0, TAU), sq: between(0.8, 1), sqa: between(0, Math.PI), kind: 0, ph: between(0, TAU), white: between(0, 0.5), depth: 1, slot: true });
    }
    // a few separate blossoms, not a clump: each one is meant to be seen
    for (let k = 0; k < n; k++)
      FLOWERS.push({ b: i, pos: off(p, normal() * spread, normal() * spread * 0.8), R: between(0.021, 0.029), rot: between(0, TAU), sq: between(0.6, 1), sqa: between(0, Math.PI), kind: 0, ph: between(0, TAU), white: r(), depth: between(0.55, 1) });
    for (let k = 0, m = 1 + Math.floor(r() * 2); k < m; k++)
      FLOWERS.push({ b: i, pos: off(p, normal() * spread * 1.3, normal() * spread), R: 0.0055, rot: 0, sq: 1, sqa: 0, kind: 1, ph: between(0, TAU), white: 0 });
    if (r() < 0.25)
      FLOWERS.push({ b: i, pos: off(p, normal() * spread, normal() * spread), R: between(0.012, 0.017), rot: between(0, TAU), sq: 1, sqa: 0, kind: 2, ph: between(0, TAU), white: 0 });
  };

  const main = add(-1, [[0.08, -0.03], [-0.3, 0.0], [-0.55, 0.3], [-0.98, 0.16]], 0.034, 0.009, 0.004, 30);
  const upper = add(main, [at(main, 0.3), off(at(main, 0.3), -0.12, -0.05), off(at(main, 0.3), -0.22, -0.08), off(at(main, 0.3), -0.36, -0.16)], 0.016, 0.007, 0.01);
  const lower = add(main, [at(main, 0.62), off(at(main, 0.62), -0.05, 0.07), off(at(main, 0.62), -0.12, 0.15), off(at(main, 0.62), -0.24, 0.2)], 0.012, 0.005, 0.02);
  const hangs = [];
  for (const [s, dx, dy, bend] of [[0.12, -0.04, 0.27, -0.02], [0.36, -0.1, 0.3, 0.03], [0.52, -0.06, 0.22, -0.03], [0.78, -0.09, 0.24, 0.02], [0.98, -0.16, 0.15, 0.05]]) {
    const b = at(main, s);
    hangs.push(add(main, [b, off(b, bend * 0.5, dy * 0.3), off(b, dx * 0.6, dy * 0.7), off(b, dx, dy)], 0.009, 0.003, 0.035));
  }
  const ub = at(upper, 0.55);
  const droop = add(upper, [ub, off(ub, -0.03, 0.04), off(ub, -0.06, 0.12), off(ub, -0.1, 0.18)], 0.006, 0.0025, 0.045);
  const twigs = [];
  for (const h of [...hangs, droop, lower])
    for (let k = 0; k < 2; k++) {
      const b = at(h, between(0.35, 0.8)), dx = (r() < 0.5 ? -1 : 1) * between(0.025, 0.05);
      twigs.push(add(h, [b, off(b, dx * 0.4, 0.015), off(b, dx * 0.8, 0.04), off(b, dx, between(0.05, 0.075))], 0.0035, 0.0018, 0.07, 10));
    }
  hangs.forEach((h) => {
    cluster(h, 1, 2, 0.026, true);
    cluster(h, 0.55, 2, 0.022);
  });
  cluster(droop, 1, 2, 0.026, true);
  cluster(lower, 1, 3, 0.026);
  cluster(lower, 0.5, 1);
  for (const tw of twigs) cluster(tw, 1, 2, 0.02);
  for (const s of [0.22, 0.45, 0.68, 0.88]) cluster(main, s, 2, 0.022);
  for (const s of [0.5, 0.85]) cluster(upper, s, 2, 0.02);
  // back to front: leaves and buds first, dim (far) blossoms before bright
  // ones, and the slot blossoms in front of their clusters
  FLOWERS.sort((a, b) => (a.slot ? 1 : 0) - (b.slot ? 1 : 0) || (a.kind === 0) - (b.kind === 0) || (a.depth ?? 0) - (b.depth ?? 0));
  SLOTS.length = 0;
  FLOWERS.forEach((f, i) => f.slot && SLOTS.push(i));
}

// ---- sway: each branch swings on its parent; gusts bend them all downwind
// (to the right). TR[i] = [angle, origin x, origin y]: a design-space point P
// on branch i sits at rot(P - base, angle) + origin.
let TR = [];
function sway(t) {
  const g = gust(t - 0.3);
  TR = [];
  BRANCHES.forEach((b, i) => {
    const a = b.amp * (0.6 * Math.sin(b.om * t + b.ph) + 0.4 * Math.sin(1.9 * b.om * t + 2 * b.ph)) * (1 + g) - b.amp * 2 * g;
    if (b.parent < 0) return void (TR[i] = [a, b.base[0], b.base[1]]);
    const o = onBranch(b.parent, b.base);
    TR[i] = [TR[b.parent][0] + a, o[0], o[1]];
  });
}
function onBranch(i, p) {
  const [a, ox, oy] = TR[i], base = BRANCHES[i].base;
  const q = rot(p[0] - base[0], p[1] - base[1], a);
  return [q[0] + ox, q[1] + oy];
}
function flowerAt(f, t) {
  const p = onBranch(f.b, f.pos), j = 0.0015 * (1 + gust(t));
  return place([p[0] + j * Math.sin(3.1 * t + f.ph), p[1] + j * Math.cos(2.7 * t + f.ph)]);
}

// ---- falling petals: each one on its own closed-form path ----
const NP = 70;
const PETALS = (() => {
  const r = seeded(23);
  const between = (a, b) => a + (b - a) * r();
  return Array.from({ length: NP }, () => {
    const u = r();
    const s = u < 0.3 ? between(0.45, 0.65) : u < 0.86 ? between(0.85, 1.15) : between(1.5, 2.0);
    const vf = between(0.045, 0.07);
    const P = 1.25 / (vf * s) + between(2, 6);
    return { s, vf, P, off: r() * P, ax: between(0.01, 0.03), om: TAU * between(0.25, 0.5), ph: between(0, TAU), th0: between(0, TAU), thw: (r() < 0.5 ? -1 : 1) * between(2, 5), fi0: between(0, TAU), fiw: between(-1.2, 1.2), q1: between(0, TAU), q2: between(0, TAU) };
  });
})();
// where petal p, let go at (x0, y0) at time t0, is at time t (screen heights)
function fall(p, x0, y0, t0, t) {
  const age = t - t0, ease = sstep(0, 1.5, age);
  const x = x0 + p.s * (drift(t) - drift(t0)) + p.ax * p.s * (Math.sin(p.om * age + p.ph) - Math.sin(p.ph)) + ease * 0.03 * p.s * Math.sin(0.7 * age + p.q1) * Math.sin(0.23 * age + p.q2);
  const y = y0 + p.s * p.vf * (age + (0.55 / (2 * p.om)) * (Math.cos(2 * p.ph) - Math.cos(2 * (p.om * age + p.ph)))) - p.s * 0.025 * (gustInt(t) - gustInt(t0));
  const c = Math.cos(p.th0 + p.thw * age + 0.7 * Math.sin(p.om * age + p.ph));
  const fi = p.fi0 + p.fiw * age + 0.3 * Math.sin(p.om * age);
  return { x, y, c, fi };
}
const EDGE = ["-", "\\", "|", "/"];
// A petal is one to three cells wide by depth (size 0 far, 1 middle, 2 near):
// face-on a round "()", tilted it narrows to one side, edge-on a line
function petalGlyph(c, fi, size, h) {
  const a = Math.abs(c);
  if (a > 0.72) return ["o", "()", "(O)"][size];
  if (a > 0.3) return c > 0 ? ["(", "(o", "(o."][size] : [")", "o)", ".o)"][size];
  const deg = ((fi * 180) / Math.PI) % 180;
  const e = EDGE[Math.floor(((deg < 0 ? deg + 180 : deg) + 22.5) / 45) % 4];
  if (e === "-") return [h < 0.3 ? "~" : "-", h < 0.3 ? "~-" : "--", "~--"][size];
  return e; // a petal edge-on at a slant is a thin line, one cell
}
// the night lights the branch from below and the petals fade as they fall away from it
const lamp = (y) => 0.35 + 0.85 * Math.exp(-(((y - 0.18 * SC) / 0.42) ** 2));

// ---- per-cell buffers ----
let dims = null, cols = 0, rows = 0, cwH = 0, chH = 0;
let BC, BD, BI, BRIM, HR, HG, HB;
// every character the scene draws (the GPU builds its glyph atlas from them)
const cells = cellBuffer(".:-=+*'`,~()oO\\|/v");
const put = (i, g, c) => cells.put(i, g, c);
// visit the cells within a box (screen heights) around a point
function cellsAround(x, y, rx, ry, fn) {
  const c0 = Math.max(0, Math.floor((x - rx) / cwH)), c1 = Math.min(cols - 1, Math.floor((x + rx) / cwH));
  const r0 = Math.max(0, Math.floor((y - ry) / chH)), r1 = Math.min(rows - 1, Math.floor((y + ry) / chH));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c, (c + 0.5) * cwH, (r + 0.5) * chH, c, r);
}
const cellOf = (x, y) => {
  const c = Math.floor(x / cwH), r = Math.floor(y / chH);
  return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
};
function addHalo(i, col, v) {
  HR[i] += col[0] * v;
  HG[i] += col[1] * v;
  HB[i] += col[2] * v;
}

// ---- value noise for the moon's face ----
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(xi, yi, 31), b = hash(xi + 1, yi, 31), c = hash(xi, yi + 1, 31), d = hash(xi + 1, yi + 1, 31);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const MOON_RAMP = ".:-=+*";
function drawMoon(light) {
  const [mx, my] = place([-0.4, 0.2]), MR = 0.065 * SC;
  cellsAround(mx, my, MR * 2.6, MR * 2.6, (i, X, Y, c, r) => {
    const d = Math.hypot(X - mx, Y - my);
    if (d < MR) {
      const limb = Math.sqrt(1 - (d / MR) ** 2);
      const maria = sstep(0.4, 0.75, vn((X - mx) * (34 / SC) + 3, (Y - my) * (34 / SC)));
      // dim and finely textured, so the branch stands out against it
      const b = (0.25 + 0.75 * Math.pow(limb, 0.6)) * (1 - 0.5 * maria);
      const k = Math.min(MOON_RAMP.length - 1, Math.floor(b * 4.2 + hash(c, r, 19) * 1.2));
      put(i, MOON_RAMP[k], PAL.moon.map((v) => v * (0.2 + 0.38 * b) * light));
    } else addHalo(i, PAL.moon, 0.22 * Math.exp(-(d - MR) / (0.55 * MR)));
  });
}

// ---- reactions ----
let lanterns = []; // [{ source, colour 0..1, slot }]
let pulses = []; // [{ slot, colour, t0, tau }]
let bursts = []; // petals shaken loose: [{ t0, x, y, colour, n, seed }]
let flashAt = -1e9, nowT = 0, overSince = null;
const lastPulse = new Map(); // slot -> time
function slotFor(source) {
  const l = lanterns.find((l) => l.source === source);
  if (l) return l.slot;
  const free = SLOTS.filter((s) => !lanterns.some((l) => l.slot === s));
  const pool = free.length ? free : SLOTS;
  return pool.reduce((best, s) => ((lastPulse.get(s) ?? -1e9) < (lastPulse.get(best) ?? -1e9) ? s : best), pool[0]);
}
function shed(slot, colour, n) {
  const f = FLOWERS[slot];
  if (!f) return;
  const [x, y] = flowerAt(f, S.time);
  bursts.push({ t0: S.time, x, y, colour, n, seed: Math.floor(Math.random() * 1e6) });
  if (bursts.length > 12) bursts.shift();
}
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    const slot = slotFor(r.source);
    if (slot == null) return;
    const colour = r.colour.map((v) => v / 255);
    lastPulse.set(slot, S.time);
    pulses = pulses.filter((p) => p.slot !== slot);
    pulses.push({ slot, colour, t0: S.time, tau: Math.max(1, (r.afterglow ?? 6) / 3) });
    if (pulses.length > 4) pulses.shift();
    shed(slot, colour, 5);
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") {
    const items = Array.isArray(r.items) ? r.items.filter((l) => Array.isArray(l.colour)) : [];
    const next = [];
    for (const it of items.slice(0, SLOTS.length)) {
      const had = lanterns.find((l) => l.source === it.source);
      const slot = had ? had.slot : SLOTS.find((s) => !next.some((l) => l.slot === s) && !lanterns.some((l) => l.slot === s && items.some((x) => x.source === l.source)));
      if (slot != null) next.push({ source: it.source, colour: it.colour.map((v) => v / 255), slot });
    }
    // a lantern that went out (seen, or read elsewhere) drops its petals
    for (const l of lanterns) if (!next.some((n) => n.source === l.source)) shed(l.slot, l.colour, 8);
    lanterns = next;
  }
});
function watchHover() {
  if (!HOVER || !pointer.on || !lanterns.length || !dims) return void (overSince = null);
  const X = pointer.x / dims.H, Y = pointer.y / dims.H;
  const l = lanterns.find((l) => {
    const f = FLOWERS[l.slot], [x, y] = flowerAt(f, S.time);
    return Math.hypot(X - x, Y - y) < f.R * SC * 1.6;
  });
  if (!l) return void (overSince = null);
  if (overSince?.source !== l.source) overSince = { source: l.source, at: performance.now() };
  else if (performance.now() - overSince.at > 800) {
    seenLantern(l.source);
    overSince = null;
  }
}

// ---- one frame: lay everything into the cell buffers ----
const S = { time: 0 };
function drawPetal(x, y, c, fi, s, colour, k) {
  const i = cellOf(x, y);
  if (i < 0) return;
  const a = Math.abs(c);
  const fade = 1 - sstep(0.82, 1.04, y);
  const b = lamp(y) * (0.55 + 0.45 * a) * (s < 0.7 ? 0.5 : 1) * fade;
  if (b < 0.06) return;
  const size = s < 0.7 ? 0 : s > 1.4 ? 2 : 1;
  const col = colour.map((v) => v * b + Math.max(0, a - 0.92) * 1.6 * lamp(y));
  const g = petalGlyph(c, fi, size, hash(k, 7, 3));
  const c0 = Math.floor(x / cwH) - (g.length >> 1), r = Math.floor(y / chH);
  for (let n = 0; n < g.length; n++) {
    const cc = c0 + n;
    if (cc >= 0 && cc < cols) put(r * cols + cc, g[n], col);
  }
  if (size === 2) // close to the eye: a soft out-of-focus fringe above and below
    for (let n = 0; n < g.length; n++)
      for (const dr of [-1, 1]) {
        const cc = c0 + n, rr = r + dr;
        if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue;
        const j = rr * cols + cc;
        if (!cells.has(j)) put(j, ".", col.map((v) => v * 0.3));
      }
}
function petals(t, layer) {
  PETALS.forEach((p, k) => {
    if ((p.s < 0.7) !== (layer === "far")) return;
    const n = Math.floor((t + p.off) / p.P), t0 = n * p.P - p.off;
    let x0, y0;
    if (hash(k, n, 1) < 0.45) {
      // shaken loose from a blossom on the branch
      const f = FLOWERS[Math.floor(hash(k, n, 2) * FLOWERS.length)];
      [x0, y0] = place(onBranch(f.b, f.pos));
    } else [x0, y0] = [-0.3 + (RX + 0.2) * hash(k, n, 3), -0.04];
    const q = fall(p, x0, y0, t0, t);
    if (q.y > 1.06 || q.x > RX + 0.05) return;
    drawPetal(q.x, q.y, q.c, q.fi, p.s, PAL.petal, k);
  });
}
function burstPetals(t) {
  bursts = bursts.filter((b) => t - b.t0 < 30);
  for (const b of bursts)
    for (let j = 0; j < b.n; j++) {
      const p = PETALS[(b.seed + j * 7) % NP];
      const q = fall({ ...p, s: 0.9 + 0.2 * hash(b.seed, j, 4) }, b.x + 0.01 * (hash(b.seed, j, 5) - 0.5), b.y, b.t0, t);
      if (q.y > 1.06) continue;
      drawPetal(q.x, q.y, q.c, q.fi, 1, mixc(b.colour, PAL.petal, sstep(4, 14, t - b.t0)), b.seed + j);
    }
}

function drawBark(light) {
  BC.fill(0);
  BRANCHES.forEach((b, i) => {
    const P = b.pts.map((p) => place(onBranch(i, p)));
    for (let j = 0; j < P.length - 1; j++) {
      const [ax, ay] = P[j], [bx, by] = P[j + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      const rmax = Math.max(b.rad[j], b.rad[j + 1]) * SC, reach = Math.max(rmax, 0.6 * chH) + cwH;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      deg = ((deg % 180) + 180) % 180;
      const dir = Math.floor((deg + 22.5) / 45) % 4;
      cellsAround((ax + bx) / 2, (ay + by) / 2, Math.abs(dx) / 2 + reach, Math.abs(dy) / 2 + reach, (i2, X, Y) => {
        const h = clamp01(((X - ax) * dx + (Y - ay) * dy) / L2);
        const vx = X - ax - dx * h, vy = Y - ay - dy * h, d = Math.hypot(vx, vy);
        const rr = (b.rad[j] + (b.rad[j + 1] - b.rad[j]) * h) * SC;
        const reff = Math.max(rr, 0.55 * chH);
        const cov = clamp01((reff - d) / cwH + 0.5);
        if (cov <= BC[i2]) return;
        BC[i2] = cov;
        BD[i2] = dir;
        BI[i2] = rr > 1.5 * cwH ? d / rr : 1;
        BRIM[i2] = Math.max(-1, Math.min(1, -vy / reff)); // +1 the top of the limb, -1 its underside
      });
    }
  });
  // Dark wood lit like a round limb: moonlight along the top edge, a pink glow
  // from the blossoms on the underside, grain lines running along the branch,
  // and the shadowed middle left sparse
  for (let i = 0; i < BC.length; i++) {
    const cov = BC[i];
    if (cov < 0.14) continue;
    const side = BRIM[i], dir = BD[i], h = hash(i, 0, 11);
    const moon = sstep(0.3, 0.95, side), under = sstep(0.35, 0.95, -side) * 0.6;
    const twig = BI[i] === 1;
    const lit = twig ? 0.55 + 0.45 * moon : 0.18 + 0.9 * moon + 0.45 * under;
    let g;
    if (twig) g = EDGE[dir];
    else if (lit < 0.22) {
      if (h < 0.45) continue; // the shadowed heart of the limb: a sparse texture
      g = h < 0.75 ? "." : ":";
    } else g = lit > 0.7 && dir === 0 ? "=" : EDGE[dir];
    const grain = 0.8 + 0.4 * hash(i, 1, 12);
    const col = PAL.bark.map((v, k) => (v * (0.45 + 0.4 * lit) + PAL.moon[k] * 0.5 * moon + PAL.petal[k] * 0.3 * under) * grain * (0.6 + 0.4 * cov) * light);
    put(i, g, col);
  }
}

const PETAL_RAMP = " .:-=+"; // the fill inside a petal, by brightness
// A blossom's shape: un-squash the point (the blossom seen at an angle), then
// five petals in polar form with deep gaps between them and a notch at each
// tip. Returns [distance outside the outline (negative inside), r, u (-0.5..0.5
// across a petal), outline radius, x, y]
function petalField(f, R, dx, dy) {
  let [qx, qy] = rot(dx, dy, -f.sqa);
  qx /= f.sq;
  [qx, qy] = rot(qx, qy, f.sqa);
  const r = Math.hypot(qx, qy);
  let u = ((Math.atan2(qy, qx) - f.rot) * 5) / TAU;
  u = u - Math.floor(u) - 0.5;
  const edge = R * (0.1 + 0.9 * Math.pow(Math.cos(Math.PI * u), 0.7)) * (1 - 0.28 * Math.exp(-((u / 0.06) ** 2)));
  return [r - edge, r, u, edge, qx, qy];
}
function drawFlowers(t, light) {
  FLOWERS.forEach((f, idx) => {
    let [cx, cy] = flowerAt(f, t);
    let R = f.R * SC, colour = null, glow = 0, boost = 1;
    const lan = f.slot && lanterns.find((l) => l.slot === idx);
    if (lan) {
      colour = lan.colour;
      glow = 0.55 + 0.25 * Math.sin((t * TAU) / 4 + f.ph);
      boost = 0.95 + 0.2 * Math.sin((t * TAU) / 4 + f.ph);
    }
    const pu = pulses.find((p) => p.slot === idx);
    if (pu) {
      const age = t - pu.t0, k = Math.exp(-age / pu.tau);
      colour = colour ? mixc(colour, pu.colour, k) : mixc(PAL.petal, pu.colour, k);
      R *= 1 + 0.3 * Math.sin(Math.PI * clamp01(age / 0.8)) * (age < 0.8 ? 1 : 0);
      boost *= 1 + 0.9 * Math.exp(-age / 0.3);
      glow = Math.max(glow, 0.8 * k);
    }
    const L = lamp(cy) * light * boost * (lan ? 1.35 : 1); // a waiting app's blossom stands out
    if (f.kind === 1) {
      cellsAround(cx, cy, R * 1.2, R * 1.4, (i, X, Y) => {
        if (Math.hypot((X - cx) / 0.75, Y - cy - R * 0.2) < R) put(i, "*", PAL.deep.map((v) => v * L * 0.9));
      });
      return;
    }
    if (f.kind === 2) {
      cellsAround(cx, cy, R, R, (i, X, Y) => {
        const [u, v] = rot(X - cx, Y - cy, -f.rot);
        if (u > -R && u < R && Math.abs(v) < 0.3 * R * Math.cos((u / R) * Math.PI * 0.5)) put(i, "v", PAL.leaf.map((c) => c * L * 0.7));
      });
      return;
    }
    const base = colour ?? null;
    const reach = R * (1.9 + glow), outside = R + 0.5 * cwH, haloW = 0.45 * R, haloA = (0.16 + glow) * L;
    cellsAround(cx, cy, reach, reach, (i, X, Y) => {
      // Beyond the petal tips only the glow is left, and it only needs the
      // distance (un-squashing only moves points outward, so d <= r)
      const d = Math.hypot(X - cx, Y - cy);
      if (d > outside) {
        if (d < reach) addHalo(i, base ?? PAL.petal, haloA * Math.exp(-(d - R) / haloW));
        return;
      }
      const [F, r, u, edge, qx, qy] = petalField(f, R, X - cx, Y - cy);
      const tone = clamp01(r / edge);
      const dep = f.depth ?? 1;
      if (F < 0.4 * cwH) {
        let g, col;
        const w = (Math.atan2(qy, qx) / TAU) * 9 + f.ph;
        const spoke = Math.abs(w - Math.round(w)) * (TAU / 9) * r;
        if (r < 0.15 * R) {
          g = "*";
          col = (base ? mixc(base, [1, 1, 1], 0.15) : PAL.heart).map((v) => v * L * dep);
        } else if (r > 0.22 * R && r < 0.36 * R && spoke < 0.55 * cwH) {
          g = "'"; // the ring of pollen around the centre
          col = (base ? mixc(base, [1, 1, 1], 0.5) : PAL.anther).map((v) => v * L * dep);
        } else if (F > -0.85 * cwH && r > 0.3 * R) {
          // each petal's outline, drawn along the curve and caught by the light
          const e = 0.3 * cwH;
          const fx = petalField(f, R, X - cx + e, Y - cy)[0] - F, fy = petalField(f, R, X - cx, Y - cy + e)[0] - F;
          let deg = (Math.atan2(fy, fx) * 180) / Math.PI + 90;
          deg = ((deg % 180) + 180) % 180;
          g = EDGE[Math.floor((deg + 22.5) / 45) % 4];
          const rim = mixc(PAL.petal, PAL.pale, 0.35 + 0.65 * f.white * sstep(0.4, 1, tone));
          col = (base ? mixc(base, [1, 1, 1], 0.3) : rim).map((v) => v * L * dep * (0.75 + 0.35 * tone));
        } else {
          // inside the petal: a soft fill, deeper pink at its base, a crease
          // down its middle
          const crease = 1 - 0.5 * Math.exp(-((u / 0.08) ** 2));
          const br = clamp01((0.5 + 0.5 * tone) * crease);
          g = PETAL_RAMP[Math.max(2, Math.min(PETAL_RAMP.length - 1, Math.round(br * (PETAL_RAMP.length - 1))))];
          const pink = mixc(PAL.deep, PAL.petal, sstep(0.15, 0.7, tone));
          col = (base ?? pink).map((v) => v * L * dep * (0.5 + 0.55 * br));
        }
        put(i, g, col);
      } else addHalo(i, base ?? PAL.petal, (0.16 + glow) * Math.exp(-F / (0.45 * R)) * L);
    });
  });
}

function frame(t) {
  nowT = t;
  if (!dims) return;
  S.time = STILL || reduced ? 41 : t;
  const T = S.time;
  const flash = Math.max(0, 1 - (t - flashAt) / 0.8);
  const light = 1 + 0.9 * flash;
  pulses = pulses.filter((p) => T - p.t0 < p.tau * 6);
  sway(T);
  watchHover();
  cells.clear();
  HR.fill(0);
  HG.fill(0);
  HB.fill(0);
  if (MOON) drawMoon(1 + 0.3 * flash);
  petals(T, "far");
  drawBark(light);
  drawFlowers(T, light);
  // the glow around blossoms (and the moon): scattered dim dots on empty cells
  for (let i = 0; i < cols * rows; i++) {
    if (cells.has(i)) continue;
    const m = Math.max(HR[i], HG[i], HB[i]);
    if (m < 0.05 + 0.22 * hash(i, 0, 17)) continue;
    const k = Math.min(1, m) / m;
    put(i, m > 0.32 ? ":" : ".", [HR[i] * k * 0.55, HG[i] * k * 0.55, HB[i] * k * 0.55].map((v) => v * Math.min(1, m * 1.6)));
  }
  petals(T, "near");
  burstPetals(T);
}

function layout(d) {
  dims = d;
  cols = d.cols;
  rows = d.rows;
  cwH = d.cw / d.H;
  chH = d.ch / d.H;
  RX = d.A;
  SC = Math.min(1, d.A / 1.15); // a portrait screen gets a smaller branch across its whole width
  const n = cols * rows;
  cells.resize(cols, rows);
  BC = new Float32Array(n);
  BD = new Uint8Array(n);
  BI = new Float32Array(n);
  BRIM = new Float32Array(n);
  HR = new Float32Array(n);
  HG = new Float32Array(n);
  HB = new Float32Array(n);
  buildTree();
}

setPalette();
startScene({
  label: "A cherry branch at night crossing the moon, its blossoms glowing and petals fluttering down in the wind.",
  fps: 20,
  // finer than the default (H / 105): the blossoms read as texture, not as letters
  fontPx: (H) => (STILL ? H / 150 : Math.max(5, Math.min(10, H / 150))),
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
