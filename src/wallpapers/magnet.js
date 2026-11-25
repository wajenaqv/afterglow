// Magnet: the lines of force between a few invisible poles, as strokes of
// light streaming along them. The poles drift past each other, so the loops
// keep bending, parting and joining again. Two strong poles, one above the
// other (most loops then run steeply, where characters draw a line best) and a
// weaker third that comes by and pulls at them. Only lines that run from one
// pole to another are drawn: filings everywhere looked like fireworks.
//
// Reactions: every app with something waiting is a pole in its colour, bending
// the field round itself; rest the cursor on it to mark it seen and it lets go.
// A message is a pole that appears and fades over the afterglow. A flash
// brightens every line.
//
// Traced, kept apart and drawn by strands.js.
// Options: ?tint=natural|cool|warm|grey|green

import { params, HOVER, STILL, STILL_AT } from "./common.js";
import { startScene, reduced, smooth as sstep, clamp } from "./nightscene.js";
import { watchSeen } from "./techy.js";
import { MAGNET } from "./palettes.js";
import { V, STRAND_SCENE, layoutStrands, beginStrands, sittingOut, addStrand, endStrands } from "./strands.js";
import { trackApps, now } from "./waiting.js";

const PAL = MAGNET[params.get("tint")] ?? MAGNET.natural;
const going = []; // poles that let go: { x, y, q, colour, t0 }
const apps = trackApps({
  onSeen: (a) => {
    const [x, y] = place(a.i, lastT);
    going.push({ x, y, q: sign(a.i), colour: a.colour, t0: now() });
  },
});
const sign = (i) => (i % 2 ? 1 : -1);

const LINES = 84, MAX_POLES = 14, DASHES = 40; // a strong pole's lines; strokes on one line at most
let dims = null, A = 1.78, S = 1;
let LIT = null; // per line, 0..1: eased in when it reaches a pole, out when it no longer does
const PX = new Float64Array(700), PY = new Float64Array(700); // one line's points
function layout(d) {
  dims = d;
  A = d.A;
  S = A < 1 ? 0.66 : 1; // a portrait screen: everything a little smaller
  LIT = new Float32Array(MAX_POLES * LINES);
  layoutStrands(d, MAX_POLES * LINES * DASHES, 3000);
}

// where a waiting app's pole sits, drifting a little: on a ring round the main
// poles (one that landed on top of them couldn't be seen), golden angles apart
function place(i, t) {
  const a = i * 2.39996 + 0.5 + 0.06 * Math.sin(t * 0.21 + i);
  return [A * (A < 1 ? 0.52 : 0.6) + (A < 1 ? 0.2 : 0.56) * Math.cos(a), 0.5 + (A < 1 ? 0.4 : 0.36) * Math.sin(a)];
}

// ---- the poles ----
const P = []; // { x, y, q, colour or null, hole }
function setPoles(t) {
  P.length = 0;
  const cx = A * (A < 1 ? 0.54 : 0.6), wide = A < 1 ? 0.5 : 1;
  // the two strong ones swing like a pendulum, never far from upright, never out of each other's reach
  const swing = 0.75 * Math.sin(t * 0.043) + 0.25 * Math.sin(t * 0.071 + 1), half = (A < 1 ? 0.2 : 0.19) + 0.03 * Math.sin(t * 0.052 + 2);
  const sx = Math.sin(swing) * half * (A < 1 ? 0.6 : 1.15), sy = Math.cos(swing) * half;
  P.push({ x: cx + sx, y: 0.5 - sy, q: 1, colour: null });
  P.push({ x: cx - sx, y: 0.5 + sy, q: -1, colour: null });
  // the third comes by, on a long loop of its own
  P.push({ x: cx + wide * (0.36 * Math.cos(t * 0.037) + 0.08 * Math.sin(t * 0.06)), y: 0.5 + 0.3 * Math.sin(t * 0.037 * 1.5 + 0.6), q: 0.55 * Math.sin(t * 0.029 + 1.2) > 0 ? 0.5 : -0.5, colour: null });
  // its pull eases to nothing where it changes sides
  P[2].q = 0.55 * clamp(1.8 * Math.sin(t * 0.029 + 1.2), -1, 1);
  for (const a of apps.waiting) {
    const [x, y] = place(a.i, t);
    P.push({ x, y, q: 0.5 * sign(a.i) * apps.lit(a), colour: a.colour });
  }
  for (const m of apps.messages) {
    if (m.i < 8) continue; // a waiting app's message strengthens its own pole
    const [x, y] = place(m.i, t);
    P.push({ x, y, q: 0.8 * sign(m.i) * apps.glow(m), colour: m.colour });
  }
  for (const m of apps.messages) {
    const own = m.i < 8 && apps.waiting.find((a) => a.i === m.i);
    if (own) P[3 + apps.waiting.indexOf(own)].q *= 1 + 1.2 * apps.glow(m);
  }
  for (let i = going.length - 1; i >= 0; i--) {
    const g = going[i], left = Math.exp(-(now() - g.t0) / 0.9);
    if (left < 0.02) going.splice(i, 1);
    else P.push({ x: g.x, y: g.y, q: 0.5 * g.q * left, colour: g.colour });
  }
  // the two strong poles take up the others' difference: with as much plus as
  // minus, every line that leaves a pole comes back to one
  let net = 0;
  for (const p of P) net += p.q;
  P[0].q = Math.max(0.35, P[0].q - net / 2);
  P[1].q = Math.min(-0.35, P[1].q - net / 2);
  for (const p of P) p.hole = (0.03 * Math.sqrt(Math.abs(p.q)) * S) ** 2;
}
function dirAt(x, y) {
  let fx = 0, fy = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], dx = x - p.x, dy = y - p.y, r2 = dx * dx + dy * dy;
    if (r2 < p.hole) return false; // into a pole: a dark hole
    const f = p.q / (r2 + 0.0006);
    fx += f * dx;
    fy += f * dy;
  }
  V[0] = fx;
  V[1] = fy;
}

