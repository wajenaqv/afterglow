// Impossible: an impossible shape, the one the user picks, as solid glowing
// faces with dark grooves between them, and a light that runs along its pieces
// for ever: down a beam, round the corner, under the next piece and out again.
//
// Polygons (Penrose's triangle and its relatives): identical pieces, each the
// outer strip of one side joined to the inner strip of the next, tucked under
// its neighbour all the way round. Under piece i + 1 the end of piece i meets
// the start of piece i + 2, so with an odd number of pieces the light's path is
// one loop through all of them, two turns round; with an even number, two
// loops. Cube: a frame whose back post passes in front. Cubes (after
// Reutersvard): a triangle of cubes, each in front of the next. Stairs (after
// Penrose): four flights that climb all the way round and arrive where they
// began, seen along the line that brings the end onto the start.
// (Real 3D beams that closed from one viewpoint and swung open were tried
// first: most of them looked skewed, and the swing took them apart.)
//
// Reactions: a message is a light in the app's colour racing round, fading
// over the afterglow. Every app with something waiting is a light in its
// colour going round for ever: rest the cursor on it to mark it seen. A flash
// lights the whole shape.
//
// The shape is drawn once per size as a smooth picture and read per cell; each
// frame only moves the lights. One character a face, the colour alone carries
// the light: a ramp of characters rippled. Drawn through cells.js.
// Options: ?object=triangle|square|pentagon|hexagon|cube|reutersvard|stairs
// ?tint=green|amber|ice|white ?crt=0

import { params, HOVER, STILL, STILL_AT } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, watchSeen } from "./techy.js";
import { onCPU, fineFont } from "./strands.js";
import { trackApps, now } from "./waiting.js";

const TAU = Math.PI * 2;
const GLYPHS = "#X*+:";
const cells = cellBuffer(GLYPHS);
const apps = trackApps();
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

// ---- the shapes: polygons painted in order ----
// { pts, tone 0..1, grad: [dark end, bright end], path: [[loop, order, x0, y0, x1, y1]] }
// path: the stretches of a loop this polygon carries; `order` sorts a loop's stretches

// Side i of the polygon has parallel lines k = 0 (inner) to 2 (outer)
function penrose(n, w, turn, tones) {
  const apo = 0.42 * Math.cos(Math.PI / n) * (n === 3 ? 1.12 : 1);
  const line = (i, k) => {
    const a = turn + Math.PI / n + (TAU * i) / n; // the way side i faces
    return [Math.cos(a), Math.sin(a), apo - (2 - k) * w];
  };
  const X = (i, k, j, m) => {
    const [a, b, c] = line(i, k), [d, e, f] = line(j, m), D = a * e - b * d;
    return [(c * e - b * f) / D, (a * f - c * d) / D];
  };
  return Array.from({ length: n }, (_, i) => {
    const loop = n % 2 ? 0 : i % 2, order = n % 2 ? (i % 2 ? (i + n) / 2 : i / 2) : Math.floor(i / 2);
    const a = X(i, 1.5, i - 1, 1), b = X(i, 1.5, i + 1, 0.5), c = X(i + 1, 0.5, i + 2, 0);
    return {
      pts: [X(i, 2, i - 1, 1), X(i, 2, i + 1, 2), X(i + 1, 2, i, 1), X(i, 1, i + 1, 1), X(i + 1, 1, i + 2, 0), X(i + 2, 0, i + 1, 0), X(i + 1, 0, i, 1), X(i, 1, i - 1, 1)],
      tone: tones[i % tones.length],
      grad: [X(i, 2, i - 1, 1), X(i, 2, i + 1, 2)], // it comes out of the dark from under the one before
      path: [[loop, order * 2, ...a, ...b], [loop, order * 2 + 1, ...b, ...c]],
    };
  });
}

const iso = ([x, y, z]) => [(x - y) * 0.866, (x + y) * 0.5 - z];
// the three faces of a box that show, seen through `see`; the sides fade downwards
function boxFaces([a, b, c], [d, e, f], see, path) {
  return [
    { pts: [[a, b, f], [d, b, f], [d, e, f], [a, e, f]].map(see), tone: 0.95, path },
    { pts: [[a, e, c], [d, e, c], [d, e, f], [a, e, f]].map(see), tone: 0.64, grad: [see([a, e, c]), see([a, e, f])], path },
    { pts: [[d, b, c], [d, e, c], [d, e, f], [d, b, f]].map(see), tone: 0.45, grad: [see([d, b, c]), see([d, b, f])], path },
  ];
}

