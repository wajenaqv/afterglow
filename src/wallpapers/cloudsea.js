// Cloud sea: the glow left behind after the sun has set, seen from high above a
// rolling sea of cloud. A band of light lies along the horizon and fades up
// into night, streaks of high cloud catch it, and the swells below are lit from
// behind: a bright rim along each crest, the face towards you in shade, cooler
// and darker the farther from the glow. The sea drifts slowly towards you.
//
// The sea is rows of swells, far to near. Each row is a profile of crest
// heights (a share of how far below the horizon the row sits, so near rows are
// big and far rows small); a pixel belongs to the nearest row whose crest is
// above it. Drawn as coloured shade characters (░▒▓) whose size follows the
// light and whose colour carries it, so the picture holds together at any size.
//
// One piece of maths, twice: `seaLight` (JS, the CPU renderer) and the GLSL
// below (the GPU renderer) are the same, line for line. Keep them in step.
//
// Reactions (signals.rs): a pulse sends a wave of the app's colour rolling in
// from the horizon, lighting each crest as it passes, then fading slowly like
// the afterglow it is named for; a flash brightens the sky for a moment.
//
// Options: ?tint=natural|cool|grey|warm (the usual palettes; natural is the
// violet night view) ?dusk=0..1 (another moment: 1 is bright orange afterglow)
// ?cycle=seconds (let the glow cool and return) ?smooth (a plain image of the
// same light, for judging the lighting)

import { hash, params, onReaction } from "./common.js";
import { CLOUDS } from "./palettes.js";
import { setPalette, startScene, reduced, BG } from "./nightscene.js";

const TAU = Math.PI * 2;
const HZ = 0.4; // the horizon, as a fraction of the screen's height
const SUN_X = 0.62; // where the glow is strongest across the screen
// The violet night view is the look, so it holds still by default; ?dusk= picks
// another moment and ?cycle= brings back the slow cooling and return.
const CYCLE = Math.max(20, parseFloat(params.get("cycle")) || 1500);
const FIXED = params.has("dusk") ? Math.min(1, Math.max(0, parseFloat(params.get("dusk")) || 0)) : params.has("cycle") ? null : 0.15;

// The glow's colour at night, in the middle and when bright, and the shade in
// the valleys, per palette: palettes.js CLOUDS
const SET = CLOUDS[params.get("tint")] ?? CLOUDS.natural;
const AMBIENT = SET.amb;
const [C_NIGHT, C_MID, C_BRIGHT] = SET.glow;

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// smooth 2D value noise
function vn(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// the glow's state at time t: how bright (D: 1 bright, 0 night), its colour, its strength
let dT = -1, D = 1, GC = C_BRIGHT, K = 1;
function setDusk(t) {
  if (t === dT) return;
  dT = t;
  D = FIXED ?? 0.25 + 0.75 * (0.5 + 0.5 * Math.cos((t * TAU) / CYCLE)); // never fully dark: even the night end keeps a faint glow
  GC = D < 0.5 ? mix(C_NIGHT, C_MID, D / 0.5) : mix(C_MID, C_BRIGHT, (D - 0.5) / 0.5);
  K = 0.5 + 0.8 * D;
}

// ---- the sea ----
const ROWS = [];
for (let d = 0.006; d < 0.62; d *= 1.07) ROWS.push(d);
const WB = 2.6; // swell width: one unit of a row's profile spans d / WB across
// crest height of row j at u (a share of the row's distance below the horizon);
// du is how much of the profile one pixel spans, to fade the finer octave
function profile(j, u, du) {
  const k1 = 1 - smoothstep(0.15, 0.45, du * 2.1);
  const n = 0.65 * vn(u * 0.9, j * 4.7, 11) + 0.35 * (0.5 + (vn(u * 2.3 + 5.1, j * 3.1, 13) - 0.5) * k1);
  return 0.04 + 0.26 * Math.pow(smoothstep(0.2, 0.85, n), 1.1);
}

// ---- reactions ----
const PULSES = []; // { col, at, life }
const TRAVEL = 3; // seconds for a pulse's wave to cross the sea
const MAX_PULSES = 4;
let nowT = 20;
let flashAt = -1e9;
onReaction((r) => {
  if (reduced) return;
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    PULSES.push({ col: r.colour.map((v) => v / 255), at: nowT, life: Math.max(5, (r.afterglow || 4) + 3) });
    if (PULSES.length > MAX_PULSES) PULSES.shift();
  } else if (r.type === "flash") flashAt = nowT;
});
// the wave and the fading tint a pulse leaves on the crests (d: the row's distance, rim: 0..1 on its crest)
function pulseAt(t, d, rim, out) {
  for (const p of PULSES) {
    const age = t - p.at;
    if (age < 0 || age > p.life) continue;
    const fade = Math.pow(1 - age / p.life, 1.6);
    const front = Math.min(1, age / TRAVEL);
    const dF = ROWS[0] * Math.pow(ROWS[ROWS.length - 1] / ROWS[0], front);
    const w = Math.exp(-((Math.log(d / dF) / 0.3) ** 2)) * (age < TRAVEL + 0.8 ? 1 : 0.6);
    const v = (w * (0.3 + 1.5 * rim) + rim * 0.2 * smoothstep(0.1, 1, front)) * fade;
    out[0] += p.col[0] * v;
    out[1] += p.col[1] * v;
    out[2] += p.col[2] * v;
  }
}
// the horizon line takes a pulse's colour too
function skyPulse(t, y, out) {
  const line = Math.exp(-Math.abs(y - HZ) * 45);
  for (const p of PULSES) {
    const age = t - p.at;
    if (age < 0 || age > p.life) continue;
    const v = line * Math.pow(1 - age / p.life, 1.3) * 0.45 * smoothstep(0, 0.6, age);
    out[0] += p.col[0] * v;
    out[1] += p.col[1] * v;
    out[2] += p.col[2] * v;
  }
}

