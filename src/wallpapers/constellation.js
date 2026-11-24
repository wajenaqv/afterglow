// Constellation: cats in the stars. On a quiet
// starfield with a faint band of milky way, a handful of brighter stars fade
// in somewhere in the sky, then faint lines draw from star to star like a
// star chart until they make a small cat: sitting, asleep, strolling, its
// face, pouncing, a loaf, stretching. Its name appears underneath ("felis
// sedens" ...), it holds a while, dissolves, and the next forms somewhere
// else. Now and then two cats form at once in different parts of the sky.
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
// Options: ?tint=natural|cool|warm|grey|green ?pose=sitting|sleeping|walking|
// face|pouncing|loaf|stretching (keep to one) ?side=any (use the whole sky;
// the left fifth is kept clear for desktop icons by default) ?size=0.3-2.5

import { num, hash, params, HOVER, pointer, stillFor, onReaction, seenLantern, STILL } from "./common.js";
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
const TINTS = {
  natural: { sky: C(1, 2, 6), dust: C(70, 60, 130), star: C(225, 232, 255), bright: C(255, 244, 220), line: C(120, 160, 235), label: C(215, 170, 85) }, // the names in a chart's gold
  cool: { sky: C(0, 3, 8), dust: C(40, 80, 140), star: C(200, 230, 255), bright: C(225, 245, 255), line: C(80, 185, 255), label: C(90, 140, 190) },
  warm: { sky: C(6, 2, 2), dust: C(130, 70, 60), star: C(255, 235, 210), bright: C(255, 225, 175), line: C(255, 160, 90), label: C(190, 135, 100) },
  grey: { sky: C(3, 3, 3), dust: C(90, 90, 95), star: C(225, 225, 230), bright: C(250, 250, 250), line: C(160, 165, 175), label: C(130, 132, 138) },
  green: { sky: C(0, 4, 2), dust: C(40, 110, 80), star: C(51, 255, 153), bright: C(255, 255, 255), line: C(125, 255, 192), label: C(77, 143, 110) },
};
const COL = TINTS[params.get("tint")] ?? TINTS.natural;

// ---- the cats: stars (x right, y down, about -1..1) and the lines between them ----
const POSES = [
  {
    name: "felis sedens", // sitting, facing left: ears, head, chest down to a front paw, the back sloping to the haunch, the tail curling up from the base
    stars: [[-0.55, -0.5], [-0.62, -1.0], [-0.44, -0.78], [-0.24, -1.0], [-0.14, -0.6], [-0.46, -0.12], [-0.42, 0.75], [0.16, -0.24], [0.46, 0.28], [0.34, 0.75], [0.78, 0.7], [0.98, 0.4]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [4, 7], [7, 8], [8, 9], [9, 6], [9, 10], [10, 11]],
  },
  {
    name: "felis dormiens", // curled up asleep: an oval, the head with its ears at one end, the tail wrapping round to meet it
    stars: [[-0.88, -0.22], [-0.86, -0.64], [-0.67, -0.47], [-0.5, -0.72], [-0.05, -0.64], [0.45, -0.5], [0.82, -0.06], [0.68, 0.42], [0.2, 0.7], [-0.35, 0.66], [-0.72, 0.4], [-0.62, 0.08]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11]],
  },
  {
    name: "felis ambulans", // strolling, tail up
    stars: [[-0.98, 0.1], [-0.98, -0.18], [-1.02, -0.44], [-0.85, -0.26], [-0.68, -0.44], [-0.6, -0.12], [-0.15, -0.16], [0.45, -0.4], [0.76, -0.68], [0.62, -1.0], [-0.72, 0.26], [-1.08, 0.56], [-0.6, 0.56], [0.2, 0.08], [0.45, 0.56], [0.62, 0.56]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [0, 10], [10, 11], [10, 12], [10, 13], [13, 14], [7, 15]],
  },
  {
    name: "caput felis", // a cat's face: ears, cheeks, eyes, nose and whiskers
    stars: [[-0.5, -0.45], [-0.72, -0.98], [-0.9, -0.28], [-0.86, 0.22], [-0.46, 0.62], [0, 0.76], [0.46, 0.62], [0.86, 0.22], [0.9, -0.28], [0.72, -0.98], [0.5, -0.45], [0, -0.52], [-0.38, -0.06], [0.38, -0.06], [0, 0.24], [-1.3, 0.1], [-1.25, 0.42], [1.3, 0.1], [1.25, 0.42]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 0], [14, 5], [14, 15], [14, 16], [14, 17], [14, 18]],
  },
  {
    name: "felis saliens", // leaping to the right: head and ears in front, the spine level, front legs reaching, back legs pushing off, the tail streaming behind
    stars: [[0.7, -0.66], [0.88, -0.64], [1.04, -0.4], [0.72, -0.34], [0.45, -0.24], [-0.05, -0.3], [-0.5, -0.2], [-0.95, -0.48], [-1.22, -0.36], [0.66, 0.06], [1.02, 0.24], [-0.72, 0.16], [-1.06, 0.42], [0.02, 0.04]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [4, 9], [9, 10], [6, 11], [11, 12], [9, 13], [13, 11]],
  },
  {
    name: "felis panis", // a loaf: paws tucked in, tail wrapped round
    stars: [[-0.95, -0.38], [-0.82, -0.74], [-0.67, -0.5], [-0.5, -0.76], [-0.36, -0.42], [0.12, -0.5], [0.7, -0.42], [0.96, -0.04], [0.86, 0.4], [-0.9, 0.4], [-1.02, 0.02], [0.55, 0.24], [0.1, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 0], [7, 11], [11, 12]],
  },
  {
    name: "felis extensa", // the long stretch, facing left: head low with its ears, front paws reaching forward, the rump high, the tail up, a back leg down
    stars: [[-0.95, 0.18], [-0.98, -0.08], [-1.0, -0.34], [-0.85, -0.2], [-0.7, -0.36], [-0.6, -0.06], [-0.5, 0.3], [-0.8, 0.5], [-1.2, 0.58], [0.1, -0.18], [0.52, -0.48], [0.74, -0.88], [0.6, -1.1], [0.66, 0.06], [0.62, 0.6], [0.1, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 9], [0, 6], [6, 7], [7, 8], [6, 15], [15, 13], [9, 10], [10, 11], [11, 12], [10, 13], [13, 14]],
  },
];
// The order they come in, so neighbours look different
const ORDER = [0, 3, 1, 4, 2, 5, 6];
const CYCLE = 23; // seconds per pose
const FIXED = ["sitting", "sleeping", "walking", "face", "pouncing", "loaf", "stretching"].indexOf(params.get("pose"));
// Timeline within a pose: stars fade in (0-1.5 s), lines draw quickly
// (1.8-5.8 s), name (from 5.5 s), hold, everything fades (18-21.5 s), a
// breath of empty sky
const STAR_STEP = 0.08, STAR_FADE = 0.7, LINE_DRAW = 0.4;
const lineTime = (i, n) => 1.8 + (i / n) * 3.6;

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

