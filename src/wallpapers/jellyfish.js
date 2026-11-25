// wallpapers/jellyfish: glowing, see-through ASCII jellyfish drifting up
// through dark water, drawn on a canvas, after the one on heywajih.com. The frame
// loop stops while the app pauses wallpapers (common.js isPaused/whenResumed).
//
// Jellyfish are translucent, so there is no depth test: every surface point
// ADDS its light to the character cell it lands in, and overlapping parts
// (the bell's front and back, tentacles seen through the bell) glow brighter.
// Per cell we sum light and colour, tone-map the total, and pick a character
// by brightness (or a stroke character for tentacles).
//
// Each jellyfish: a bell that pulses (contracts narrower and taller, then
// relaxes), brightest at its rim (light grazing a thin membrane), with radial
// canals and four bright horseshoe gonads like a moon jelly; frilly oral
// arms rippling below; long tentacles trailing and waving behind. Each pulse
// pushes it up a little (eased over the contraction, no jumps); arms and
// tentacles follow the bell with a delay that grows down their length, so
// each pulse ripples down them. It drifts up and reappears below. Faint particles
// ("marine snow") drift through the water. The view is fixed: a wallpaper,
// not an interactive scene.
//
// Hover (common.js pointer): the jelly under the cursor dissolves into
// shading blocks (see SCRAMBLE).
//
// Options: ?count=6 jellyfish (1-10) ?tint=natural|cool|grey|warm (palette)
//          ?size=<0.3-2.5> ?preview (gallery: low frame rate)
//          ?still=<id>&at=<s> (one frame for the stills page, see common.js)
//          ?hero: one big jellyfish, placed for the screen's shape (on a
//          phone the bell sits up behind the lock-screen clock), pulsing in
//          place without drifting; used for stills and for the live "big
//          jellyfish" page (wallpapers/big-jellyfish.html sets data-hero)
//          ?hue=1-6: the big jelly's colour in the palette (default: the
//          moment's for stills, random live)

import { wholePx, params, num, hash, seeded, cssRGB, HOVER, pointer, STILL, STILL_AT, fontReady, sendStill, onReaction, seenLantern, paceFrames } from "./common.js";
import { wantGPU } from "./gpu.js";
import { createJellyGL } from "./jellyfish-gl.js";
import { TINTS } from "./palettes.js";

const reduced = !STILL && matchMedia("(prefers-reduced-motion: reduce)").matches;
const HERO = params.has("hero") || "hero" in document.body.dataset;
const preview = params.has("preview");
const SIZE = num("size", 1, 0.3, 2.5);
// Default count follows the screen's shape: wider screens get more jellyfish
// (about 7 at 16:9, 9 on ultrawide, 5 on a square window)
const COUNT = HERO ? 1 : Math.round(num("count", Math.max(4, Math.min(10, Math.round(2.5 + 2.5 * (innerWidth / innerHeight)))), 1, 10));
// Sampling detail: 1 = full density, about 8 light
// samples per character cell; the default 0.5 takes half as many. Each
// sample's area weight grows to match, so brightness per cell stays the same.
// 2D surfaces (the bell) thin out in both directions, lines (tentacles,
// arms) along their length. ?detail=0.25-1
const DETAIL = num("detail", 0.5, 0.25, 1);
const BELL_STEP = 0.03 / Math.sqrt(DETAIL); // radians between bell rings
const BELL_RING = 70 * Math.sqrt(DETAIL); // samples per unit of ring length
const LINE_STEP = 0.03 / DETAIL; // units between samples down arms and tentacles

