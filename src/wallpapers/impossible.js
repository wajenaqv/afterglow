// Impossible: an impossible object that is really there, the one the user picks.
//
// A Penrose triangle: three square beams in an open chain, along x, then y,
// then z, so the far end of the last sits exactly (L, L, L) from the start of
// the first. Seen along that diagonal the ends meet and the chain looks like a
// closed, impossible triangle. (The last half of the last beam is always drawn
// first, behind everything, so where the ends meet the first beam passes in
// front: that is what reads as impossible rather than as overlapping bars.)
//
// Penrose stairs: four flights round a square, every step a little higher,
// but two flights are longer than the two opposite them, so after a lap the
// path ends shifted sideways and higher. Seen along that shift, the end lands
// on the start: a staircase that climbs for ever.
//
// The camera rocks slowly round each object's magic viewpoint: it closes,
// holds (the illusion), swings open now and then so you can see it never was
// closed, and closes again.
//
// Reactions: a new message sends a band of light in the app's colour round the
// endless loop, fading as it goes; every app with something waiting is a light
// that keeps going round it for ever (the climbers on Penrose's stairs); rest
// the cursor on it to mark it seen. A flash lights the edges.
//
// Drawn through cells.js: faces filled with characters by how much light they
// catch, edges in slope characters.
// Options: ?object=triangle|stairs|reutersvard|square|pentagon ?tint=green|amber|ice|white ?crt=0

import { params, STILL, STILL_AT, onReaction } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, mixc, scale, watchSeen } from "./techy.js";

const TAU = Math.PI * 2;
const RAMP = " .:-=+*#%@";
const cells = cellBuffer(RAMP.slice(1) + "|/\\_o()");
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// the six faces of a box, minus any named in `open` ("min2", "max2": the box's
// low or high z face, where a beam is split)
function boxFaces(bx, id) {
  const { min: a, max: b } = bx, out = [];
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1]) {
      if (bx.open === (side ? "max" : "min") + axis) continue;
      const n = [0, 0, 0];
      n[axis] = side ? 1 : -1;
      const o = [a[0], a[1], a[2]];
      o[axis] = side ? b[axis] : a[axis];
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const e1 = [0, 0, 0], e2 = [0, 0, 0];
      e1[u] = b[u] - a[u];
      e2[v] = b[v] - a[v];
      out.push({ o, e1, e2, n, box: id, behind: !!bx.behind, centre: lerp3(a, b, 0.5) });
    }
  return out;
}

