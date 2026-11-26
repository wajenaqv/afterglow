// Black hole: a ray-traced black hole in coloured characters, after
// heywajih.com's (same physics), in colour and in two views.
//
// Every character cell is a ray of light traced backwards from the viewer past
// a Schwarzschild black hole, with the photon orbit equation
//     d²u/dφ² = 3Mu² − u      (u = 1/r, M = 1)
// A ray falls through the horizon (the shadow), lands on the thin disk of gas
// in the equatorial plane, or escapes to the stars. Nothing is drawn by hand:
// the far side of the disk bent up over the top and under the bottom, the
// photon ring hugging the shadow (light that nearly orbited the hole) and the
// stretched stars round it all come out of the tracing. (Hand-drawn rings, on
// heywajih, looked like Saturn.)
//
// The gas is coloured by temperature: hot inside, and hotter and brighter on
// the side coming towards you (Doppler beaming, softened so the far side stays
// visible). Each frame only spins the gas (inner orbits faster) and drifts the
// stars; the tracing runs once per screen size, a slice each frame so the
// first frames don't stall.
//
// Views (?view=, the page defaults to trails, see blackholetrails.js): gargantua, nearly edge-on; whirlpool, seen from
// higher up with spiral arms of gas falling in.
//
// No hover effect: the cursor only marks a waiting app seen.
//
// Reactions: a message is a clump of gas in the app's colour spiralling in
// from the outer edge; when it falls in, the photon ring flares in its colour
// and fades over the afterglow. Each waiting app is a hot spot orbiting in the
// disk in its colour (seen twice: once bent over the top); rest the cursor on
// it for a moment to mark it seen, and it fades where it is. A flash lights the ring
// and the disk.
//
// Drawing: the scene puts each cell's glyph and colour into a cell buffer
// (cells.js), which the CPU draws as text and the GPU from a texture, so the
// two renderers can't drift apart.
//
// Options: ?view=gargantua|whirlpool ?tint=fire|natural|cool|green ?place=right

