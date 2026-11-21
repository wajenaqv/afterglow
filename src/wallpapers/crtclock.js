// The animated clock styles of the clock wallpaper, after real CRT displays
// (docs/ideas/crt-afterglow-effects.html), drawn as glowing characters with
// the night-scene renderer (nightscene.js startScene: a GPU and a CPU
// renderer from the same maths, sampleCell in GLSL and sample() in JS):
//
//   radar  the sweep is the second hand. Rings, and blips for the hours (the
//          12 marks), the hour (near the middle) and the minute (further
//          out). A blip flashes blue-white when the sweep passes over it and
//          cools to amber, like the P7 phosphor of radar screens. A new
//          message is a new contact: a blip in the app's colour.
//   scope  an oscilloscope clock: a beam draws the face, the 12 marks and the
//          three hands, over and over; the trace fades behind it (phosphor
//          persistence), the beam's head is near white. A new message
//          tints the trace in the app's colour for its afterglow.
//
// Units: screen heights, y down (like every night scene). Angles: atan2 with
// y down, so they run clockwise; 12 o'clock is -PI/2.

import { startScene, setPalette, BG } from "./nightscene.js";

const TAU = Math.PI * 2;
const W0 = 0.0055; // line half-width
const HOT = [0.75, 0.86, 1.0]; // a blip just hit: blue-white
const AMBER = [1.0, 0.6, 0.16]; // its afterglow
const WHITE = [1, 1, 1];
const mod = (a, b) => ((a % b) + b) % b;

// Shared state, set each frame by frame(), read by sample() and bind()
const S = {
  mode: 0, // 0 radar, 1 scope
  cx: 0.5, cy: 0.45, R: 0.3,
  tint: [0.2, 1, 0.55],
  sweep: 0, hourA: 0, minA: 0, secA: 0,
  beam: 0, L: 1,
  pulse: [0, 0, 0], // the app's colour, already scaled by how strong it is now
  contact: [-9, -9], // radar: where the new contact sits
  flash: 0,
};

/** Length of the scope's path: the circle, 12 marks, 3 hands */
const pathLength = (R) => TAU * R + 12 * 0.11 * R + (0.5 + 0.8 + 0.92) * R;
const SCOPE_PERIOD = 1.6; // seconds for the beam to draw everything once

function segment(x, y, ax, ay, bx, by) {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return [Math.hypot(px - dx * h, py - dy * h), h];
}
const line = (d) => Math.exp(-((d / W0) ** 2)) + 0.22 * Math.exp(-d / 0.018);

function radar(X, Y) {
  const { cx, cy, R, tint, sweep } = S;
  const dx = X - cx, dy = Y - cy, r = Math.hypot(dx, dy);
  const col = [0, 0, 0];
  const add = (c, f) => {
    col[0] += c[0] * f;
    col[1] += c[1] * f;
    col[2] += c[2] * f;
  };
  if (r > R * 1.3) return col;
  // rings
  let ring = 0;
  for (const k of [1 / 3, 2 / 3, 1]) ring += Math.exp(-(((r - R * k) / W0) ** 2));
  add(tint, ring * 0.22);
  // the sweep and the glow it leaves behind it
  if (r < R) {
    const behind = mod(sweep - Math.atan2(dy, dx), TAU);
    const near = Math.min(behind, TAU - behind) * r;
    add(tint, Math.exp(-behind / 0.6) * 0.28 + Math.exp(-((near / W0) ** 2)) * 0.85);
  }
  // blips: 12 hour marks, the hour, the minute, and a new contact
  const blip = (a, br, size, strength) => {
    const bx = cx + Math.cos(a) * br, by = cy + Math.sin(a) * br;
    const d = Math.hypot(X - bx, Y - by);
    if (d > size * 7) return;
    const shape = d < size ? 1 : Math.exp(-(d - size) / (size * 0.7));
    const age = (mod(sweep - a, TAU) / TAU) * 60; // seconds since the sweep passed
    const hot = Math.max(0, 1 - age / 0.8);
    const warm = 0.3 + 0.7 * Math.exp(-age / 14); // never fades out: the time stays readable
    add(HOT, shape * hot * 1.6 * strength);
    add(AMBER, shape * warm * 1.1 * strength);
  };
  for (let k = 0; k < 12; k++) blip((k / 12) * TAU - Math.PI / 2, R * 0.92, R * 0.018, 0.6);
  blip(S.hourA, R * 0.5, R * 0.065, 1.2);
  blip(S.minA, R * 0.78, R * 0.048, 1.2);
  // a new message: a contact in the app's colour
  const cd = Math.hypot(X - S.contact[0], Y - S.contact[1]);
  const cs = R * 0.04;
  if (cd < cs * 7) add(S.pulse, (cd < cs ? 1 : Math.exp(-(cd - cs) / (cs * 0.7))) * 1.8);
  add(tint, Math.exp(-r / (R * 0.03)) * 0.6); // the centre
  return col;
}

