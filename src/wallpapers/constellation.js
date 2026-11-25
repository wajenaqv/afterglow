// Constellation: cats in the stars. On a quiet starfield with a faint band of
// milky way, stars gather somewhere in the sky until they make a small cat:
// sitting, asleep, a loaf, peeking over the horizon, reaching for a star,
// trotting, stretching, with a ball of yarn, or two with their tails in a
// heart. There are no lines: the cat is stardust, with a few bright stars at
// the ears, paws and tail, and its eyes are stars. Its name appears underneath
// ("felis sedens" ...), it holds a while, dissolves, and the next gathers
// somewhere else. Now and then two gather at once in different parts of the sky.
// (Stars joined by chart lines came first, as on heywajih.com: stiff, and with
// rounder cats the lines turned them into drawings with stars on top.)
//
// Hover: sweep the cursor quickly across the sky and a shooting star streaks
// off the way it was going (at most one every couple of seconds).
//
// Reactions: a new message is a shooting star in the app's colour whose trail
// lingers and fades over the afterglow; every app with something waiting is a
// bright star in its colour, twinkling in the upper sky, until you rest the
// cursor on it (it then shoots off); a flash lights up every star.
//
// Drawing: the scene is sparse, so instead of working out every cell's light,
// each frame puts only the cells that hold something
// into a cell buffer (cells.js), which the CPU draws as text and the GPU from
// a texture. Colours go through the same tone map as nightscene.js ink().
//
// Options: ?tint=natural|cool|warm|grey|green ?pose=sitting|sleeping|loaf|
// peeking|reaching|walking|stretching|yarn|pair (keep to one) ?side=any (use
// the whole sky; the left fifth is kept clear for desktop icons by default)
// ?size=0.3-2.5 ?fx=0 (no shooting stars from the cursor)