// the sea's light at (x, y), or false when the pixel is above every crest
function billow(x, y, A, t, out, pix) {
  const dxs = x - A / 2;
  const near = Math.exp(-Math.abs(x - A * SUN_X) / 0.55);
  const drift = t * 0.12;
  for (let j = ROWS.length - 1; j >= 0; j--) {
    const d = ROWS[j];
    const base = HZ + d;
    const u = (dxs / d) * WB + drift + j * 13.7;
    const du = (pix / d) * WB;
    const h = profile(j, u, du) * d;
    const top = base - h;
    if (y < top) continue;
    const s = (base - y) / h; // 1 at the crest, 0 at the foot
    const slope = (profile(j, u + 0.05, du) - profile(j, u - 0.05, du)) * 10;
    // the flank turned towards the glow catches more of it
    const side = Math.min(1, Math.max(0, 0.5 - slope * (x < A * SUN_X ? -1 : 1) * 0.9));
    const rim = Math.exp(-(y - top) / (0.006 + 0.05 * d));
    const face = Math.min(1, Math.max(0, s));
    const amb = 0.5 + 0.5 * D;
    const az = 0.25 + 0.9 * near;
    // light running over the crests
    const shimmer = smoothstep(0.55, 0.85, vn(u * 2.2 - t * 0.35, j * 1.7 + t * 0.25, 15)) * rim * (0.1 + 0.4 * near);
    const lit = Math.max(0, (0.1 * face + 0.3 * (side - 0.5) * face) * az + rim * (0.3 + 0.9 * near) + shimmer - 0.2 * smoothstep(0, -0.6, s));
    // the shade between the crests is cool, the lit parts take the glow's colour
    const cool = 1 - (1 - near) * (1 - rim) * 0.35;
    let r = AMBIENT[0] * amb * cool + GC[0] * K * lit;
    let g = AMBIENT[1] * amb * cool + GC[1] * K * lit;
    let b = AMBIENT[2] * amb * cool + GC[2] * K * lit;
    // far rows melt into the glow along the horizon
    const hz = Math.exp(-d / 0.05) * 0.85;
    const hg = Math.min(1, 0.3 + 0.7 * near);
    out[0] = r + (GC[0] * K * 0.65 * hg - r) * hz;
    out[1] = g + (GC[1] * K * 0.65 * hg - g) * hz;
    out[2] = b + (GC[2] * K * 0.4 * hg - b) * hz;
    pulseAt(t, d, rim, out);
    return true;
  }
  return false;
}

/** The light at screen point (x, y) (y down, 0..1; x across in screen heights);
 *  pix is how wide one cell is, in screen heights */