import { hash, params, HOVER, pointer, seenLantern, STILL } from "./common.js";
import { BLACKHOLE } from "./palettes.js";
import { startScene, setPalette, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { trackApps, now } from "./waiting.js";

const PAL = BLACKHOLE[params.get("tint")] ?? BLACKHOLE.fire;
const VIEWS = {
  // elevation above the disk, shadow radius as a share of the screen height, disk outer edge (M), spiral arms
  gargantua: { elev: 5, size: 0.17, rout: 20, arms: 2.5, whirl: false },
  whirlpool: { elev: 24, size: 0.115, rout: 17, arms: 3.2, whirl: true },
};
const VIEW = VIEWS[params.get("view")] ?? VIEWS.gargantua;
// Centred by default (owner); ?place=right moves it right of centre, clear
// of the desktop icons on the left (a portrait screen is always centred)
const CENTRE = params.get("place") !== "right";

const RAMP = ".:-;=+*ox%#@"; // by ink, light to heavy
const cells = cellBuffer(RAMP);
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function heat(x) {
  const T = PAL.heat, f = clamp(x) * (T.length - 1), i = Math.min(T.length - 2, Math.floor(f));
  return mix(T[i], T[i + 1], f - i);
}

// ---- the tracing ----
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const SKY = 0, HOLE = 1, DISK = 2;
const D = 60; // camera distance (M)
const R_IN = 6; // the disk's inner edge: the innermost stable orbit
const SHADOW = 3 * Math.sqrt(3); // the shadow's apparent radius (M)
const E = (VIEW.elev * Math.PI) / 180;
const CAM = [0, D * Math.sin(E), -D * Math.cos(E)];
const FWD = norm(mul(CAM, -1));
const RIGHT = norm([FWD[2], 0, -FWD[0]]);
const UP = [FWD[1] * RIGHT[2] - FWD[2] * RIGHT[1], FWD[2] * RIGHT[0] - FWD[0] * RIGHT[2], FWD[0] * RIGHT[1] - FWD[1] * RIGHT[0]];
const E1 = norm(CAM);
// the disk's brightness by radius (thin-disk temperature profile)
const profile = (r) => (1 - Math.sqrt(R_IN / r)) / (r * r * r);
const PEAK = profile((49 / 36) * R_IN);

// One ray through image-plane offset (a, b), in M
function trace(a, b) {
  const dir = norm(add(FWD, add(mul(RIGHT, a / D), mul(UP, b / D))));
  const impact = Math.hypot(a, b);
  if (impact > 45) {
    // far out light barely bends (4M/b): skip the integration
    const bend = 4 / impact;
    return { kind: SKY, dir: norm(add(dir, add(mul(RIGHT, (-a / impact) * bend), mul(UP, (-b / impact) * bend)))), ring: 0 };
  }
  // the ray stays in the plane through the hole spanned by E1 and e2
  const along = dot(dir, E1), perp = add(dir, mul(E1, -along)), side = Math.hypot(perp[0], perp[1], perp[2]) || 1e-9, e2 = mul(perp, 1 / side);
  const u0 = 1 / D;
  let u = u0, w = (-u * along) / side, phi = 0, prevY = CAM[1], umax = 0;
  const acc = (u) => 3 * u * u - u;
  for (let i = 0; i < 5000; i++) {
    const h = u < 0.05 ? 0.02 : 0.005; // fine steps near the hole
    const k1u = w, k1w = acc(u), k2u = w + (h / 2) * k1w, k2w = acc(u + (h / 2) * k1u);
    const k3u = w + (h / 2) * k2w, k3w = acc(u + (h / 2) * k2u), k4u = w + h * k3w, k4w = acc(u + h * k3u);
    u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    phi += h;
    if (u > umax) umax = u;
    if (u >= 0.5) return { kind: HOLE }; // inside r = 2M
    const c = Math.cos(phi), s = Math.sin(phi);
    const er = [E1[0] * c + e2[0] * s, E1[1] * c + e2[1] * s, E1[2] * c + e2[2] * s];
    if (u <= 0 || (u < u0 && w < 0)) {
      // escaped; the closer it came to the photon sphere (r = 3M), the brighter the ring
      const ephi = add(mul(E1, -s), mul(e2, c));
      const ring = Math.exp(-Math.max(0, 1 / umax - 3) / 0.22);
      return { kind: SKY, dir: norm(add(mul(er, -w / (u * u || 1e-9)), mul(ephi, 1 / Math.max(u, 1e-9)))), ring };
    }
    const r = 1 / u, y = r * er[1];
    if (y > 0 !== prevY > 0 && r >= R_IN && r <= VIEW.rout) {
      // landed on the disk. Doppler: gas orbits at v = sqrt(M/r); light from
      // gas coming towards us is bluer and brighter
      const ephi = add(mul(E1, -s), mul(e2, c));
      const p = mul(er, r), travel = norm(add(mul(er, -w / (u * u)), mul(ephi, r)));
      const vel = [-p[2] / r, 0, p[0] / r], beta = Math.sqrt(1 / r), towards = -dot(vel, travel);
      const g = Math.sqrt(1 - 3 / r) / (1 - beta * towards);
      return { kind: DISK, r, ang: Math.atan2(p[2], p[0]), light: Math.min(3, (profile(r) / PEAK) ** 0.5 * g ** 1.7) * 1.5, g };
    }
    prevY = y;
  }
  return { kind: HOLE }; // circled too long near the photon sphere
}

// ---- per screen size ----
let dims = null, cols = 0, rows = 0, n = 0, done = 0;
let kind, rad, ang, light, temp, kep, swirl0, lon, lat, ring, L;
let cx = 0, cy = 0, perRow = 1, aspect = 0.5, shadowPx = 100, starCell = 0.01, readyAt = 0;

function layout(d) {
  dims = d;
  cols = d.cols;
  rows = d.rows;
  n = cols * rows;
  cells.resize(cols, rows);
  kind = new Uint8Array(n);
  kind.fill(HOLE);
  [rad, ang, light, temp, kep, swirl0, lon, lat, ring] = Array.from({ length: 9 }, () => new Float32Array(n));
  L = new Float32Array(n * 3);
  aspect = d.cw / d.ch;
  // the shadow's size: a share of the height, smaller on narrow screens
  const unit = Math.min(d.H, d.W / 1.6);
  shadowPx = unit * VIEW.size;
  perRow = (SHADOW / shadowPx) * d.ch; // M per row
  starCell = (perRow / D) * 0.9;
  // right of centre, keeping the left fifth clear for desktop icons
  cx = (d.W * (d.A > 1.2 && !CENTRE ? 0.6 : 0.5)) / d.cw;
  cy = (d.H * 0.5) / d.ch;
  done = 0;
  readyAt = 0;
  if (STILL) traceSome(Infinity);
}

// trace rows of cells until the time is up (and at most `most` rows, so one
// slow row can't hold up a frame for long)
function traceSome(budgetMs, most = Infinity) {
  const end = performance.now() + budgetMs, last = Math.min(n, done + most * cols);
  while (done < last && performance.now() < end) {
    const stop = Math.min(last, done + cols);
    for (let i = done; i < stop; i++) {
      const x = i % cols, y = (i - x) / cols;
      const hit = trace((x - cx + 0.5) * aspect * perRow, -(y - cy + 0.5) * perRow);
      kind[i] = hit.kind;
      if (hit.kind === DISK) {
        const r = hit.r;
        rad[i] = r;
        ang[i] = hit.ang;
        light[i] = hit.light;
        temp[i] = 0.15 + 0.55 * (R_IN / r) ** 1.2 + 0.35 * (hit.g - 1);
        kep[i] = (R_IN / r) ** 1.5;
        swirl0[i] = hit.ang + Math.log(r) * VIEW.arms;
      } else if (hit.kind === SKY) {
        lon[i] = Math.atan2(hit.dir[0], hit.dir[2]);
        lat[i] = Math.asin(clamp(hit.dir[1], -1, 1));
        ring[i] = hit.ring;
      }
    }
    done = stop;
  }
  if (done >= n && !readyAt) readyAt = now();
}

// ---- reactions ----
// a waiting app's orbit: radius as a share of the disk, and where it starts
const SLOTS = [0.1, 0.45, 0.8, 0.28, 0.62, 0.95, 0.18, 0.52];
const orbitR = (i) => R_IN + 2.2 + SLOTS[i % SLOTS.length] * (VIEW.rout - R_IN - 4);
let gone = []; // seen apps fading where they are: { a, r, ang, t0 }
const apps = trackApps({
  onSeen(a) {
    const s = spots.find((p) => p.a.source === a.source);
    if (s) gone.push({ a, r: s.r, ang: s.ang, t0: now() });
  },
});
let spots = []; // this frame's hot spots: { a, r, ang, x, z, on }
const orbits = new Map(); // source -> where its hot spot is on its orbit (radians)
let over = null; // { source, at } the hot spot under the cursor
let spin = 0, lastT = null;

function frame(t) {
  if (!dims) return;
  if (done < n) traceSome(28, 12);
  cells.clear();
  if (done < n) return; // black until the hole is traced (a fraction of a second)
  const T = now();
  const dt = lastT == null ? 0 : clamp(t - lastT, 0, 0.1);
  lastT = t;
  apps.tidy();
  spin += reduced ? 0 : dt * 0.55;
  const flash = apps.flash();
  const fadeIn = STILL ? 1 : smooth(0, 1.2, T - readyAt);

  // waiting apps: hot spots on fixed orbits, drifting round slowly (far
  // slower than the gas, so the cursor can rest on one); a seen one fades
  // out where it is over 1.5 s
  spots = apps.waiting.map((a) => {
    const r = orbitR(a.i);
    const an = (orbits.get(a.source) ?? a.i * 2.4 + 1) - (reduced ? 0 : dt * 0.09 * (R_IN / r) ** 1.5);
    orbits.set(a.source, an);
    return { a, r, ang: an, x: r * Math.cos(an), z: r * Math.sin(an), on: apps.lit(a), hits: [] };
  });
  gone = gone.filter((g) => T - g.t0 < 1.5);
  for (const g of gone) spots.push({ a: g.a, r: g.r, ang: g.ang, x: g.r * Math.cos(g.ang), z: g.r * Math.sin(g.ang), on: 1 - smooth(0, 1.5, T - g.t0), hits: [], gone: true });
  // gas falling in: messages from the outer edge (4 s)
  const clumps = [];
  let ringCol = heat(0.8), ringBoost = flash * 1.2;
  for (const m of apps.messages) clumps.push({ colour: m.colour, r0: VIEW.rout, a0: (m.t0 * 7.3) % 6.283, t0: m.t0, dur: 4, tau: m.tau });
  for (const c of clumps) {
    const age = T - c.t0, k = clamp(age / c.dur);
    c.r = c.r0 - (c.r0 - R_IN) * k * k;
    const an = c.a0 - age * 1.2 - k * 5;
    c.x = c.r * Math.cos(an);
    c.z = c.r * Math.sin(an);
    c.on = age < c.dur ? smooth(0, 0.6, age) : 0;
    // into the hole: the ring flares in its colour, fading over the afterglow
    const glow = age > c.dur * 0.9 ? smooth(c.dur * 0.9, c.dur, age) * Math.exp(-Math.max(0, age - c.dur) / (c.tau * 0.6)) : 0;
    if (glow > 0.02) ringCol = mix(ringCol, c.colour, clamp(glow));
    ringBoost += glow;
  }
  const live = clumps.filter((c) => c.on > 0.01);

  const drift = t * 0.004; // the sky turns slowly behind the hole
  L.fill(0);
  for (let i = 0; i < n; i++) {
    const k3 = i * 3;
    if (kind[i] === DISK) {
      const r = rad[i], sw = swirl0[i] - spin * kep[i];
      const tex = VIEW.whirl
        ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(sw * 3)) ** 2 * (0.75 + 0.25 * Math.sin(sw * 11 + r))
        : 0.7 + 0.3 * Math.sin(sw * 8) * Math.sin(sw * 3 + 1.7);
      const b = light[i] * tex * (1 + 0.6 * flash);
      let c = heat(temp[i] + flash * 0.15);
      c = [c[0] * b, c[1] * b, c[2] * b];
      if (spots.length || live.length) {
        const px = r * Math.cos(ang[i]), pz = r * Math.sin(ang[i]);
        for (const s of spots) {
          // its shape (for the hit test, whatever its brightness), then its light
          const shape = Math.exp(-((px - s.x) ** 2 + (pz - s.z) ** 2) / 2.4), k = shape * s.on;
          if (shape > 0.35 && s.on > 0.05 && !s.gone) s.hits.push(i);
          if (k > 0.01) c = mix(c, s.a.colour.map((v) => v * 1.6), clamp(k * 1.3));
        }
        for (const f of live) {
          const k = Math.exp(-((px - f.x) ** 2 + (pz - f.z) ** 2) / 2.6) * f.on;
          if (k > 0.01) c = mix(c, f.colour.map((v) => v * 1.9), clamp(k * 1.3));
        }
      }
      L[k3] = c[0];
      L[k3 + 1] = c[1];
      L[k3 + 2] = c[2];
    } else if (kind[i] === SKY) {
      const sx = Math.floor((lon[i] + drift) / starCell), sy = Math.floor(lat[i] / starCell), st = hash(sx, sy, 1);
      if (st < 0.007) {
        const b = hash(sx, sy, 2) * (0.55 + 0.45 * Math.sin(t * 1.3 + st * 5000)) * 0.9 * (1 + flash);
        L[k3] = PAL.star[0] * b;
        L[k3 + 1] = PAL.star[1] * b;
        L[k3 + 2] = PAL.star[2] * b;
      }
      const rb = ring[i] * (0.9 + ringBoost * 2.2);
      if (rb > 0.02) {
        L[k3] += ringCol[0] * rb;
        L[k3 + 1] += ringCol[1] * rb;
        L[k3 + 2] += ringCol[2] * rb;
      }
    }
  }

  // into characters: a tight halo of specks round the light, then the glyph by brightness
  for (let i = 0; i < n; i++) {
    const k3 = i * 3;
    let r = L[k3], g = L[k3 + 1], b = L[k3 + 2], m = Math.max(r, g, b);
    if (m < 0.08) {
      const x = i % cols, y = (i - x) / cols;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) continue;
      const a = i - 1, c = i + 1, u = i - cols, d = i + cols;
      const hr = (L[a * 3] + L[c * 3] + L[u * 3] + L[d * 3]) * 0.09;
      const hg = (L[a * 3 + 1] + L[c * 3 + 1] + L[u * 3 + 1] + L[d * 3 + 1]) * 0.09;
      const hb = (L[a * 3 + 2] + L[c * 3 + 2] + L[u * 3 + 2] + L[d * 3 + 2]) * 0.09;
      const hm = Math.max(hr, hg, hb);
      if (hm > 0.02 && hash(x, y, 7) < hm * 4) {
        r = hr;
        g = hg;
        b = hb;
        m = hm;
      }
    }
    m *= fadeIn;
    if (m < 0.05) continue;
    const tone = clamp(m / (1 + m * 0.35));
    const slot = Math.min(RAMP.length, Math.floor(tone * RAMP.length) + 1);
    const s = ((0.45 + 0.55 * tone) / Math.max(r, g, b)) * fadeIn;
    cells.putSlot(i, slot, r * s, g * s, b * s);
  }

  // rest the cursor on a hot spot for 0.8 s: seen (the app sends the new list back)
  if (HOVER && pointer.on && spots.length) {
    const mx = Math.floor(pointer.x / dims.cw), my = Math.floor(pointer.y / dims.ch);
    const hit = spots.find((s) => s.hits.some((i) => Math.abs((i % cols) - mx) <= 2 && Math.abs(Math.floor(i / cols) - my) <= 1));
    if (!hit) over = null;
    else if (over?.source !== hit.a.source) over = { source: hit.a.source, at: T };
    else if (T - over.at > 0.8 && !over.sent) {
      seenLantern(hit.a.source);
      over.sent = true;
    }
  } else over = null;
}

// ?debug: where the hot spots are on screen (CSS px), for testing
if (params.has("debug"))
  window.__state = () => ({ done, n, readyAt, T: now(), lit: Array.from({ length: n }, (_, i) => cells.has(i)).filter(Boolean).length });
if (params.has("debug"))
  window.__blackhole = () =>
    spots.map((s) => {
      const i = s.hits[s.hits.length >> 1];
      return { source: s.a.source, cells: s.hits.length, x: i == null ? null : ((i % cols) + 0.5) * dims.cw, y: i == null ? null : (Math.floor(i / cols) + 0.5) * dims.ch };
    });

setPalette();
startScene({
  label: "A black hole: glowing gas swirling round a black shadow, its far side bent up over the top by the gravity, among stretched stars, drawn in coloured text characters.",
  fps: 15,
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