function scope(X, Y) {
  const { cx, cy, R, tint, beam, L } = S;
  const speed = L / SCOPE_PERIOD;
  const col = [0, 0, 0];
  let glow = 0, head = 0;
  const at = (d, s) => {
    if (d > 0.06) return;
    const age = mod(beam - s, L) / speed;
    const f = line(d);
    glow += f * (0.14 + Math.exp(-age / 0.5) * 0.95);
    head += f * Math.exp(-age / 0.04) * 1.2;
  };
  const dx = X - cx, dy = Y - cy, r = Math.hypot(dx, dy);
  // the face: the circle, from 12 o'clock clockwise
  at(Math.abs(r - R), mod(Math.atan2(dy, dx) + Math.PI / 2, TAU) * R);
  let s0 = TAU * R;
  // the 12 marks, outward
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const [d, h] = segment(X, Y, cx + c * R * 0.86, cy + s * R * 0.86, cx + c * R * 0.97, cy + s * R * 0.97);
    at(d, s0 + h * 0.11 * R);
    s0 += 0.11 * R;
  }
  // the hands, from the middle out
  for (const [a, len] of [[S.hourA, 0.5], [S.minA, 0.8], [S.secA, 0.92]]) {
    const [d, h] = segment(X, Y, cx, cy, cx + Math.cos(a) * R * len, cy + Math.sin(a) * R * len);
    at(d, s0 + h * len * R);
    s0 += len * R;
  }
  const c = [tint[0] + S.pulse[0], tint[1] + S.pulse[1], tint[2] + S.pulse[2]];
  for (let i = 0; i < 3; i++) col[i] = c[i] * glow + WHITE[i] * head;
  return col;
}

