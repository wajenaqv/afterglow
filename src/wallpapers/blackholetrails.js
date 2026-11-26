// Black hole, drawn as orbit trails (?view=trails | sweep): the disk as a
// long exposure, after a picture the owner liked. Rings of gas orbit the
// hole, each carrying a streak or two of light, brightest at its head and
// fading behind, drifting slowly inward (so a streak is a short piece of
// spiral, not a circle); the inner orbits turn faster. Colours are mixed
// streak by streak, leaning white-hot inside and red outside (?tint=spectrum
// by default), and the approaching side is a little brighter.
//
// The light is bent by the hole for real: a table, worked out once at start,
// of where a ray from the eye with impact parameter b crosses each radius
// (Schwarzschild, u'' = 3u^2 - u, the same maths as the ray-traced views),
// turned round into "a point at radius r seen at angle phi round the hole
// shows up at b". That gives the far side of the disk bent up over the hole,
// the round shadow (b = 3 sqrt 3), and the disk's second image: light that
// went once round the hole, squeezed into a thin ring hugging the shadow
// (the photon ring is made of it, not drawn).
//
// trails: the whole hole, nearly edge-on, right of centre.
// sweep: cropped in and tilted, the hole high, the disk sweeping off the
// screen.
//
// Drawing: real thin lines, not characters (orbits drawn as characters turned
// into blocks of = and slashes, three times), with a soft glow (a blurred
// quarter-size copy added on top). Two renderers, picked like the others
// (?render=gpu|cpu): the GPU draws every orbit as one instance of a fixed
// ring of line segments, the vertex shader placing them through the table
// and fading each streak, so a frame sends only a few numbers; the CPU
// (canvas 2D) walks every streak each frame, lines of the same colour and
// strength in one path. The reactions are drawn in 2D either way (on a
// canvas over the GPU's).
//
// Reactions: a message lights a long trail in the app's colour and the
// photon ring flares in it; every app with something waiting is a bright
// clump on a slow orbit, in its colour, until you rest the cursor on it
// (then it spirals in); a flash brightens every trail. Hover (?fx=0 off):
// near the hole it feeds, the gas turning faster and brighter.
//
// Options: ?view=trails|sweep ?tint=spectrum|fire|natural|cool|green
// ?place=right ?glow=0 ?fps ?fx=0 ?hover=0

import { params, num, hash, STILL, STILL_AT, HOVER, HOVER_FX, pointer, onReaction, seenLantern, sendStill, paceFrames } from "./common.js";
import { BLACKHOLE } from "./palettes.js";
import { wantGPU } from "./gpu.js";
import { compile, QUAD_VS } from "./glyph-atlas.js";

const TAU = Math.PI * 2;
const reduced = !STILL && matchMedia("(prefers-reduced-motion: reduce)").matches;
const preview = params.has("preview");
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c) => `rgb(${Math.round(clamp(c[0]) * 255)},${Math.round(clamp(c[1]) * 255)},${Math.round(clamp(c[2]) * 255)})`;

const PAL = BLACKHOLE[params.get("tint")] ?? BLACKHOLE.spectrum;
const heat = (h) => {
  const T = PAL.heat, f = clamp(h) * (T.length - 1), i = Math.min(T.length - 2, Math.floor(f));
  return mix(T[i], T[i + 1], f - i);
};
const ODD = [[1, 0.8, 0.45], [1, 0.45, 0.35], [0.95, 0.95, 0.6]]; // a few streaks another colour

const VIEWS = {
  // elevation (degrees), the shadow's radius as a share of the screen, outer edge (M), where the hole sits, tilt
  trails: { elev: 9, size: 0.12, rout: 36, cx: 0.6, cy: 0.5, roll: 0, count: 1700, spread: 1.25, gain: 1.9, crop: false },
  sweep: { elev: 14, size: 0.095, rout: 95, cx: 0.6, cy: 0.32, ccy: 0.44, roll: -0.16, count: 2600, spread: 1.45, gain: 1.6, crop: true },
};
const VIEW = VIEWS[params.get("view")] ?? VIEWS.trails;
const CENTRE = params.get("place") !== "right"; // centred unless ?place=right (owner)
const GLOW = params.get("glow") === "0" ? 0 : 0.5;
const SHADOW = 3 * Math.sqrt(3), R_IN = 6;
const SPEED = 0.35; // rad/s at the inner edge
const SPIRAL = 0.035; // how much further out a streak's tail is, per radian behind its head
const SECOND = 0.22; // the second image's brightness (its lines pile up into a thin ring)
// orbits inside this radius also draw their second image. Off (0): it is
// right, but the near side's piles up into a hard thin arc over the shadow,
// apart from the gas, and the far side's is a loop under the hole across the
// near side; the owner found such a ring "a weird line in the disk"
const INNER = 0;
const COLOUR_BINS = 24;