function cube() {
  const w = 0.17, L = 1, beams = [], blocks = [];
  for (const y of [0, L]) for (const z of [0, L]) beams.push([[0, y, z], [L + w, y + w, z + w]]);
  for (const x of [0, L]) for (const z of [0, L]) beams.push([[x, 0, z], [x + w, L + w, z + w]]);
  for (const x of [0, L]) for (const y of [0, L]) beams.push([[x, y, 0], [x + w, y + w, L + w]]);
  // in three blocks each, so sorting them far to near is exact
  for (const [m, M] of beams) {
    const ax = [0, 1, 2].find((k) => M[k] - m[k] > w * 1.5), cuts = [m[ax], m[ax] + w, M[ax] - w, M[ax]];
    for (let i = 0; i < 3; i++) {
      const a = m.slice(), b = M.slice();
      a[ax] = cuts[i];
      b[ax] = cuts[i + 1];
      blocks.push({ a, b, m, M, d: a[0] + a[1] + a[2] + b[0] + b[1] + b[2] });
    }
  }
  blocks.sort((p, q) => p.d - q.d);
  // the light walks round eight of the edges, the back post among them
  const V = [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 0, 0]].map((v) => v.map((c) => c * L + w / 2));
  const walk = V.map((v, i) => [0, i, ...iso(v), ...iso(V[(i + 1) % 8])]), mids = V.map((v, i) => v.map((c, k) => (c + V[(i + 1) % 8][k]) / 2));
  const carries = (m, M) => walk.filter((_, i) => mids[i].every((c, k) => c >= m[k] - 0.01 && c <= M[k] + 0.01));
  const out = blocks.flatMap((p) => boxFaces(p.a, p.b, iso, carries(p.m, p.M)));
  // the back post, painted again in front of everything in its way
  const post = boxFaces([0, 0, w], [w, w, L], iso, carries([0, 0, 0], [w, w, L + w])).slice(1);
  out.push(...post.map((q, i) => ({ ...q, tone: i ? 0.66 : 0.95 })));
  return out;
}

function reutersvard() {
  const n = 4, s = 1.62, pos = [];
  for (let i = 0; i < n - 1; i++) pos.push([i * s, 0, 0]);
  for (let i = 0; i < n - 1; i++) pos.push([(n - 1) * s, i * s, 0]);
  for (let i = 0; i < n - 1; i++) pos.push([(n - 1) * s, (n - 1) * s, i * s]);
  const N = pos.length, top = (p) => iso([p[0] + 0.5, p[1] + 0.5, p[2] + 0.8]);
  const cubes = pos.map((p, i) => ({ p, i, d: p[0] + p[1] + p[2] })).sort((a, b) => a.d - b.d).map(({ p, i }) => {
    const here = top(p), before = i ? mid(top(pos[i - 1]), here) : here, after = i < N - 1 ? mid(here, top(pos[i + 1])) : here;
    return boxFaces(p, p.map((v) => v + 1), iso, [[0, i * 2, ...before, ...here], [0, i * 2 + 1, ...here, ...after]]);
  });
  // where the ring closes, the near end is painted first: the far end covers it
  const last = cubes.pop(), first = cubes.shift(), tail = cubes.splice(-2);
  return [...tail.flat(), ...last, ...first, ...cubes.flat()];
}