// ---- impossible chains ----
// Square beams along the axes, one after another: [axis, sign, length] each.
// Seen along the line from the chain's start to its end, the end lands on the
// start and the chain closes into a loop that can't exist. The last beam is
// split in half and its far half always drawn first, behind everything, so
// where the ends meet the first beam passes in front: that reads as impossible
// rather than as overlapping bars. `cubes`: built from separate cubes instead
// (Reutersvard's figures).
function chain(segs, { S = 0.2, roll = 0, cubes = false, edge = 1, speed = 0.3 } = {}) {
  const pts = [[0, 0, 0]];
  for (const [ax, sg, len] of segs) {
    const p = pts[pts.length - 1].slice();
    p[ax] += sg * len;
    pts.push(p);
  }
  const n = segs.length, boxes = [];
  const box = (a, b, extra) => ({ min: [0, 1, 2].map((k) => Math.min(a[k], b[k]) - S / 2), max: [0, 1, 2].map((k) => Math.max(a[k], b[k]) + S / 2), ...extra });
  segs.forEach(([ax], i) => {
    const a = pts[i], b = pts[i + 1];
    if (cubes) {
      const m = Math.max(2, Math.round(Math.abs(b[ax] - a[ax]) / (S * 1.3)));
      for (let j = i ? 1 : 0; j < (i === n - 1 ? m : m + 1); j++) {
        const c = lerp3(a, b, j / m);
        boxes.push(box(c, c, { behind: i === n - 1 && j > m / 2 }));
      }
    } else if (i === n - 1) {
      const mid = lerp3(a, b, 0.5), up = b[ax] > a[ax];
      const near = box(a, mid), far = box(mid, b, { behind: true });
      // no faces where the two halves meet
      near[up ? "max" : "min"][ax] = mid[ax];
      far[up ? "min" : "max"][ax] = mid[ax];
      near.open = (up ? "max" : "min") + ax;
      far.open = (up ? "min" : "max") + ax;
      boxes.push(near, far);
    } else boxes.push(box(a, b));
  });
  return {
    faces: boxes.flatMap(boxFaces),
    magic: sub(pts[n], pts[0]),
    roll,
    byBox: cubes,
    loopLen: n,
    loopAt: (u) => {
      u = ((u % n) + n) % n;
      const k = Math.floor(u);
      return lerp3(pts[k], pts[k + 1], u - k);
    },
    glowR: S * 0.9,
    edge,
    speed, // beams per second
  };
}
const triangle = () => chain([[0, 1, 1], [1, 1, 1], [2, 1, 1]], { roll: Math.PI / 2 });
const reutersvard = () => chain([[0, 1, 1], [1, 1, 1], [2, 1, 1]], { roll: Math.PI / 2, cubes: true, S: 0.17, edge: 0.75 });
// four beams: 2 along +x, 1 along +y, 1 back along -x, 1 up +z: the ends are
// (1, 1, 1) apart, so it is seen on the diagonal, every beam showing its sides (seen
// along (0, 1, 1) instead, only the fronts showed and it read as a flat frame)
const square = () => chain([[0, 1, 2], [1, 1, 1], [0, -1, 1], [2, 1, 1]], { roll: Math.PI / 2, S: 0.2 });
// five beams whose ends are (1, 1, 1) apart
const pentagon = () => chain([[0, 1, 1.6], [1, 1, 1.6], [2, 1, 1], [0, -1, 0.6], [1, -1, 0.6]], { roll: Math.PI / 2, S: 0.18 });

// ---- Penrose stairs ----
function stairs() {
  const w = 0.17, W = 0.2, h = 0.062, D = 0.3; // tread, stair width, rise, depth of each block
  const flights = [[1, 0, 5], [0, 1, 5], [-1, 0, 1], [0, -1, 1]]; // direction, treads (6 and 1: a lower, more side-on magic viewpoint, so the risers show)
  const boxes = [], tops = [];
  let x = 0, y = 0, k = 0;
  const add = (x0, y0, x1, y1) => {
    const top = (k + 1) * h;
    boxes.push({ min: [Math.min(x0, x1), Math.min(y0, y1), top - D], max: [Math.max(x0, x1), Math.max(y0, y1), top] });
    tops.push([(x0 + x1) / 2, (y0 + y1) / 2, top]);
    k++;
  };
  for (const [dx, dy, n] of flights) {
    add(x, y, x + W, y + W); // the landing at the corner
    for (let i = 0; i < n; i++) {
      if (dx > 0) add(x + W + i * w, y, x + W + (i + 1) * w, y + W);
      else if (dx < 0) add(x - i * w, y, x - (i + 1) * w, y + W);
      else if (dy > 0) add(x, y + W + i * w, x + W, y + W + (i + 1) * w);
      else add(x, y - i * w, x + W, y - (i + 1) * w);
    }
    if (dx > 0) x += W + n * w;
    else if (dx < 0) x -= n * w + W;
    else if (dy > 0) y += W + n * w;
    else y -= n * w + W;
  }
  // where the next lap would start: shifted (x, y) and k steps higher. Seen along
  // that shift, it is the first step again
  const N = k, shift = [x, y, N * h];
  const loop = [...tops, [tops[0][0] + shift[0], tops[0][1] + shift[1], tops[0][2] + shift[2]]];
  return {
    faces: boxes.flatMap(boxFaces),
    magic: shift,
    roll: 0,
    byBox: true,
    loopLen: N,
    loopAt: (u) => {
      u = ((u % N) + N) % N;
      const i = Math.floor(u);
      const p = lerp3(loop[i], loop[i + 1], u - i);
      return [p[0], p[1], p[2] + 0.012];
    },
    glowR: W * 0.45,
    edge: 0.5, // dimmer edges: on a staircase full-bright outlines become a lattice
    speed: 1.8, // steps per second
  };
}