// A line one character wide, the way you'd draw it by hand: walk the long axis
// (in cells, taller than wide) one cell at a time; steep = | with a slash at
// each sideways step (all slashes near 45 degrees), shallow = ' - . _ by where
// the line crosses the cell, so long shallow lines curve gently. (A distance
// test, every cell near the line, drew steep and diagonal lines two characters
// wide: || and //.) fn(c, r, chr, k, n) per cell, start to end.
const SUBROW = "'-._";
function rasterLine(ax, ay, bx, by, fn) {
  const x0 = ax / cellW, y0 = ay / cellH, x1 = bx / cellW, y1 = by / cellH;
  const dx = x1 - x0, dy = y1 - y0;
  const steep = Math.abs(dy) >= Math.abs(dx);
  const pts = [];
  if (steep) {
    const r0 = Math.floor(y0), r1 = Math.floor(y1), s = r1 >= r0 ? 1 : -1;
    for (let r = r0; r !== r1 + s; r += s) {
      const yc = clamp(r + 0.5, Math.min(y0, y1), Math.max(y0, y1));
      pts.push([Math.floor(x0 + (dy ? ((yc - y0) * dx) / dy : 0)), r]);
    }
  } else {
    const c0 = Math.floor(x0), c1 = Math.floor(x1), s = c1 >= c0 ? 1 : -1;
    for (let c = c0; c !== c1 + s; c += s) {
      const xc = clamp(c + 0.5, Math.min(x0, x1), Math.max(x0, x1));
      const y = y0 + ((xc - x0) * dy) / (dx || 1e-9);
      pts.push([c, Math.floor(y), y - Math.floor(y)]);
    }
  }
  const diag = dx * dy > 0 ? "\\" : "/";
  const n = pts.length;
  const ratio = steep ? Math.abs(dx) / (Math.abs(dy) || 1) : Math.abs(dy) / (Math.abs(dx) || 1);
  pts.forEach(([c, r, f], k) => {
    let chr;
    if (steep) {
      const nc = (pts[k + 1] ?? pts[k - 1] ?? [c])[0];
      chr = ratio > 0.6 || nc !== c ? diag : "|";
    } else chr = ratio < 0.04 ? "-" : SUBROW[Math.min(3, Math.floor(f * 4))];
    fn(c, r, chr, k, n);
  });
}
// a star's magnitude, like a chart's: 2 bright (bigger, a wider halo), 1, 0 faint
const magnitude = (pose, i) => (hash(i, pose.stars.length, 3) < 0.25 ? 2 : hash(i, pose.stars.length, 4) < 0.45 ? 1 : 0);