function seaLight(x, y, A, t, out, pix = 0.006) {
  setDusk(t);
  if (!(y > HZ && billow(x, y, A, t, out, pix))) {
    // sky: the glow along the horizon, fading up to deep blue-black. No sun.
    const toSun = Math.hypot((x - A * SUN_X) * 0.5, (y - HZ) * 2.0); // wide across, tight up
    const glow = Math.exp(-toSun * 2.6);
    const up = Math.max(0, HZ - y) / HZ; // 0 at the horizon, 1 at the top
    const top = [0.02 + 0.02 * D, 0.025 + 0.02 * D, 0.07 + 0.03 * (1 - D)];
    const base = mix(GC, top, Math.min(1, Math.pow(up, 0.5) * 1.1));
    const band = (0.18 + 1.2 * glow) * K;
    const line = Math.exp(-Math.abs(y - HZ) * 70) * glow * 1.5 * K; // the thin bright line where the glow meets the sea
    // streaks of high cloud catching the glow, stronger on the glow's side
    const wide = Math.exp(-Math.abs(x - A * SUN_X) * 0.9);
    const streak = smoothstep(0.55, 0.92, vn(x * 2.2 + t * 0.02, y * 34, 21)) * Math.exp(-up * 2.4) * wide * K * 0.9;
    out[0] = base[0] * band + GC[0] * (line + streak);
    out[1] = base[1] * band + GC[1] * (line + streak);
    out[2] = base[2] * band + GC[2] * (line + streak);
    // stars come out as the glow cools
    const gx = Math.floor(x * 280), gy = Math.floor(y * 280);
    if (up > 0.3 && hash(gx, gy, 9) < 0.0012 + 0.003 * (1 - D)) {
      const s = (0.1 + 0.2 * (1 - D)) * (0.6 + 0.4 * Math.sin(t * 2 + hash(gx, gy, 10) * 6.283));
      out[0] += s;
      out[1] += s;
      out[2] += s;
    }
  }
  if (y <= HZ + 0.02) skyPulse(t, y, out);
  const f = Math.max(0, 1 - (t - flashAt) / 0.7);
  if (f > 0) {
    const k = 0.35 * f * f;
    out[0] += GC[0] * k;
    out[1] += GC[1] * k;
    out[2] += GC[2] * k;
  }
}

