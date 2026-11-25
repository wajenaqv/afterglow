// The circuit board wallpaper's board: parts placed at random (seeded), then
// traces found from pin to pin on two layers, as an autorouter would. Made
// once per screen size.
//
//   makeBoard(cols, rows, big) -> {
//     chips   [{ kind, x, y, w, h, n, label, ref, outs: [[trace, backwards]] }]
//     traces  [{ cells, ch, L: layer 0 (top) or 1, A, B: chips at its ends or null, edge, via }]
//     decor   [[x, y, character, light]]
//     edge    the traces that come in from the edge of the board
//   }

import { seeded } from "./common.js";

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]], DCH = "-/|\\-/|\\";
const PARTS = ["74HC595", "ATMEGA", "LM358", "NE555", "AG-01", "SN7400", "MAX232", "CD4017", "ESP32", "RP2040", "W25Q64", "TL072", "PCF8574", "DS1307", "LM317"];
const SMALL = ["-[===]-", "o-||-o", "(+)", "[R47]", "-|>|-", "o o o", "(o)", "-[10K]-"];

export function makeBoard(cols, rows, big) {
  const r = seeded(big ? 31 : 12), int = (a, b) => a + Math.floor((b - a + 1) * r()), N = cols * rows, wide = cols * 0.6 > rows;
  const area = Math.min(1.3, N / 34000), x0 = wide ? Math.floor(cols * 0.2) : 3; // how much fits, next to a 1600x900 screen
  const solid = new Uint8Array(N), keep = new Uint8Array(N); // the parts; the parts and their pins
  const occ = [new Uint8Array(N), new Uint8Array(N)], chips = [], decor = [], traces = [];
  const on = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  // ---- the parts ----
  function place(kind, w, h, X, Y) {
    const tries = X === undefined ? 300 : 1;
    for (let t = 0; t < tries; t++) {
      const x = X ?? int(x0, cols - w - 4), y = Y ?? int(4, rows - h - 5);
      if (x < 2 || y < 2 || x + w > cols - 2 || y + h > rows - 2) continue;
      let ok = true;
      for (let b = y - 4; b < y + h + 4 && ok; b++) for (let a = x - 7; a < x + w + 7 && ok; a++) if (on(a, b) && keep[b * cols + a]) ok = false;
      if (!ok) continue;
      for (let b = y; b < y + h; b++) for (let a = x; a < x + w; a++) keep[b * cols + a] = solid[b * cols + a] = 1;
      chips.push({ kind, x, y, w, h, n: chips.length, outs: [], label: PARTS[chips.length % PARTS.length], ref: "U" + (chips.length + 1) });
      return;
    }
  }
  const [pw, ph] = big ? [Math.min(76, cols - 10), Math.min(33, rows - 10)] : [46, 19];
  place("cpu", pw, ph, Math.round(wide ? cols * (big ? 0.58 : 0.64) : cols / 2) - (pw >> 1), Math.round((rows - ph) / 2));
  for (let k = 0; k < Math.round(2 * area); k++) place("ram", 28, 9);
  for (let k = 0; k < Math.max(8, Math.round(12 * area)); k++) place("ic", 2 * int(7, 10), int(5, 8));
  place("xtal", 13, 3);
  place("header", 25, 3);
  // pins: [x, y, the way out of the chip]
  for (const c of chips) {
    c.sides = [[], [], [], []]; // right, up, left, down
    for (let y = c.y + 1; y < c.y + c.h - 1; y++) c.sides[0].push([c.x + c.w, y, 0]), c.sides[2].push([c.x - 1, y, 4]);
    for (let x = c.x + 2; x < c.x + c.w - 2; x += 2) c.sides[1].push([x, c.y - 1, 2]), c.sides[3].push([x, c.y + c.h, 6]);
    for (const s of c.sides) for (const [x, y] of s) keep[y * cols + x] = 1;
  }
  // ---- the router: A* over (cell, direction), turning 45 degrees at a time, beside other traces rather than through them ----
  const G = new Float32Array(N * 8), seen = new Int32Array(N * 8), from = new Int32Array(N * 8), shut = new Int32Array(N * 8);
  let run = 0;
  function route(a, b, L) {
    const O = occ[L], goal = b[1] * cols + b[0], s0 = (a[1] * cols + a[0]) * 8 + a[2];
    if (O[s0 >> 3] || O[goal]) return null;
    run++;
    const heap = [], H = (x, y) => 1.15 * Math.hypot((x - b[0]) * 0.6, y - b[1]);
    const push = (f, s) => {
      let i = heap.push(null) - 1;
      for (let p; i && heap[(p = (i - 1) >> 1)][0] > f; i = p) heap[i] = heap[p];
      heap[i] = [f, s];
    };
    const pop = () => {
      const top = heap[0], e = heap.pop();
      if (!heap.length) return top;
      let i = 0;
      for (let k; (k = 2 * i + 1) < heap.length; i = k) {
        if (k + 1 < heap.length && heap[k + 1][0] < heap[k][0]) k++;
        if (heap[k][0] >= e[0]) break;
        heap[i] = heap[k];
      }
      heap[i] = e;
      return top;
    };
    G[s0] = 0;
    seen[s0] = run;
    from[s0] = -1;
    push(H(a[0], a[1]), s0);
    for (let n = 0; heap.length && n < 16000; n++) {
      const s = pop()[1];
      if (shut[s] === run) continue;
      shut[s] = run;
      const i = s >> 3, x = i % cols, y = (i / cols) | 0;
      if (i === goal) {
        const path = [];
        for (let q = s; q >= 0; q = from[q]) path.push([q >> 3, q & 7]);
        return path.reverse();
      }
      for (const t of [0, 1, 7]) {
        const e = ((s & 7) + t) % 8, [dx, dy] = DIRS[e], X = x + dx, Y = y + dy, j = Y * cols + X;
        if (!on(X, Y) || O[j] || solid[j] || (keep[j] && j !== goal)) continue;
        if (dx && dy && O[y * cols + X] && O[Y * cols + x]) continue; // not across another diagonal
        let c = Math.hypot(dx * 0.6, dy) + (t ? 0.9 : 0);
        if (dy && (O[j - 1] || O[j + 1])) c += 2.5; // "|" side by side is a smudge
        if (wide && X < cols * 0.16) c += 1.5;
        const q = j * 8 + e, g = G[s] + c;
        if (seen[q] === run && G[q] <= g) continue;
        seen[q] = run;
        G[q] = g;
        from[q] = s;
        push(g + H(X, Y), q);
      }
    }
    return null;
  }
  function lay(path, L, A, B, extra) {
    for (const [i] of path) occ[L][i] = 1;
    const t = { cells: path.map((p) => p[0]), ch: path.map((p) => DCH[p[1]]), L, A, B, ...extra };
    traces.push(t);
    A?.outs.push([t, false]);
    B?.outs.push([t, true]);
    return t;
  }
  // ---- buses: runs of neighbouring pins joined to another chip's, mostly a near one's ----
  const bus = (c, side, k) => {
    const s = c.sides[side].filter((p) => !p.used), at = int(0, Math.max(0, s.length - k)), got = s.slice(at, at + k);
    return got.length > 1 ? got : null;
  };
  const off = (c, e) => [(e.x + e.w / 2 - c.x - c.w / 2) * 0.6, e.y + e.h / 2 - c.y - c.h / 2];
  const near = (c, e) => Math.hypot(...off(c, e));
  const face = (c, e) => {
    const [dx, dy] = off(c, e);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 3 : 1;
  };
  let fails = 0;
  for (let k = 0; k < 150 && chips.length > 1 && fails < 60; k++) {
    const c = chips[k % 3 === 0 ? 0 : int(0, chips.length - 1)], others = chips.filter((e) => e !== c).sort((p, q) => near(c, p) - near(c, q)), e = others[Math.floor(r() * r() * others.length)];
    const n = int(3, c.kind === "cpu" ? 8 : 5), P = bus(c, face(c, e), n), Q = bus(e, face(e, c), n), L = r() < 0.7 ? 0 : 1;
    if (!P || !Q) continue;
    for (let j = 0; j < Math.min(P.length, Q.length); j++) {
      let on2 = L, path = route(P[j], Q[j], L);
      if (!path) path = route(P[j], Q[j], (on2 = 1 - L));
      if (!path) {
        fails++;
        continue;
      }
      P[j].used = Q[j].used = true;
      lay(path, on2, c, e);
    }
  }
  // ---- buses to the edge of the board: messages come in on these ----
  for (let k = 0; k < 18 && chips.length; k++) {
    const c = chips[k % 4 ? int(0, chips.length - 1) : 0], side = int(0, 3), L = r() < 0.7 ? 0 : 1;
    for (const p of bus(c, side, int(2, 4)) ?? []) {
      const b = side === 0 ? [cols - 1, p[1]] : side === 2 ? [0, p[1]] : [Math.min(cols - 2, Math.max(1, p[0] + (k % 2 ? 8 : -8))), side === 1 ? 0 : rows - 1];
      const path = route(p, b, L);
      if (!path) continue;
      p.used = true;
      const t = lay(path, L, null, c, { edge: true });
      t.cells.reverse();
      t.ch.reverse();
    }
  }
  // ---- some of the pins left over: short stubs that end at a via ----
  for (const c of chips)
    c.sides.forEach((s, d) => {
      for (const p of s) {
        if (p.used || r() < 0.55) continue;
        const [dx, dy] = DIRS[d * 2], n = int(3, 8), b = [p[0] + dx * n * 2 + int(-3, 3), p[1] + dy * n + (dy ? 0 : int(-2, 2))];
        if (!on(b[0] - 1, b[1] - 1) || !on(b[0] + 1, b[1] + 1) || keep[b[1] * cols + b[0]]) continue;
        const path = route(p, b, 0);
        if (path && path.length < 40) lay(path, 0, c, null, { via: true });
      }
    });
  // ---- small parts in the gaps, and a faint dotted ground ----
  const taken = (x, y) => !on(x, y) || keep[y * cols + x] || occ[0][y * cols + x];
  for (let k = 0, put = 0; k < 3000 && put < 45 * area; k++) {
    const s = SMALL[int(0, SMALL.length - 1)], x = int(x0, cols - 10), y = int(1, rows - 2);
    let ok = true;
    for (let b = y - 1; b <= y + 1 && ok; b++) for (let a = x - 1; a <= x + s.length && ok; a++) if (taken(a, b)) ok = false;
    if (!ok) continue;
    put++;
    [...s].forEach((g, j) => {
      keep[y * cols + x + j] = 1;
      if (g !== " ") decor.push([x + j, y, g, 0.2]);
    });
  }
  for (let y = 0; y < rows; y += 2) for (let x = 0; x < cols; x += 4) if (!taken(x, y) && !occ[1][y * cols + x]) decor.push([x, y, ".", 0.07]);
  return { chips, traces, decor, edge: traces.filter((t) => t.edge && t.cells.length > 15) };
}