import { num, hash, params, HOVER, HOVER_FX, pointer, stillFor, onReaction, seenLantern, STILL } from "./common.js";
import { CONSTELLATION } from "./palettes.js";
import { startScene, setPalette, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";

const SIZE = num("size", 1, 0.3, 2.5);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const C = (r, g, b) => [r / 255, g / 255, b / 255];
const scale = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const add = (a, b, f = 1) => [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f];

// ---- palettes ----
const COL = CONSTELLATION[params.get("tint")] ?? CONSTELLATION.natural;

// ---- the cats: outlines (x right, y down, about -1..1) the stars gather along ----
// A head: round cheeks and two pointed ears. Strokes join at the ear tips; a
// stroke of three or more points is a curve.
function head(x, y, r, tilt = 0) {
  const c = Math.cos(tilt), n = Math.sin(tilt), at = ([a, b]) => [x + (a * c - b * n) * r, y + (a * n + b * c) * r];
  const L = [-0.8, -1.12], T = [0.8, -1.12], face = [[0.92, -0.28], [1.04, 0.16], [0.78, 0.6], [0, 0.82], [-0.78, 0.6], [-1.04, 0.16], [-0.92, -0.28]];
  return {
    at,
    strokes: [[[-0.92, -0.28], L], [L, [-0.34, -0.74]], [[-0.34, -0.74], [0, -0.79], [0.34, -0.74]], [[0.34, -0.74], T], [T, [0.92, -0.28]], face].map((k) => k.map(at)),
    mask: [...face, [-0.8, -1.05], [-0.34, -0.74], [0.34, -0.74], [0.8, -1.05]].map(at), // hides what is behind it
    ears: [at(L), at(T)],
  };
}
// eyes: open (they blink), happy or asleep. tips: the bright stars, besides the
// ears. gold: strokes in the gold of the names. cut: the head is hidden below this.
const POSES = [
  {
    name: "felis sedens", // sitting up, tail curled
    heads: [head(0, -0.4, 0.52)], eyes: "open",
    body: [[[-0.34, -0.1], [-0.5, 0.36], [-0.5, 0.74], [-0.3, 0.92], [0, 0.93], [0.3, 0.92], [0.5, 0.74], [0.5, 0.36], [0.34, -0.1]], [[-0.13, 0.5], [-0.15, 0.91]], [[0.13, 0.5], [0.15, 0.91]], [[0.48, 0.8], [0.82, 0.84], [1.02, 0.62], [0.92, 0.36], [0.74, 0.44]]],
    tips: [[-0.15, 0.91], [0.15, 0.91], [0.74, 0.44]],
  },
  {
    name: "felis dormiens", // curled up asleep
    heads: [head(-0.45, 0.22, 0.45, -0.1)], eyes: "asleep", zzz: [-0.1, -0.6],
    body: [[[-0.5, 0], [-0.1, -0.36], [0.4, -0.42], [0.85, -0.16], [1.04, 0.28], [0.86, 0.62], [0.4, 0.8], [-0.15, 0.8], [-0.5, 0.7]], [[1, 0.42], [0.72, 0.5], [0.3, 0.5], [0.02, 0.42]], [[0.5, 0.06], [0.28, 0.24], [0.24, 0.5]]],
    tips: [[0.02, 0.42], [0.4, -0.42]],
  },
  {
    name: "felis panis", // a loaf
    heads: [head(-0.36, -0.22, 0.48)], eyes: "happy",
    body: [[[-0.2, -0.3], [0.3, -0.38], [0.8, -0.2], [1.04, 0.2], [0.98, 0.58], [0.6, 0.68], [0, 0.7], [-0.6, 0.68], [-0.96, 0.56], [-0.98, 0.2], [-0.7, 0]], [[-0.52, 0.66], [-0.38, 0.52], [-0.22, 0.54], [-0.14, 0.68]], [[1, 0.5], [0.72, 0.42], [0.5, 0.5]]],
    tips: [[0.5, 0.5], [0.8, -0.2]],
  },
  {
    name: "felis curiosa", // peeking over the horizon, paws on the edge
    heads: [head(0, 0.06, 0.72)], eyes: "open", cut: 0.5,
    body: [[[-1.35, 0.5], [-1.12, 0.5]], [[-0.62, 0.5], [0.62, 0.5]], [[1.12, 0.5], [1.35, 0.5]]],
    front: [-1, 1].flatMap((m) => [[[1.12 * m, 0.5], [1.1 * m, 0.34], [0.87 * m, 0.24], [0.64 * m, 0.34], [0.62 * m, 0.5]], [[1.12 * m, 0.5], [1.06 * m, 0.64], [0.87 * m, 0.68], [0.68 * m, 0.64], [0.62 * m, 0.5]], [[0.95 * m, 0.52], [0.95 * m, 0.64]], [[0.79 * m, 0.52], [0.79 * m, 0.64]]]),
    tips: [[-1.35, 0.5], [1.35, 0.5]],
  },
  {
    name: "felis et stella", // reaching for a star
    heads: [head(-0.2, -0.3, 0.47, 0.16)], eyes: "open", prize: [0.94, -0.84],
    body: [[[-0.42, 0], [-0.6, 0.42], [-0.56, 0.78], [-0.3, 0.92], [0.2, 0.92], [0.46, 0.76], [0.44, 0.4], [0.3, 0.2]], [[0.1, 0.1], [0.4, 0], [0.62, -0.28], [0.74, -0.56], [0.9, -0.52], [0.86, -0.28], [0.66, 0.1], [0.3, 0.34]], [[-0.1, 0.55], [-0.1, 0.91]], [[-0.54, 0.8], [-0.88, 0.86], [-1.08, 0.62], [-1, 0.36], [-0.84, 0.42]]],
    tips: [[-0.84, 0.42], [-0.1, 0.91]],
  },
  {
    name: "felis ambulans", // a kitten trotting, tail up
    heads: [head(-0.52, -0.24, 0.46)], eyes: "happy",
    body: [[[-0.2, -0.1], [0.15, -0.02], [0.5, -0.1], [0.72, 0.1], [0.76, 0.4], [0.9, 0.66], [0.84, 0.78], [0.68, 0.74], [0.54, 0.46]], [[0.54, 0.46], [0.1, 0.5], [-0.32, 0.46]], [[-0.32, 0.46], [-0.5, 0.72], [-0.66, 0.78], [-0.74, 0.66], [-0.6, 0.44], [-0.58, 0.1]], [[-0.22, 0.48], [-0.16, 0.76], [-0.02, 0.77]], [[0.34, 0.48], [0.26, 0.76], [0.4, 0.77]], [[0.62, -0.02], [0.9, -0.26], [0.96, -0.64], [0.84, -0.92], [1.04, -1]]],
    tips: [[1.04, -1], [-0.66, 0.78], [0.84, 0.78], [0.96, -0.64]],
  },
  {
    name: "felis extensa", // the big stretch
    heads: [head(-0.62, 0.22, 0.4, -0.08)], eyes: "happy",
    body: [[[-0.4, 0.06], [0, -0.04], [0.3, -0.36], [0.64, -0.56], [0.92, -0.36], [0.96, 0.06], [0.9, 0.44], [0.98, 0.74], [0.74, 0.78], [0.6, 0.5], [0.52, 0.2]], [[0.52, 0.2], [0.16, 0.36], [-0.2, 0.62]], [[-0.2, 0.62], [-0.7, 0.8], [-1.12, 0.78], [-1.14, 0.6], [-0.8, 0.56]], [[0.82, -0.48], [1.08, -0.72], [1.1, -1.02], [0.9, -1.12]]],
    tips: [[0.9, -1.12], [-1.12, 0.78], [0.64, -0.56], [0.98, 0.74]],
  },
  {
    name: "felis ludens", // with a ball of yarn
    heads: [head(-0.42, -0.22, 0.47, 0.1)], eyes: "open",
    body: [[[-0.2, -0.1], [0.16, 0.06], [0.36, 0.4], [0.32, 0.76], [0.04, 0.88], [-0.5, 0.88], [-0.76, 0.72], [-0.74, 0.3], [-0.6, 0]], [[0.16, 0.2], [0.46, 0.22], [0.64, 0.38], [0.56, 0.54], [0.34, 0.54]], [[-0.36, 0.56], [-0.38, 0.87]], [[-0.72, 0.78], [-1, 0.8], [-1.14, 0.54], [-1.02, 0.32], [-0.9, 0.4]]],
    gold: [[[0.96, 0.36], [1.24, 0.62], [0.96, 0.88], [0.68, 0.62], [0.96, 0.36]], [[0.78, 0.46], [1, 0.6], [1.06, 0.84]], [[0.76, 0.76], [0.98, 0.64], [1.18, 0.5]], [[1.12, 0.84], [1.28, 0.92], [1.42, 0.8]]],
    tips: [[-0.9, 0.4], [-0.38, 0.87]],
  },
  {
    name: "felis amantes", // two from behind, tails in a heart
    heads: [head(-0.74, -0.2, 0.36), head(0.74, -0.2, 0.36)],
    body: [-1, 1].map((m) => [[0.96 * m, -0.04], [1.14 * m, 0.4], [1.08 * m, 0.78], [0.74 * m, 0.88], [0.42 * m, 0.78], [0.38 * m, 0.4], [0.54 * m, -0.04]]),
    gold: [-1, 1].flatMap((m) => [[[0.44 * m, 0.76], [0.2 * m, 0.86], [0, 0.7]], [[0, 0.7], [0.26 * m, 0.42], [0.3 * m, 0.16], [0.16 * m, 0.04], [0, 0.2]]]),
    tips: [[0, 0.2], [0, 0.7]],
  },
];
// The order they come in, so neighbours look different
const ORDER = [0, 1, 4, 3, 2, 5, 7, 6, 8];
const CYCLE = 23; // seconds per pose
const FIXED = ["sitting", "sleeping", "loaf", "peeking", "reaching", "walking", "stretching", "yarn", "pair"].indexOf(params.get("pose"));
// Timeline within a pose: the stars gather (0-5 s), eyes (from 4 s), name (from
// 5.5 s), hold, the stars go out one by one (18-21.5 s), a breath of empty sky

// Sky placement: each cat in a different part of the sky, stepping by the
// golden ratio; every few cycles a second, different cat forms elsewhere at
// the same time. The left fifth stays clear for desktop icons unless ?side=any.
const ANYWHERE = params.get("side") === "any";
const PAIR_EVERY = 0.28; // share of cycles that show two cats
let dims, R, cellW, cellH, cols, rows;
const frac = (v) => v - Math.floor(v);
function spot(fx, fy) {
  const left = (ANYWHERE || dims.A < 1.3 ? 0 : dims.A * 0.2) + R * 1.45;
  const right = dims.A - R * 1.45;
  const top = R * 1.15 + 0.03, bottom = 1 - R * 0.9 - 0.07;
  return [left + fx * Math.max(0, right - left), top + fy * Math.max(0, bottom - top)];
}
// The cats on screen right now: [{ pose, cx, cy, u (seconds in), fade }]
function current(t) {
  if (reduced) {
    const [cx, cy] = spot(0.6, 0.4);
    return [{ pose: POSES[Math.max(0, FIXED)], cx, cy, u: 15, fade: 1 }];
  }
  const k = Math.floor(t / CYCLE);
  const u = t - k * CYCLE;
  const fade = 1 - smooth(18, 21.5, u);
  const pick = (n) => POSES[FIXED >= 0 ? FIXED : ORDER[((n % ORDER.length) + ORDER.length) % ORDER.length]];
  const fx = frac(k * 0.618 + 0.37), fy = frac(k * 0.382 + 0.21);
  const [cx, cy] = spot(fx, fy);
  const cats = [{ pose: pick(k), cx, cy, u, fade }];
  if (FIXED < 0 && hash(k, 7, 77) < PAIR_EVERY) {
    const [cx2, cy2] = spot(frac(fx + 0.5), frac(fy + 0.45));
    cats.push({ pose: pick(k + 3), cx: cx2, cy: cy2, u: u - 2.2, fade });
  }
  return cats;
}
const place = (cat, p) => [cat.cx + p[0] * R, cat.cy + p[1] * R];
const toCell = (x, y) => [Math.floor(x / cellW), Math.floor(y / cellH)];

// ---- light to colour: nightscene.js ink()'s tone map ----
const RAMP = " .:-=+*oO#%@";
function tone(col) {
  const L = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
  const T = 1 - Math.exp(-L * 2.2);
  const top = Math.max(col[0], col[1], col[2], 1e-4);
  const f = 0.3 + 0.85 * T, hot = Math.max(0, T - 0.8) * 2.5;
  return { T, rgb: col.map((v) => { const c = (v / top) * f; return c + (1 - c) * hot * 0.6; }) };
}
// a light-only cell: blank below a dithered cut-off, else a character by brightness
function light(c, r, col) {
  const { T, rgb } = tone(col);
  if (T < 0.045 + 0.06 * hash(c, r, 5)) return;
  cells.putAt(c, r, RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(T * (RAMP.length - 1))))], rgb);
}
const draw = (c, r, chr, col) => cells.putAt(c, r, chr, tone(col).rgb);
// - | / \ by the slope of a line on screen (cells are taller than wide)
function slopeChar(dx, dy) {
  const ang = Math.atan2(dy, dx * (cellH / cellW) * 0.6);
  const a = Math.abs(ang) > Math.PI / 2 ? ang - Math.sign(ang) * Math.PI : ang; // fold to -90..90
  return Math.abs(a) < 0.4 ? "-" : Math.abs(a) > 1.17 ? "|" : a < 0 ? "/" : "\\";
}