const cells = cellBuffer(RAMP.slice(1) + "|/\\_'ABCDEFGHIJKLMNOPQRSTUVWXYZ");

// ---- the starfield: which cells hold a background star never changes ----
let SKY = []; // [c, r, h]
function layout(d) {
  dims = d;
  R = Math.min(0.1, d.A * 0.14) * SIZE;
  cellW = d.cw / d.H;
  cellH = d.ch / d.H;
  cols = d.cols;
  rows = d.rows;
  cells.resize(cols, rows);
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

// ---- a cat: glow round its named stars, then its chart lines ----
function drawCat(cat, t) {
  const { pose, u, fade } = cat;
  if (fade <= 0 || u <= 0) return;
  // soft glow around the named stars, summed per cell
  const glow = new Map();
  pose.stars.forEach((s, i) => {
    const a = clamp((u - i * STAR_STEP) / STAR_FADE) * fade;
    if (a <= 0) return;
    const [sx, sy] = place(cat, s);
    const [c0, r0] = toCell(sx, sy);
    const m = magnitude(pose, i), k = [0.12, 0.2, 0.32][m], spread = [0.00004, 0.00006, 0.0001][m]; // bright stars glow wider
    for (let r = r0 - 3; r <= r0 + 3; r++)
      for (let c = c0 - 4; c <= c0 + 4; c++) {
        const X = (c + 0.5) * cellW, Y = (r + 0.5) * cellH;
        const g = a * k * Math.exp(-((X - sx) ** 2 + ((Y - sy) * 0.8) ** 2) / spread);
        if (g > 0.002) glow.set(r * cols + c, (glow.get(r * cols + c) ?? 0) + g);
      }
  });
  for (const [k, g] of glow) if (g > 0.01) light(k % cols, Math.floor(k / cols), add(COL.sky, COL.star, g));
  // the constellation's lines, drawn one after another, one character wide,
  // stopping a cell short of the stars
  pose.lines.forEach(([ia, ib], i) => {
    const p = clamp((u - lineTime(i, pose.lines.length)) / LINE_DRAW);
    if (p <= 0) return;
    const [ax, ay] = place(cat, pose.stars[ia]);
    const [bx0, by0] = place(cat, pose.stars[ib]);
    const bx = ax + (bx0 - ax) * p, by = ay + (by0 - ay) * p;
    const shimmer = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 1.3 + i);
    const col = add(COL.sky, COL.line, 0.8 * fade * shimmer);
    rasterLine(ax, ay, bx, by, (c, r, chr, k, n) => {
      if (k === 0 || (p >= 1 && k === n - 1)) return;
      draw(c, r, chr, col);
    });
  });
}
// on top: the named stars (bright, twinkling) and the cat's name under it
function drawCatStars(cat, t, flash) {
  const { pose, u, fade } = cat;
  if (fade <= 0 || u <= 0) return;
  pose.stars.forEach((s, i) => {
    const a = clamp((u - i * STAR_STEP) / STAR_FADE) * fade;
    if (a <= 0) return;
    const [c, r] = toCell(...place(cat, s));
    const tw = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 1.7 + i * 2.1);
    const m = magnitude(pose, i);
    draw(c, r, m ? "*" : "+", scale(COL.bright, [0.85, 1.25, 1.7][m] * a * tw * (1 + flash)));
  });
  const la = smooth(5.5, 7, u) * fade;
  if (la > 0) {
    const text = pose.name.toUpperCase().split("").join(" ");
    const [c, r] = toCell(cat.cx, cat.cy + R * 0.85 + 0.035);
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
  if (HOVER && pointer.on && dims && !reduced) {
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
    lanterns = items.slice(0, 8).map((it, i) => {
      const [x, y] = lanternSpot(i);
      return { source: it.source, colour: it.colour.map((v) => v / 255), x, y };
    });
  }
});

function frame(t) {
  nowT = t;
  if (!dims) return;
  const flash = Math.max(0, 1 - (t - flashAt) / 0.8);
  cells.clear();
  const cats = current(t);
  for (const cat of cats) drawCat(cat, t);
  drawSky(t, flash); // background stars sit over the lines
  for (const cat of cats) drawCatStars(cat, t, flash);
  drawLanterns(t);
  drawShots(t);
}

setPalette();
startScene({
  label: "Cat constellations: small groups of stars in different parts of a night sky joined by faint lines into cats, sitting, sleeping, pouncing, drawn in coloured text characters.",
  fps: 15,
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
