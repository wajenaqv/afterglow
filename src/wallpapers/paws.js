// wallpapers/paws (ported unchanged from heywajih.com; pausing is handled by
// nightscene.js): an invisible cat walking across the screen. Glowing paw
// prints appear one at a time, left and right, along a wandering path that
// comes in from any edge, curves and turns, and leaves by another. Each
// lands with a soft whiter flash, glows in its walk's colour, then cools
// towards violet and fades. Now and then the cat stops, feet side by side,
// before walking on, and sometimes a second cat crosses on its own path.
//
// The print's shape follows the owner's reference (a cat's paw icon): two
// tall oval toes in the middle, two smaller round toes lower at the sides,
// and a rounded triangular pad with a flat base. The look is the
// wallpapers' own (like the jellyfish): each bean is translucent light,
// a little brighter at its edges, with a soft halo, and overlapping glow
// adds up. A finer character grid than the other scenes keeps the prints
// small but detailed. Walks come from seeds, so every viewer sees the same
// cats. Built on nightscene.js's renderer (light -> characters).
//
// Hover (common.js pointer): the curious cat. Rest the cursor somewhere for
// a moment and the cat that's walking turns towards it, circles round it
// once, sits beside it for a few seconds as if sniffing, then wanders off
// to an edge (at most once every little while).
//
// ?trail (for stills): one long walk across the whole screen, every print
// visible, its colour stepping through the palette, newest end brightest.
//
// Options: ?tint=natural|cool|grey|warm (palette) ?theme=<name> ?trail
//          ?still=<id>&at=<s> (one frame for the stills page, see common.js)
//          ?size=<0.3-2.5> (print size) ?preview

import { num, seeded, hash, params, HOVER, pointer, stillFor, STILL, STILL_AT, onReaction } from "./common.js";
const TRAIL = params.has("trail");
import { C, setPalette, startScene, scale, add, mix, smooth, ellipse, circle, reduced } from "./nightscene.js";

const SIZE = num("size", 1, 0.3, 2.5);
let BG = C(3, 3, 8);
let FLASH = C(255, 240, 230);
// Palettes (?tint=): one colour per walk, and what prints cool to as they
// fade. natural is the original mix.
const PALETTES = {
  natural: {
    old: C(175, 135, 205),
    tints: [
      C(255, 176, 150), // peach
      C(255, 150, 190), // rose
      C(255, 204, 128), // amber
      C(210, 175, 255), // lilac
      C(150, 235, 210), // mint
      C(140, 205, 255), // sky
      C(255, 130, 130), // coral
      C(170, 160, 255), // periwinkle
      C(255, 230, 150), // honey
      C(240, 150, 255), // orchid
      C(120, 235, 240), // aqua
    ],
  },
  cool: {
    old: C(110, 120, 200),
    tints: [C(140, 205, 255), C(120, 235, 240), C(150, 235, 210), C(170, 160, 255), C(110, 160, 255), C(190, 225, 255), C(100, 215, 200)], // sky, aqua, mint, periwinkle, blue, ice, teal
  },
  grey: {
    old: C(110, 112, 120),
    tints: [C(240, 242, 248), C(200, 205, 215), C(220, 220, 220), C(175, 180, 190), C(245, 240, 232)], // pearl, silver, light grey, slate, warm white
  },
  warm: {
    old: C(170, 90, 110),
    tints: [C(255, 176, 150), C(255, 150, 190), C(255, 204, 128), C(255, 130, 130), C(255, 230, 150), C(255, 160, 90), C(255, 110, 160)], // peach, rose, amber, coral, honey, tangerine, raspberry
  },
};
const PALETTE = PALETTES[params.get("tint")] ?? PALETTES.natural;
let OLD = PALETTE.old; // what a print cools to as it fades
let TINTS = PALETTE.tints;
setPalette(({ fg, accent, bright, dim }) => {
  BG = scale(dim, 0.04);
  FLASH = bright;
  OLD = dim;
  TINTS = [accent, fg, bright];
  return {};
});