const OBJECTS = { triangle: triangle(), stairs: stairs(), reutersvard: reutersvard(), square: square(), pentagon: pentagon() };
// the shape is the user's choice (?object=, Settings), the Penrose triangle by default
const SHAPE = OBJECTS[params.get("object")] ?? OBJECTS.triangle;
// Every SHOW seconds: held closed most of the time, swinging open and shut
// twice (SWINGS: start, length)
const SHOW = 44, SWINGS = [[9, 6], [29, 6]];
const current = () => [SHAPE, 1];

// ---- the camera: orthographic, rocking round the object's magic viewpoint ----
let dims = null, cols = 0, rows = 0, cwH = 0, chH = 0, SX = 1, SY = 0.5, ZOOM = 0.42;
function layout(d) {
  dims = d;
  cols = d.cols;
  rows = d.rows;
  cwH = d.cw / d.H;
  chH = d.ch / d.H;
  SX = d.A > 1.2 ? d.A * 0.6 : d.A / 2;
  SY = 0.52;
  ZOOM = Math.min(0.5, d.A * 0.45);
  cells.resize(cols, rows);
}
// how far off the magic viewpoint: lingers at zero (closed), swings open between
function offAngle(t) {
  const into = t - Math.floor(t / SHOW) * SHOW;
  for (let i = 0; i < SWINGS.length; i++) {
    const [s, d] = SWINGS[i];
    if (into > s && into < s + d) return (i % 2 ? 1 : -1) * 0.45 * Math.pow(Math.sin((Math.PI * (into - s)) / d), 1.3);
  }
  return 0; // closed: the illusion holds
}
function camera(obj, t, magic = false) {
  const a = magic ? 0 : offAngle(t);
  const base = norm(obj.magic);
  const c = Math.cos(a), s = Math.sin(a);
  const d = norm([base[0] * c - base[1] * s, base[0] * s + base[1] * c, base[2] + 0.08 * Math.sin((TAU * t) / 31) * Math.abs(Math.sin(a * 3))]);
  const r0 = norm(cross([0, 0, 1], d)), u0 = cross(d, r0);
  const cr = Math.cos(obj.roll), sr = Math.sin(obj.roll);
  const right = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
  const up = [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr];
  return { d, right, up, obj };
}
// fit a shape to the screen: its extent seen from the magic viewpoint, once
function fitObj(o) {
  const cam = camera(o, 0, true);
  let r0 = 1e9, r1 = -1e9, u0 = 1e9, u1 = -1e9;
  for (const f of o.faces)
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = [f.o[0] + f.e1[0] * a + f.e2[0] * b, f.o[1] + f.e1[1] * a + f.e2[1] * b, f.o[2] + f.e1[2] * a + f.e2[2] * b];
      const r = dot(p, cam.right), u = dot(p, cam.up);
      (r0 = Math.min(r0, r)), (r1 = Math.max(r1, r)), (u0 = Math.min(u0, u)), (u1 = Math.max(u1, u));
    }
  o.mid = [(r0 + r1) / 2, (u0 + u1) / 2];
  o.ext = [r1 - r0, u1 - u0];
}
const FIT = 0.64; // share of the screen's height a shape fills
const project = (p, cam) => {
  const o = cam.obj;
  if (!o.ext) fitObj(o);
  const z = Math.min(FIT / o.ext[1], (dims.A * 0.5) / o.ext[0]);
  return [SX + (dot(p, cam.right) - o.mid[0]) * z, SY - (dot(p, cam.up) - o.mid[1]) * z];
};
const LIGHT = norm([-0.4, 0.3, 1]); // from the top left

