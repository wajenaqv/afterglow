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
// Traced, kept apart and drawn by strands.js.
// Options: ?tint=natural|cool|warm|grey|green ?flow=calm|lively

import { params, seeded, HOVER, STILL, STILL_AT, onReaction } from "./common.js";
import { startScene, reduced, smooth as sstep, clamp } from "./nightscene.js";
import { watchSeen } from "./techy.js";
import { CURRENTS } from "./palettes.js";
import { V, STRAND_SCENE, layoutStrands, beginStrands, sittingOut, addStrand, endStrands } from "./strands.js";

const HUES = CURRENTS[params.get("tint")] ?? CURRENTS.natural;
const PACE = { calm: 0.55, lively: 1.8 }[params.get("flow")] ?? 1;
const TAU = Math.PI * 2;
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
let dims = null, A = 1.78;
let roots = []; // x, y, length factor, brightness factor
function layout(d) {
  dims = d;
  A = d.A;
  S = A < 1 ? 0.62 : 1;
  WIDE = A > 1.2 ? 1.65 : 1;
  MID = (A * 0.57) / S; // in units of S, like the stream function
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
  layoutStrands(d, list.length);
}

// the palette as a loop: k (any number) -> colour
function hue(k, out) {
  const n = HUES.length, f = (((k % 1) + 1) % 1) * n, i = Math.floor(f), u = f - i;
  const a = HUES[i % n], b = HUES[(i + 1) % n];
  for (let q = 0; q < 3; q++) out[q] = a[q] + (b[q] - a[q]) * u; // straight: easing left a flat band at every hue
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

let lastT = null;
function frame(t) {
  if (!dims) return;
  const T = (STILL ? STILL_AT : reduced ? 40 : t) * PACE, real = now();
  field(T);
  const dt = lastT == null ? 0 : clamp(t - lastT, 0, 0.1);
  lastT = t;
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

  beginStrands(dt);
  const base = [0, 0, 0];
  for (let n = 0; n < roots.length; n += 4) {
    const x = roots[n], y = roots[n + 1];
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
    if (sittingOut(n / 4)) continue;
    const len = 0.27 * S * Math.min(1.2, k) * roots[n + 2];
    const light = (0.42 + 0.63 * Math.min(1, k)) * roots[n + 3] * (1 + 0.5 * flash) * dim * (1 + 0.35 * lit);

    addStrand(n / 4, x, y, len, light, base, (1 - 0.8 * lit) * Math.min(1, k), dirAt);
  }
  endStrands();
  if (HOVER) watchSeen(lanterns, (l) => place(l.i), dims.H, 0.09);
}

startScene({
  label: "Fine strands of light combed by a slow invisible current, swelling into ribbons and shrinking away over the dark.",
  layout,
  frame,
  ...STRAND_SCENE,
});
