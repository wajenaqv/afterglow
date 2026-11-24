// The "light" clock: the time drawn the way the jellies are drawn, as light.
// The digits and the date are rendered once (per minute, per screen size)
// into a light mask at character-cell resolution: a sharp core, a glow and a
// wide halo. Each frame the night-scene renderer (GPU or CPU, same maths)
// turns that light into characters by brightness. Like a jelly's bell, each
// digit has a faint glassy fill, a glowing rim and a soft glow around it,
// and its own hue from the jellies' palette (palettes.js: the stroke in the
// bell colour, the glow in the glow colour; each digit value keeps its hue);
// the date is in the water's pale snow colour.
//
// Life: the digits breathe slowly (a wave across them, like a bell's pulse);
// when the minute turns, the old digits dissolve cell by cell into specks
// while the new ones condense, with a brief sparkle where they meet; a new
// message sends a band of the app's colour through the digits; a flash
// brightens everything for a moment.

import { startScene, setPalette, BG } from "./nightscene.js";
import { hash } from "./common.js";
import { timeText, dateText } from "./hoverclock.js";
import { TINTS } from "./palettes.js";

const MAX_CHARS = 6; // "12:59" is 5; the GPU arrays are this long
const n01 = (c) => c.map((v) => v / 255);

const FONT = '"JetBrains Mono", ui-monospace, Consolas, monospace'; // the date
// the digits: the system's display face (plain zero; JetBrains Mono's dotted
// zero looked like an eye this big)
const DIGITS = '"Segoe UI Variable Display", "Segoe UI", "SF Pro Display", system-ui, sans-serif';
const TURN = 1.6; // seconds the minute change takes
const SS = 4; // supersampling of the mask

// separable box blur: rx cells across, ry rows down
function boxBlur(src, cols, rows, rx, ry) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    const o = r * cols;
    for (let c = -rx; c < cols; c++) {
      if (c + rx < cols) acc += src[o + c + rx];
      if (c - rx - 1 >= 0) acc -= src[o + c - rx - 1];
      if (c >= 0) tmp[o + c] = acc / (2 * rx + 1);
    }
  }
  for (let c = 0; c < cols; c++) {
    let acc = 0;
    for (let r = -ry; r < rows; r++) {
      if (r + ry < rows) acc += tmp[(r + ry) * cols + c];
      if (r - ry - 1 >= 0) acc -= tmp[(r - ry - 1) * cols + c];
      if (r >= 0) out[r * cols + c] = acc / (2 * ry + 1);
    }
  }
  return out;
}

/**
 * tint: a jelly palette name (natural, cool, grey, warm), or
 * own: [top, bottom] colours 0..1 (the logo's fade, or a picked colour)
 */