// ---- canvas grid ----
// Two renderers: the GPU one (jellyfish-gl.js, WebGL2) when the
// Rendering setting allows it (gpu.js), else this file's canvas 2D one. Both
// draw the same picture from the same per-jelly state (jellyState below).
function newCanvas() {
  const c = document.createElement("canvas");
  c.className = "canvas-wall";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", "Glowing jellyfish drawn in coloured text characters, pulsing slowly upward through dark water.");
  return c;
}
let canvas = newCanvas();
document.body.appendChild(canvas);
let ctx = null; // canvas 2D (CPU renderer)
let GLR = null; // the GPU renderer (set up below, once the jellies exist)
const measure = document.createElement("canvas").getContext("2d"); // for character widths
const FONT = (px) => `700 ${px}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;

let W, H, cw, ch, cols, rows;
let acc, sr, sg, sb, tent; // per cell: summed light, summed colour, tentacle share
let bA, bR, bG, bB, tmp; // the same, blurred: the glow around each jelly
function resize() {
  const dpr = STILL ? 1 : devicePixelRatio || 1; // stills are exactly the size asked for
  W = innerWidth;
  H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // fine grid: smoother bells and tentacles. Stills scale freely, so a 6K
  // still is the same picture as 1080p, just sharper
  const fontPx = STILL ? H / 105 : Math.max(6, Math.min(12, H / 105));
  measure.font = FONT(fontPx);
  // whole device pixels both ways (wholePx says why)
  cw = wholePx(measure.measureText("M").width, dpr);
  ch = wholePx(fontPx * 1.02, dpr);
  cols = Math.ceil(W / cw);
  rows = Math.ceil(H / ch);
  if (GLR) return GLR.resize({ dpr, cw, ch, cols, rows, fontPx, font: FONT(fontPx) });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = FONT(fontPx);
  ctx.textBaseline = "top";
  const n = cols * rows;
  acc = new Float32Array(n);
  sr = new Float32Array(n);
  sg = new Float32Array(n);
  sb = new Float32Array(n);
  tent = new Float32Array(n);
  [bA, bR, bG, bB, tmp] = Array.from({ length: 5 }, () => new Float32Array(n));
}

// Box blur (3 cells across, 2 down): spreads each jelly's light into a soft halo
function blur(src, dst) {
  for (let y = 0; y < rows; y++) {
    const o = y * cols;
    let s = 0;
    for (let x = 0; x <= 3 && x < cols; x++) s += src[o + x];
    for (let x = 0; x < cols; x++) {
      tmp[o + x] = s / 7;
      if (x + 4 < cols) s += src[o + x + 4];
      if (x - 3 >= 0) s -= src[o + x - 3];
    }
  }
  for (let x = 0; x < cols; x++) {
    let s = 0;
    for (let y = 0; y <= 2 && y < rows; y++) s += tmp[y * cols + x];
    for (let y = 0; y < rows; y++) {
      dst[y * cols + x] = s / 5;
      if (y + 3 < rows) s += tmp[(y + 3) * cols + x];
      if (y - 2 >= 0) s -= tmp[(y - 2) * cols + x];
    }
  }
}

// ---- colours ----
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Bioluminescent hues: bell, its glowing gonads, and its tentacles; the
// water: DEEP (the colour of distance) and
// SNOW (the drifting particles). ?tint= picks a palette; natural is the
// original look.
// TINTS: palettes.js (shared with the light clock)
const TINT = TINTS[params.get("tint")] ?? TINTS.natural;
const HUES = TINT.hues;
let BG = [0, 0, 0];
let DEEP = TINT.deep; // the colour of distance under water
const SNOW_COL = TINT.snow; // the drifting particles
function setPalette() {
  BG = cssRGB("--bg");
}

// ---- camera: fixed, looking down a little to see into the bells ----
const yaw = 0, pitch = 0.22;
const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
let focal, camDist;

// Add light b with colour rgb at a 3D point. `area` is the bit of surface
// (world units²) this sample stands for: it adds light in proportion to how
// much of the character cell it covers, so sampling density and distance
// don't change brightness. isTent marks tentacle strokes.
function glow(x, y, z, b, rgb, isTent, area) {
  glowRGB(x, y, z, b, rgb[0], rgb[1], rgb[2], isTent, area);
}
// The same with the colour as three numbers. This runs ~60,000 times a frame,
// so it allocates nothing: per-sample colour arrays kept the garbage collector
// busy.
function glowRGB(x, y, z, b, R, G, B, isTent, area) {
  if (PERF) PERF.samples++;
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp + camDist;
  if (z2 < 1) return;
  const c = Math.floor((W / 2 + (x1 * focal) / z2) / cw);
  const r = Math.floor((H / 2 - (y2 * focal) / z2) / ch);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return;
  const k = r * cols + c;
  const cellArea = ((cw * z2) / focal) * ((ch * z2) / focal);
  // Seen through water: farther away is dimmer and bluer
  const fog = Math.max(0, Math.min(1, (z2 - (camDist - 4)) / 8));
  if (fog > 0) {
    const m = fog * 0.45;
    R += (DEEP[0] - R) * m;
    G += (DEEP[1] - G) * m;
    B += (DEEP[2] - B) * m;
  }
  const w = (area ? (b * area) / cellArea : b) * (1 - 0.45 * fog);
  acc[k] += w;
  sr[k] += R * w;
  sg[k] += G * w;
  sb[k] += B * w;
  if (isTent) tent[k] += w;
}

// ---- the jellyfish ----
const random = seeded(4242);
// Spread evenly across the width (xf: -1..1 of the visible width, worked out
// each frame so wide screens are filled), at staggered heights (yf: 0..1 of
// the wrap), so they don't bunch up
const JELLIES = Array.from({ length: COUNT }, (_, i) => ({
  xf: -1 + (2 * (i + 0.5)) / COUNT + (random() - 0.5) * (0.8 / COUNT),
  z: (random() * 2 - 1) * 3,
  yf: (i * 0.618) % 1,
  r: 1.3 + random() * 1.5, // bell radius, up to ~2.8
  period: 2.6 + random() * 1.6, // seconds per pulse
  phase: random() * 10,
  speed: 0.18 + random() * 0.14, // drift upward, units per second
  tilt: (random() - 0.5) * 0.5,
  hue: i % HUES.length,
  tentacles: 8 + Math.floor(random() * 6),
  seed: i * 97,
}));
// Hero: one big jelly, standing still in the frame: no rising and no sway,
// only its pulse and the ripples down its arms and tentacles. Portrait:
// centred, bell in the upper third, behind a phone's lock-screen clock.
// Landscape: off to the right. ?hue picks its colour; otherwise the moment
// (?at) does for stills, and live it's random each time it starts.
if (HERO) {
  const portrait = innerHeight > innerWidth;
  Object.assign(JELLIES[0], {
    xf: portrait ? 0 : 0.36,
    z: 0,
    r: portrait ? 3.1 : 4.6, // (?size still scales it)
    fixedY: portrait ? 4.2 : 4.6,
    tilt: 0.08,
    tentacles: 13,
    hue: params.has("hue") ? Math.round(num("hue", 1, 1, 6)) - 1 : STILL ? Math.floor(STILL_AT * 7.3) : Math.floor(Math.random() * 6),
    still: true, // no sway
  });
  // the hover clock takes this jelly's colour (host.js)
  document.documentElement.dataset.hue = String(JELLIES[0].hue);
}
// Marine snow: x as a fraction of the visible width, so it fills wide screens too
const SNOW = Array.from({ length: 600 }, () => [random() * 2 - 1, random() * 20 - 10, random() * 16 - 8, random()]);
// ?specks=0: no marine snow, the jellies on plain black (Settings: background)
const SPECKS = params.get("specks") !== "0";
let HALF_W = 10; // half the visible width in world units (10 = half the height)

// ---- reactions (common.js onReaction, signals.rs) ----
//   pulse  the on-screen jelly pulsed longest ago contracts and glows in the
//          app's colour, fading over the afterglow
//   count  extra jellies drift in as things wait: one per 3, up to 10 in all.
//          They're made up front (so the GPU knows their samples) and fade
//          in and out; the usual jellies keep their exact places
//   flash  every jelly gets the touch flash
// Extras use their own random numbers, after the snow's, so nothing else moves.
const MAX_JELLIES = 10;
const extraRandom = seeded(777);
const EXTRAS = HERO
  ? []
  : Array.from({ length: Math.max(0, MAX_JELLIES - COUNT) }, (_, k) => ({
      // golden-ratio steps across the width, so each new extra lands far
      // from the ones before it
      xf: ((k * 0.618 + 0.11) % 1) * 1.9 - 0.95 + (extraRandom() - 0.5) * 0.1,
      z: (extraRandom() * 2 - 1) * 3,
      yf: extraRandom(),
      r: 1.1 + extraRandom() * 1.2,
      period: 2.6 + extraRandom() * 1.6,
      phase: extraRandom() * 10,
      speed: 0.18 + extraRandom() * 0.14,
      tilt: (extraRandom() - 0.5) * 0.5,
      hue: (COUNT + k) % HUES.length,
      tentacles: 8 + Math.floor(extraRandom() * 6),
      seed: (COUNT + k) * 97,
      extra: true,
      presence: 0,
    }));
JELLIES.push(...EXTRAS);
let extrasWanted = 0;
let pulseClock = 0; // orders pulses, so they take turns
let clock = 0; // seconds, for the lanterns' slow breathing

// ---- lanterns: something is waiting (signals.rs) ----
// Each app with something waiting lights one jelly in its colour, breathing
// softly, until the app has nothing waiting or you rest the cursor on that
// jelly ("seen": seenLantern tells the app). A lantern keeps to a jelly
// that's on screen: it goes to a jelly low on the screen (jellies rise, so
// that one stays longest), and only when its jelly is leaving at the top
// does it move to another (one fades out as the other fades in). More
// lanterns than jellies (the big jellyfish has one): a jelly holds several
// and its colour steps through them every few seconds.
const lanternOf = new Map(); // source -> jelly
const LANTERN = 1; // how strongly a lantern tints its jelly (as much as a pulse, but breathing)
const visible = (j) => (j.presence ?? 1) > 0.5 && j.screen && j.screen.x > 0 && j.screen.x < W && j.screen.y > H * 0.1 && j.screen.y < H * 0.9;
const leaving = (j) => (j.presence ?? 1) <= 0.5 || !j.screen || j.screen.x < 0 || j.screen.x > W || j.screen.y < H * 0.04 || j.screen.y > H;
function lanternJelly(skip) {
  const free = JELLIES.filter((j) => j !== skip && visible(j) && !(j.lanterns?.length));
  const low = free.filter((j) => j.screen.y > H * 0.45);
  const pool = low.length ? low : free;
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  // none free: share the visible jelly with the fewest
  const shared = JELLIES.filter((j) => j !== skip && visible(j)).sort((a, b) => (a.lanterns?.length ?? 0) - (b.lanterns?.length ?? 0));
  return shared[0] ?? JELLIES.find((j) => j !== skip && (j.presence ?? 1) > 0.5) ?? JELLIES[0];
}
function giveLantern(j, item) {
  j.lanterns = (j.lanterns ?? []).filter((l) => l.source !== item.source);
  j.lanterns.push({ source: item.source, rgb: item.colour.map((v) => Math.max(0, Math.min(255, v))) });
  j.lanternAmt ??= 0;
  lanternOf.set(item.source, j);
}
function takeLantern(source) {
  const j = lanternOf.get(source);
  if (j) j.lanterns = j.lanterns.filter((l) => l.source !== source);
  lanternOf.delete(source);
}
function showLanterns(items) {
  const want = new Map(items.map((i) => [i.source, i]));
  for (const source of [...lanternOf.keys()]) if (!want.has(source)) takeLantern(source);
  for (const item of items) {
    const j = lanternOf.get(item.source);
    if (j) giveLantern(j, item); // keeps its jelly (the colour may have changed)
    else giveLantern(lanternJelly(), item);
  }
}
// The lantern colour a jelly shows now (several: one after another)
function lanternRGB(j) {
  const ls = j.lanterns;
  if (!ls?.length) return j.lastLanternRGB;
  return (j.lastLanternRGB = ls[Math.floor(clock / 4) % ls.length].rgb);
}
// How lit a jelly is: a pulse, or its lantern (breathing slowly)
function litAmt(j) {
  const lantern = (j.lanternAmt || 0) * LANTERN * (0.86 + 0.14 * Math.sin(clock * 1.3 + (j.phase || 0))) * (1 - 0.85 * (j.drain || 0));
  return Math.max(j.glowAmt || 0, lantern);
}

// A jelly's colours, tinted towards a pulse's or its lantern's colour
function colOf(j) {
  const base = HUES[j.hue % HUES.length];
  const pulse = j.glowAmt || 0;
  const a = litAmt(j);
  if (a < 0.01) return base;
  const rgb = pulse >= a - 1e-6 ? j.glowRGB : lanternRGB(j);
  if (!rgb) return base;
  const tint = (c, k) => c.map((v, i) => v + (rgb[i] - v) * k);
  return { bell: tint(base.bell, a * 0.85), glow: tint(base.glow, Math.min(1, a)), tent: tint(base.tent, a * 0.7) };
}

onReaction((r) => {
  if (r.type === "pulse") {
    // the app's lantern jelly if it has one, so the arrival and what's left
    // waiting are the same jelly; else on screen, and pulsed longest ago
    // (ties: any of them, so pulses land all over, not always mid-screen)
    let j = lanternOf.get(r.source);
    if (!j || !visible(j)) {
      const onScreen = JELLIES.filter((j) => (j.presence ?? 1) > 0.5 && j.screen && j.screen.x > 0 && j.screen.x < W && j.screen.y > 0 && j.screen.y < H);
      const pool = onScreen.length ? onScreen : JELLIES.filter((j) => (j.presence ?? 1) > 0.5);
      const order = new Map(pool.map((j) => [j, Math.random()]));
      pool.sort((a, b) => (a.pulsedAt ?? -1) - (b.pulsedAt ?? -1) || order.get(a) - order.get(b));
      j = pool[0];
    }
    if (!j) return;
    j.glowRGB = r.colour.map((v) => Math.max(0, Math.min(255, v)));
    j.glowAmt = 1;
    j.glowTau = Math.max(0.2, (r.afterglow || 4) / 3); // mostly gone after the afterglow
    j.excite = Math.max(j.excite || 0, 0.8); // contracts as it lights up
    j.pulsedAt = ++pulseClock;
  } else if (r.type === "count") {
    extrasWanted = Math.min(EXTRAS.length, Math.ceil(Math.max(0, r.n) / 3));
  } else if (r.type === "flash") {
    for (const j of JELLIES) j.excite = 1;
  } else if (r.type === "lanterns") {
    showLanterns(Array.isArray(r.items) ? r.items : []);
  }
});

// Once per frame: pulses fade, extras drift in or out, lanterns fade in and
// out (about 1.5 s) and move off jellies that are leaving the screen
let lanternCheck = 0;
function reactionsTick(dt) {
  clock += dt;
  if ((lanternCheck += dt) > 1) {
    lanternCheck = 0;
    for (const [source, j] of [...lanternOf]) {
      if (!leaving(j)) continue;
      const next = lanternJelly(j);
      if (next === j || !visible(next)) continue;
      const item = j.lanterns.find((l) => l.source === source);
      takeLantern(source);
      giveLantern(next, { source, colour: item.rgb });
    }
  }
  for (const j of JELLIES) {
    if (j.glowAmt) j.glowAmt = j.glowAmt * Math.exp(-dt / j.glowTau);
    const want = j.lanterns?.length ? 1 : 0;
    if (j.lanternAmt !== undefined) j.lanternAmt += Math.max(-dt / 1.5, Math.min(dt / 1.5, want - j.lanternAmt));
    if (j.extra) {
      const want = EXTRAS.indexOf(j) < extrasWanted ? 1 : 0;
      j.presence += Math.max(-dt / 3, Math.min(dt / 3, want - j.presence));
    }
  }
}

// Hover (both renderers): the characters of the jelly under the cursor
// dissolve into shading blocks ░▒▓ (by brightness),
// densest at the cursor (SCRAMBLE, from j.stir, which eases in and settles
// over about a second). No light and no change to its path: light on the
// wallpaper only ever means something is waiting.
// Resting the cursor on a lantern for 0.8 s marks it seen; its colour
// drains away meanwhile (j.drain), and comes back if you move off.
// (j.excite is now only the flash reaction's contraction and glow.)
const SEEN_MS = 800;
// the scramble's glyphs, faint to bright (also jellyfish-gl.js GLYPHS, slots 19-21)
const SHADES = "░▒▓";
// ?scramble=0 (Settings → wallpaper): no scramble; the cursor still marks lanterns seen
const SCRAMBLE_ON = params.get("scramble") !== "0";
const SCRAMBLE = { amt: 0, x: 0, y: 0, r: 1, bucket: 0 };
function hoverTick(dt) {
  let top = null;
  for (const j of JELLIES) if (j.stir > 0.01 && j.screen && (!top || j.stir > top.stir)) top = j;
  SCRAMBLE.amt = top && SCRAMBLE_ON ? top.stir * 0.4 : 0;
  if (top) Object.assign(SCRAMBLE, { x: pointer.x, y: pointer.y, r: Math.max(20, top.screen.r * 1.0), bucket: Math.floor(performance.now() / 90) % 10000 });
  for (const j of JELLIES) {
    j.excite = (j.excite || 0) * Math.exp(-dt / 1.5);
    const sc = j.screen;
    const over = HOVER && pointer.on && sc && Math.hypot((pointer.x - sc.x) / (sc.r * 1.3), (pointer.y - sc.y) / (sc.r * 1.1)) < 1;
    j.stir = over ? Math.min(1, (j.stir || 0) + dt * 2.5) : (j.stir || 0) * Math.exp(-dt / 1.2);
    // real time, not frames (the frame rate can be 15)
    const now = performance.now();
    j.overSince = over ? (j.overSince ?? now) : null;
    j.drain = j.overSince !== null && j.lanterns?.length ? Math.min(1, (now - j.overSince) / SEEN_MS) : 0;
    if (j.overSince !== null && now - j.overSince > SEEN_MS && j.lanterns?.length) {
      for (const l of j.lanterns) seenLantern(l.source);
      for (const l of [...j.lanterns]) takeLantern(l.source); // fade now; the app confirms
    }
  }
}

// Pulse shape 0..1: a quick contraction, then a slow relaxation
const pulse = (t, period, phase) => {
  const u = (((t + phase) / period) % 1 + 1) % 1;
  return u < 0.3 ? Math.sin((u / 0.3) * (Math.PI / 2)) : Math.cos(((u - 0.3) / 0.7) * (Math.PI / 2)) ** 2;
};

// The push from each contraction, in cycles: eases in over the contraction
// (the first 45% of a cycle) instead of jumping, so the jelly glides up
const PUSH = 0.35; // units per pulse
const pushOf = (j, t) => {
  const c = (t + j.phase) / j.period;
  const f = Math.min(1, (c - Math.floor(c)) / 0.45);
  return Math.floor(c) + f * f * (3 - 2 * f);
};

// Where a point lands on screen (px), and its distance from the camera
function project(x, y, z) {
  const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp + camDist;
  return [W / 2 + (x1 * focal) / z2, H / 2 - (y2 * focal) / z2, z2];
}

// One jelly's state at time t, shared by both renderers: where it is, how
// contracted, how bright. Null when it's faded out (off the top or bottom).
// Also remembers where its bell is on screen, for the hover check.
function jellyState(j, t) {
  const p = reduced ? 0.3 : Math.max(pulse(t, j.period, j.phase), 0.75 * (j.excite || 0));
  const push = reduced ? 0 : pushOf(j, t);
  const travel = j.speed * t + PUSH * push;
  const bottom = -10.5 - j.r * SIZE;
  const top = 10.5 + j.r * SIZE + 2.5;
  const span = top - bottom;
  const y = j.fixedY ?? bottom + ((((travel + j.yf * span) % span) + span) % span);
  const fade = (j.fixedY != null ? 1 : Math.max(0, Math.min(1, (y - bottom) / 2.5, (top - y) / 2.5))) * (j.presence ?? 1);
  if (fade <= 0) {
    j.screen = null; // not on screen: no hover, no pulses
    return null;
  }
  const sway = j.still ? 0 : 1;
  const cx = j.xf * HALF_W * 0.9 + Math.sin(t * 0.07 + j.seed) * 0.8 * sway;
  const cz = j.z + Math.cos(t * 0.05 + j.seed) * 0.6 * sway;
  const R = j.r * SIZE * (1 - 0.18 * p);
  const Hb = j.r * SIZE * (0.5 + 0.25 * p);
  const flash = (0.8 + 0.55 * p) * (1 + 1.4 * (j.excite || 0)) * (1 + 0.8 * litAmt(j));
  const [bx, by, bz] = project(cx, y + Hb * 0.4, cz);
  j.screen = { x: bx, y: by, r: (R * focal) / bz };
  return { p, push, y, fade, cx, cz, R, Hb, flash, jr: j.r * SIZE, ct: Math.cos(j.tilt), st: Math.sin(j.tilt), col: colOf(j) };
}

// The fixed sample parameters of one jelly, for the GPU renderer: one vertex
// per sample as [p0, p1, p2, p3, kind], walking the same loops as drawJelly
// (bell rings at their largest size; the shader skips samples a contracted
// ring doesn't have)
function templateFor(j) {
  const out = [];
  const TH_MAX = 1.3;
  const jr = j.r * SIZE;
  for (let th = 0.02; th <= TH_MAX; th += BELL_STEP) {
    const ringMax = Math.max(10, Math.round(Math.sin(th) * jr * BELL_RING));
    for (let i = 0; i < ringMax; i++) out.push(th, i, 0, 0, 0);
  }
  const armLen = 1.6 * jr;
  for (let a = 0; a < 4; a++) for (let s = 0; s < armLen; s += LINE_STEP) for (let u = -1; u <= 1; u += 0.5) out.push(a, s, u, armLen, 1);
  for (let i = 0; i < j.tentacles; i++) {
    const len = (2.2 + hash(j.seed, i) * 2.2) * jr;
    for (let s = 0; s < len; s += LINE_STEP) out.push(i, s, len, 0, 2);
  }
  return new Float32Array(out);
}

function drawJelly(j, t) {
  // touched: contracts and flashes (j.excite, set in render from the cursor)
  const pAt = (tt) => (reduced ? 0.3 : Math.max(pulse(tt, j.period, j.phase), 0.75 * (j.excite || 0)));
  const p = pAt(t);
  // Rises steadily, with a push on each contraction. It wraps over a band
  // taller than the screen: it starts with the bell fully below the bottom
  // edge and finishes with the tentacle tips fully above the top, so it never
  // pops in or out; it also fades over the last couple of units at each end.
  const push = reduced ? 0 : pushOf(j, t);
  const travel = j.speed * t + PUSH * push;
  // Arms and tentacles follow the bell with a delay that grows down their
  // length: a segment s units down moves the way the bell did `lag` s ago,
  // so each push and contraction ripples down them. `drag`: how far it
  // trails below where it would hang if it kept up with the push.
  const drag = (lag) => (reduced ? 0 : PUSH * (push - pushOf(j, t - lag)));
  const bottom = -10.5 - j.r * SIZE;
  // Leaving at the top: it fades out over the 2.5 units after its bell
  // clears the edge (the screen is ±10), so no headless tentacles linger;
  // then it wraps round to the bottom
  const top = 10.5 + j.r * SIZE + 2.5;
  const span = top - bottom;
  const y = j.fixedY ?? bottom + ((((travel + j.yf * span) % span) + span) % span);
  const fade = (j.fixedY != null ? 1 : Math.max(0, Math.min(1, (y - bottom) / 2.5, (top - y) / 2.5))) * (j.presence ?? 1);
  if (fade <= 0) {
    j.screen = null; // not on screen: no hover, no pulses
    return;
  }
  const sway = j.still ? 0 : 1;
  const cx = j.xf * HALF_W * 0.9 + Math.sin(t * 0.07 + j.seed) * 0.8 * sway;
  const cz = j.z + Math.cos(t * 0.05 + j.seed) * 0.6 * sway;
  const R = j.r * SIZE * (1 - 0.18 * p); // narrower when contracted
  const Hb = j.r * SIZE * (0.5 + 0.25 * p); // a shallow umbrella, taller when contracted
  const ct = Math.cos(j.tilt), st = Math.sin(j.tilt);
  const col = colOf(j); // its hue, tinted while a pulse glows
  // Local -> world: tilt the jelly a little around the z axis
  const put = (lx, ly, lz, b, R_, G_, B_, isTent, area) =>
    glowRGB(cx + lx * ct - ly * st, y + lx * st + ly * ct, cz + lz, b * fade, R_, G_, B_, isTent, area);
  const BELL_AREA = BELL_STEP * R * ((Math.PI * 2) / BELL_RING); // one bell sample's patch of membrane
  const ARM_AREA = LINE_STEP * 0.07 * j.r * SIZE;
  const TENT_AREA = LINE_STEP * 0.05;
  const flash = (0.8 + 0.55 * p) * (1 + 1.4 * (j.excite || 0)) * (1 + 0.8 * litAmt(j)); // each contraction, a touch and a pulse make the bell glow brighter
  // remember where the bell is on screen, for the hover check
  const [bx, by, bz] = project(cx, y + Hb * 0.4, cz);
  j.screen = { x: bx, y: by, r: (R * focal) / bz };

  // Bell: a dome. Brightness from the rim (grazing angle), canals and gonads.
  const view = [Math.sin(yaw), 0, -Math.cos(yaw)];
  const TH_MAX = 1.3;
  // (per-ring values are worked out once per ring instead of per
  // sample, and colours are passed as numbers; same maths, same picture.)
  const [bellR, bellG, bellB] = col.bell;
  const [gloR, gloG, gloB] = col.glow;
  for (let th = 0.02; th <= TH_MAX; th += BELL_STEP) {
    const sth = Math.sin(th), cth = Math.cos(th);
    const ring = Math.max(10, Math.round(sth * R * BELL_RING));
    const thf = th / TH_MAX;
    // The rim curls in as the bell contracts and flares out as it relaxes
    const edge = Math.max(0, th - 1.02);
    const flare = 1 + edge * (0.45 * (1 - p) - 0.5 * p);
    const ly = Hb * cth;
    const ny = cth * (R / Hb);
    const margin = 0.3 * Math.pow(thf, 8); // the bell margin is brightest
    const whiten = Math.pow(thf, 5) * 0.4; // ...and whiter
    const rimR = bellR + (255 - bellR) * whiten, rimG = bellG + (255 - bellG) * whiten, rimB = bellB + (255 - bellB) * whiten;
    const gr = Math.abs(th - 0.5);
    for (let i = 0; i < ring; i++) {
      const ph = (i / ring) * Math.PI * 2;
      const cph = Math.cos(ph), sph = Math.sin(ph);
      const scallop = 1 + 0.035 * Math.sin(ph * 16) * thf; // wavy margin
      const lx = R * sth * cph * scallop * flare;
      const lz = R * sth * sph * scallop * flare;
      // Facing: how directly this bit of membrane faces us (normal . view)
      const nx = sth * cph, nz = sth * sph;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); // (Math.hypot is slow in V8)
      const facing = Math.abs((nx * view[0] + nz * view[2]) / nl);
      let b = 0.02 + 0.22 * Math.pow(1 - facing, 2.2); // translucent: faint, edges glow
      b += margin;
      const canal = Math.abs(Math.sin(ph * 4)); // eight radial canals
      if (canal < 0.07 && th > 0.25) b += 0.18;
      // Four horseshoe gonads around the top, glowing through the bell
      const gq = Math.abs(Math.sin(ph * 2));
      const gonad = gr < 0.14 && gq > 0.6 ? 1 - gr / 0.14 : 0;
      b += gonad * 0.7;
      b *= flash;
      if (gonad > 0.2) put(lx, ly, lz, b, gloR, gloG, gloB, false, BELL_AREA);
      else put(lx, ly, lz, b, rimR, rimG, rimB, false, BELL_AREA);
    }
  }

  // Oral arms: four frilly ribbons rippling down from the centre
  const armLen = 1.6 * j.r * SIZE;
  const armR = gloR + (bellR - gloR) * 0.5, armG = gloG + (bellG - gloG) * 0.5, armB = gloB + (bellB - gloB) * 0.5;
  // how far each step down the arms trails (the same for all four arms)
  let n = 0;
  for (let s = 0; s < armLen; s += LINE_STEP) lagTab[n++] = drag(s * 0.08) * 0.6;
  for (let a = 0; a < 4; a++) {
    const ang = a * (Math.PI / 2) + 0.4;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let si = 0;
    for (let s = 0; s < armLen; s += LINE_STEP, si++) {
      const sway = Math.sin(s * 1.6 - t * 1.1 + a) * 0.15 * s;
      const bx = ca * (0.12 + sway), bz = sa * (0.12 + sway);
      const by = Hb * 0.15 - s - lagTab[si];
      const bright = 0.14 * flash * (1 - (s / armLen) * 0.6);
      for (let u = -1; u <= 1; u += 0.5) {
        const ruffle = Math.sin(s * 9 + u * 3 - t * 2) * 0.08;
        const w = u * 0.12 * j.r * SIZE * (1 - s / (1.2 * armLen));
        put(bx - sa * w + ruffle * ca, by, bz + ca * w + ruffle * sa, bright, armR, armG, armB, false, ARM_AREA);
      }
    }
  }

  // Tentacles: from the margin, trailing below and waving, lagging the pulse.
  // The pulse and push s units down depend only on s, so they're worked out
  // once per step for all tentacles (they were recomputed for every sample).
  let maxLen = 0;
  for (let i = 0; i < j.tentacles; i++) maxLen = Math.max(maxLen, (2.2 + hash(j.seed, i) * 2.2) * j.r * SIZE);
  n = 0;
  for (let s = 0; s < maxLen; s += LINE_STEP, n++) {
    const lag = s * 0.11;
    plTab[n] = pAt(t - lag);
    lagTab[n] = drag(lag) * 0.7;
  }
  const [tenR, tenG, tenB] = col.tent;
  const follow0 = 1 - 0.18 * p;
  const sTM = Math.sin(TH_MAX), cTM = Math.cos(TH_MAX);
  for (let i = 0; i < j.tentacles; i++) {
    const ph = (i / j.tentacles) * Math.PI * 2;
    const len = (2.2 + hash(j.seed, i) * 2.2) * j.r * SIZE;
    const rx = R * sTM * Math.cos(ph), rz = R * sTM * Math.sin(ph), ry = Hb * cTM;
    let si = 0;
    for (let s = 0; s < len; s += LINE_STEP, si++) {
      // Waves travel down each tentacle, growing towards the tip
      const k = s / len;
      const wave1 = Math.sin(s * 1.1 - t * 1.5 + i * 1.7) * 0.35 * k;
      const wave2 = Math.cos(s * 0.8 - t * 1.1 + i) * 0.25 * k;
      // lower down, it follows the bell's width and push from a moment ago
      const pl = plTab[si];
      const follow = (1 - 0.18 * pl) / follow0; // the bell's width then, against now
      const spread = (1 + 0.05 * s * (1 - pl)) * follow; // fan out a little when relaxed
      const b = 1.1 * (1 - k * 0.85);
      put(rx * spread + wave1, ry - s - lagTab[si], rz * spread + wave2, b, tenR, tenG, tenB, true, TENT_AREA);
    }
  }
}
// Scratch tables for drawJelly, one entry per LINE_STEP down an arm or
// tentacle (the longest, a hero jelly at ?size=2.5 and detail 1, is ~1700 steps)
const plTab = new Float64Array(4096);
const lagTab = new Float64Array(4096);

// ---- frame ----
const RAMP = " .:-=+*oO#%@";
const STROKES = "|!:;";
// Hover scramble (CPU): a shading block for cell (x, y) of brightness L, or
// null. Same rule as the GPU's glyph shader: inside the circle, with a
// chance that's SCRAMBLE.amt at the cursor and falls off towards the edge,
// re-rolled every 90 ms; ░▒▓ by brightness, with a little jitter.
function scrambled(x, y, L) {
  if (SCRAMBLE.amt <= 0) return null;
  const d = Math.hypot((x + 0.5) * cw - SCRAMBLE.x, (y + 0.5) * ch - SCRAMBLE.y) / SCRAMBLE.r;
  if (d >= 1 || hash(x, y, SCRAMBLE.bucket) >= SCRAMBLE.amt * (1 - d * d)) return null;
  const i = Math.floor(L * 3 + (hash(x + 7, y + 3, SCRAMBLE.bucket) - 0.5) * 0.8);
  return SHADES[Math.max(0, Math.min(2, i))];
}
const styles = new Map();
function style(r, g, b) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v / 6) * 6));
  const key = (q(r) << 16) | (q(g) << 8) | q(b);
  let s = styles.get(key);
  if (!s) styles.set(key, (s = `rgb(${q(r)},${q(g)},${q(b)})`));
  return s;
}

const start = performance.now();
let last = 0;
// ?fps=15-30 (Settings → performance)
const FPS = reduced ? 1 : preview ? 8 : num("fps", 30, 10, 30);
function frame(now) {
  const dt = Math.min(0.2, (now - last) / 1000);
  last = now;
  render(now, dt);
}

// ?perf: log the average time of each part of a frame every 2 s (dev aid)
const PERF = params.has("perf") ? { n: 0, sim: 0, cells: 0, draw: 0, lit: 0, samples: 0 } : null;

function render(now, dt) {
  const p0 = PERF && performance.now();
  const t = STILL ? STILL_AT : reduced ? 0 : (now - start) / 1000 + 40;
  // Far away with a narrow view, so tentacles hang straight instead of
  // fanning out in perspective; about 20 units of water from top to bottom
  camDist = 70;
  focal = (H / 20) * camDist;

  HALF_W = (10 * W) / H;
  reactionsTick(dt);
  if (GLR) {
    // GPU: hover bookkeeping and per-jelly state here, everything else in shaders
    hoverTick(dt);
    const jellies = [];
    for (const j of JELLIES) {
      const s = jellyState(j, t);
      if (s) jellies.push({ j, s });
    }
    GLR.draw({ t, W, H, camDist, focal, cam: [cy, sy, cp, sp], halfW: HALF_W, deep: DEEP, snowCol: SNOW_COL, bg: BG, reduced, bellStep: BELL_STEP, bellRing: BELL_RING, lineStep: LINE_STEP, jellies, scramble: SCRAMBLE });
    if (PERF && ++PERF.n === 60) {
      console.log(`perf gpu ${cols}x${rows} cells: cpu side ${((performance.now() - p0)).toFixed(2)} ms (last frame)`);
      PERF.n = 0;
    }
    return;
  }

  acc.fill(0);
  sr.fill(0);
  sg.fill(0);
  sb.fill(0);
  tent.fill(0);

  // Marine snow, drifting slowly down (off with ?specks=0: plain black water)
  if (SPECKS)
    for (const [xf, y0, z, m] of SNOW) {
      const y = ((((y0 - t * (0.08 + m * 0.06)) + 10) % 20) + 20) % 20 - 10;
      glow(xf * HALF_W * 1.05 + Math.sin(t * 0.2 + m * 9) * 0.3, y, z, 0.06 + 0.1 * m, SNOW_COL, false);
    }
  // Hover: a jelly under the cursor lights up; the glow fades over ~1.5 s
  hoverTick(dt);
  for (const j of JELLIES) drawJelly(j, t);

  // Glow: a blurred copy of all the light, added back faintly around it
  blur(acc, bA);
  blur(sr, bR);
  blur(sg, bG);
  blur(sb, bB);

  // (No light shafts from the surface any more: as they faded, the character
  // cut-off turned them into dotted wedges that read as artifacts.)

  const p1 = PERF && performance.now();
  const GLOW = 0.7;
  const HALO = ".'`:";
  const groups = new Map();
  for (let k = 0; k < acc.length; k++) {
    const own = acc[k];
    const a = own + bA[k] * GLOW;
    if (a < 0.03) continue;
    const L = 1 - Math.exp(-a * 1.3); // tone-map summed light to 0..1
    if (L < 0.05) continue;
    const r0 = (sr[k] + bR[k] * GLOW) / a, g0 = (sg[k] + bG[k] * GLOW) / a, b0 = (sb[k] + bB[k] * GLOW) / a;
    // Brightest spots run towards white, like an over-exposed glow
    const hot = Math.max(0, L - 0.75) * 2;
    const f = 0.25 + 0.95 * L;
    const r = r0 * f + (255 - r0 * f) * hot * 0.6;
    const g = g0 * f + (255 - g0 * f) * hot * 0.6;
    const b = b0 * f + (255 - b0 * f) * hot * 0.6;
    // Cells lit only by the glow get faint specks; the jellies themselves get
    // the ramp, or stroke characters where tentacles dominate
    const chr0 =
      own < a * 0.35 ? HALO[Math.min(HALO.length - 1, Math.floor(L * 2 * HALO.length))]
      : tent[k] > own * 0.6 ? STROKES[Math.min(STROKES.length - 1, Math.floor((1 - L) * STROKES.length))]
      : RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(L * (RAMP.length - 1))))];
    const chr = scrambled(k % cols, Math.floor(k / cols), L) ?? chr0;
    const s = style(BG[0] + (r - BG[0]), BG[1] + (g - BG[1]), BG[2] + (b - BG[2]));
    let list = groups.get(s);
    if (!list) groups.set(s, (list = []));
    list.push(k % cols, Math.floor(k / cols), chr);
  }

  const p2 = PERF && performance.now();
  ctx.fillStyle = `rgb(${BG.join(",")})`;
  ctx.fillRect(0, 0, W, H);
  let lit = 0;
  for (const [s, list] of groups) {
    ctx.fillStyle = s;
    for (let i = 0; i < list.length; i += 3) ctx.fillText(list[i + 2], list[i] * cw, list[i + 1] * ch);
    lit += list.length / 3;
  }
  if (PERF) {
    const p3 = performance.now();
    PERF.n++, (PERF.sim += p1 - p0), (PERF.cells += p2 - p1), (PERF.draw += p3 - p2), (PERF.lit += lit);
    if (PERF.n === 60) {
      const f = (v) => (v / 60).toFixed(2);
      console.log(`perf ${cols}x${rows} cells: sim ${f(PERF.sim)} ms, cells ${f(PERF.cells)} ms, draw ${f(PERF.draw)} ms, lit ${Math.round(PERF.lit / 60)}, styles ${groups.size}, samples ${Math.round(PERF.samples / 60)}`);
      Object.assign(PERF, { n: 0, sim: 0, cells: 0, draw: 0, lit: 0, samples: 0 });
    }
  }
}