const cells = cellBuffer(RAMP.slice(1) + "|/\\_'zABCDEFGHIJKLMNOPQRSTUVWXYZ");

// ---- the starfield: which cells hold a background star never changes ----
let SKY = []; // [c, r, h]
function layout(d) {
  dims = d;
  R = Math.min(0.145, d.A * 0.14) * SIZE;
  cellW = d.cw / d.H;
  cellH = d.ch / d.H;
  cols = d.cols;
  rows = d.rows;
  cells.resize(cols, rows);
  for (const p of POSES) p.dust = null; // gathered again at this size
  for (const l of lanterns) [l.x, l.y] = lanternSpot(l.i); // the screen changed
  SKY = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const X = (c + 0.5) * cellW, Y = (r + 0.5) * cellH;
      const band = Math.exp(-(((X * 0.45 + Y - 0.25 - d.A * 0.2) / 0.22) ** 2)); // the milky way, thicker with stars
      const h = hash(c, r, 21);
      if (h < 0.004 + 0.008 * band) SKY.push([c, r, h, band, X, Y]);
    }
}
function drawSky(t, flash) {
  for (const [c, r, h, band, X, Y] of SKY) {
    const tw = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(t * (0.4 + h * 300) + h * 900);
    let col = add(COL.sky, COL.dust, 0.03 * band * (0.7 + 0.3 * Math.sin(X * 23 + Y * 31)));
    col = add(col, COL.star, (0.12 + 0.5 * ((h * 250) % 1)) * tw * (1 + 2.5 * flash));
    const { T, rgb } = tone(col);
    if (T >= 0.045 + 0.06 * hash(c, r, 5) || h < 0.0012) cells.putAt(c, r, h < 0.0012 ? "+" : ".", rgb);
  }
}