export function startLightClock({ tint = "natural", own = null, hours = "auto", size = 1, fps = 30 }) {
  const PAL =
    own
      ? { hues: [{ bell: own[1].map((v) => v * 255), glow: own[1].map((v) => v * 255) }], snow: own[0].map((v) => v * 200) }
      : (TINTS[tint] ?? TINTS.natural);
  const SNOW = n01(PAL.snow);
  let dims = null;
  let shown = "";
  let cur = null, old = null; // masks: Float32Array(cols * rows * 3): fill, rim, glow
  let turnAt = -1e9, now = 0, dirty = true;
  let pulse = [0, 0, 0], pulseAt = -1e9, pulseFade = 4, flashAt = -1e9;
  const box = { top: 0, bottom: 0 }; // the digits' rows in screen heights (colour gradient)
  let onLayout = null;
  // what sample() and the shader read each frame
  const S = { p: 1, breathT: 0, flash: 0, pulseX: -9, pulse: [0, 0, 0], xb: [], n: 1, dateTop: 9, bell: [SNOW], glowC: [SNOW] };

  // ---- the light mask ----
  const big = document.createElement("canvas");
  const small = document.createElement("canvas");
  function mask(time, date) {
    const { cols, rows, cw, ch, W, H } = dims;
    if (!cols || !rows || !W || !H) return new Float32Array(Math.max(1, cols * rows * 3)); // no screen yet
    big.width = cols * SS;
    big.height = rows * SS;
    const g = big.getContext("2d");
    g.setTransform((SS / cw) * 1, 0, 0, SS / ch, 0, 0); // draw in CSS px
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    // digits: about 56% of the width, at most 34% of the height
    g.font = `400 100px ${DIGITS}`;
    const m = g.measureText(time);
    const capH = 100 * 0.73;
    const px = Math.min((W * 0.56 * size) / m.width, (H * 0.34 * size) / capH) * 100;
    const baseline = H * 0.44 + (px * 0.73) / 2;
    small.width = cols;
    small.height = rows;
    const s = small.getContext("2d", { willReadFrequently: true });
    s.imageSmoothingQuality = "high";
    // one value per cell: how much of it the shape covers
    const coverage = () => {
      s.clearRect(0, 0, cols, rows);
      s.drawImage(big, 0, 0, cols, rows);
      const d4 = s.getImageData(0, 0, cols, rows).data;
      const a = new Float32Array(cols * rows);
      for (let i = 0; i < a.length; i++) a[i] = d4[i * 4 + 3] / 255;
      g.clearRect(0, 0, W, H);
      return a;
    };
    g.font = `400 ${px}px ${DIGITS}`;
    g.fillText(time, W / 2, baseline);
    const digits = coverage();
    // the date: small, spaced, under the digits (bold and ~4 rows tall so it reads)
    const dpx = Math.max(ch * 4.2, px * 0.11);
    g.font = `700 ${dpx}px ${FONT}`;
    if ("letterSpacing" in g) g.letterSpacing = `${dpx * 0.16}px`;
    const dateY = baseline + px * 0.22 + dpx;
    g.fillText(date, W / 2, dateY);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    const dateCov = coverage();
    box.top = (baseline - px * 0.73) / H;
    box.bottom = dateY / H;
    // each character's column and colour: a digit keeps its value's hue,
    // the colon is snow
    // (measured: the digit face isn't monospaced)
    g.font = `400 ${px}px ${DIGITS}`;
    const left = W / 2 - g.measureText(time).width / 2;
    S.n = Math.min(MAX_CHARS, time.length);
    S.xb = [];
    for (let i = 1; i < S.n; i++) S.xb.push((left + g.measureText(time.slice(0, i)).width) / H);
    S.dateTop = (baseline + px * 0.06) / H;
    S.bell = [];
    S.glowC = [];
    for (const c of time.slice(0, MAX_CHARS)) {
      const hue = c === ":" ? null : PAL.hues[Number(c) % PAL.hues.length];
      S.bell.push(hue ? n01(hue.bell) : SNOW);
      S.glowC.push(hue ? n01(hue.glow) : SNOW);
    }
    // Like a jelly's bell: a faint glassy fill, a glowing rim where the
    // stroke meets the dark, and a soft glow around it. The rim is the part
    // of a stroke whose blurred neighbourhood isn't all stroke. Blurs are box
    // blurs run twice (about a gaussian), further across than down (cells
    // are narrower than tall), in plain JS (WebKit has no canvas blur filter).
    const near = boxBlur(digits, cols, rows, 1, 1);
    const both = new Float32Array(cols * rows);
    for (let i = 0; i < both.length; i++) both[i] = Math.min(1, digits[i] + dateCov[i] * 0.7);
    const glow = boxBlur(boxBlur(both, cols, rows, 2, 1), cols, rows, 2, 1);
    const halo = boxBlur(boxBlur(both, cols, rows, 7, 4), cols, rows, 7, 4);
    const out = new Float32Array(cols * rows * 3);
    for (let i = 0; i < cols * rows; i++) {
      out[i * 3] = digits[i] * 0.26 + dateCov[i] * 0.62; // fill
      out[i * 3 + 1] = Math.min(1, digits[i] * (1 - near[i]) * 2.6); // rim
      out[i * 3 + 2] = Math.min(1, glow[i] * 0.75 + halo[i] * 0.7); // glow
    }
    onLayout?.({ bottom: (dateY + dpx * 0.9) });
    return out;
  }

  function layout(d) {
    dims = d;
    const t = new Date();
    shown = timeText(t, hours);
    cur = mask(shown, dateText(t, hours));
    old = cur;
    turnAt = -1e9;
    dirty = true;
  }

  // ---- per frame ----
  function frame(t) {
    now = t;
    if (!dims) return;
    const d = new Date();
    const text = timeText(d, hours);
    if (dims && text !== shown) {
      old = cur;
      cur = mask(text, dateText(d, hours));
      shown = text;
      turnAt = t;
      dirty = true;
    }
    S.p = Math.min(1, (t - turnAt) / TURN);
    S.breathT = t;
    S.flash = Math.max(0, 1 - (t - flashAt) / 0.5) * 0.7;
    const age = t - pulseAt;
    const k = Math.max(0, 1 - age / pulseFade);
    S.pulse = pulse.map((v) => v * k);
    S.pulseX = dims ? -0.2 + (age / 2.2) * (dims.A + 0.4) : -9; // sweeps across in 2.2 s, then again fainter
    if (age > 2.2) S.pulseX = -0.2 + (((age - 2.2) % 3.2) / 3.2) * (dims.A + 0.4);
  }

  // the same maths as LIGHT_GLSL below
  const col = [0, 0, 0];
  function sample(X, Y, t, cell) {
    const { cols } = dims;
    const i = (cell[1] * cols + cell[0]) * 3;
    const h = hash(cell[0], cell[1], 11);
    const w = Math.max(0, Math.min(1, (S.p - h * 0.7) / 0.3));
    const c0 = old[i] + (cur[i] - old[i]) * w;
    const g0 = old[i + 1] + (cur[i + 1] - old[i + 1]) * w;
    const h0 = old[i + 2] + (cur[i + 2] - old[i + 2]) * w;
    const spark = 4 * w * (1 - w) * 0.5 * (cur[i + 1] + old[i + 1]);
    const tw = 0.86 + 0.14 * Math.sin(S.breathT * 0.9 + hash(cell[0], cell[1], 23) * 6.283);
    const breath = 0.86 + 0.14 * Math.sin(S.breathT * 1.05 - X * 2.4);
    const lift = 1 + S.flash;
    const stroke = ((c0 + g0) * tw * breath + spark * 0.9) * lift;
    const glow = h0 * 0.45 * tw * breath * lift;
    // whose colour: the character this column belongs to, or the date's snow
    let k0 = 0;
    while (k0 < S.xb.length && X > S.xb[k0]) k0++;
    const date = Y > S.dateTop;
    const bc = date ? SNOW : S.bell[k0], gc = date ? SNOW : S.glowC[k0];
    // a little whiter towards the top of the digits, like light from above
    const gy = Math.max(0, Math.min(1, (Y - box.top) / Math.max(0.01, S.dateTop - box.top)));
    const white = date ? 0 : 0.28 * (1 - gy);
    const band = Math.exp(-(((X - S.pulseX) / 0.07) ** 2)) * (c0 + g0 * 0.7);
    for (let k = 0; k < 3; k++) col[k] = BG[k] / 255 + (bc[k] + (1 - bc[k]) * white) * stroke + gc[k] * glow + S.pulse[k] * band * 1.6;
    return [col, null];
  }

  // ---- GPU ----
  const GLSL = `
uniform sampler2D uNew, uOld;
uniform float uP, uT, uFlash, uPulseX, uTop0, uDateTop;
uniform float uXB[${MAX_CHARS}];
uniform int uN;
uniform vec3 uBell[${MAX_CHARS}], uGlowC[${MAX_CHARS}];
uniform vec3 uSnow, uPulse, uStart;
float hash3(int x, int y, int z) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
vec3 sampleCell(vec2 P) {
  ivec2 c = ivec2(floor(P * uH / uCell));
  vec3 n = texelFetch(uNew, c, 0).rgb;
  vec3 o = texelFetch(uOld, c, 0).rgb;
  float w = clamp((uP - hash3(c.x, c.y, 11) * 0.7) / 0.3, 0.0, 1.0);
  vec3 m = mix(o, n, w);
  float spark = 4.0 * w * (1.0 - w) * 0.5 * (n.g + o.g);
  float tw = 0.86 + 0.14 * sin(uT * 0.9 + hash3(c.x, c.y, 23) * 6.283);
  float breath = 0.86 + 0.14 * sin(uT * 1.05 - P.x * 2.4);
  float lift = 1.0 + uFlash;
  float stroke = ((m.r + m.g) * tw * breath + spark * 0.9) * lift;
  float glow = m.b * 0.45 * tw * breath * lift;
  int k0 = 0;
  for (int i = 0; i < ${MAX_CHARS - 1}; i++) if (i < uN - 1 && P.x > uXB[i]) k0 = i + 1;
  bool date = P.y > uDateTop;
  vec3 bc = date ? uSnow : uBell[k0];
  vec3 gc = date ? uSnow : uGlowC[k0];
  float gy = clamp((P.y - uTop0) / max(0.01, uDateTop - uTop0), 0.0, 1.0);
  float white = date ? 0.0 : 0.28 * (1.0 - gy);
  float q = (P.x - uPulseX) / 0.07;
  float band = exp(-q * q) * (m.r + m.g * 0.7);
  return uStart + (bc + (1.0 - bc) * white) * stroke + gc * glow + uPulse * band * 1.6;
}`;
  let texNew = null, texOld = null;
  const upload = (gl, tex, data, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (dirty) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, dims.cols, dims.rows, 0, gl.RGB, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
  };
  const gpu = {
    glsl: GLSL,
    bind(gl, u, unit) {
      if (!dims) return;
      texNew ??= gl.createTexture();
      texOld ??= gl.createTexture();
      upload(gl, texNew, cur, unit);
      upload(gl, texOld, old, unit + 1);
      dirty = false;
      gl.uniform1i(u.uNew, unit);
      gl.uniform1i(u.uOld, unit + 1);
      gl.uniform1f(u.uP, S.p);
      gl.uniform1f(u.uT, S.breathT);
      gl.uniform1f(u.uFlash, S.flash);
      gl.uniform1f(u.uPulseX, S.pulseX);
      gl.uniform1f(u.uTop0, box.top);
      const xb = new Float32Array(MAX_CHARS).fill(1e9);
      xb.set(S.xb);
      gl.uniform1fv(u["uXB[0]"], xb);
      gl.uniform1f(u.uDateTop, S.dateTop);
      gl.uniform1i(u.uN, S.n);
      const flat = (list) => {
        const a = new Float32Array(MAX_CHARS * 3);
        list.forEach((c, i) => a.set(c, i * 3));
        return a;
      };
      gl.uniform3fv(u["uBell[0]"], flat(S.bell));
      gl.uniform3fv(u["uGlowC[0]"], flat(S.glowC));
      gl.uniform3f(u.uSnow, ...SNOW);
      gl.uniform3f(u.uPulse, ...S.pulse);
      gl.uniform3f(u.uStart, BG[0] / 255, BG[1] / 255, BG[2] / 255);
    },
  };

  setPalette();
  startScene({
    label: "The time and date drawn in glowing coloured text characters, breathing slowly.",
    fps,
    fontPx: (H) => Math.max(5, Math.min(11, H / 110)),
    layout,
    frame,
    sample,
    gpu,
  });

  return {
    onLayout(fn) {
      onLayout = fn;
    },
    react(r) {
      if (r.type === "pulse" && Array.isArray(r.colour)) {
        pulse = r.colour.map((v) => v / 255);
        pulseFade = Math.max(2.5, (r.afterglow || 4) * 1.5);
        pulseAt = now;
      } else if (r.type === "flash") flashAt = now;
    },
  };
}