function stairs() {
  const w = 0.22, W = 0.26, h = 0.1, D = 0.3, boxes = []; // tread, stair width, rise, depth
  let x = 0, y = 0;
  const add = (x0, y0, x1, y1) => {
    const top = (boxes.length + 1) * h;
    boxes.push({ a: [Math.min(x0, x1), Math.min(y0, y1), top - D], b: [Math.max(x0, x1), Math.max(y0, y1), top] });
  };
  for (const [dx, dy, n] of [[1, 0, 4], [0, 1, 4], [-1, 0, 1], [0, -1, 1]]) {
    add(x, y, x + W, y + W); // the landing
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
  // a lap ends shifted by m: seen along m, the end lands on the start
  const N = boxes.length, m = [x, y, N * h], l = Math.hypot(...m), d = m.map((v) => v / l), rl = Math.hypot(d[0], d[1]), r = [-d[1] / rl, d[0] / rl, 0];
  const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
  const see = (p) => [dot(p, r), -dot(p, u)];
  const tops = boxes.map(({ a, b }) => see([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, b[2]]));
  boxes.forEach((p, i) => (p.path = [[0, i * 2, ...mid(tops[(i + N - 1) % N], tops[i]), ...tops[i]], [0, i * 2 + 1, ...tops[i], ...mid(tops[i], tops[(i + 1) % N])]]));
  return boxes.sort((p, q) => dot(p.a, d) + dot(p.b, d) - dot(q.a, d) - dot(q.b, d)).flatMap((p) => boxFaces(p.a, p.b, see, p.path));
}

const UP = -Math.PI / 2;
// the polygons, how tall they stand (screen heights), the grooves (rows)
const SHAPES = {
  triangle: [() => penrose(3, 0.068, UP, [0.95, 0.5, 0.72]), 0.76, 2],
  square: [() => penrose(4, 0.095, -Math.PI / 4, [0.95, 0.68, 0.95, 0.68]), 0.72, 2],
  pentagon: [() => penrose(5, 0.095, UP, [0.95, 0.5, 0.78, 0.48, 0.65]), 0.78, 2],
  hexagon: [() => penrose(6, 0.088, UP, [0.95, 0.5, 0.72, 0.95, 0.5, 0.72]), 0.78, 2],
  cube: [cube, 0.74, 0.7],
  reutersvard: [reutersvard, 0.72, 1],
  stairs: [stairs, 0.74, 1],
};
const [make, TALL, GROOVE] = SHAPES[params.get("object")] ?? SHAPES.triangle;

// centred on the origin, 1 tall
const POLYS = (() => {
  const polys = make(), xs = polys.flatMap((p) => p.pts.map((q) => q[0])), ys = polys.flatMap((p) => p.pts.map((q) => q[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), s = 1 / Math.max(y1 - y0, (x1 - x0) * 0.8);
  const move = ([x, y]) => [(x - (x0 + x1) / 2) * s, (y - (y0 + y1) / 2) * s];
  const out = polys.map((p) => ({ ...p, pts: p.pts.map(move), grad: p.grad?.map(move), path: p.path.map(([l, o, a, b, c, d]) => [l, o, ...move([a, b]), ...move([c, d])]) }));
  out.wide = (x1 - x0) * s;
  return out;
})();

// ---- the loops the light runs round ----
const LOOPS = (() => {
  const seen = new Map();
  for (const p of POLYS) for (const q of p.path) seen.set(q[0] + ":" + q[1], q);
  const loops = [];
  for (const q of [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const l = (loops[q[0]] ??= { len: 0, segs: [] }), last = l.segs[l.segs.length - 1];
    if (last) l.len += Math.hypot(q[2] - last.q[4], q[3] - last.q[5]); // out of sight, under a piece
    const d = Math.hypot(q[4] - q[2], q[5] - q[3]);
    l.segs.push({ q, at: l.len, d });
    l.len += d;
  }
  for (const l of loops) {
    const a = l.segs[l.segs.length - 1].q, b = l.segs[0].q;
    l.len += Math.hypot(b[2] - a[4], b[3] - a[5]);
    l.at = new Map(l.segs.map((e) => [e.q[1], e]));
  }
  return loops;
})();
// how far along its loop a point of a polygon is: [loop, distance], or null
function along(p, x, y) {
  let best = 9, out = null;
  for (const [l, o, a, b, c, d] of p.path) {
    const dx = c - a, dy = d - b, n = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((x - a) * dx + (y - b) * dy) / n));
    const far = Math.hypot(x - a - dx * u, y - b - dy * u);
    if (far < best) {
      best = far;
      const e = LOOPS[l].at.get(o);
      out = [l, e.at + e.d * u];
    }
  }
  return out;
}
// where on the shape the light is at distance s, null while it's under a piece
function pointOn(l, s) {
  for (const e of l.segs) {
    const u = (s - e.at) / (e.d || 1e-9);
    if (u >= 0 && u <= 1) return [e.q[2] + (e.q[4] - e.q[2]) * u, e.q[3] + (e.q[5] - e.q[3]) * u];
  }
  return null;
}

// ---- the shape per cell, once per size ----
let dims = null, A = 1.78, SIZE = 0.74;
let N = 0, CELL = null, GLYPH = null, FACE = null, LOOP = null, DIST = null, PX = null, PY = null; // the cells it covers
const inside = (pts, x, y) => {
  let on = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [a, b] = pts[i], [c, d] = pts[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) on = !on;
  }
  return on;
};
function layout(d) {
  dims = d;
  A = d.A;
  const { cols, rows, cw, ch, H } = d, cwH = cw / H, chH = ch / H;
  cells.resize(cols, rows);
  SIZE = Math.min(TALL, (A * 0.86) / POLYS.wide);
  // in cells
  const X = (p) => (p[0] * SIZE + A / 2) / cwH, Y = (p) => (p[1] * SIZE + 0.5) / chH;
  // a smooth picture of the faces, several pixels a cell
  const sx = 3, sy = 5, c = document.createElement("canvas");
  c.width = cols * sx;
  c.height = rows * sy;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000"; // light, not a colour: the red channel is read back
  g.fillRect(0, 0, c.width, c.height);
  g.lineJoin = "round";
  const own = new Int16Array(cols * rows).fill(-1);
  POLYS.forEach((p, n) => {
    const path = new Path2D(), P = p.pts.map((q) => [X(q), Y(q)]), t = Math.round(p.tone * 255);
    P.forEach(([x, y], i) => (i ? path.lineTo(x * sx, y * sy) : path.moveTo(x * sx, y * sy)));
    path.closePath();
    g.fillStyle = `rgb(${t},0,0)`;
    if (p.grad) {
      const l = g.createLinearGradient(X(p.grad[0]) * sx, Y(p.grad[0]) * sy, X(p.grad[1]) * sx, Y(p.grad[1]) * sy);
      for (const [at, k] of [[0, 0.35], [0.5, 0.8], [1, 1]]) l.addColorStop(at, `rgb(${Math.round(t * k)},0,0)`);
      g.fillStyle = l;
    }
    g.fill(path);
    g.strokeStyle = "#000"; // the groove
    g.lineWidth = GROOVE * sy;
    g.stroke(path);
    const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
    for (let r = Math.max(0, Math.floor(Math.min(...ys))); r <= Math.min(rows - 1, Math.ceil(Math.max(...ys))); r++)
      for (let q = Math.max(0, Math.floor(Math.min(...xs))); q <= Math.min(cols - 1, Math.ceil(Math.max(...xs))); q++) if (inside(P, q + 0.5, r + 0.5)) own[r * cols + q] = n;
  });
  const px = g.getImageData(0, 0, c.width, c.height).data, list = [];
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q;
      if (own[i] < 0) continue;
      let s = 0;
      for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) s += px[((r * sy + y) * c.width + q * sx + x) * 4];
      s /= 255 * sx * sy;
      if (s < 0.03) continue;
      const x = ((q + 0.5) * cwH - A / 2) / SIZE, y = ((r + 0.5) * chH - 0.5) / SIZE, p = POLYS[own[i]], a = along(p, x, y);
      // one character a face, by its tone
      const gl = p.tone > 0.82 ? 0 : p.tone > 0.62 ? 1 : p.tone > 0.5 ? 2 : p.tone > 0.38 ? 3 : 4;
      list.push([i, gl, s, a ? a[0] : -1, a ? a[1] : 0, x, y]);
    }
  N = list.length;
  const col = (k, T) => T.from(list, (e) => e[k]);
  CELL = col(0, Int32Array);
  GLYPH = col(1, Uint8Array);
  FACE = col(2, Float32Array);
  LOOP = col(3, Int8Array);
  DIST = col(4, Float32Array);
  PX = col(5, Float32Array);
  PY = col(6, Float32Array);
}