// ---- the lens table ----
// b (impact parameter, M) for a point at radius r seen at angle phi round
// the hole from the eye: phi = gamma for the direct image, 2 pi - gamma for
// the one that went round the hole once. -1 where no ray gets there
const NR = 160, NPHI = 400, R_MIN = 4.5, R_MAX = 110;
const DPHI = TAU / (NPHI - 1), KS = (NR - 1) / Math.log(R_MAX / R_MIN);
const LENS = (() => {
  const BC = SHADOW, bs = [];
  for (let i = 0; i < 40; i++) bs.push(0.001 + ((BC - 3.2) * i) / 39);
  for (let i = 0; i < 120; i++) bs.push(BC - 10 ** (-4 + 3.5 * (1 - i / 119))); // spiralling in
  for (let i = 0; i < 220; i++) bs.push(BC + 10 ** (-4 + 4.5 * (i / 219))); // round the hole and out
  for (let i = 1; i <= 300; i++) bs.push(BC + 3.17 + (130 - BC - 3.17) * (i / 300) ** 1.3);
  // every ray's radius at each phi of the table (NaN: fell in, Infinity: gone)
  const SUB = 4, h = DPHI / SUB, rb = new Float64Array(bs.length * NPHI);
  const f = (u) => 3 * u * u - u;
  bs.forEach((b, i) => {
    let u = 0, v = 1 / b, state = 0;
    rb[i * NPHI] = Infinity;
    for (let j = 1; j < NPHI; j++) {
      for (let s = 0; s < SUB && state === 0; s++) {
        const k1u = v, k1v = f(u);
        const k2u = v + (h / 2) * k1v, k2v = f(u + (h / 2) * k1u);
        const k3u = v + (h / 2) * k2v, k3v = f(u + (h / 2) * k2u);
        const k4u = v + h * k3v, k4v = f(u + h * k3u);
        u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
        v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
        if (u > 0.5) state = 1;
        else if (u < 0) state = 2;
      }
      rb[i * NPHI + j] = state === 0 ? 1 / u : state === 1 ? NaN : Infinity;
    }
  });
  // turned round: for each phi, the smallest b whose ray crosses each radius there
  const tab = new Float32Array(NR * NPHI).fill(-1);
  for (let k = 0; k < NR; k++) tab[k * NPHI] = 0;
  const rAt = (k) => R_MIN * Math.exp(k / KS);
  for (let j = 1; j < NPHI; j++) {
    for (let i = 0; i + 1 < bs.length; i++) {
      const r0 = rb[i * NPHI + j], r1 = rb[(i + 1) * NPHI + j];
      if (!Number.isFinite(r0) || !Number.isFinite(r1) || !(r1 > r0)) continue;
      const ka = Math.max(0, Math.ceil(Math.log(r0 / R_MIN) * KS)), kb = Math.min(NR - 1, Math.floor(Math.log(r1 / R_MIN) * KS));
      for (let k = ka; k <= kb; k++) if (tab[k * NPHI + j] < 0) tab[k * NPHI + j] = bs[i] + ((bs[i + 1] - bs[i]) * (rAt(k) - r0)) / (r1 - r0);
    }
  }
  return tab;
})();
// kept in step with lens() in the GPU's vertex shader
function lens(r, phi) {
  const fk = clamp(Math.log(r / R_MIN) * KS, 0, NR - 1.001), fj = clamp(phi / DPHI, 0, NPHI - 1.001);
  const k = Math.floor(fk), j = Math.floor(fj), u = fj - j, w = fk - k, i = k * NPHI + j;
  const a = LENS[i], b = LENS[i + 1], c = LENS[i + NPHI], d = LENS[i + NPHI + 1];
  if (a < 0 || b < 0 || c < 0 || d < 0) return -1;
  return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
}

// ---- the orbits (fixed: seeded), innermost first ----
const ORBITS = [];
for (let k = 0; k < VIEW.count; k++) {
  const x = hash(k, 1) ** VIEW.spread; // more of them further in
  const r = R_IN + x * (VIEW.rout - R_IN);
  // colour: white-hot inside to red outside, but mixed streak by streak
  const h = clamp(1.05 - 1.15 * x ** 0.8 + (hash(k, 6) - 0.5) * 0.7);
  const odd = hash(k, 3) > 0.94;
  const trails = [];
  const nt = hash(k, 2) > 0.6 ? 2 : 1;
  for (let j = 0; j < nt; j++)
    trails.push({ a0: hash(k, 10 + j) * TAU, len: 0.25 + 1.9 * hash(k, 20 + j) ** 1.6, b: 0.12 + 0.88 * hash(k, 30 + j) ** 3 });
  ORBITS.push({
    r, x,
    env: smooth(0, 0.04, x) * (0.3 + 0.7 * (1 - x) ** 0.7) * (0.6 + 0.4 * hash(k, 7)),
    bin: odd ? COLOUR_BINS + Math.floor(hash(k, 4) * ODD.length) : Math.min(COLOUR_BINS - 1, Math.floor(h * COLOUR_BINS)),
    wide: hash(k, 5) > 0.6,
    omega: SPEED * (R_IN / r) ** 1.5,
    trails,
  });
}
ORBITS.sort((a, b) => a.r - b.r);
const N_INNER = ORBITS.filter((o) => o.r < INNER).length;
const BIN_COLOUR = [...Array.from({ length: COLOUR_BINS }, (_, b) => heat((b + 0.5) / COLOUR_BINS)), ...ODD];