// ---- a cat ----
const inside = (pts, x, y) => {
  let on = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if (pts[i][1] > y !== pts[j][1] > y && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) on = !on;
  return on;
};
// a smooth curve through the points (Catmull-Rom)
function curve(pts) {
  const n = pts.length, loop = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 1e-6, out = [];
  if (n < 3) return pts;
  const at = (i) => (loop ? pts[(i + (n - 1) * 2) % (n - 1)] : pts[clamp(i, 0, n - 1)]);
  for (let i = 0; i < n - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < 10; k++) {
      const t = k / 10;
      out.push([0, 1].map((q) => 0.5 * (2 * b[q] + (c[q] - a[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t * t + (3 * b[q] - a[q] - 3 * c[q] + d[q]) * t * t * t)));
    }
  }
  out.push(pts[n - 1]);
  return out;
}
// The stars of a cat at this screen size, once: { x, y, h: random, at: when it
// appears (s), m: 0 dust, 1 a star with a small halo, 2 a bright one, gold }
function gather(pose) {
  const dust = [], taken = new Set(), masks = pose.heads.map((h) => h.mask), paws = (pose.front ?? []).filter((k) => k.length > 3);
  const behind = (x, y) => masks.some((m) => inside(m, x, y));
  const sunk = (x, y) => pose.cut && (y > pose.cut - 0.02 || paws.some((m) => inside(m, x, y)));
  const add = (x, y, h, at, m, gold) => {
    const key = Math.round((x * R) / cellW) + "," + Math.round((y * R) / cellH);
    if (taken.has(key)) return;
    taken.add(key);
    dust.push({ x, y, h, at, m, gold });
  };
  const ears = pose.heads.flatMap((h) => h.ears);
  [...ears, ...pose.tips].forEach(([x, y], i) => add(x, y, hash(i, 3, 4), 0.25 * i, 2, false));
  const strokes = [
    ...pose.heads.flatMap((h) => h.strokes).map((k) => [k, sunk]),
    ...pose.body.map((k) => [k, pose.cut ? null : behind]),
    ...(pose.front ?? []).map((k) => [k, null]),
    ...(pose.gold ?? []).map((k) => [k, null, true]),
  ];
  const gap = (1.2 * cellH) / R, off = (0.22 * cellH) / R;
  strokes.forEach(([k, hidden, gold], q) => {
    const pts = curve(k), len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = len[len.length - 1], n = Math.max(1, Math.round(L / gap));
    for (let i = 0, j = 1; i <= n; i++) {
      const d = (L * i) / n;
      while (j < pts.length - 1 && len[j] < d) j++;
      const t = (d - len[j - 1]) / (len[j] - len[j - 1] || 1), h = hash(q * 50 + i, 7, 3);
      const x = pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t + (hash(q, i, 8) - 0.5) * 2 * off, y = pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t + (hash(q, i, 9) - 0.5) * 2 * off;
      if (!hidden?.(x, y)) add(x, y, h, 0.6 + (q / strokes.length) * 2.6 + i * 0.03, h < 0.07 ? 1 : 0, !!gold);
    }
  });
  return dust;
}
const WARM = add(scale(COL.bright, 0.6), COL.label, 0.4); // the eyes
// a star's soft halo, only where the sky is empty
function halo(c0, r0, col, power, spread) {
  for (let r = r0 - 3; r <= r0 + 3; r++)
    for (let c = c0 - 5; c <= c0 + 5; c++) {
      const i = r * cols + c;
      if (c < 0 || r < 0 || c >= cols || r >= rows || cells.has(i)) continue;
      const g = power * Math.exp(-(((c - c0) * cellW) ** 2 + ((r - r0) * cellH) ** 2) / (spread * cellH * cellH));
      if (g > 0.09) cells.put(i, g > 0.3 ? ":" : ".", scale(col, g));
    }
}
function rays(c, r, col, k) {
  for (const [x, y, g] of [[-1, 0, "-"], [1, 0, "-"], [0, -1, "'"], [0, 1, "'"]]) cells.putAt(c + x, r + y, g, scale(col, k));
}
function drawCat(cat, t, flash) {
  const { pose, u, fade } = cat;
  if (fade <= 0 || u <= 0) return;
  pose.dust ??= gather(pose);
  const lit = 1 + 0.6 * flash, halos = [];
  for (const p of pose.dust) {
    // in one after another, out one by one
    const a = smooth(0, 0.8, u - p.at) * clamp(fade * 1.7 - p.h * 0.7);
    if (a <= 0.02) continue;
    const [c, r] = toCell(...place(cat, [p.x, p.y])), tw = reduced ? 0.9 : 0.78 + 0.22 * Math.sin(t * (0.8 + p.h * 2) + p.h * 40);
    const col = p.gold ? COL.label : p.m || p.h < 0.18 ? COL.bright : COL.star, k = a * tw * lit;
    if (p.m === 2) rays(c, r, COL.bright, 0.6 * k);
    cells.putAt(c, r, p.m ? "*" : p.h < 0.3 ? "+" : p.h < 0.5 ? ":" : ".", scale(col, k * (p.m || p.gold ? 1 : p.h < 0.5 ? 0.88 : 0.76)));
    if (p.m) halos.push([c, r, COL.star, k * (p.m === 2 ? 0.6 : 0.36), p.m === 2 ? 2.1 : 1.2]);
  }
  // the face: eyes and nose are stars
  const e = smooth(4, 5.2, u) * fade * lit;
  if (pose.eyes && e > 0.02) {
    const h = pose.heads[0];
    const blink = !reduced && pose.eyes === "open" && (t + cat.cx * 7) % 5.3 < 0.2;
    for (const side of [-0.4, 0.4]) {
      const [c, r] = toCell(...place(cat, h.at([side, 0.06])));
      if (pose.eyes === "open" && !blink) {
        rays(c, r, WARM, 0.6 * e);
        cells.putAt(c, r, "*", scale(WARM, e));
        halos.push([c, r, WARM, 0.55 * e, 2]);
      } else {
        // shut: a little arc of faint stars
        const arc = pose.eyes === "happy" ? [[-2, 0, "."], [-1, 0, "'"], [0, -1, "+"], [1, 0, "'"], [2, 0, "."]] : [[-2, 0, "'"], [-1, 0, "."], [0, 0, "+"], [1, 0, "."], [2, 0, "'"]];
        for (const [x, y, g] of arc) cells.putAt(c + x, r + y, g, scale(WARM, 0.85 * e));
      }
    }
    const [c, r] = toCell(...place(cat, h.at([0, 0.36])));
    cells.putAt(c, r, "+", scale(WARM, 0.7 * e));
  }
  for (const k of halos) halo(...k);
  if (pose.zzz)
    ["z", "z", "Z"].forEach((g, n) => {
      const [c, r] = toCell(...place(cat, [pose.zzz[0] + n * 0.13, pose.zzz[1] - n * 0.16]));
      const k = reduced ? 0.6 : 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.4 - n * 1.1));
      if (e > 0.02) cells.putAt(c, r, g, scale(COL.label, k * e));
    });
  if (pose.prize) {
    const [c, r] = toCell(...place(cat, pose.prize)), k = smooth(0, 1.2, u) * fade * (reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 2)) * lit;
    for (const [x, y, g] of [[-2, 0, "-"], [2, 0, "-"], [0, -2, "'"], [0, 2, "'"]]) cells.putAt(c + x, r + y, g, scale(COL.bright, 0.4 * k));
    rays(c, r, COL.bright, 0.8 * k);
    cells.putAt(c, r, "*", scale(COL.bright, k));
    halo(c, r, COL.star, 0.7 * k, 3);
  }
  // its name
  const la = smooth(5.5, 7, u) * fade;
  if (la > 0) {
    const text = pose.name.toUpperCase().split("").join(" ");
    const [c, r] = toCell(cat.cx, cat.cy + R + 0.03);
    [...text].forEach((ch, i) => ch !== " " && draw(c - Math.floor(text.length / 2) + i, r, ch, scale(COL.label, la)));
  }
}

