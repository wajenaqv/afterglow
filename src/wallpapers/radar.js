// Radar: a phosphor radar screen. A beam sweeps round; everything it passes
// flares and then decays slowly, like the long-persistence phosphor of an old
// radar (the literal afterglow). Range rings, bearing ticks, a coastline of
// ground returns, sea clutter near the centre that changes every sweep.
//
// Reactions: every app with something waiting is a contact, a blip labelled
// with its name, that the beam refreshes each pass (a blue-white flash cooling
// into the app's colour), with the echoes of its last positions fading behind
// it; rest the cursor on it to mark it seen. A new message is a new contact
// coming in from the edge in the app's colour, fading over the afterglow. A
// flash lights the whole screen.
//
// The decay needs no memory: a cell's light comes from how long ago the beam
// passed it. Drawn through cells.js (CPU lays out, GPU or CPU draws).
// Options: ?tint=green|amber|ice|white ?crt=0

import { params, hash, STILL, STILL_AT, onReaction } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, mixc, scale, watchSeen } from "./techy.js";

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(xi, yi, z), b = hash(xi + 1, yi, z), c = hash(xi, yi + 1, z), d = hash(xi + 1, yi + 1, z);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

const SWEEP = 6; // seconds per turn of the beam
const W_BEAM = TAU / SWEEP;
const TAU_PH = 2.4; // phosphor decay, seconds
const RAMP = " .:-=+*#%@";
const cells = cellBuffer(RAMP.slice(1) + "|/\\_o<>[]()',ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

let dims = null, cols = 0, rows = 0, cwH = 0, chH = 0, CX = 1, CY = 0.5, R = 0.44, A = 1.78;
function layout(d) {
  dims = d;
  cols = d.cols;
  rows = d.rows;
  cwH = d.cw / d.H;
  chH = d.ch / d.H;
  A = d.A;
  // the scope a little right of centre (the left fifth stays quiet for desktop icons)
  R = Math.min(0.44, A * 0.42);
  CX = A > 1.2 ? Math.max(A * 0.58, A * 0.2 + R + 0.06) : A / 2;
  CY = 0.5;
  cells.resize(cols, rows);
}
const put = (c, r, g, col) => cells.putAt(c, r, g, col);
const text = (c, r, s, col) => [...s].forEach((ch, k) => ch !== " " && put(c + k, r, ch, col));
// - | / \ for a line at angle a (screen), cells being taller than wide
function slopeChar(a) {
  let d = ((a * 180) / Math.PI) % 180;
  if (d < 0) d += 180;
  return ["-", "\\", "|", "/"][Math.floor((d + 22.5) / 45) % 4];
}
// the phosphor's colour for light that was swept `age` seconds ago: a
// blue-white flash cooling into its colour
const phosphor = (base, age, k) => scale(mixc(PH.flash, base, sstep(0, 0.7, age)), k);

// ---- reactions ----
let lanterns = []; // { source, colour }
let contacts = []; // a new message: { colour, t0, a (bearing), tau }
let flashAt = -1e9, nowT = 0;
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    // it comes in at the edge just ahead of the beam, so it shows at once
    contacts.push({ colour: r.colour.map((v) => v / 255), t0: nowT, a: (W_BEAM * nowT + 0.5) % TAU, tau: Math.max(2, (r.afterglow ?? 6) / 2) });
    if (contacts.length > 6) contacts.shift();
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") lanterns = (Array.isArray(r.items) ? r.items : []).filter((l) => Array.isArray(l.colour)).slice(0, 8).map((l, i) => ({ source: l.source, colour: l.colour.map((v) => v / 255), i }));
});
// a waiting app's contact: a slow drift on a fixed course
function lanternAt(l, t) {
  const r = R * (0.3 + 0.55 * ((l.i * 0.618 + 0.21) % 1));
  const a = TAU * ((l.i * 0.381 + 0.13) % 1) + 0.006 * t * (l.i % 2 ? 1 : -1);
  return [CX + r * Math.cos(a), CY + r * Math.sin(a), a];
}
const ageAt = (a, t) => {
  // seconds since the beam last passed bearing a
  let d = (W_BEAM * t - a) % TAU;
  if (d < 0) d += TAU;
  return d / W_BEAM;
};