const STEP = 0.62; // seconds between prints
const LIFE = 11; // seconds a print takes to fade away
const PAUSE = 3.5; // seconds a cat stands still when it stops

let A = 16 / 9, U = 0.06, dims; // screen aspect; print size (screen heights)

// ---- the print: lx forward (towards the toes), ly across, in units of U ----
const BEANS = [
  (x, y) => ellipse(x, y, 0.62, -0.27, 0.25, 0.15), // tall middle toes
  (x, y) => ellipse(x, y, 0.62, 0.27, 0.25, 0.15),
  (x, y) => ellipse(x, y, 0.3, -0.64, 0.17, 0.155), // smaller outer toes, lower
  (x, y) => ellipse(x, y, 0.3, 0.64, 0.17, 0.155),
  // the pad: a rounded triangle with a flat base
  (x, y) => Math.min(Math.max(ellipse(x, y, -0.34, 0, 0.36, 0.52), -(x + 0.62)), circle(x, y, -0.06, 0, 0.21)),
];
// Light from one print at local (lx, ly): translucent beans, a little
// brighter towards their edges, each with a soft halo
function printLight(lx, ly) {
  let light = 0;
  for (const bean of BEANS) {
    const d = bean(lx, ly);
    if (d < 0) light += 0.62 + 0.38 * smooth(-0.09, 0, d);
    else light += 0.32 * Math.exp(-d / 0.07); // halo
  }
  return light;
}

// ---- walks: prints { x, y, a (heading), at, tint } ----
function makeWalk(seed, start, tintOverride) {
  const rnd = seeded(seed);
  // enter from a random point on any edge, heading for a point somewhere inside
  const edge = Math.floor(rnd() * 4), e = rnd();
  let [x, y] = [[-0.08, e], [A + 0.08, e], [e * A, -0.08], [e * A, 1.08]][edge];
  const [tx, ty] = [A * (0.2 + rnd() * 0.6), 0.2 + rnd() * 0.6];
  let a = Math.atan2(ty - y, tx - x);
  const stride = U * 2.1; // short steps
  const off = U * 0.42; // feet almost in a single line
  const wander = 0.04 + rnd() * 0.05, phase = rnd() * 6;
  const stopAt = rnd() < 0.45 ? 6 + Math.floor(rnd() * 8) : -1;
  const turnAt = 4 + Math.floor(rnd() * 10), turnBy = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.9);
  const picked = TINTS[Math.floor(rnd() * TINTS.length)];
  const tint = tintOverride ?? picked; // a messenger cat walks in its app's colour
  const prints = [];
  let time = start;
  for (let n = 0; n < 120; n++) {
    a += wander * Math.sin(n * 0.37 + phase) + (n >= turnAt && n < turnAt + 5 ? turnBy / 5 : 0);
    x += Math.cos(a) * stride;
    y += Math.sin(a) * stride;
    const side = n % 2 ? 1 : -1;
    prints.push({ x: x - Math.sin(a) * off * side, y: y + Math.cos(a) * off * side, a, at: time, tint, cx: x, cy: y, n });
    time += STEP;
    if (n === stopAt) {
      // stops: the other foot comes up alongside, a print-width over (feet
      // set closer than that overlapped into a "double paw"), then a pause
      const across = U * 1.85 - off;
      prints.push({ x: x + Math.sin(a) * across * side, y: y - Math.cos(a) * across * side, a, at: time, tint });
      time += STEP + PAUSE;
    }
    if (n > 3 && (x < -0.12 || x > A + 0.12 || y < -0.12 || y > 1.12)) break;
  }
  return { prints, end: time, tint };
}