const GLSL = `
uniform int uMode;
uniform vec2 uC;
uniform float uR, uSweep, uHourA, uMinA, uSecA, uBeam, uL, uFlash;
uniform vec3 uTint, uPulse, uStart;
uniform vec2 uContact;
const float TAU = 6.283185307;
const float W0 = ${W0};
const vec3 HOT = vec3(0.75, 0.86, 1.0);
const vec3 AMBER = vec3(1.0, 0.6, 0.16);
float modp(float a, float b) { return a - b * floor(a / b); }
vec2 seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}
float lineF(float d) { return exp(-(d / W0) * (d / W0)) + 0.22 * exp(-d / 0.018); }
vec3 blip(vec2 P, float a, float br, float size, float strength) {
  vec2 b = uC + vec2(cos(a), sin(a)) * br;
  float d = length(P - b);
  if (d > size * 7.0) return vec3(0.0);
  float shape = d < size ? 1.0 : exp(-(d - size) / (size * 0.7));
  float age = modp(uSweep - a, TAU) / TAU * 60.0;
  float hot = max(0.0, 1.0 - age / 0.8);
  float warm = 0.3 + 0.7 * exp(-age / 14.0);
  return HOT * (shape * hot * 1.6 * strength) + AMBER * (shape * warm * 1.1 * strength);
}
vec3 radarL(vec2 P) {
  vec2 dv = P - uC;
  float r = length(dv);
  vec3 col = vec3(0.0);
  if (r > uR * 1.3) return col;
  float ring = 0.0;
  for (int k = 1; k <= 3; k++) { float q = (r - uR * float(k) / 3.0) / W0; ring += exp(-q * q); }
  col += uTint * (ring * 0.22);
  if (r < uR) {
    float behind = modp(uSweep - atan(dv.y, dv.x), TAU);
    float nearD = min(behind, TAU - behind) * r;
    col += uTint * (exp(-behind / 0.6) * 0.28 + exp(-(nearD / W0) * (nearD / W0)) * 0.85);
  }
  for (int k = 0; k < 12; k++) col += blip(P, float(k) / 12.0 * TAU - 1.5707963, uR * 0.92, uR * 0.018, 0.6);
  col += blip(P, uHourA, uR * 0.5, uR * 0.065, 1.2);
  col += blip(P, uMinA, uR * 0.78, uR * 0.048, 1.2);
  float cd = length(P - uContact), cs = uR * 0.04;
  if (cd < cs * 7.0) col += uPulse * ((cd < cs ? 1.0 : exp(-(cd - cs) / (cs * 0.7))) * 1.8);
  col += uTint * (exp(-r / (uR * 0.03)) * 0.6);
  return col;
}
vec3 scopeL(vec2 P) {
  float speed = uL / ${SCOPE_PERIOD.toFixed(2)};
  float glow = 0.0, head = 0.0;
  vec2 dv = P - uC;
  float r = length(dv);
  float d, s, age, f;
  d = abs(r - uR);
  if (d <= 0.06) {
    s = modp(atan(dv.y, dv.x) + 1.5707963, TAU) * uR;
    age = modp(uBeam - s, uL) / speed; f = lineF(d);
    glow += f * (0.14 + exp(-age / 0.5) * 0.95); head += f * exp(-age / 0.04) * 1.2;
  }
  float s0 = TAU * uR;
  for (int k = 0; k < 12; k++) {
    float a = float(k) / 12.0 * TAU - 1.5707963;
    vec2 u = vec2(cos(a), sin(a));
    vec2 q = seg(P, uC + u * uR * 0.86, uC + u * uR * 0.97);
    if (q.x <= 0.06) {
      age = modp(uBeam - (s0 + q.y * 0.11 * uR), uL) / speed; f = lineF(q.x);
      glow += f * (0.14 + exp(-age / 0.5) * 0.95); head += f * exp(-age / 0.04) * 1.2;
    }
    s0 += 0.11 * uR;
  }
  vec2 hands[3] = vec2[3](vec2(uHourA, 0.5), vec2(uMinA, 0.8), vec2(uSecA, 0.92));
  for (int k = 0; k < 3; k++) {
    float a = hands[k].x, len = hands[k].y;
    vec2 q = seg(P, uC, uC + vec2(cos(a), sin(a)) * uR * len);
    if (q.x <= 0.06) {
      age = modp(uBeam - (s0 + q.y * len * uR), uL) / speed; f = lineF(q.x);
      glow += f * (0.14 + exp(-age / 0.5) * 0.95); head += f * exp(-age / 0.04) * 1.2;
    }
    s0 += len * uR;
  }
  return (uTint + uPulse) * glow + vec3(1.0) * head;
}
vec3 sampleCell(vec2 P) {
  vec3 col = uMode == 0 ? radarL(P) : scopeL(P);
  return uStart + col * (1.0 + uFlash);
}`;

/**
 * Start a CRT clock. style: "radar" | "scope"; tint: [r, g, b] 0..1;
 * size: 0.5-1.6. Returns { react(reaction), layoutBox() } where layoutBox
 * is the face's place in CSS px (for the date under it).
 */