// ---- shooting stars: from a quick sweep of the cursor, or a new message ----
// { x, y, dx, dy (unit), at, colour, speed, life (s moving), tail, linger (s:
// how long the trail stays after the head stops; 0 for none) }
let shots = [];
let lastSweep = -1e9;
function shoot(x, y, dx, dy, at, colour, { speed = 1.1, life = 0.9, tail = 0.17, linger = 0 } = {}) {
  shots.push({ x, y, dx, dy, at, colour, speed, life, tail, linger });
  if (shots.length > 6) shots.shift();
}
function drawShots(t) {
  if (HOVER_FX && pointer.on && dims && !reduced) {
    const speed = Math.hypot(pointer.vx, pointer.vy);
    if (stillFor() < 0.08 && speed > 1300 && t - lastSweep > 2.5) {
      shoot(pointer.x / dims.H, pointer.y / dims.H, pointer.vx / speed, pointer.vy / speed, t, COL.bright);
      lastSweep = t;
    }
  }
  shots = shots.filter((s) => t - s.at < s.life + s.linger * 4);
  for (const s of shots) {
    const age = t - s.at;
    const moving = age < s.life;
    const head = s.speed * Math.min(age, s.life);
    // moving: bright, fading towards the end of its run; then (a message's
    // star) the trail lingers and fades away slowly: the afterglow
    const fade = moving ? (s.linger ? 1 - 0.35 * (age / s.life) : 1 - age / s.life) : 0.65 * Math.exp(-(age - s.life) / s.linger);
    if (fade < 0.02) continue;
    const len = Math.min(head, s.tail);
    const chr = slopeChar(s.dx, s.dy);
    const seen = new Set();
    for (let d = 0; d <= len; d += cellW * 0.6) {
      const [c, r] = toCell(s.x + s.dx * (head - d), s.y + s.dy * (head - d));
      const k = r * cols + c;
      if (seen.has(k)) continue;
      seen.add(k);
      const along = 1 - d / s.tail; // bright at the head, fading down the tail
      const isHead = d === 0 && moving;
      draw(c, r, isHead ? "*" : chr, scale(s.colour, (isHead ? 1.8 : 1.2 * along) * fade));
    }
  }
}