function frame(t) {
  nowT = t;
  if (!dims) return;
  const T = STILL ? STILL_AT : reduced ? 40 : t;
  const flash = Math.max(0, 1 - (T - flashAt) / 1.0);
  const beam = (W_BEAM * T) % TAU;
  cells.clear();
  contacts = contacts.filter((c) => T - c.t0 < c.tau * 5);

  // ---- the scope, cell by cell ----
  const c0 = Math.max(0, Math.floor((CX - R * 1.02) / cwH)), c1 = Math.min(cols - 1, Math.ceil((CX + R * 1.02) / cwH));
  const r0 = Math.max(0, Math.floor((CY - R * 1.02) / chH)), r1 = Math.min(rows - 1, Math.ceil((CY + R * 1.02) / chH));
  for (let r = r0; r <= r1; r++) {
    const Y = (r + 0.5) * chH, dy = Y - CY;
    for (let c = c0; c <= c1; c++) {
      const X = (c + 0.5) * cwH, dx = X - CX;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      let a = Math.atan2(dy, dx);
      if (a < 0) a += TAU;
      const age = ageAt(a, T);
      const ph = Math.exp(-age / TAU_PH) + 0.35 * flash;
      const rev = Math.floor((W_BEAM * T - a) / TAU); // which pass this is, for the clutter
      let g = null, k = 0, base = PH.ink;
      // the beam itself: a bright line with a soft trailing edge
      if (age < 0.05 && d > 0.01) {
        g = slopeChar(a);
        k = 1.25;
      } else if (age < 1.6 && hash(c, r, rev) < 0.45 * Math.exp(-age / 0.35)) {
        // the wedge of afterglow trailing the beam, thinning out as it fades
        g = age < 0.2 ? ":" : ".";
        k = 0.75 * Math.exp(-age / 0.5);
      }
      // range rings, bearing ticks and the cross: always faintly there, bright when swept
      const ringW = 0.55 * chH;
      let feat = 0, fg = null;
      for (let q = 1; q <= 4; q++) if (Math.abs(d - (R * q) / 4) < ringW * (q === 4 ? 1 : 0.8)) (feat = q === 4 ? 0.9 : 0.55), (fg = slopeChar(a + Math.PI / 2));
      const deg = (a * 180) / Math.PI;
      const tick5 = Math.abs(((deg + 2.5) % 10) - 2.5) < 0.9, tick30 = Math.abs(((deg + 15) % 30) - 15) < 0.9;
      if (d > R * (tick30 ? 0.9 : 0.955) && tick5) (feat = 0.8), (fg = slopeChar(a));
      if (!fg && (Math.abs(dx) < 0.5 * cwH || Math.abs(dy) < 0.5 * chH)) (feat = 0.3), (fg = Math.abs(dx) < 0.5 * cwH ? "|" : "-");
      // ground returns: a stretch of coast to one side, and clutter near the centre
      let ret = 0, rg = null;
      // a coastline (a contour of the noise) with sparse returns inland: a
      // filled mass of land took over the screen
      const lv = 0.7 * vnoise(dx * 6 + 11, dy * 6 + 3, 21) + 0.3 * vnoise(dx * 22, dy * 22, 22);
      const sector = sstep(0.45 * R, 0.62 * R, d) * sstep(0.05, 0.3, dx * 0.6 - dy);
      if (sector > 0.05 && Math.abs(lv - 0.6) < 0.018) (ret = 0.6 * sector), (rg = slopeChar(a + 1.2));
      else if (sector > 0.05 && lv > 0.6 && hash(c, r, 23) < 0.12) (ret = 0.3 * sector), (rg = hash(c, r, 24) < 0.5 ? "." : ":");
      else if (d < 0.32 * R && hash(c, r, 97 + rev) < 0.09 * (1 - d / (0.32 * R))) (ret = 0.6), (rg = hash(c, r, 5) < 0.5 ? "." : ":");
      if (!g && ret > 0 && ph * ret > 0.06) (g = rg), (k = (0.25 + ph) * ret);
      else if (!g && fg) (g = fg), (k = feat * (0.14 + 0.85 * ph));
      if (g && k > 0.04) put(c, r, g, phosphor(base, age, k));
    }
  }

  // ---- bearings round the rim, and a few readouts ----
  for (let b = 0; b < 360; b += 30) {
    const a = (b - 90) * (Math.PI / 180); // 000 at the top
    const x = CX + R * 1.07 * Math.cos(a), y = CY + R * 1.07 * Math.sin(a);
    const s = String(b).padStart(3, "0");
    text(Math.round(x / cwH) - 1, Math.round(y / chH), s, scale(PH.dim, 0.8));
  }
  const hc = Math.round((CX + R * 0.75) / cwH), hr = Math.round((CY + R * 0.92) / chH);
  const dim = scale(PH.dim, 0.9);
  text(hc, hr, `RNG 40NM`, dim);
  text(hc, hr + 1, `SWP ${SWEEP.toFixed(1)}S`, dim);
  text(hc, hr + 2, `TGT ${String(lanterns.length + contacts.length).padStart(2, "0")}`, dim);

  // ---- contacts: waiting apps ----
  for (const l of lanterns) {
    const [x, y, a] = lanternAt(l, T);
    const age = ageAt(a, T);
    // echoes of where it was on the last passes, fading
    for (let k = 3; k >= 1; k--) {
      const [px, py] = lanternAt(l, T - k * SWEEP);
      put(Math.floor(px / cwH), Math.floor(py / chH), ".", scale(l.colour, 0.5 * Math.exp(-k * 0.7)));
    }
    const k = 0.4 + 1.2 * Math.exp(-age / 3) + 0.4 * flash; // refreshed each pass, never quite gone
    const cc = Math.floor(x / cwH), cr = Math.floor(y / chH);
    put(cc, cr, "@", phosphor(l.colour, age, k));
    put(cc - 1, cr, "<", phosphor(l.colour, age, k * 0.5));
    put(cc + 1, cr, ">", phosphor(l.colour, age, k * 0.5));
    text(cc + 3, cr, l.source.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), scale(l.colour, 0.35 + 0.4 * Math.exp(-age / 3)));
  }
  // ---- contacts: new messages, coming in from the edge ----
  for (const p of contacts) {
    const s = T - p.t0;
    const d = R * (0.97 - 0.035 * s);
    if (d < 0.1 * R) continue;
    const x = CX + d * Math.cos(p.a), y = CY + d * Math.sin(p.a);
    const age = ageAt(p.a, T);
    const fade = Math.exp(-s / p.tau);
    put(Math.floor(x / cwH), Math.floor(y / chH), "*", phosphor(p.colour, age, (0.5 + 1.3 * Math.exp(-age / 2.5)) * fade));
  }

  watchSeen(lanterns, (l) => lanternAt(l, T), dims.H);
}

crt();
startScene({
  label: "A phosphor radar screen: a beam sweeps round, everything it passes glows and slowly fades; contacts mark apps with something waiting.",
  fps: 20,
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