// ---- the lights ----
const SPEED = 0.26; // shape heights a second
const BOOST = [1, 1, 1.25, 1.45, 1.9]; // sparser characters need more light
let heads = []; // { loop, at, len, x, y, show, k, tail, colour or null }
const shown = new Map(); // how far each light's halo is in (it eases out as the light goes under)
function setHeads(T) {
  heads = [];
  const add = (key, loop, at, k, tail, colour) => {
    const l = LOOPS[loop], s = ((at % l.len) + l.len) % l.len, p = pointOn(l, s), old = shown.get(key) ?? 1, halo = old + ((p ? 1 : 0) - old) * 0.25;
    shown.set(key, halo);
    heads.push({ key, loop, at: s, len: l.len, x: p ? p[0] : 9, y: p ? p[1] : 9, halo: p ? halo : 0, k, tail, colour });
  };
  LOOPS.forEach((l, i) => add("own" + i, i, T * SPEED + (i * l.len) / 2, 1, 0.65, null));
  apps.waiting.forEach((a) => add("w" + a.source, a.i % LOOPS.length, whereabouts(a, T), apps.lit(a), 0.32, a.colour));
  apps.messages.forEach((m) => add("m" + m.t0, m.i % LOOPS.length, m.i * 0.618 + (now() - m.t0) * SPEED * 3.5, 1.2 * apps.glow(m), 0.55, m.colour));
  if (shown.size > 40) for (const k of shown.keys()) if (!heads.some((h) => h.key === k)) shown.delete(k);
}
// a waiting app's light: spread round its loop, all going on at the same pace as the main one
const whereabouts = (a, T) => T * SPEED + LOOPS[a.i % LOOPS.length].len * (0.3 + 0.618 * a.i);