// ---- hover: the curious cat ----
// When the cursor rests, the walking cat's remaining steps are replaced by a
// detour: towards the cursor, once round it, a sit beside it, then away.
const CURIOUS_AFTER = 1.2; // seconds the cursor must rest
let curiousUntil = -1e9; // no new detour before this (scene seconds)
const turnTowards = (a, want, max) => {
  const d = Math.atan2(Math.sin(want - a), Math.cos(want - a));
  return a + Math.max(-max, Math.min(max, d));
};
function detour(prints, last, tx, ty, tint) {
  let x = last.cx, y = last.cy, a = last.a, n = last.n + 1, time = last.at + STEP;
  const stride = U * 2.1, off = U * 0.42, R = U * 3.4; // a roomy circle, so the prints don't pile up
  const put = (px, py, pa, side = n % 2 ? 1 : -1, lat = off) => {
    prints.push({ x: px - Math.sin(pa) * lat * side, y: py + Math.cos(pa) * lat * side, a: pa, at: time, tint, cx: px, cy: py, n });
    n++;
    time += STEP;
  };
  // 1. turn and walk towards it
  for (let k = 0; k < 60 && Math.hypot(tx - x, ty - y) > R + stride * 0.6; k++) {
    a = turnTowards(a, Math.atan2(ty - y, tx - x), 0.38);
    x += Math.cos(a) * stride;
    y += Math.sin(a) * stride;
    put(x, y, a);
  }
  // 2. once round it, the way it was already turning
  const t0 = Math.atan2(y - ty, x - tx);
  const dir = Math.sin(a - t0) >= 0 ? 1 : -1;
  const steps = Math.max(8, Math.ceil((Math.PI * 2 * R) / stride));
  for (let k = 1; k <= steps; k++) {
    const th = t0 + (dir * k * Math.PI * 2) / steps;
    x = tx + Math.cos(th) * R;
    y = ty + Math.sin(th) * R;
    a = th + (dir * Math.PI) / 2;
    put(x, y, a);
  }
  // 3. sit beside it, facing it: the other foot comes alongside, then a pause
  a = Math.atan2(ty - y, tx - x);
  put(x, y, a, -1, U * 0.92); // side by side, a print-width apart (no overlap)
  put(x, y, a, 1, U * 0.92);
  time += PAUSE + 1;
  // 4. wander off, away from it, until off screen
  a = Math.atan2(y - ty, x - tx) + (Math.random() - 0.5) * 1.2;
  for (let k = 0; k < 90; k++) {
    a += 0.05 * Math.sin(k * 0.4);
    x += Math.cos(a) * stride;
    y += Math.sin(a) * stride;
    put(x, y, a);
    if (x < -0.12 || x > A + 0.12 || y < -0.12 || y > 1.12) break;
  }
  return time;
}
function curious(t) {
  if (!HOVER || !pointer.on || stillFor() < CURIOUS_AFTER || t < curiousUntil) return;
  const tx = pointer.x / dims.H, ty = pointer.y / dims.H;
  for (const cat of cats) {
    const i = cat.walks.findIndex((w) => w.prints.length && w.prints[0].at <= t && w.end > t);
    if (i < 0) continue;
    const w = cat.walks[i];
    const done = w.prints.filter((p) => p.at <= t);
    const last = done[done.length - 1];
    if (!last || t - last.at > STEP * 1.5) continue; // not mid-stride (standing still)
    w.prints = done;
    w.end = detour(w.prints, last, tx, ty, w.tint);
    cat.walks.length = i + 1; // later walks start again after the detour
    curiousUntil = w.end + 6;
    return;
  }
}

// Two cats: the first walks again and again; the second only now and then
const cats = [
  { walks: [], n: 0, gap: (r) => 1.5 + r * 2.5, first: -LIFE * 0.5 },
  { walks: [], n: 0, gap: (r) => 20 + r * 35, first: 14 },
];
function walksUpTo(t) {
  cats.forEach((cat, c) => {
    while (!cat.walks.length || cat.walks[cat.walks.length - 1].end < t + 1) {
      const prev = cat.walks[cat.walks.length - 1];
      const seed = 1000 + c * 50021 + cat.n * 7919;
      cat.walks.push(makeWalk(seed, prev ? prev.end + cat.gap(hash(cat.n, c, 5)) : cat.first));
      cat.n++;
    }
    while (cat.walks.length > 2 && cat.walks[1].end + LIFE < t) cat.walks.shift();
  });
}

