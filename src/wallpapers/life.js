// Phosphor life: Conway's Game of Life on a phosphor screen, slow, with dead
// cells fading out over a few seconds instead of vanishing, so every pattern
// leaves a glowing trail. When the board quietens down, a methuselah (a tiny
// pattern that grows for a long time) is dropped in somewhere so it never dies.
//
// Reactions: a new message launches a glider in the app's colour from the edge
// of the screen; cells born from it take its colour, so the colour spreads into
// whatever it hits and fades with the cells. Every app with something waiting
// keeps a pulsar (a big oscillator) beating in its colour; rest the cursor on
// it to mark it seen, and it is set free into the board. A flash lights every
// cell.
//
// Each life cell is two characters wide (characters are taller than wide, so
// the cells come out about square). Simulated on the CPU (life needs the last
// generation), drawn through cells.js. Options: ?tint=green|amber|ice|white ?crt=0

import { seeded, STILL, onReaction } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, watchSeen } from "./techy.js";

const STEPS = 5; // generations per second
const FADE = 2.2; // seconds a dead cell takes to fade (phosphor)
const cells = cellBuffer("[]+:.'*#");

let dims = null, N = 0, M = 0, cwH = 0, chH = 0; // N columns, M rows of life cells
let alive, next, glow, cr, cg, cb; // per life cell
const rand = seeded(1729);
const idx = (x, y) => ((y + M) % M) * N + ((x + N) % N);

function layout(d) {
  dims = d;
  cwH = d.cw / d.H;
  chH = d.ch / d.H;
  N = Math.floor(d.cols / 2);
  M = d.rows;
  cells.resize(d.cols, d.rows);
  alive = new Uint8Array(N * M);
  next = new Uint8Array(N * M);
  glow = new Float32Array(N * M);
  cr = new Float32Array(N * M).fill(PH.ink[0]);
  cg = new Float32Array(N * M).fill(PH.ink[1]);
  cb = new Float32Array(N * M).fill(PH.ink[2]);
  // a few patches of random soup to start from
  for (let k = 0; k < 5; k++) soup(Math.floor(rand() * N), Math.floor(rand() * M), 14 + Math.floor(rand() * 10));
  if (STILL || reduced) for (let i = 0; i < 160; i++) step(); // a still: some life already happened
}
function soup(x0, y0, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (rand() < 0.35) set(x0 + x, y0 + y, PH.ink);
}
function set(x, y, col) {
  const i = idx(x, y);
  alive[i] = 1;
  glow[i] = 1;
  cr[i] = col[0];
  cg[i] = col[1];
  cb[i] = col[2];
}

// patterns, as rows of "#" and "."
const pat = (rows) => rows.map((r) => [...r].map((ch) => ch === "#"));
const METHUSELAHS = [
  pat([".##", "##.", ".#."]), // R-pentomino
  pat([".#.....", "...#...", "##..###"]), // acorn
  pat(["......#.", "##......", ".#...###"]), // diehard
];
const GLIDER = pat([".#.", "..#", "###"]); // heads down and right
const PULSAR = pat(["..###...###..", ".............", "#....#.#....#", "#....#.#....#", "#....#.#....#", "..###...###..", ".............", "..###...###..", "#....#.#....#", "#....#.#....#", "#....#.#....#", ".............", "..###...###.."]);
function stamp(p, x0, y0, col, flipX = false, flipY = false) {
  const h = p.length, w = p[0].length;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p[flipY ? h - 1 - y : y][flipX ? w - 1 - x : x]) set(x0 + x, y0 + y, col);
}

// ---- waiting apps: a pulsar each, kept beating in a cleared square ----
let lanterns = []; // { source, colour, x, y (pulsar's top-left), phase }
const PS = 13, PAD = 2;
function lanternSpot(i) {
  // in a row across the upper middle of the screen, clear of the left fifth
  const n = Math.max(1, lanterns.length);
  const x = Math.floor(N * (0.3 + 0.6 * ((i + 0.5) / Math.max(n, 3))));
  return [x - (PS >> 1), Math.floor(M * 0.28) - (PS >> 1)];
}
function keepPulsars() {
  for (const l of lanterns) {
    // clear its square, then lay the pulsar down in its current phase
    for (let y = -PAD; y < PS + PAD; y++) for (let x = -PAD; x < PS + PAD; x++) alive[idx(l.x + x, l.y + y)] = 0;
    stampPhase(l);
  }
}
// the pulsar's three phases, found by running it once on a small board
const PHASES = (() => {
  const S = PS + 6;
  let g = new Uint8Array(S * S);
  PULSAR.forEach((row, y) => row.forEach((v, x) => v && (g[(y + 3) * S + x + 3] = 1)));
  const out = [];
  for (let k = 0; k < 3; k++) {
    out.push(g);
    const n = new Uint8Array(S * S);
    for (let y = 1; y < S - 1; y++)
      for (let x = 1; x < S - 1; x++) {
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c += g[(y + dy) * S + x + dx];
        n[y * S + x] = c === 3 || (c === 2 && g[y * S + x]) ? 1 : 0;
      }
    g = n;
  }
  return out.map((g) => ({ g, S }));
})();
function stampPhase(l) {
  const { g, S } = PHASES[l.phase % 3];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (g[y * S + x]) set(l.x + x - 3, l.y + y - 3, l.colour);
}