export function startCrtClock({ style, tint, size = 1, fps = 30 }) {
  S.mode = style === "scope" ? 1 : 0;
  S.tint = tint;
  let pulseColour = [0, 0, 0], pulseAt = -1e9, pulseFade = 4, flashAt = -1e9, now = 0;
  const box = { cx: 0, cy: 0, R: 0 };

  function layout({ A, H }) {
    S.cx = A / 2;
    S.cy = 0.44;
    S.R = Math.min(0.32, A * 0.4) * size;
    S.L = pathLength(S.R);
    Object.assign(box, { cx: S.cx * H, cy: S.cy * H, R: S.R * H });
    onLayout?.(box);
  }
  function frame(t) {
    now = t;
    const d = new Date();
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    const min = d.getMinutes() + sec / 60;
    const hour = (d.getHours() % 12) + min / 60;
    S.secA = (sec / 60) * TAU - Math.PI / 2;
    S.minA = (min / 60) * TAU - Math.PI / 2;
    S.hourA = (hour / 12) * TAU - Math.PI / 2;
    S.sweep = S.secA;
    S.beam = ((t % SCOPE_PERIOD) / SCOPE_PERIOD) * S.L;
    const k = Math.max(0, 1 - (t - pulseAt) / pulseFade);
    S.pulse = pulseColour.map((v) => v * k);
    S.flash = Math.max(0, 1 - (t - flashAt) / 0.4) * 0.8;
  }
  function sample(X, Y) {
    const c = S.mode === 0 ? radar(X, Y) : scope(X, Y);
    const f = 1 + S.flash;
    return [[BG[0] / 255 + c[0] * f, BG[1] / 255 + c[1] * f, BG[2] / 255 + c[2] * f], null];
  }
  const gpu = {
    glsl: GLSL,
    bind(gl, u) {
      gl.uniform1i(u.uMode, S.mode);
      gl.uniform2f(u.uC, S.cx, S.cy);
      gl.uniform1f(u.uR, S.R);
      gl.uniform1f(u.uSweep, S.sweep);
      gl.uniform1f(u.uHourA, S.hourA);
      gl.uniform1f(u.uMinA, S.minA);
      gl.uniform1f(u.uSecA, S.secA);
      gl.uniform1f(u.uBeam, S.beam);
      gl.uniform1f(u.uL, S.L);
      gl.uniform1f(u.uFlash, S.flash);
      gl.uniform3f(u.uTint, ...S.tint);
      gl.uniform3f(u.uPulse, ...S.pulse);
      gl.uniform3f(u.uStart, BG[0] / 255, BG[1] / 255, BG[2] / 255);
      gl.uniform2f(u.uContact, ...S.contact);
    },
  };
  let onLayout = null;
  setPalette();
  startScene({
    label: style === "scope" ? "An oscilloscope clock: a glowing beam draws the clock face and its hands, fading behind it." : "A radar clock: the sweep is the second hand, and blips for the hour and minute flash and fade.",
    fps,
    fontPx: (H) => Math.max(5, Math.min(11, H / 130)),
    layout,
    frame,
    sample,
    gpu,
  });
  return {
    onLayout(fn) {
      onLayout = fn;
      if (box.R) fn(box);
    },
    react(r) {
      if (r.type === "pulse" && Array.isArray(r.colour)) {
        pulseColour = r.colour.map((v) => v / 255);
        pulseFade = Math.max(1, (r.afterglow || 4) * (S.mode === 0 ? 3 : 1));
        pulseAt = now;
        // radar: the contact appears somewhere between the rings
        const a = Math.random() * TAU, rr = S.R * (0.3 + Math.random() * 0.55);
        S.contact = [S.cx + Math.cos(a) * rr, S.cy + Math.sin(a) * rr];
      } else if (r.type === "flash") flashAt = now;
    },
  };
}