setPalette();

// Pick the renderer. The GPU one gets the jellies' fixed sample parameters
// once; if it can't start, or its context is lost later (driver update, GPU
// reset), the page carries on with the CPU renderer on a fresh canvas.
if (wantGPU()) {
  GLR = createJellyGL(canvas, { still: STILL, jellies: JELLIES, templateFor, snow: new Float32Array(SPECKS ? SNOW.flatMap(([xf, y0, z, m]) => [xf, y0, z, m, 3]) : []) });
  if (GLR) {
    document.documentElement.dataset.renderer = "gpu";
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      console.warn("afterglow: GPU context lost, switching the jellyfish to the CPU");
      useCPU();
    });
  }
}
if (!GLR) useCPU(true);
// ?debug: per-cell light from whichever renderer is running (dev aid)
if (params.has("debug"))
  (window.__jelly = () => (GLR ? { gpu: GLR.readLight() } : { cpu: { acc, sr, sg, sb, tent, cols, rows } })), (window.__jellies = JELLIES);
function useCPU(first) {
  GLR = null;
  if (!first) {
    const fresh = newCanvas();
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  ctx = canvas.getContext("2d");
  document.documentElement.dataset.renderer = "cpu";
  if (!first) {
    resize();
    render(performance.now(), 0);
  }
}

if (STILL) {
  // One frame at the chosen moment, handed to the stills page
  fontReady().then(() => {
    resize();
    render(0, 0);
    sendStill(canvas);
  });
} else {
  resize();
  addEventListener("resize", () => {
    resize();
    render(performance.now(), 0);
  });
  document.fonts?.ready.then(() => {
    resize();
    render(performance.now(), 0);
  });
  paceFrames(FPS, frame);
}
