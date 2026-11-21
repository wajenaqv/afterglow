// Shore: a bioluminescent beach at night, seen from straight above. Dark sea
// at the top, dark sand below, the water's edge curving across the screen.
// Waves roll in as faint lines; where one breaks, a band of electric blue
// flares along the crest, runs up the sand as glowing foam, fades and slides
// back, leaving sparkles in the wet sand. Two waves overlap, so one breaks
// every few seconds. The light comes from plankton that glow when disturbed,
// so the cursor in the water stirs glowing trails.
//
// Reactions: a new message breaks the next wave in the app's colour; every
// app with something waiting leaves a glowing patch in the surf in its
// colour, until you rest the cursor on it (seen); a flash lights the water.
//
// Per character cell, the same maths in JS (CPU) and GLSL (GPU), through
// nightscene.js startScene. Options: ?tint=natural|green|violet|grey

import { params, hash, STILL, HOVER, pointer, onReaction, seenLantern } from "./common.js";
import { setPalette, startScene, reduced, BG } from "./nightscene.js";

const T = 11; // seconds per wave cycle; WAVES of them, evenly offset
const WAVES = 2;
const PB = 0.5; // the part of a cycle spent rolling in, before it breaks
const TRAIL = 24; // cursor trail points
const PATCHES = 6; // most lanterns shown

const TINTS = {
  natural: [0.15, 0.72, 1.0], // electric blue
  green: [0.2, 1.0, 0.55],
  violet: [0.55, 0.4, 1.0],
  grey: [0.75, 0.8, 0.85],
};
const GLOW = TINTS[params.get("tint")] ?? TINTS.natural;
const SEA = [0.02, 0.05, 0.09]; // the water's own faint shimmer colour
const SAND = [0.09, 0.075, 0.06];

// ---- the beach ----
// a curving cove: the shore sweeps from high on the right to low on the left
const shoreY = (x) => 0.5 + 0.16 * Math.sin(x * 1.25 - 0.9) + 0.025 * Math.sin(x * 4.1 + 1.7);
const runup = (x, i) => 0.15 + 0.04 * Math.sin(x * 2.3 + i * 1.9);
const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// value noise from the shared integer hash (the GLSL has the same)
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, z), b = hash(xi + 1, yi, z), c = hash(xi, yi + 1, z), d = hash(xi + 1, yi + 1, z);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---- state per frame ----
let dims = null;
const S = { time: 0, flash: 0, pulse: [0, 0, 0], pulseWave: -1, trail: [], patches: [] };
// trail: [{ x, y, age }]; patches: [{ source, colour, x, y }]