// Brightness at age (s): lands with a soft flash, then fades slowly
function glowAt(age) {
  if (age < 0) return 0;
  return smooth(0, 0.2, age) * (0.5 + 0.5 * Math.exp(-age / 1.2)) * (1 - smooth(LIFE * 0.3, LIFE, age));
}

let active = [];
// The long trail: a gentle S-curve from one edge to the opposite one (left
// to right on wide screens, bottom to top on tall ones), seeded by the
// moment so each shuffle walks a different path
function trailPrints(t) {
  const rnd = seeded(Math.floor(STILL_AT * 1000) + 7); // the moment picks the path (steady if left running)
  const portrait = A < 1;
  const stride = U * 2.1, off = U * 0.42;
  let x, y, a;
  if (portrait) [x, y, a] = [A * (0.3 + rnd() * 0.4), 1.08, -Math.PI / 2 + (rnd() - 0.5) * 0.4];
  else [x, y, a] = [-0.08, 0.3 + rnd() * 0.4, (rnd() - 0.5) * 0.4];
  const bend = (0.05 + rnd() * 0.05) * (rnd() < 0.5 ? -1 : 1), phase = rnd() * 6;
  const prints = [];
  for (let n = 0; n < 200; n++) {
    a += bend * Math.sin(n * 0.18 + phase);
    x += Math.cos(a) * stride;
    y += Math.sin(a) * stride;
    const side = n % 2 ? 1 : -1;
    prints.push({ x: x - Math.sin(a) * off * side, y: y + Math.cos(a) * off * side, a });
    if (n > 3 && (x < -0.1 || x > A + 0.1 || y < -0.1 || y > 1.1)) break;
  }
  // colour steps through the palette along the walk; older end dimmer
  const n = prints.length;
  return prints.map((p, i) => {
    const f = i / Math.max(1, n - 1);
    const pos = f * (TINTS.length - 1);
    const colour = mix(TINTS[Math.floor(pos)], TINTS[Math.min(TINTS.length - 1, Math.floor(pos) + 1)], pos - Math.floor(pos));
    return { ...p, g: 0.35 + 0.65 * f, colour, ca: Math.cos(p.a), sa: Math.sin(p.a) };
  });
}

// ---- reactions (AfterGlow; common.js onReaction, signals.rs) ----
//   pulse  a messenger cat walks in from an edge, in the app's colour
//   flash  every glowing print brightens for a moment
const messengers = []; // walks started by pulses
let messengerN = 0;
let lastT = 0; // the scene time of the last frame
let flashAmt = 0;
onReaction((r) => {
  if (r.type === "pulse") {
    const colour = r.colour.map((v) => Math.max(0, Math.min(255, v)) / 255);
    messengers.push(makeWalk(90001 + messengerN++ * 7919, lastT, colour));
  } else if (r.type === "flash") flashAmt = 1;
});

function frame(t) {
  if (TRAIL) {
    active = trailPrints(t);
    return;
  }
  if (!reduced) curious(t);
  walksUpTo(t);
  flashAmt *= Math.exp(-Math.max(0, t - lastT) / 0.5);
  lastT = t;
  while (messengers.length && messengers[0].end + LIFE < t) messengers.shift();
  active = [];
  const walks = cats.flatMap((cat) => cat.walks).concat(messengers);
  for (const w of walks) for (const p of w.prints) {
    const age = reduced ? 3 : t - p.at;
    const g = reduced ? (p.at < 8 ? 0.8 : 0) : glowAt(age);
    if (g <= 0.01) continue;
    // fresh prints run whiter, then take the walk's colour and cool to violet
    const fresh = Math.exp(-age / 0.45) * 0.5;
    let colour = add(scale(mix(p.tint, OLD, smooth(1, 7, age)), 1 - fresh), FLASH, fresh);
    if (flashAmt > 0.01) colour = add(colour, FLASH, flashAmt * 0.6);
    active.push({ ...p, g: g * (1 + flashAmt), colour, ca: Math.cos(p.a), sa: Math.sin(p.a) });
  }
}