// ---- waiting apps: a bright star each, in its colour, in the upper sky ----
let lanterns = []; // [{ source, colour 0..1, x, y }]
let overSince = null;
function lanternSpot(i) {
  const left = (ANYWHERE || dims.A < 1.3 ? 0.06 : dims.A * 0.22), right = dims.A - 0.06;
  return [left + frac(0.31 + i * 0.618) * (right - left), 0.07 + frac(0.17 + i * 0.382) * 0.26];
}
function drawLanterns(t) {
  lanterns.forEach((l, i) => {
    const [c0, r0] = toCell(l.x, l.y);
    const breathe = reduced ? 1 : 0.8 + 0.2 * Math.sin((t * Math.PI * 2) / 4 + i * 1.7);
    // a soft halo, then the star itself
    for (let r = r0 - 2; r <= r0 + 2; r++)
      for (let c = c0 - 4; c <= c0 + 4; c++) {
        if (c === c0 && r === r0) continue;
        const X = (c + 0.5) * cellW, Y = (r + 0.5) * cellH;
        const g = 0.5 * breathe * Math.exp(-((X - l.x) ** 2 + ((Y - l.y) * 0.8) ** 2) / 0.00012);
        if (g > 0.03) light(c, r, scale(l.colour, g));
      }
    draw(c0, r0, "*", scale(mixWhite(l.colour, 0.3), 1.8 * breathe));
  });
  // rest the cursor on one for 0.8 s: seen
  if (!HOVER || !pointer.on || !lanterns.length) return void (overSince = null);
  const X = pointer.x / dims.H, Y = pointer.y / dims.H;
  const l = lanterns.find((l) => Math.hypot(X - l.x, Y - l.y) < 0.035);
  if (!l) return void (overSince = null);
  if (overSince?.source !== l.source) overSince = { source: l.source, at: performance.now() };
  else if (performance.now() - overSince.at > 800) {
    seenLantern(l.source);
    overSince = null;
  }
}
const mixWhite = (c, f) => c.map((v) => v + (1 - v) * f);