// ---- the screen ----
let W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, shadowPx = 1;
const E = (VIEW.elev * Math.PI) / 180, SE = Math.sin(E), CE = Math.cos(E);
const ROLL_C = Math.cos(VIEW.roll), ROLL_S = Math.sin(VIEW.roll);
// a point of the disk (radius r, angle a) on the screen through the lens
// table; img 1 = its second image. Returns 1 behind the hole, 0 in front, -1
// nowhere. Kept in step with proj() in the GPU's vertex shader
function project(r, a, out, img = 0) {
  const ca = Math.cos(a), sa = Math.sin(a); // +sin: away from us
  const dx = ca, dy = sa * SE, depth = sa * CE;
  const g = Math.acos(clamp(-depth, -1, 1)); // angle from the eye's direction
  const b = lens(r, img ? TAU - g : g);
  if (b < 0) return -1;
  const l = Math.hypot(dx, dy) || 1e-6, s = img ? -b / l : b / l;
  const ix = dx * s, iy = dy * s;
  out[0] = cx + (ix * ROLL_C - iy * ROLL_S) * scale;
  out[1] = cy - (ix * ROLL_S + iy * ROLL_C) * scale;
  return img || depth > 0 ? 1 : 0;
}
// the approaching side (left) brighter
const beam = (a) => 1 - 0.35 * Math.cos(a) * CE;
// the stars: the same on both renderers
let STARS = [];
// The dark: everything inside the disk's inner edge, not only the shadow
// circle (b = 3 sqrt 3), which is smaller than the bent inner edge; stars
// showed in the gap between them, and a ring drawn round the circle floated
// in it. SHAPE: its outline round the centre (for a fan), FAR: the inner
// edge's far side, bent over the hole (where the ring flares)
let SHAPE = [], FAR = [];
function shapes() {
  const q = [0, 0];
  SHAPE = [];
  for (let i = 0; i < 256; i++) {
    if (project(R_IN * 1.01, (i / 256) * TAU, q) < 0) continue;
    let dx = q[0] - cx, dy = q[1] - cy;
    const d = Math.hypot(dx, dy);
    if (d < shadowPx) {
      dx *= shadowPx / (d || 1);
      dy *= shadowPx / (d || 1);
    }
    SHAPE.push([cx + dx, cy + dy]);
  }
  FAR = [];
  for (let i = 0; i <= 96; i++) if (project(R_IN * 1.01, 0.03 + (i / 96) * (Math.PI - 0.06), q) >= 0) FAR.push([q[0], q[1]]);
}
function place() {
  W = innerWidth;
  H = innerHeight;
  const wide = W / H > 1.2;
  const unit = VIEW.crop ? Math.min(H, W / 1.4) : Math.min(H, W / 1.6);
  shadowPx = unit * VIEW.size;
  scale = shadowPx / SHADOW;
  // the whole disk (its streaks' tails reach ~1.08 of the outer edge) fits
  // across the screen, with a little room: on a portrait screen it was cut
  // off at both sides. Sweep is cropped on purpose
  if (!VIEW.crop) {
    scale = Math.min(scale, (0.47 * W) / (1.08 * VIEW.rout));
    shadowPx = scale * SHADOW;
  }
  cx = W * (wide && !CENTRE ? VIEW.cx : 0.5);
  cy = H * (CENTRE && VIEW.ccy ? VIEW.ccy : VIEW.cy); // sweep sits lower when centred
  shapes();
  const n = Math.round((W * H) / 2600);
  STARS = Array.from({ length: n }, (_, i) => {
    const b = hash(i, 52) ** 3;
    return { x: hash(i, 50) * W, y: hash(i, 51) * H, a: 0.12 + 0.55 * b, size: b > 0.6 ? 1.6 : 1, col: mix(PAL.star, [1, 1, 1], hash(i, 53) * 0.5) };
  });
}

// ---- reactions ----
let messages = []; // a long trail in the app's colour: { r, a0, colour, t0, tau }
let lanterns = []; // { source, colour, slot, r, a, fall (time it was seen, or null) }
let flashAt = -1e9, nowT = 0, over = null;
const SLOTS = [0.12, 0.3, 0.2, 0.42, 0.26, 0.36];
const lanternR = (i) => R_IN + 5 + SLOTS[i % SLOTS.length] * 30;
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    messages.push({ r: R_IN + 2 + Math.random() * 10, a0: Math.random() * TAU, colour: r.colour.map((v) => v / 255), t0: nowT, tau: Math.max(1.5, (r.afterglow ?? 6) / 2) });
    if (messages.length > 4) messages.shift();
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") {
    const items = Array.isArray(r.items) ? r.items.filter((l) => Array.isArray(l.colour)) : [];
    const keep = new Set(items.map((l) => l.source));
    for (const l of lanterns) if (!keep.has(l.source) && l.fall == null) l.fall = nowT;
    for (const it of items.slice(0, 6)) {
      const had = lanterns.find((l) => l.source === it.source && l.fall == null);
      if (had) had.colour = it.colour.map((v) => v / 255);
      else {
        const used = new Set(lanterns.filter((l) => l.fall == null).map((l) => l.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        lanterns.push({ source: it.source, colour: it.colour.map((v) => v / 255), slot, r: lanternR(slot), a: Math.random() * TAU, fall: null });
      }
    }
  }
});
const lanternAt = (l, out) => (project(l.r, l.a, out), out);
function watchHover() {
  if (!HOVER || !pointer.on) return void (over = null);
  const p = [0, 0];
  const l = lanterns.find((l) => l.fall == null && (lanternAt(l, p), Math.hypot(pointer.x - p[0], pointer.y - p[1]) < 18));
  if (!l) return void (over = null);
  if (over?.source !== l.source) over = { source: l.source, at: performance.now(), sent: false };
  else if (!over.sent && performance.now() - over.at > 800) {
    over.sent = true;
    seenLantern(l.source);
  }
}