// ---- one generation ----
let gen = 0;
function step() {
  for (let y = 0; y < M; y++) {
    const ym = ((y - 1 + M) % M) * N, y0 = y * N, yp = ((y + 1) % M) * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N;
      const c = alive[ym + xm] + alive[ym + x] + alive[ym + xp] + alive[y0 + xm] + alive[y0 + xp] + alive[yp + xm] + alive[yp + x] + alive[yp + xp];
      const i = y0 + x;
      const live = c === 3 || (c === 2 && alive[i]);
      next[i] = live ? 1 : 0;
      if (live && !alive[i]) {
        // born: takes the average colour of its live neighbours
        let r = 0, g = 0, b = 0;
        for (const j of [ym + xm, ym + x, ym + xp, y0 + xm, y0 + xp, yp + xm, yp + x, yp + xp])
          if (alive[j]) (r += cr[j]), (g += cg[j]), (b += cb[j]);
        cr[i] = r / c;
        cg[i] = g / c;
        cb[i] = b / c;
      }
    }
  }
  [alive, next] = [next, alive];
  for (const l of lanterns) l.phase++;
  keepPulsars();
  gen++;
  // never let it die out: when it gets quiet, drop a methuselah somewhere
  if (gen % 30 === 0) {
    let pop = 0;
    for (let i = 0; i < alive.length; i++) pop += alive[i];
    if (pop < N * M * 0.035) stamp(METHUSELAHS[Math.floor(rand() * METHUSELAHS.length)], Math.floor(rand() * N), Math.floor(rand() * M), PH.ink);
  }
  // colour bleeds back to the phosphor's own as cells live on
  for (let i = 0; i < alive.length; i++)
    if (alive[i]) {
      cr[i] += (PH.ink[0] - cr[i]) * 0.02;
      cg[i] += (PH.ink[1] - cg[i]) * 0.02;
      cb[i] += (PH.ink[2] - cb[i]) * 0.02;
    }
}

// ---- reactions ----
let flashAt = -1e9, nowT = 0;
onReaction((r) => {
  if (!dims) return;
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    // a glider from a corner of the screen, heading in
    const col = r.colour.map((v) => v / 255);
    const fx = rand() < 0.5, fy = rand() < 0.5;
    const x = fx ? N - 6 - Math.floor(rand() * N * 0.3) : Math.floor(N * 0.25 + rand() * N * 0.3);
    const y = fy ? M - 6 : 2;
    stamp(GLIDER, x, y, col, fx, fy);
    stamp(GLIDER, x + (fx ? -5 : 5), y + (fy ? -1 : 1), col, fx, fy); // a pair, so it reads
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") {
    const items = (Array.isArray(r.items) ? r.items : []).filter((l) => Array.isArray(l.colour)).slice(0, 5);
    // a pulsar whose app has been seen is set free: no longer kept, it meets the board
    lanterns = items.map((it, i) => {
      const had = lanterns.find((l) => l.source === it.source);
      return had ?? { source: it.source, colour: it.colour.map((v) => v / 255), phase: 0 };
    });
    lanterns.forEach((l, i) => ([l.x, l.y] = lanternSpot(i)));
    keepPulsars();
  }
});

let simT = null;
function frame(t) {
  nowT = t;
  if (!dims) return;
  const dt = simT == null ? 0 : Math.min(0.5, t - simT);
  if (simT == null) simT = t;
  if (!STILL && !reduced) {
    // whole generations at a steady pace, however the frames fall
    const target = Math.floor(t * STEPS);
    let todo = Math.min(4, target - Math.floor(simT * STEPS));
    while (todo-- > 0) step();
    simT = t;
  }
  const flash = Math.max(0, 1 - (t - flashAt) / 0.8);
  const fade = Math.exp(-dt / FADE);
  cells.clear();
  for (let y = 0; y < M; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (alive[i]) glow[i] = 1;
      else glow[i] *= fade;
      const v = Math.min(1, glow[i] + (glow[i] > 0.02 ? 0.5 * flash : 0));
      if (v < 0.06) continue;
      let g;
      if (alive[i]) g = "[]";
      else if (v > 0.55) g = "++";
      else if (v > 0.28) g = "::";
      else g = "..";
      const k = alive[i] ? 1 : 0.15 + 0.7 * v;
      const col = [cr[i] * k, cg[i] * k, cb[i] * k];
      cells.putAt(2 * x, y, g[0], col);
      cells.putAt(2 * x + 1, y, g[1], col);
    }
  // a pulsar is about 13 cells across: rest the cursor anywhere on it
  watchSeen(lanterns, (l) => [(2 * (l.x + PS / 2)) * cwH, (l.y + PS / 2) * chH], dims.H, 0.08);
}

crt();
startScene({
  label: "Conway's Game of Life on a glowing phosphor screen: cells live and die, and the dead fade slowly, leaving trails of light.",
  fps: 20,
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