// ---- smooth mock (?smooth): a plain image of the same light ----
function smooth() {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh" });
  document.body.append(canvas);
  document.body.style.background = "#000";
  const ctx = canvas.getContext("2d");
  const o = [0, 0, 0];
  let last = 0;
  const draw = (now) => {
    requestAnimationFrame(draw);
    if (now - last < 150) return;
    last = now;
    const w = Math.max(2, Math.floor(innerWidth / 5)), h = Math.max(2, Math.floor(innerHeight / 5));
    if (canvas.width !== w) {
      canvas.width = w;
      canvas.height = h;
    }
    const img = ctx.createImageData(w, h);
    const A = w / h, t = now / 1000 + 20;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        seaLight((i / w) * A, j / h, A, t, o, 1 / h);
        const p = (j * w + i) * 4;
        for (let k = 0; k < 3; k++) img.data[p + k] = 255 * (1 - Math.exp(-1.3 * o[k]));
        img.data[p + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  };
  requestAnimationFrame(draw);
}

// ---- characters ----
// Three shade glyphs, picked by plain tone bands (no dither: it turned to
// speckle), blank below MIN_TONE so dim light is clean black, and the colour
// carries the tone smoothly, each channel tone-mapped so hues stay varied.
// Plain ASCII symbols by default (more steps, since a symbol holds less tone
// than a block); ?glyphs=blocks draws the shade blocks ░▒▓ instead.
const GLYPHS = {
  blocks: { chars: " ░▒▓", edges: [0.14, 0.28, 0.5] },
  ascii: { chars: " .:-=+*#%@", edges: [0.14, 0.19, 0.25, 0.32, 0.4, 0.5, 0.62, 0.75, 0.88] },
};
const GLYPH = GLYPHS[params.get("glyphs")] ?? GLYPHS.ascii;
const SHADES = GLYPH.chars;
const EDGES = GLYPH.edges;
const MIN_TONE = EDGES[0];
const GAIN = 1; // dim on purpose
const EXPOSURE = 2.2 * 1.1;
let dims = null;
const out = [0, 0, 0];
const chan = (v) => Math.round((1 - Math.exp(-4.5 * v * v - 0.6 * v)) * 15) * 17;
function sample(X, Y, t, cell) {
  const cw = dims.cw / dims.H, ch = dims.ch / dims.H;
  seaLight((cell[0] + 0.5) * cw, (cell[1] + 0.5) * ch, dims.A, t, out, cw);
  out[0] *= GAIN;
  out[1] *= GAIN;
  out[2] *= GAIN;
  const T = 1 - Math.exp(-EXPOSURE * (0.3 * out[0] + 0.59 * out[1] + 0.11 * out[2]));
  let step = 0;
  for (const e of EDGES) if (T >= e) step++;
  return [out, SHADES[step], `rgb(${chan(out[0])},${chan(out[1])},${chan(out[2])})`];
}

// ---- the GPU renderer: the same maths in GLSL ----
const f1 = (v) => v.toFixed(5);
const GLSL = `
uniform float uT, uA, uD, uK, uFlash;
uniform vec3 uGC, uStart;
uniform vec4 uPulse[${MAX_PULSES}]; // rgb, age in seconds (< 0: none)
uniform float uLife[${MAX_PULSES}];
const float HZ = ${f1(HZ)};
const float SUN_X = ${f1(SUN_X)};
const float WB = ${f1(WB)};
const float R0 = ${f1(ROWS[0])};
const float RN = ${f1(ROWS[ROWS.length - 1])};
const int NROWS = ${ROWS.length};
const float TRAVEL = ${f1(TRAVEL)};
const vec3 AMBIENT = vec3(${AMBIENT.map(f1).join(", ")});
float hash3(int x, int y, int z) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
float vn(float x, float z, int s) {
  int i = int(floor(x)), j = int(floor(z));
  float fx = x - floor(x), fz = z - floor(z);
  float u = fx * fx * (3.0 - 2.0 * fx), v = fz * fz * (3.0 - 2.0 * fz);
  float a = hash3(i, j, s), b = hash3(i + 1, j, s), c = hash3(i, j + 1, s), d = hash3(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
float profile(int j, float u, float du) {
  float k1 = 1.0 - smoothstep(0.15, 0.45, du * 2.1);
  float n = 0.65 * vn(u * 0.9, float(j) * 4.7, 11) + 0.35 * (0.5 + (vn(u * 2.3 + 5.1, float(j) * 3.1, 13) - 0.5) * k1);
  return 0.04 + 0.26 * pow(smoothstep(0.2, 0.85, n), 1.1);
}
void pulseAt(float d, float rim, inout vec3 o) {
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    float age = uPulse[i].a;
    if (uLife[i] <= 0.0 || age < 0.0 || age > uLife[i]) continue;
    float fade = pow(1.0 - age / uLife[i], 1.6);
    float front = min(1.0, age / TRAVEL);
    float dF = R0 * pow(RN / R0, front);
    float lg = log(d / dF) / 0.3;
    float w = exp(-lg * lg) * (age < TRAVEL + 0.8 ? 1.0 : 0.6);
    float v = (w * (0.3 + 1.5 * rim) + rim * 0.2 * smoothstep(0.1, 1.0, front)) * fade;
    o += uPulse[i].rgb * v;
  }
}
bool billow(float x, float y, float pix, out vec3 o) {
  float dxs = x - uA / 2.0;
  float near = exp(-abs(x - uA * SUN_X) / 0.55);
  float drift = uT * 0.12;
  for (int j = NROWS - 1; j >= 0; j--) {
    float d = R0 * pow(RN / R0, float(j) / float(NROWS - 1));
    float base = HZ + d;
    float u = dxs / d * WB + drift + float(j) * 13.7;
    float du = pix / d * WB;
    float h = profile(j, u, du) * d;
    float top = base - h;
    if (y < top) continue;
    float s = (base - y) / h;
    float slope = (profile(j, u + 0.05, du) - profile(j, u - 0.05, du)) * 10.0;
    float side = clamp(0.5 - slope * (x < uA * SUN_X ? -1.0 : 1.0) * 0.9, 0.0, 1.0);
    float rim = exp(-(y - top) / (0.006 + 0.05 * d));
    float face = clamp(s, 0.0, 1.0);
    float amb = 0.5 + 0.5 * uD;
    float az = 0.25 + 0.9 * near;
    float shimmer = smoothstep(0.55, 0.85, vn(u * 2.2 - uT * 0.35, float(j) * 1.7 + uT * 0.25, 15)) * rim * (0.1 + 0.4 * near);
    float lit = max(0.0, (0.1 * face + 0.3 * (side - 0.5) * face) * az + rim * (0.3 + 0.9 * near) + shimmer - 0.2 * smoothstep(0.0, -0.6, s));
    float cool = 1.0 - (1.0 - near) * (1.0 - rim) * 0.35;
    vec3 c = AMBIENT * amb * cool + uGC * uK * lit;
    float hz = exp(-d / 0.05) * 0.85;
    float hg = min(1.0, 0.3 + 0.7 * near);
    vec3 haze = uGC * uK * vec3(0.65, 0.65, 0.4) * hg;
    o = c + (haze - c) * hz;
    pulseAt(d, rim, o);
    return true;
  }
  return false;
}
vec3 seaLight(float x, float y, float pix) {
  vec3 col;
  if (!(y > HZ && billow(x, y, pix, col))) {
    float toSun = length(vec2((x - uA * SUN_X) * 0.5, (y - HZ) * 2.0));
    float glow = exp(-toSun * 2.6);
    float up = max(0.0, HZ - y) / HZ;
    vec3 top = vec3(0.02 + 0.02 * uD, 0.025 + 0.02 * uD, 0.07 + 0.03 * (1.0 - uD));
    vec3 base = mix(uGC, top, min(1.0, pow(up, 0.5) * 1.1));
    float band = (0.18 + 1.2 * glow) * uK;
    float line = exp(-abs(y - HZ) * 70.0) * glow * 1.5 * uK;
    float wide = exp(-abs(x - uA * SUN_X) * 0.9);
    float streak = smoothstep(0.55, 0.92, vn(x * 2.2 + uT * 0.02, y * 34.0, 21)) * exp(-up * 2.4) * wide * uK * 0.9;
    col = base * band + uGC * (line + streak);
    int gx = int(floor(x * 280.0)), gy = int(floor(y * 280.0));
    if (up > 0.3 && hash3(gx, gy, 9) < 0.0012 + 0.003 * (1.0 - uD)) {
      float s = (0.1 + 0.2 * (1.0 - uD)) * (0.6 + 0.4 * sin(uT * 2.0 + hash3(gx, gy, 10) * 6.283));
      col += vec3(s);
    }
  }
  if (y <= HZ + 0.02) {
    float line = exp(-abs(y - HZ) * 45.0);
    for (int i = 0; i < ${MAX_PULSES}; i++) {
      float age = uPulse[i].a;
      if (uLife[i] <= 0.0 || age < 0.0 || age > uLife[i]) continue;
      col += uPulse[i].rgb * (line * pow(1.0 - age / uLife[i], 1.3) * 0.45 * smoothstep(0.0, 0.6, age));
    }
  }
  col += uGC * (0.35 * uFlash * uFlash);
  return col;
}
vec4 sampleCell4(vec2 P) {
  vec2 cs = uCell / uH;
  ivec2 cell = ivec2(floor(P / cs));
  vec2 C = (vec2(cell) + 0.5) * cs;
  vec3 col = seaLight(C.x, C.y, cs.x) * ${f1(GAIN)};
  float T = 1.0 - exp(-${f1(EXPOSURE)} * dot(col, vec3(0.3, 0.59, 0.11)));
  const float EDGES[${EDGES.length}] = float[${EDGES.length}](${EDGES.map(f1).join(", ")});
  float shade = 0.0;
  for (int i = 0; i < ${EDGES.length}; i++) if (T >= EDGES[i]) shade += 1.0;
  if (shade < 0.5) return vec4(0.0);
  vec3 q = floor((1.0 - exp(-4.5 * col * col - 0.6 * col)) * 15.0 + 0.5) * 17.0;
  return vec4(q / 255.0, shade);
}`;
const gpu = {
  glsl: GLSL,
  ramp: SHADES.slice(1),
  bind(gl, u) {
    if (!dims) return;
    setDusk(nowT);
    gl.uniform1f(u.uT, nowT);
    gl.uniform1f(u.uA, dims.A);
    gl.uniform1f(u.uD, D);
    gl.uniform1f(u.uK, K);
    gl.uniform1f(u.uFlash, Math.max(0, 1 - (nowT - flashAt) / 0.7));
    gl.uniform3f(u.uGC, GC[0], GC[1], GC[2]);
    gl.uniform3f(u.uStart, BG[0] / 255, BG[1] / 255, BG[2] / 255);
    const pulses = new Float32Array(MAX_PULSES * 4).fill(0);
    const life = new Float32Array(MAX_PULSES).fill(1);
    for (let i = 0; i < MAX_PULSES; i++) {
      const p = PULSES[i];
      pulses[i * 4 + 3] = -1;
      if (!p) continue;
      pulses.set([p.col[0], p.col[1], p.col[2], nowT - p.at], i * 4);
      life[i] = p.life;
    }
    gl.uniform4fv(u["uPulse[0]"] ?? u.uPulse, pulses);
    gl.uniform1fv(u["uLife[0]"] ?? u.uLife, life);
  },
};

if (params.has("smooth")) smooth();
else {
  setPalette();
  startScene({
    label: "A sea of cloud seen from above after sunset: a band of glow along the horizon and rolling swells of cloud, their crests lit from behind, drawn in glowing coloured characters.",
    fps: 20,
    fontPx: (H) => Math.max(6, Math.min(10, H / 110)),
    layout: (d) => (dims = d),
    frame: (t) => {
      nowT = reduced ? 20 : t;
    },
    sample: (X, Y, t, cell) => sample(X, Y, reduced ? 20 : t, cell),
    gpu,
  });
}