// ---- one frame's numbers, for either renderer ----
let start = performance.now(), last = -1, spin = 0, feed = 0;
function step(now) {
  const t = STILL ? STILL_AT : reduced ? 40 : (now - start) / 1000 + 40;
  const dt = last < 0 ? 0 : Math.min(0.2, t - last);
  last = t;
  nowT = t;
  // feeding: the cursor near the hole
  let want = 0;
  if (HOVER_FX && pointer.on) want = clamp(1 - (Math.hypot(pointer.x - cx, pointer.y - cy) - shadowPx * 1.2) / (shadowPx * 3));
  feed += (want - feed) * clamp(dt * 1.5);
  spin = STILL || reduced ? t : spin + dt * (1 + 1.5 * feed);
  watchHover();
  const flash = Math.max(0, 1 - (t - flashAt) / 0.8);
  const gain = VIEW.gain * (1 + 0.35 * feed) * (1 + 1.2 * flash);
  // messages: a long bright trail in the app's colour; the ring flares in it
  let ringCol = mix(heat(0.95), [1, 1, 1], 0.3), ringA = 0.5 * flash;
  const extra = [];
  messages = messages.filter((m) => t - m.t0 < m.tau * 5);
  for (const m of messages) {
    const age = t - m.t0, on = smooth(0, 0.6, age) * Math.exp(-Math.max(0, age - 0.6) / m.tau);
    extra.push({ r: m.r, head: m.a0 + spin * SPEED * (R_IN / m.r) ** 1.5, len: 3.2, colour: m.colour, a: on, w: 2.4 });
    ringCol = mix(ringCol, m.colour, on * 0.8);
    ringA = Math.max(ringA, 0.9 * on);
  }
  // waiting apps: a clump each, breathing, on a slow orbit (held while the cursor is on it)
  lanterns = lanterns.filter((l) => l.fall == null || t - l.fall < 2.6);
  for (const l of lanterns) {
    const held = over?.source === l.source && l.fall == null;
    if (!held && !reduced) l.a += dt * 0.1 * (R_IN / l.r) ** 1.5 * (l.fall != null ? 4 : 1);
    if (l.fall != null) l.r = Math.max(R_IN * 0.9, l.r - dt * 5);
    const fade = l.fall != null ? 1 - smooth(1.2, 2.6, t - l.fall) : 1;
    const drain = held ? 1 - 0.7 * clamp((performance.now() - over.at) / 800) : 1;
    extra.push({ r: l.r, head: l.a, len: 1.4, colour: l.colour, a: (0.8 + 0.2 * Math.sin(t * 2.2 + l.slot)) * fade * drain, w: 2.2, clump: true });
  }
  return { gain, extra, ringCol, ringA };
}

// The reactions and the ring's flare, on a 2D canvas: drawn over the trails,
// not added to them (added light on white stays white). pass 0: behind the
// hole, 1: in front, null: both (the GPU's overlay, where the shadow is
// already drawn underneath: points behind the hole that land in it are skipped)
function drawExtras(c, f, pass) {
  c.globalCompositeOperation = "source-over";
  c.lineCap = "round";
  const q = [0, 0];
  const hidden = (b) => b === 1 && Math.hypot(q[0] - cx, q[1] - cy) < shadowPx;
  const inPass = (b1, b2) => (b1 === 1 && b2 === 1 ? 0 : 1) === pass;
  for (const e of f.extra) {
    const steps = 40;
    c.lineWidth = e.w;
    c.strokeStyle = rgb(e.colour);
    for (let s = 0; s < steps; s++) {
      const b1 = project(e.r, e.head - (s / steps) * e.len, q), x1 = q[0], y1 = q[1], h1 = hidden(b1);
      const b2 = project(e.r, e.head - ((s + 1) / steps) * e.len, q);
      if (b1 < 0 || b2 < 0) continue;
      if (pass == null ? h1 || hidden(b2) : !inPass(b1, b2)) continue;
      c.globalAlpha = clamp(e.a * (1 - s / steps) ** 1.2);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(q[0], q[1]);
      c.stroke();
    }
    const b = project(e.r, e.head, q);
    if (e.clump && b >= 0 && (pass == null ? !hidden(b) : b === 1 - pass)) {
      const R = 15, g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
      g.addColorStop(0, rgb(mix(e.colour, [1, 1, 1], 0.5)));
      g.addColorStop(0.25, rgb(e.colour));
      g.addColorStop(0.6, rgb(mix(e.colour, [0, 0, 0], 0.6)));
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = clamp(e.a);
      c.fillStyle = g;
      c.fillRect(q[0] - R, q[1] - R, R * 2, R * 2);
    }
  }
  c.globalAlpha = 1;
}
// a message or a flash: the inner edge of the gas flares, over the top of
// the hole (a soft wide stroke under a thin bright one)
function drawRing(c, f) {
  if (f.ringA < 0.01 || FAR.length < 2) return;
  c.globalCompositeOperation = "lighter";
  c.strokeStyle = rgb(f.ringCol);
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  FAR.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.globalAlpha = clamp(f.ringA * 0.25);
  c.lineWidth = 7;
  c.stroke();
  c.globalAlpha = clamp(f.ringA);
  c.lineWidth = 1.6;
  c.stroke();
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
}