function layout(d) {
  dims = d;
  A = d.A;
  U = 0.06 * SIZE;
  cats.forEach((c) => ((c.walks = []), (c.n = 0)));
}

function sample(X, Y) {
  let col = BG;
  for (const p of active) {
    const dx = X - p.x, dy = Y - p.y;
    if (dx * dx + dy * dy > (U * 1.15) ** 2) continue;
    const light = printLight((dx * p.ca + dy * p.sa) / U, (-dx * p.sa + dy * p.ca) / U);
    if (light > 0.01) col = add(col, p.colour, 1.25 * light * p.g);
  }
  return [col, null];
}

// ---- the GPU version of sample() (AfterGlow, scene-gl.js) ----
// The prints that are glowing go to the GPU each frame as a small float
// texture (row 0: x, y, cos, sin of the heading; row 1: colour, glow), and
// this shader does sample()'s maths per cell: printLight()'s beans and pad,
// their translucent fill and halo, added up over the prints.
const PAWS_GLSL = `
uniform sampler2D uPrints;
uniform int uCount;
uniform float uU;
uniform vec3 uStart; // the scene's own background light (BG)
float ellipseD(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
float circleD(vec2 p, vec2 c, float r) { return length(p - c) - r; }
float smoothF(float a, float b, float v) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float bean(float d) { return d < 0.0 ? 0.62 + 0.38 * smoothF(-0.09, 0.0, d) : 0.32 * exp(-d / 0.07); }
float printLight(vec2 l) {
  float s = 0.0;
  s += bean(ellipseD(l, vec2(0.62, -0.27), vec2(0.25, 0.15)));
  s += bean(ellipseD(l, vec2(0.62, 0.27), vec2(0.25, 0.15)));
  s += bean(ellipseD(l, vec2(0.3, -0.64), vec2(0.17, 0.155)));
  s += bean(ellipseD(l, vec2(0.3, 0.64), vec2(0.17, 0.155)));
  s += bean(min(max(ellipseD(l, vec2(-0.34, 0.0), vec2(0.36, 0.52)), -(l.x + 0.62)), circleD(l, vec2(-0.06, 0.0), 0.21)));
  return s;
}
vec3 sampleCell(vec2 P) {
  vec3 col = uStart;
  float reach = uU * 1.15;
  for (int i = 0; i < uCount; i++) {
    vec4 a = texelFetch(uPrints, ivec2(i, 0), 0);
    vec2 d = P - a.xy;
    if (dot(d, d) > reach * reach) continue;
    float light = printLight(vec2(d.x * a.z + d.y * a.w, -d.x * a.w + d.y * a.z) / uU);
    if (light > 0.01) {
      vec4 b = texelFetch(uPrints, ivec2(i, 1), 0);
      col += b.rgb * (1.25 * light * b.a);
    }
  }
  return col;
}`;
let printsTex = null;
const gpuSpec = {
  glsl: PAWS_GLSL,
  bind(gl, u, unit) {
    const n = Math.max(1, active.length);
    const data = new Float32Array(n * 2 * 4);
    active.forEach((p, i) => {
      data.set([p.x, p.y, p.ca, p.sa], i * 4);
      data.set([p.colour[0], p.colour[1], p.colour[2], p.g], (n + i) * 4);
    });
    if (!printsTex) printsTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, printsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform1i(u.uPrints, unit);
    gl.uniform1i(u.uCount, active.length);
    gl.uniform1f(u.uU, U);
    gl.uniform3f(u.uStart, ...BG);
  },
};

startScene({
  label: "Glowing paw prints of invisible cats walking across a dark screen, drawn in coloured text characters.",
  fps: 15,
  fontPx: (H) => (STILL ? H / 165 : Math.max(5, Math.min(10, H / 165))), // stills scale freely
  layout,
  frame,
  sample,
  gpu: gpuSpec,
});