const out = [0, 0, 0];
function light(X, Y, cell) {
  const t = S.time;
  const ys = shoreY(X);
  let g = 0; // glow (in the tint)
  let pg = 0; // glow in the pulse colour
  let sea = 0, sand = 0;
  if (Y < ys) sea = smoothstep(0.62, 0.95, vnoise(X * 7 + t * 0.06, Y * 11, 3)) * 0.9;
  else sand = hash(cell[0], cell[1], 7) < 0.02 ? 0.5 : 0;
  for (let i = 0; i < WAVES; i++) {
    const cyc = t / T + i / WAVES;
    const n = Math.floor(cyc);
    const p = cyc - n + 0.05 * Math.sin(X * 0.9 + n * 2.0); // the break sweeps along the shore
    const isPulse = n * WAVES + i === S.pulseWave;
    let w = 0;
    if (p < PB) {
      // rolling in: a faint line, brighter as it nears the shore
      const q = Math.max(0, p / PB);
      const yf = -0.08 + (ys + 0.01 + 0.08) * Math.pow(q, 1.3);
      const d = Y - yf;
      w += Math.exp(-((d / 0.01) ** 2)) * (0.06 + 0.5 * q ** 4);
      if (d < 0) w += Math.exp(d / 0.025) * 0.04 * q;
    } else {
      // broken: the flare, then foam running up the sand and sliding back
      const q = (p - PB) / (1 - PB);
      const R = runup(X, n);
      const ysw = ys + R * Math.sin(Math.PI * Math.min(1, q * 1.15));
      const flare = Math.exp(-(((q - 0.03) / 0.07) ** 2)) * 1.8;
      if (Y > ys - 0.03 && Y < ysw + 0.01) {
        const foam = smoothstep(0.45, 0.8, 0.6 * vnoise(X * 16, Y * 16 - q * 3, 11 + n) + 0.4 * vnoise(X * 38, Y * 38 - q * 6, 13 + n));
        const fade = Math.pow(1 - q, 0.8);
        w += foam * fade * 1.0 + flare * smoothstep(ys - 0.03, ys, Y) * (1 - smoothstep(ysw - 0.06, ysw, Y)) * 0.6;
      }
      w += Math.exp(-(((Y - ysw) / 0.007) ** 2)) * (1 - q) * 1.5 + flare * Math.exp(-(((Y - ys) / 0.02) ** 2));
      // sparkles left in the wet sand as it slides back
      if (Y > ys && Y < ys + R && Y > ysw && q > 0.45) {
        const s = hash(cell[0], cell[1], 100 + n * 7 + i) < 0.05 ? 1 : 0;
        w += s * Math.exp(-(q - 0.45) * 3.5) * (0.6 + 0.4 * Math.sin(t * 6 + hash(cell[0], cell[1], 5) * 6.283)) * 0.9;
      }
    }
    if (isPulse) pg += w;
    else g += w;
  }
  // the shallow edge keeps twinkling between waves
  const dz = Math.abs(Y - ys);
  if (dz < 0.045) {
    const tz = Math.floor(t * 1.5 + hash(cell[0], cell[1], 9) * 7);
    if (hash(cell[0], cell[1], 200 + tz) < 0.035) g += 0.45 * (1 - dz / 0.045);
  }
  // the cursor stirring the water
  // (segments between successive points, widening as they fade, like
  // stirred water spreading)
  if (Y < ys + 0.02)
    for (let k = 0; k < S.trail.length; k++) {
      const a = S.trail[k], b = S.trail[Math.min(k + 1, S.trail.length - 1)];
      const joined = b.age - a.age < 0.4;
      const bx = joined ? b.x : a.x, by = joined ? b.y : a.y;
      const dx = bx - a.x, dy = by - a.y, l2 = dx * dx + dy * dy;
      const h = l2 > 0 ? Math.max(0, Math.min(1, ((X - a.x) * dx + (Y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(X - a.x - dx * h, Y - a.y - dy * h);
      const rad = 0.01 + a.age * 0.012;
      if (d < rad * 5) g = Math.max(g, Math.exp(-d / rad) * Math.exp(-a.age / 1.6) * 0.9);
    }
  // waiting apps: glowing patches in the surf
  const br = 0.75 + 0.25 * Math.sin(t * 1.4);
  for (const pt of S.patches) {
    const d = Math.hypot((X - pt.x) / 1.6, Y - pt.y);
    if (d < 0.12) {
      const v = Math.exp(-d / 0.022) * br * 1.3 * (0.6 + 0.4 * vnoise(X * 40, Y * 40 + t, 17));
      for (let q = 0; q < 3; q++) out[q] += pt.colour[q] * v;
    }
  }
  const f = 1 + S.flash;
  for (let q = 0; q < 3; q++) out[q] += BG[q] / 255 + SEA[q] * sea + SAND[q] * sand + GLOW[q] * g * f + S.pulse[q] * pg * f;
}
function sample(X, Y, t, cell) {
  out[0] = out[1] = out[2] = 0;
  const cw = dims.cw / dims.H, ch = dims.ch / dims.H;
  light((cell[0] + 0.5) * cw, (cell[1] + 0.5) * ch, cell);
  return [out, null];
}

// ---- the same in GLSL ----
const GLSL = `
uniform float uTime, uFlash;
uniform int uPulseWave, uTrailN, uPatchN;
uniform vec3 uGlow, uSea, uSand, uPulse, uStart;
uniform vec3 uTrail[${TRAIL}];
uniform vec2 uPatch[${PATCHES}];
uniform vec3 uPatchCol[${PATCHES}];
const float PI = 3.141592654;
float hash3(int x, int y, int z) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
float vnoise(float x, float y, int z) {
  int xi = int(floor(x)), yi = int(floor(y));
  float fx = x - floor(x), fy = y - floor(y);
  float sx = fx * fx * (3.0 - 2.0 * fx), sy = fy * fy * (3.0 - 2.0 * fy);
  float a = hash3(xi, yi, z), b = hash3(xi + 1, yi, z), c = hash3(xi, yi + 1, z), d = hash3(xi + 1, yi + 1, z);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
float shoreY(float x) { return 0.5 + 0.16 * sin(x * 1.25 - 0.9) + 0.025 * sin(x * 4.1 + 1.7); }
vec3 sampleCell(vec2 P) {
  vec2 cs = uCell / uH;
  ivec2 cell = ivec2(floor(P / cs));
  vec2 C = (vec2(cell) + 0.5) * cs;
  float X = C.x, Y = C.y, t = uTime;
  float ys = shoreY(X);
  float g = 0.0, pg = 0.0, sea = 0.0, sand = 0.0;
  if (Y < ys) sea = smoothstep(0.62, 0.95, vnoise(X * 7.0 + t * 0.06, Y * 11.0, 3)) * 0.9;
  else sand = hash3(cell.x, cell.y, 7) < 0.02 ? 0.5 : 0.0;
  for (int i = 0; i < ${WAVES}; i++) {
    float cyc = t / ${T}.0 + float(i) / ${WAVES}.0;
    float nf = floor(cyc);
    int n = int(nf);
    float p = cyc - nf + 0.05 * sin(X * 0.9 + nf * 2.0);
    bool isPulse = n * ${WAVES} + i == uPulseWave;
    float w = 0.0;
    if (p < ${PB}) {
      float q = max(0.0, p / ${PB});
      float yf = -0.08 + (ys + 0.01 + 0.08) * pow(q, 1.3);
      float d = Y - yf;
      w += exp(-pow(d / 0.01, 2.0)) * (0.06 + 0.5 * pow(q, 4.0));
      if (d < 0.0) w += exp(d / 0.025) * 0.04 * q;
    } else {
      float q = (p - ${PB}) / ${(1 - PB).toFixed(3)};
      float R = 0.15 + 0.04 * sin(X * 2.3 + nf * 1.9);
      float ysw = ys + R * sin(PI * min(1.0, q * 1.15));
      float flare = exp(-pow((q - 0.03) / 0.07, 2.0)) * 1.8;
      if (Y > ys - 0.03 && Y < ysw + 0.01) {
        float foam = smoothstep(0.45, 0.8, 0.6 * vnoise(X * 16.0, Y * 16.0 - q * 3.0, 11 + n) + 0.4 * vnoise(X * 38.0, Y * 38.0 - q * 6.0, 13 + n));
        float fade = pow(1.0 - q, 0.8);
        w += foam * fade * 1.0 + flare * smoothstep(ys - 0.03, ys, Y) * (1.0 - smoothstep(ysw - 0.06, ysw, Y)) * 0.6;
      }
      w += exp(-pow((Y - ysw) / 0.007, 2.0)) * (1.0 - q) * 1.5 + flare * exp(-pow((Y - ys) / 0.02, 2.0));
      if (Y > ys && Y < ys + R && Y > ysw && q > 0.45) {
        float s = hash3(cell.x, cell.y, 100 + n * 7 + i) < 0.05 ? 1.0 : 0.0;
        w += s * exp(-(q - 0.45) * 3.5) * (0.6 + 0.4 * sin(t * 6.0 + hash3(cell.x, cell.y, 5) * 6.283)) * 0.9;
      }
    }
    if (isPulse) pg += w; else g += w;
  }
  float dz = abs(Y - ys);
  if (dz < 0.045) {
    int tz = int(floor(t * 1.5 + hash3(cell.x, cell.y, 9) * 7.0));
    if (hash3(cell.x, cell.y, 200 + tz) < 0.035) g += 0.45 * (1.0 - dz / 0.045);
  }
  if (Y < ys + 0.02) {
    for (int k = 0; k < ${TRAIL}; k++) {
      if (k >= uTrailN) break;
      vec3 a = uTrail[k], b = uTrail[min(k + 1, uTrailN - 1)];
      bool joined = b.z - a.z < 0.4;
      vec2 e = joined ? b.xy - a.xy : vec2(0.0);
      float l2 = dot(e, e);
      float h = l2 > 0.0 ? clamp(dot(vec2(X, Y) - a.xy, e) / l2, 0.0, 1.0) : 0.0;
      float d = length(vec2(X, Y) - a.xy - e * h);
      float rad = 0.01 + a.z * 0.012;
      if (d < rad * 5.0) g = max(g, exp(-d / rad) * exp(-a.z / 1.6) * 0.9);
    }
  }
  vec3 col = vec3(0.0);
  float br = 0.75 + 0.25 * sin(t * 1.4);
  for (int k = 0; k < ${PATCHES}; k++) {
    if (k >= uPatchN) break;
    float d = length(vec2((X - uPatch[k].x) / 1.6, Y - uPatch[k].y));
    if (d < 0.12) col += uPatchCol[k] * (exp(-d / 0.022) * br * 1.3 * (0.6 + 0.4 * vnoise(X * 40.0, Y * 40.0 + t, 17)));
  }
  float f = 1.0 + uFlash;
  return col + uStart + uSea * sea + uSand * sand + uGlow * g * f + uPulse * pg * f;
}`;
const gpu = {
  glsl: GLSL,
  bind(gl, u) {
    gl.uniform1f(u.uTime, S.time);
    gl.uniform1f(u.uFlash, S.flash);
    gl.uniform1i(u.uPulseWave, S.pulseWave);
    gl.uniform3f(u.uGlow, ...GLOW);
    gl.uniform3f(u.uSea, ...SEA);
    gl.uniform3f(u.uSand, ...SAND);
    gl.uniform3f(u.uPulse, ...S.pulse);
    gl.uniform3f(u.uStart, BG[0] / 255, BG[1] / 255, BG[2] / 255);
    const tr = new Float32Array(TRAIL * 3);
    S.trail.slice(0, TRAIL).forEach((p, i) => tr.set([p.x, p.y, p.age], i * 3));
    gl.uniform1i(u.uTrailN, Math.min(TRAIL, S.trail.length));
    gl.uniform3fv(u["uTrail[0]"], tr);
    const pp = new Float32Array(PATCHES * 2), pc = new Float32Array(PATCHES * 3);
    S.patches.forEach((p, i) => {
      pp.set([p.x, p.y], i * 2);
      pc.set(p.colour, i * 3);
    });
    gl.uniform1i(u.uPatchN, S.patches.length);
    gl.uniform2fv(u["uPatch[0]"], pp);
    gl.uniform3fv(u["uPatchCol[0]"], pc);
  },
};

// ---- the cursor, the reactions ----
let lastPoint = null;
function stir(dt) {
  for (const p of S.trail) p.age += dt;
  S.trail = S.trail.filter((p) => p.age < 4);
  if (!HOVER || !pointer.on || !dims) return;
  const x = pointer.x / dims.H, y = pointer.y / dims.H;
  if (!lastPoint || Math.hypot(x - lastPoint.x, y - lastPoint.y) > 0.006) {
    lastPoint = { x, y };
    S.trail.unshift({ x, y, age: 0 });
    if (S.trail.length > TRAIL) S.trail.length = TRAIL;
  }
}
let lanterns = [];
let overSince = null;
function placePatches() {
  const n = Math.min(PATCHES, lanterns.length);
  S.patches = lanterns.slice(0, PATCHES).map((l, i) => {
    const x = dims.A * ((i + 1) / (n + 1));
    return { source: l.source, colour: l.colour.map((c) => c / 255), x, y: shoreY(x) + 0.035 };
  });
  if (!HOVER || !pointer.on || !S.patches.length) return void (overSince = null);
  const X = pointer.x / dims.H, Y = pointer.y / dims.H;
  const pt = S.patches.find((p) => Math.hypot(X - p.x, Y - p.y) < 0.07);
  if (!pt) return void (overSince = null);
  if (overSince?.source !== pt.source) overSince = { source: pt.source, at: performance.now() };
  else if (performance.now() - overSince.at > 800) {
    seenLantern(pt.source);
    overSince = null;
  }
}
let pulseCol = [0, 0, 0], pulseUntil = -1, flashAt = -1e9, nowT = 0;
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    // the next wave to break carries the app's colour
    pulseCol = r.colour.map((v) => v / 255);
    let best = -1, bestDt = 1e9;
    for (let i = 0; i < WAVES; i++) {
      const cyc = S.time / T + i / WAVES;
      const n = Math.floor(cyc), p = cyc - n;
      const dt = p < PB - 0.05 ? (PB - p) * T : (1 - p + PB) * T;
      const id = p < PB - 0.05 ? n * WAVES + i : (n + 1) * WAVES + i;
      if (dt < bestDt) (bestDt = dt), (best = id);
    }
    S.pulseWave = best;
    pulseUntil = S.time + bestDt + T;
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") lanterns = Array.isArray(r.items) ? r.items.filter((l) => Array.isArray(l.colour)) : [];
});

let prevT = null;
function frame(t) {
  nowT = t;
  if (!dims) return;
  S.time = STILL || reduced ? 33 : t;
  stir(prevT === null ? 0 : t - prevT);
  prevT = t;
  S.flash = Math.max(0, 1 - (t - flashAt) / 0.6) * 0.8;
  if (S.pulseWave >= 0 && S.time > pulseUntil) S.pulseWave = -1;
  S.pulse = S.pulseWave >= 0 ? pulseCol : [0, 0, 0];
  placePatches();
}

setPalette();
startScene({
  label: "A bioluminescent beach at night seen from above: waves break into glowing blue foam that runs up the sand and fades.",
  fps: 20,
  fontPx: (H) => (STILL ? H / 120 : Math.max(5, Math.min(11, H / 120))),
  layout: (d) => (dims = d),
  frame,
  sample,
  gpu,
});