let lastT = 0, seenT = null, seenFirst = false;
function frame(t) {
  if (!dims) return;
  const T = STILL ? STILL_AT : reduced ? 40 : t;
  const dt = seenT == null ? 0 : clamp(t - seenT, 0, 0.1);
  seenT = t;
  lastT = T;
  apps.tidy();
  setPoles(T);
  const flash = apps.flash();
  beginStrands(dt);
  const base = [0, 0, 0], STEP = 0.007, GAP = 0.15 * S, LONG = 0.13 * S;
  const ease = 1 - Math.exp(-dt / 0.7), run = T * 0.035;
  // a line's colour at a pole
  const tone = (p) => p.colour ?? (p.q > 0 ? PAL.plus : PAL.minus);
  for (let i = 0; i < Math.min(P.length, MAX_POLES); i++) {
    const a = P[i];
    if (a.q < 0.04) continue; // lines start at the plus poles
    for (let l = 0; l < LINES; l++) {
      // a weaker pole has fewer lines: the last ones fade as it weakens
      const share = sstep(l / LINES - 0.02, l / LINES + 0.06, Math.min(1, a.q * 1.05));
      const line = i * LINES + l;
      if (share < 0.02) {
        LIT[line] = 0;
        continue;
      }
      // the angles in golden order, so any number of them is spread evenly
      const th = (l * 0.618034 * Math.PI * 2) % (Math.PI * 2);
      let x = a.x + Math.cos(th) * Math.sqrt(a.hole) * 1.05, y = a.y + Math.sin(th) * Math.sqrt(a.hole) * 1.05, n = 0, end = null;
      while (n < 700) {
        PX[n] = x;
        PY[n++] = y;
        if (dirAt(x, y) === false) {
          for (const p of P) if (p.q < 0 && (x - p.x) ** 2 + (y - p.y) ** 2 < p.hole) end = p;
          break;
        }
        const v = Math.sqrt(V[0] * V[0] + V[1] * V[1]) || 1;
        x += (V[0] / v) * STEP;
        y += (V[1] / v) * STEP;
        if (x < -0.5 || y < -0.6 || x > A + 0.5 || y > 1.6) break;
      }
      const want = end ? 1 : 0;
      LIT[line] = seenFirst ? LIT[line] + (want - LIT[line]) * ease : want;
      const lit = LIT[line] * share;
      if (lit < 0.03) continue;
      const total = (n - 1) * STEP, c0 = tone(a), c1 = end ? tone(end) : c0, own = a.colour || end?.colour;
      // strokes streaming along it, each keeping its number
      const at = run + ((l * 0.7548) % 1) * GAP, first = Math.ceil(-at / GAP);
      for (let k = first; k * GAP + at < total && k < first + DASHES; k++) {
        const s0 = k * GAP + at, id = line * DASHES + ((k % DASHES) + DASHES) % DASHES;
        if (sittingOut(id)) continue;
        const p = Math.min(n - 1, Math.floor(s0 / STEP)), u = (s0 + LONG * 0.7) / Math.max(total, LONG);
        const X = PX[p], Y = PY[p];
        // quiet where it leaves and arrives, and in the desktop icons' fifth
        const k1 = sstep(-0.05, 0.08, u) * sstep(1.15, 0.85, u) * (0.2 + 0.8 * sstep(0.1 * A, 0.3 * A, X)) * lit;
        if (k1 < 0.04) continue;
        const w = sstep(0.15, 0.85, u);
        for (let q = 0; q < 3; q++) base[q] = c0[q] + (c1[q] - c0[q]) * w;
        // long outer loops are fainter
        const far = 1 - 0.5 * sstep(0.8, 2.6, total);
        addStrand(id, X, Y, Math.min(LONG, total - s0 + 0.01), (0.5 + 0.75 * far) * k1 * (1 + 0.8 * flash) * (own ? 1.15 : 1), base, own ? 0.3 : 0.9, dirAt);
      }
    }
  }
  seenFirst = true;
  endStrands();
  if (HOVER) watchSeen(apps.waiting, (a) => place(a.i, T), dims.H, 0.08);
}

startScene({
  label: "Filings of light round invisible magnetic poles that drift past each other, their loops bending, parting and joining.",
  layout,
  frame,
  ...STRAND_SCENE,
});