let flashAt = -1e9, nowT = 0;
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour) && dims) {
    // a shooting star in the app's colour across the upper sky
    const colour = mixWhite(r.colour.map((v) => v / 255), 0.15);
    const right = Math.random() < 0.5;
    const left = ANYWHERE || dims.A < 1.3 ? 0.1 : dims.A * 0.3;
    const x = left + Math.random() * (dims.A - left - 0.1), y = 0.06 + Math.random() * 0.22;
    const a = (right ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 0.3;
    shoot(x, y, Math.cos(a), Math.sin(a), nowT, colour, { speed: 0.45, life: 1.1, tail: 0.3, linger: Math.max(1, (r.afterglow ?? 6) / 3) });
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns" && dims) {
    const items = Array.isArray(r.items) ? r.items.filter((l) => Array.isArray(l.colour)) : [];
    // a star that's been seen (or read elsewhere) shoots off
    for (const l of lanterns)
      if (!items.some((it) => it.source === l.source)) shoot(l.x, l.y, 0.8, 0.6, nowT, l.colour, { speed: 0.9, life: 0.8, tail: 0.15 });
    // each keeps its place while others come and go
    const kept = items.slice(0, 8).map((it) => lanterns.find((l) => l.source === it.source)), taken = new Set(kept.filter(Boolean).map((l) => l.i));
    lanterns = items.slice(0, 8).map((it, n) => {
      let i = kept[n]?.i;
      if (i == null) {
        for (i = 0; taken.has(i); ) i++;
        taken.add(i);
      }
      const [x, y] = lanternSpot(i);
      return { source: it.source, colour: it.colour.map((v) => v / 255), x, y, i };
    });
  }
});

function frame(t) {
  nowT = t;
  if (!dims) return;
  const flash = Math.max(0, 1 - (t - flashAt) / 0.8);
  cells.clear();
  const cats = current(t);
  drawSky(t, flash);
  for (const cat of cats) drawCat(cat, t, flash);
  drawLanterns(t);
  drawShots(t);
}

setPalette();
startScene({
  label: "Cat constellations: stars gathering in different parts of a night sky into cats, sitting, sleeping, playing, drawn in coloured text characters.",
  fps: 15,
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