// ---- reactions ----
let runs = []; // a message: { colour, t0, tau, u0 (a share of the loop) }
let lanterns = []; // { source, colour, i }
let flashAt = -1e9, nowT = 0;
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    runs.push({ colour: r.colour.map((v) => v / 255), t0: nowT, tau: Math.max(2, (r.afterglow ?? 6) / 2), u0: Math.random() });
    if (runs.length > 4) runs.shift();
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") lanterns = (Array.isArray(r.items) ? r.items : []).filter((l) => Array.isArray(l.colour)).slice(0, 6).map((l, i) => ({ source: l.source, colour: l.colour.map((v) => v / 255), i }));
});
// where a waiting app's light is on the loop: spread out, all moving on
const lanternU = (obj, l, t) => (l.i * obj.loopLen) / Math.max(1, lanterns.length) + t * obj.speed;

function slopeChar(dx, dy) {
  let d = (Math.atan2(dy, dx) * 180) / Math.PI;
  d = ((d % 180) + 180) % 180;
  return ["-", "\\", "|", "/"][Math.floor((d + 22.5) / 45) % 4];
}

function frame(t) {
  nowT = t;
  if (!dims) return;
  const T = STILL ? STILL_AT : reduced ? 0 : t;
  const [obj, fade] = current(T);
  const cam = camera(obj, T);
  const flash = Math.max(0, 1 - (T - flashAt) / 0.9);
  runs = runs.filter((r) => T - r.t0 < r.tau * 5);
  cells.clear();
  if (fade < 0.02) return;
  // painter's order, far first: by box for the stairs (blocks side by side), by
  // face for the triangle (its beams overlap at the corners); whatever is marked
  // "behind" before everything
  const vis = obj.faces.filter((f) => dot(f.n, cam.d) > 0.02).map((f) => {
    const c = obj.byBox ? f.centre : [f.o[0] + (f.e1[0] + f.e2[0]) / 2, f.o[1] + (f.e1[1] + f.e2[1]) / 2, f.o[2] + (f.e1[2] + f.e2[2]) / 2];
    return { f, depth: f.behind ? -1e9 : dot(c, cam.d) };
  });
  vis.sort((a, b) => a.depth - b.depth);
  const glowAt = (p3) => {
    // light from the runs and the waiting apps' lights, at a point on the object
    let col = null, k = 0;
    const add = (c, v) => {
      if (v > k) (k = v), (col = c);
    };
    const R = obj.glowR;
    for (const r of runs) {
      const s = T - r.t0, head = r.u0 * obj.loopLen + s * obj.speed * 7;
      const len = obj.loopLen * 0.35;
      for (let back = 0; back < len; back += obj.loopLen / 60) {
        const q = obj.loopAt(head - back);
        const d = Math.hypot(p3[0] - q[0], p3[1] - q[1], p3[2] - q[2]);
        if (d < R) add(r.colour, (1 - back / len) * Math.exp(-s / r.tau) * (1 - d / R));
      }
    }
    for (const l of lanterns) {
      const q = obj.loopAt(lanternU(obj, l, T));
      const d = Math.hypot(p3[0] - q[0], p3[1] - q[1], p3[2] - q[2]);
      if (d < R * 1.2) add(l.colour, 1.1 * (1 - d / (R * 1.2)));
    }
    return col ? [col, k] : null;
  };
  for (const { f } of vis) {
    const p0 = project(f.o, cam);
    const p1 = project([f.o[0] + f.e1[0], f.o[1] + f.e1[1], f.o[2] + f.e1[2]], cam);
    const p2 = project([f.o[0] + f.e2[0], f.o[1] + f.e2[1], f.o[2] + f.e2[2]], cam);
    // screen = p0 + a*q1 + b*q2 (a, b in 0..1 across the face); solve per cell
    const q1 = [p1[0] - p0[0], p1[1] - p0[1]], q2 = [p2[0] - p0[0], p2[1] - p0[1]];
    const det = q1[0] * q2[1] - q1[1] * q2[0];
    if (Math.abs(det) < 1e-7) continue;
    const xs = [p0[0], p1[0], p2[0], p1[0] + q2[0]], ys = [p0[1], p1[1], p2[1], p1[1] + q2[1]];
    const c0 = Math.max(0, Math.floor(Math.min(...xs) / cwH) - 1), c1 = Math.min(cols - 1, Math.ceil(Math.max(...xs) / cwH) + 1);
    const r0 = Math.max(0, Math.floor(Math.min(...ys) / chH) - 1), r1 = Math.min(rows - 1, Math.ceil(Math.max(...ys) / chH) + 1);
    // three clear tones, like the classic drawings: the lit face bright, one mid, one dark
    const nl = dot(f.n, LIGHT), lit = nl > 0.6 ? 0.95 : nl > 0 ? 0.55 : 0.22;
    // edge width in face units, about half a cell
    const ea = (0.55 * Math.max(cwH, chH)) / Math.hypot(q1[0], q1[1]), eb = (0.55 * Math.max(cwH, chH)) / Math.hypot(q2[0], q2[1]);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const X = (c + 0.5) * cwH - p0[0], Y = (r + 0.5) * chH - p0[1];
        const a = (X * q2[1] - Y * q2[0]) / det, b = (q1[0] * Y - q1[1] * X) / det;
        if (a < 0 || a > 1 || b < 0 || b > 1) continue;
        const p3 = [f.o[0] + f.e1[0] * a + f.e2[0] * b, f.o[1] + f.e1[1] * a + f.e2[1] * b, f.o[2] + f.e1[2] * a + f.e2[2] * b];
        const g = glowAt(p3);
        const onA = a < ea || a > 1 - ea, onB = b < eb || b > 1 - eb;
        if (onA || onB) {
          const dir = onA ? q2 : q1; // an edge: the slope of the side it runs along
          let col = scale(PH.ink, (0.85 * obj.edge + 0.6 * flash) * fade);
          if (g) col = mixc(col, g[0], Math.min(1, g[1]));
          cells.putAt(c, r, slopeChar(dir[0] / cwH, dir[1] / chH), col);
        } else {
          const stripe = 0.9 + 0.1 * Math.sin((a + b) * 40); // faint scan stripes
          const v = lit * stripe;
          let col = scale(mixc(PH.dim, PH.ink, v), (0.35 + 0.55 * v) * fade);
          if (g) col = mixc(col, g[0], Math.min(1, g[1] * 0.9));
          cells.putAt(c, r, RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(v * 7)))], col);
        }
      }
  }
  // the waiting apps' lights on top: a bright point in brackets, easy to spot
  for (const l of lanterns) {
    const [x, y] = project(obj.loopAt(lanternU(obj, l, T)), cam);
    const c = Math.floor(x / cwH), r = Math.floor(y / chH);
    const col = scale(mixc(l.colour, [1, 1, 1], 0.3), fade);
    cells.putAt(c, r, "@", col);
    cells.putAt(c - 1, r, "(", scale(l.colour, 0.8 * fade));
    cells.putAt(c + 1, r, ")", scale(l.colour, 0.8 * fade));
  }
  watchSeen(lanterns, (l) => project(obj.loopAt(lanternU(obj, l, T)), cam), dims.H, 0.05);
}

crt();
startScene({
  label: "Glowing impossible objects, a Penrose triangle and Penrose stairs: the view rocks slowly, so each closes into an impossible shape and opens again.",
  fps: 20,
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