// ---- the CPU renderer: canvas 2D paths ----
function cpuRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let stars = null, glow = null;
  function layout() {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    stars = document.createElement("canvas");
    stars.width = canvas.width;
    stars.height = canvas.height;
    const s = stars.getContext("2d");
    s.fillStyle = "#000";
    s.fillRect(0, 0, stars.width, stars.height);
    s.scale(dpr, dpr);
    for (const st of STARS) {
      s.globalAlpha = st.a;
      s.fillStyle = rgb(st.col);
      s.fillRect(st.x, st.y, st.size, st.size);
    }
    glow = document.createElement("canvas");
    glow.width = Math.ceil(canvas.width / 4);
    glow.height = Math.ceil(canvas.height / 4);
  }
  function draw(f) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(stars, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // the streaks into paths by pass (behind the hole / in front), colour, strength and width
    const paths = new Map();
    const pathFor = (key, pass, bin, level, wide) => {
      let p = paths.get(key);
      if (!p) paths.set(key, (p = { pass, bin, level, wide, path: new Path2D() }));
      return p.path;
    };
    const q = [0, 0], step = 14 / scale; // a point every ~14 px
    const inView = (x, y) => x > -30 && x < W + 30 && y > -30 && y < H + 30;
    ORBITS.forEach((o, k) => {
      const imgs = k < N_INNER ? 2 : 1;
      for (const tr of o.trails) {
        const head = tr.a0 + spin * o.omega;
        const n = Math.max(4, Math.min(240, Math.ceil((tr.len * o.r) / step)));
        for (let img = 0; img < imgs; img++) {
          const k0 = o.env * f.gain * (img ? SECOND : 1);
          let px = 0, py = 0, pb = -1, pl = 0, lastKey = -1;
          for (let s = 0; s <= n; s++) {
            const d = (s / n) * tr.len, a = head - d;
            const b = project(o.r * (1 + SPIRAL * d), a, q, img);
            const l = tr.b * (1 - d / tr.len) ** 1.8 * beam(a) * k0;
            if (s > 0 && b >= 0 && pb >= 0 && (inView(px, py) || inView(q[0], q[1]))) {
              const level = Math.min(11, Math.round(((l + pl) / 2) * 12));
              if (level >= 1) {
                const pass = b === 1 && pb === 1 ? 0 : 1;
                const key = ((pass * 40 + o.bin) * 12 + level) * 2 + (o.wide ? 1 : 0);
                const path = pathFor(key, pass, o.bin, level, o.wide);
                if (key !== lastKey) path.moveTo(px, py);
                path.lineTo(q[0], q[1]);
                lastKey = key;
              } else lastKey = -1;
            } else lastKey = -1;
            px = q[0];
            py = q[1];
            pb = b;
            pl = l;
          }
        }
      }
    });
    const stroke = (pass) => {
      ctx.globalCompositeOperation = "lighter";
      for (const p of paths.values()) {
        if (p.pass !== pass) continue;
        ctx.strokeStyle = rgb(BIN_COLOUR[p.bin]);
        ctx.globalAlpha = p.level / 12;
        ctx.lineWidth = p.wide ? 1.2 : 0.7;
        ctx.stroke(p.path);
      }
      ctx.globalAlpha = 1;
      drawExtras(ctx, f, pass);
    };
    stroke(0);
    // the dark covers what's behind it
    ctx.fillStyle = "#000";
    ctx.beginPath();
    SHAPE.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.fill();
    stroke(1);
    // the glow: a blurred quarter-size copy added on top
    if (GLOW) {
      const g = glow.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.filter = "none";
      g.fillStyle = "#000";
      g.fillRect(0, 0, glow.width, glow.height);
      g.filter = "blur(2px)";
      g.imageSmoothingQuality = "high";
      g.drawImage(canvas, 0, 0, glow.width, glow.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = GLOW;
      ctx.drawImage(glow, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    drawRing(ctx, f);
  }
  return { layout, draw };
}

// ---- the GPU renderer: every orbit one instance of a fixed ring of line
// segments; the vertex shader places them and fades each streak, so a frame
// only sends a few numbers. The glow from a blurred quarter-size copy; the
// reactions on a 2D canvas on top ----
const SEGS = 320; // line segments per orbit
const TRAILS_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec4 aOrbit; // r, omega, brightness (env x width), unused
layout(location = 1) in vec3 aCol;
layout(location = 2) in vec3 aT1; // a streak: start angle, length, brightness
layout(location = 3) in vec3 aT2; // a second one (brightness 0: none)
uniform sampler2D uLens;
uniform float uSpin, uGain, uPass, uImg, uSE, uCE, uRC, uRS, uScale;
uniform vec2 uCentre, uView;
out vec3 vCol;
const float TAU = 6.28318530718;
const float R_MIN = ${R_MIN.toFixed(4)}, KS = ${KS.toFixed(6)}, DPHI = ${DPHI.toFixed(8)};
const float NR = ${NR}.0, NPHI = ${NPHI}.0, SPIRAL = ${SPIRAL}, SECOND = ${SECOND};
// kept in step with lens() and project() in blackholetrails.js
float lens(float r, float phi) {
  vec2 f = vec2(clamp(phi / DPHI, 0.0, NPHI - 1.001), clamp(log(r / R_MIN) * KS, 0.0, NR - 1.001));
  ivec2 i = ivec2(floor(f));
  f -= vec2(i);
  float a = texelFetch(uLens, i, 0).r, b = texelFetch(uLens, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uLens, i + ivec2(0, 1), 0).r, d = texelFetch(uLens, i + ivec2(1, 1), 0).r;
  if (min(min(a, b), min(c, d)) < 0.0) return -1.0;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// screen x, y, behind (1) or in front (0), and -1 for nowhere
vec3 proj(float r, float a) {
  float ca = cos(a), sa = sin(a);
  vec2 dir = vec2(ca, sa * uSE);
  float depth = sa * uCE;
  float g = acos(clamp(-depth, -1.0, 1.0));
  float b = lens(r, uImg > 0.5 ? TAU - g : g);
  if (b < 0.0) return vec3(0.0, 0.0, -1.0);
  vec2 i = dir / max(length(dir), 1e-6) * (uImg > 0.5 ? -b : b);
  vec2 s = uCentre + vec2(i.x * uRC - i.y * uRS, -(i.x * uRS + i.y * uRC)) * uScale;
  return vec3(s, uImg > 0.5 || depth > 0.0 ? 1.0 : 0.0);
}
// how far behind a streak's head the angle a is (or -1)
float behindHead(vec3 T, float a) {
  if (T.z <= 0.0) return -1.0;
  float d = mod(T.x + uSpin * aOrbit.y - a, TAU);
  return d > T.y ? -1.0 : d;
}
float light(vec3 T, float d) { return T.z * pow(1.0 - d / T.y, 1.8); }
// a vertex at angle a, d behind the head of streak T: where it is (x, y,
// behind) and its light (0 past the streak's ends)
vec4 point(vec3 T, float a, float d) {
  float on = d >= 0.0 && d <= T.y ? 1.0 : 0.0;
  d = clamp(d, 0.0, T.y);
  vec3 p = proj(aOrbit.x * (1.0 + SPIRAL * d), a);
  return vec4(p, on * light(T, d) * (1.0 - 0.35 * cos(a) * uCE));
}
void main() {
  int seg = gl_VertexID / 2;
  float a0 = float(seg) / ${SEGS}.0 * TAU, a1 = float(seg + 1) / ${SEGS}.0 * TAU;
  // both ends from one streak (the one over the segment's start, else its
  // end): ends from two overlapping streaks kinked from one radius to the other
  float d1 = behindHead(aT1, a0), d2 = behindHead(aT2, a0);
  if (d1 < 0.0 && d2 < 0.0) {
    d1 = behindHead(aT1, a1);
    d2 = behindHead(aT2, a1);
    if (d1 >= 0.0) d1 += a1 - a0;
    if (d2 >= 0.0) d2 += a1 - a0;
  }
  bool first = d1 >= 0.0 && (d2 < 0.0 || light(aT1, clamp(d1, 0.0, aT1.y)) >= light(aT2, clamp(d2, 0.0, aT2.y)));
  vec3 T = first ? aT1 : aT2;
  float d = first ? d1 : d2;
  if (d < 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // no streak here
    vCol = vec3(0.0);
    return;
  }
  vec4 p0 = point(T, a0, d), p1 = point(T, a1, d - (a1 - a0));
  float pass = p0.z > 0.5 && p1.z > 0.5 ? 0.0 : 1.0;
  if (p0.z < 0.0 || p1.z < 0.0 || (uImg < 0.5 && pass != uPass) || p0.w + p1.w < 0.004) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // nothing to draw: off the screen
    vCol = vec3(0.0);
    return;
  }
  bool end = gl_VertexID % 2 == 1;
  vec4 p = end ? p1 : p0;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
  vCol = aCol * p.w * aOrbit.z * uGain * (uImg > 0.5 ? SECOND : 1.0);
}`;
const TRAILS_FS = `#version 300 es
precision mediump float;
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;
const STARS_VS = `#version 300 es
layout(location = 0) in vec3 aStar; // x, y (CSS px), size
layout(location = 1) in vec3 aCol; // colour times brightness
uniform vec2 uView;
uniform float uDpr;
out vec3 vCol;
void main() {
  gl_Position = vec4((aStar.x + aStar.z * 0.5) / uView.x * 2.0 - 1.0, 1.0 - (aStar.y + aStar.z * 0.5) / uView.y * 2.0, 0.0, 1.0);
  gl_PointSize = aStar.z * uDpr;
  vCol = aCol;
}`;
// the dark (SHAPE), a fan of triangles from the centre, in CSS px
const SHAPE_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uView;
out vec3 vCol;
void main() {
  gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0);
  vCol = vec3(0.0);
}`;
// a gaussian blur along uDir (sigma 2 texels), same size in and out
const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec2 px = 1.0 / vec2(textureSize(uTex, 0)), uv = gl_FragCoord.xy * px;
  float w[5] = float[](1.0, 0.8825, 0.6065, 0.3247, 0.1353);
  vec3 s = texture(uTex, uv).rgb;
  for (int i = 1; i < 5; i++) s += w[i] * (texture(uTex, uv + uDir * px * float(i)).rgb + texture(uTex, uv - uDir * px * float(i)).rgb);
  o = vec4(s / 4.898, 1.0);
}`;
const ADD_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uFull;
uniform float uK;
out vec4 o;
void main() { o = vec4(texture(uTex, gl_FragCoord.xy / uFull).rgb * uK, 1.0); }`;
// how bright a CPU line of width w is per pixel of its length, for the GPU's 1 px lines
const WIDTH_LIGHT = (wide) => (wide ? 1.0 : 0.6);
// the glow source is drawn a quarter the size, its lines four device pixels
// wide; the CPU's downscaled copy spreads each line's light over the same
const GLOW_GPU = 0.25;
function gpuRenderer(canvas, overlay) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const trails = compile(gl, TRAILS_VS, TRAILS_FS), starsP = compile(gl, STARS_VS, TRAILS_FS), shadow = compile(gl, SHAPE_VS, TRAILS_FS);
  const blur = compile(gl, QUAD_VS, BLUR_FS), add = compile(gl, QUAD_VS, ADD_FS);
  const oc = overlay.getContext("2d");
  // the lens table
  const lensTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lensTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, NPHI, NR, 0, gl.RED, gl.FLOAT, LENS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // per orbit: r, omega, brightness, 0 | colour | streak 1 | streak 2
  const data = new Float32Array(ORBITS.length * 13);
  ORBITS.forEach((o, k) => {
    const d = data.subarray(k * 13, k * 13 + 13), col = BIN_COLOUR[o.bin], [t1, t2] = o.trails;
    d.set([o.r, o.omega, o.env * WIDTH_LIGHT(o.wide), 0, col[0], col[1], col[2], t1.a0, t1.len, t1.b, t2 ? t2.a0 : 0, t2 ? t2.len : 1, t2 ? t2.b : 0]);
  });
  const orbitVao = gl.createVertexArray();
  gl.bindVertexArray(orbitVao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const attr = (loc, size, offset) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 13 * 4, offset * 4);
    gl.vertexAttribDivisor(loc, 1); // one value per orbit
  };
  attr(0, 4, 0);
  attr(1, 3, 4);
  attr(2, 3, 7);
  attr(3, 3, 10);
  const starVao = gl.createVertexArray(), starBuf = gl.createBuffer();
  const emptyVao = gl.createVertexArray(), shapeVao = gl.createVertexArray(), shapeBuf = gl.createBuffer();
  let nShape = 0;
  let nStars = 0;
  // the glow's two quarter-size buffers (8 bits: half floats left blocky patches in the glow)
  const glowBufs = [0, 1].map(() => ({ tex: gl.createTexture(), fb: gl.createFramebuffer() }));
  let gw = 1, gh = 1;
  function layout() {
    canvas.width = overlay.width = Math.round(W * dpr);
    canvas.height = overlay.height = Math.round(H * dpr);
    const s = new Float32Array(STARS.length * 6);
    STARS.forEach((st, i) => s.set([st.x, st.y, st.size, st.col[0] * st.a, st.col[1] * st.a, st.col[2] * st.a], i * 6));
    nStars = STARS.length;
    gl.bindVertexArray(starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, s, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    // the dark: centre, then its outline round, closed
    const fan = [cx, cy];
    for (const p of [...SHAPE, SHAPE[0]]) if (p) fan.push(p[0], p[1]);
    nShape = fan.length / 2;
    gl.bindVertexArray(shapeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fan), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gw = Math.ceil(canvas.width / 4);
    gh = Math.ceil(canvas.height / 4);
    for (const g of glowBufs) {
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // the streaks: pass 0 behind the hole (with the second images), 1 in front
  function streaks(f, gain, pass) {
    gl.useProgram(trails.p);
    const u = trails.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, lensTex);
    gl.uniform1i(u.uLens, 0);
    gl.uniform1f(u.uSpin, spin);
    gl.uniform1f(u.uGain, gain);
    gl.uniform1f(u.uSE, SE);
    gl.uniform1f(u.uCE, CE);
    gl.uniform1f(u.uRC, ROLL_C);
    gl.uniform1f(u.uRS, ROLL_S);
    gl.uniform1f(u.uScale, scale);
    gl.uniform2f(u.uCentre, cx, cy);
    gl.uniform2f(u.uView, W, H);
    gl.bindVertexArray(orbitVao);
    gl.uniform1f(u.uPass, pass);
    gl.uniform1f(u.uImg, 0);
    gl.drawArraysInstanced(gl.LINES, 0, SEGS * 2, ORBITS.length);
    if (pass === 0) {
      gl.uniform1f(u.uImg, 1);
      gl.drawArraysInstanced(gl.LINES, 0, SEGS * 2, N_INNER);
    }
  }
  function draw(f) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // light adds up
    // the glow's source, a quarter the size, then blurred both ways
    if (GLOW) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowBufs[0].fb);
      gl.viewport(0, 0, gw, gh);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      streaks(f, f.gain * GLOW_GPU, 0);
      streaks(f, f.gain * GLOW_GPU, 1);
      gl.disable(gl.BLEND);
      gl.useProgram(blur.p);
      gl.bindVertexArray(emptyVao);
      gl.uniform1i(blur.u.uTex, 0);
      for (const [from, to, dir] of [[0, 1, [1, 0]], [1, 0, [0, 1]]]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, glowBufs[to].fb);
        gl.bindTexture(gl.TEXTURE_2D, glowBufs[from].tex);
        gl.uniform2f(blur.u.uDir, dir[0], dir[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(starsP.p);
    gl.uniform2f(starsP.u.uView, W, H);
    gl.uniform1f(starsP.u.uDpr, dpr);
    gl.bindVertexArray(starVao);
    gl.drawArrays(gl.POINTS, 0, nStars);
    streaks(f, f.gain / dpr, 0); // lines are one device pixel wide
    // the shadow covers what's behind it
    gl.disable(gl.BLEND);
    gl.useProgram(shadow.p);
    gl.uniform2f(shadow.u.uView, W, H);
    gl.bindVertexArray(shapeVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, nShape);
    gl.enable(gl.BLEND);
    streaks(f, f.gain / dpr, 1);
    if (GLOW) {
      gl.useProgram(add.p);
      gl.bindVertexArray(emptyVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glowBufs[0].tex);
      gl.uniform1i(add.u.uTex, 0);
      gl.uniform2f(add.u.uFull, canvas.width, canvas.height);
      gl.uniform1f(add.u.uK, GLOW);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // the reactions over it all
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, overlay.width, overlay.height);
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRing(oc, f);
    drawExtras(oc, f, null);
  }
  return { layout, draw, gl };
}

// ---- start ----
const label = "A black hole: glowing streaks of gas swirling round a dark shadow, the far side bent up over it.";
function makeCanvas() {
  const c = document.createElement("canvas");
  c.className = "canvas-wall";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", label);
  document.body.appendChild(c);
  return c;
}
let renderer = null, canvases = [];
function useCPU() {
  for (const c of canvases) c.remove();
  const c = makeCanvas();
  canvases = [c];
  renderer = cpuRenderer(c);
  document.documentElement.dataset.renderer = "cpu";
}
function useGPU() {
  const c = makeCanvas(), o = makeCanvas();
  o.setAttribute("aria-hidden", "true");
  canvases = [c, o];
  try {
    renderer = gpuRenderer(c, o);
  } catch (e) {
    console.warn("black hole: GPU renderer failed, using the CPU", e);
    renderer = null;
  }
  if (!renderer) return useCPU();
  document.documentElement.dataset.renderer = "gpu";
  c.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    useCPU();
    relayout();
  });
}
function relayout() {
  dpr = STILL ? 1 : devicePixelRatio || 1;
  place();
  renderer.layout();
}
// a still always comes from the CPU renderer (one canvas to save)
if (!STILL && wantGPU()) useGPU();
else useCPU();
relayout();

let frameMs = 0;
function render(now) {
  const began = performance.now();
  renderer.draw(step(now));
  frameMs = frameMs * 0.9 + (performance.now() - began) * 0.1;
}

// ?debug: frame time, and where the waiting apps' clumps are on screen (CSS px), for testing
if (params.has("debug")) {
  window.__frameMs = () => frameMs;
  window.__blackhole = () => lanterns.filter((l) => l.fall == null).map((l) => ({ source: l.source, ...((p) => ({ x: p[0], y: p[1] }))(lanternAt(l, [0, 0])) }));
}

if (STILL) {
  render(0);
  sendStill(canvases[0]);
} else {
  addEventListener("resize", () => {
    relayout();
    render(performance.now());
  });
  paceFrames(reduced ? 1 : preview ? 8 : num("fps", 20, 10, 30), render);
}