function frame(t) {
  if (!dims) return;
  const T = STILL ? STILL_AT : reduced ? 8 : t;
  apps.tidy();
  setHeads(T);
  const flash = apps.flash(), ink = PH.ink;
  cells.clear();
  for (let n = 0; n < N; n++) {
    const fa = FACE[n], loop = LOOP[n], dist = DIST[n], x = PX[n], y = PY[n];
    // The lights run along the pieces: a bright head, and behind it the phosphor
    // letting go, quickly at first and then slowly. They light what they pass
    let glow = 0, spark = 0, r = ink[0], g = ink[1], b = ink[2];
    for (let q = 0; q < heads.length; q++) {
      const h = heads[q];
      let v = 0, s = 0;
      if (loop === h.loop) {
        let d = h.at - dist;
        if (d < 0) d += h.len;
        const ahead = h.len - d;
        if (d < h.tail * 5) {
          v = 0.5 * Math.exp(-d / 0.09) + Math.exp(-d / h.tail);
          if (d < 0.2) s = Math.exp(-d / 0.035);
        }
        if (ahead < 0.06) {
          const e = Math.exp(-((ahead / 0.02) ** 2));
          v += 0.9 * e;
          s += Math.exp(-((ahead / 0.015) ** 2));
        }
      }
      const d2 = (x - h.x) ** 2 + (y - h.y) ** 2;
      if (d2 < 0.1) v += 0.4 * h.halo * Math.exp(-d2 / 0.02);
      v *= h.k;
      if (v < 0.01) continue;
      glow += v;
      if (h.colour) {
        const m = Math.min(1, v * 1.3);
        r += (h.colour[0] - r) * m;
        g += (h.colour[1] - g) * m;
        b += (h.colour[2] - b) * m;
        spark += s * h.k * 0.45;
      } else spark += s;
    }
    const k = (0.58 + 0.5 * flash) * fa + glow * (0.14 + 0.62 * fa), lift = Math.min(1, k * BOOST[GLYPH[n]]);
    if (lift < 0.02) continue;
    const hot = Math.min(0.85, 0.25 * Math.max(0, k - 0.7) + 0.6 * spark);
    cells.putSlot(CELL[n], GLYPH[n] + 1, (r + (1 - r) * hot) * lift, (g + (1 - g) * hot) * lift, (b + (1 - b) * hot) * lift);
  }
  if (HOVER)
    watchSeen(
      apps.waiting,
      (a) => {
        const h = heads.find((e) => e.key === "w" + a.source);
        return h && h.x < 9 ? [A / 2 + h.x * SIZE, 0.5 + h.y * SIZE] : [-9, -9];
      },
      dims.H,
      0.07,
    );
}

crt();
startScene({
  label: "A glowing impossible shape, a light running along its pieces, under and over, for ever.",
  fps: () => (onCPU() ? 15 : 20),
  layout,
  frame,
  fontPx: fineFont,
  sample: cells.sample,
  gpu: cells.gpu,
});
