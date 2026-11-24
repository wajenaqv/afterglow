// Circuit board: a dark PCB in phosphor green. Chips with pins and part
// numbers; buses of parallel traces run out from their pins, jog at 45 degrees
// and end at vias, at other chips or at the edge of the board. Packets of light
// run along the traces now and then, and the copper they pass keeps glowing
// and fades behind them (the afterglow).
//
// Reactions: a new message is a packet in the app's colour coming in from the
// edge of the board to a chip, which lights up and sends the signal on along
// two more traces; every app with something waiting takes a chip, which shows
// the app's name and a blinking LED in its colour until you rest the cursor on
// it; a flash surges through all the copper.
//
// The board is generated once per screen size (seeded, so it is the same each
// time); a trace cell's glow comes from how long ago a packet passed it, so no
// memory is needed. Drawn through cells.js. Options: ?tint=green|amber|ice|white ?crt=0

import { seeded, hash, STILL, STILL_AT, onReaction } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, mixc, scale, watchSeen } from "./techy.js";

const cells = cellBuffer("-|/\\o+*=.:[]()#_'" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
// the eight directions, and the character a trace running that way is drawn with
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
const DCH = ["-", "/", "|", "\\", "-", "/", "|", "\\"];
const PARTS = ["74HC595", "ATMEGA", "LM358", "NE555", "AG-01", "SN7400", "MAX232", "CD4017", "ESP32", "RP2040", "W25Q64", "TL072"];

let dims = null, cols = 0, rows = 0, cwH = 0, chH = 0;
let STATIC = []; // [c, r, glyph, kind] kind: 0 copper, 1 chip, 2 label, 3 via, 4 decor
let CHIPS = []; // { x, y, w, h, label, ref }
let TRACES = []; // { cells: [i...], edge: bool (its far end is at the board edge), chip }
const EDGE_TRACES = [];

function generate() {
  const r = seeded(4242);
  const between = (a, b) => a + Math.floor((b - a + 1) * r());
  const occ = new Uint8Array(cols * rows); // 0 free, 1 chip, 2 trace
  STATIC = [];
  CHIPS = [];
  TRACES = [];
  EDGE_TRACES.length = 0;
  const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && occ[y * cols + x] === 0;
  // ---- chips: rectangles, kept apart, none in the left fifth ----
  for (let tries = 0; tries < 400 && CHIPS.length < 9; tries++) {
    const w = 2 * between(5, 9), h = between(4, 8);
    const x = between(Math.floor(cols * 0.24), cols - w - 4), y = between(3, rows - h - 3);
    let ok = true;
    for (let yy = y - 4; yy < y + h + 4 && ok; yy++) for (let xx = x - 6; xx < x + w + 6 && ok; xx++) if (!free(xx, yy) && xx >= 0 && yy >= 0 && xx < cols && yy < rows) ok = false;
    if (!ok) continue;
    const chip = { x, y, w, h, label: PARTS[between(0, PARTS.length - 1)], ref: "U" + (CHIPS.length + 1) };
    CHIPS.push(chip);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) occ[yy * cols + xx] = 1;
  }
  // ---- buses: parallel traces out of a run of pins, with 45 degree jogs ----
  const route = (starts, dir, chip) => {
    // a plan along the main direction, with jogs off it and back
    const main = dir, plan = [[main, between(2, 6)]];
    for (let s = 0; s < 4; s++) {
      const side = r() < 0.5 ? 1 : 7; // jog left or right of the main direction
      if (r() < 0.6) plan.push([(main + side) % 8, between(2, 6)]);
      plan.push([main, between(4, 22)]);
    }
    const paths = starts.map(() => []);
    let stop = Infinity, edge = false;
    starts.forEach(([x0, y0], j) => {
      let x = x0, y = y0, n = 0;
      for (const [d, len] of plan)
        for (let k = 0; k < len; k++) {
          x += DIRS[d][0];
          y += DIRS[d][1];
          if (x < 0 || y < 0 || x >= cols || y >= rows) {
            edge = true;
            stop = Math.min(stop, n);
            return;
          }
          if (!free(x, y)) return void (stop = Math.min(stop, n));
          paths[j].push([x, y, DCH[d]]);
          n++;
        }
      stop = Math.min(stop, n);
    });
    if (stop < 3) return;
    // all the traces of a bus end together: at a via, at a chip, or at the edge
    paths.forEach((p) => {
      const cut = p.slice(0, stop);
      for (const [x, y, ch] of cut) {
        occ[y * cols + x] = 2;
        STATIC.push([x, y, ch, 0]);
      }
      const [ex, ey] = cut[cut.length - 1];
      const t = { cells: cut.map(([x, y]) => y * cols + x), edge: edge && stop === p.length, chip };
      if (!t.edge) STATIC.push([ex, ey, "o", 3]);
      TRACES.push(t);
      if (t.edge) EDGE_TRACES.push(t);
    });
  };
  for (const chip of CHIPS) {
    const { x, y, w, h } = chip;
    // the chip: outline, pins on the long sides, part number and reference
    for (let xx = x; xx < x + w; xx++) STATIC.push([xx, y, "-", 1], [xx, y + h - 1, "-", 1]);
    for (let yy = y + 1; yy < y + h - 1; yy++) STATIC.push([x, yy, "|", 1], [x + w - 1, yy, "|", 1]);
    for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) STATIC.push([cx, cy, "+", 1]);
    STATIC.push([x + 1, y + 1, "o", 1]); // pin 1
    chip.labelAt = [x + Math.max(1, (w - chip.label.length) >> 1), y + (h >> 1)];
    [...chip.ref].forEach((ch, k) => STATIC.push([x + k, y - 1, ch, 2]));
    const pinsTop = [], pinsBot = [], pinsL = [], pinsR = [];
    for (let xx = x + 2; xx < x + w - 2; xx += 2) pinsTop.push([xx, y - 1]), pinsBot.push([xx, y + h]);
    for (let yy = y + 1; yy < y + h - 1; yy++) pinsL.push([x - 1, yy]), pinsR.push([x + w, yy]);
    for (const [pins, dir] of [[pinsL, 4], [pinsR, 0], [pinsTop, 2], [pinsBot, 6]]) {
      if (pins.length < 2) continue;
      // one or two buses per side, from runs of neighbouring pins
      for (let b = 0; b < 2; b++) {
        if (r() < 0.25) continue;
        const k = Math.min(pins.length, between(2, 5)), at = between(0, pins.length - k);
        const run = pins.slice(at, at + k).filter(([px, py]) => free(px, py));
        if (run.length >= 2) route(run, dir, chip);
      }
    }
  }
  // make sure a few buses reach the edge of the board, for the messages to come in on
  for (const chip of CHIPS) {
    if (EDGE_TRACES.length >= 6) break;
    const run = [];
    for (let yy = chip.y + 1; yy < chip.y + chip.h - 1 && run.length < 3; yy++) if (free(chip.x - 1, yy)) run.push([chip.x - 1, yy]);
    if (run.length >= 2) route(run, 4, chip);
  }
  // decoration: stray vias and a faint dotted ground pour in the empty board
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (!free(x, y)) continue;
      if (hash(x, y, 31) < 0.004) STATIC.push([x, y, "o", 3]);
      else if (x % 4 === 0 && y % 2 === 0) STATIC.push([x, y, ".", 4]);
    }
}

function layout(d) {
  dims = d;
  cols = d.cols;
  rows = d.rows;
  cwH = d.cw / d.H;
  chH = d.ch / d.H;
  cells.resize(cols, rows);
  generate();
}

// ---- packets ----
const SPEED = 26; // cells per second
const TRAIL = 2.2; // seconds the copper glows after a packet
// light a trace with a packet that set off at t0 (from its far end if `back`)
function packet(tr, t0, t, colour, k, back) {
  const n = tr.cells.length, run = t - t0;
  if (run < 0 || run > n / SPEED + TRAIL * 4) return false;
  const head = run * SPEED;
  for (let j = 0; j < n && j <= head; j++) {
    const age = (head - j) / SPEED; // seconds since the packet passed cell j
    const glow = Math.exp(-age / TRAIL);
    if (glow < 0.04) continue;
    const i = tr.cells[back ? n - 1 - j : j];
    const isHead = head - j < 1;
    LIT.set(i, [isHead ? PH.flash : colour, Math.max(LIT.get(i)?.[1] ?? 0, (isHead ? 1.4 : glow) * k)]);
  }
  return run * SPEED >= n; // arrived
}
const LIT = new Map(); // cell -> [colour, strength], rebuilt each frame

// ---- reactions ----
let lanterns = []; // { source, colour, chip }
let arrivals = []; // a message: { trace, colour, t0, tau, chip, out: [traces] }
let flashAt = -1e9, nowT = 0;
onReaction((r) => {
  if (!dims) return;
  if (r.type === "pulse" && Array.isArray(r.colour) && (EDGE_TRACES.length || TRACES.length)) {
    const pool = EDGE_TRACES.length ? EDGE_TRACES : TRACES;
    const trace = pool[Math.floor(Math.random() * pool.length)];
    const others = TRACES.filter((t) => t.chip === trace.chip && t !== trace);
    const out = others.sort(() => Math.random() - 0.5).slice(0, 2);
    arrivals.push({ trace, colour: r.colour.map((v) => v / 255), t0: nowT, tau: Math.max(1.5, (r.afterglow ?? 6) / 3), chip: trace.chip, out });
    if (arrivals.length > 4) arrivals.shift();
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") {
    const items = (Array.isArray(r.items) ? r.items : []).filter((l) => Array.isArray(l.colour)).slice(0, CHIPS.length);
    const next = [];
    for (const it of items) {
      const had = lanterns.find((l) => l.source === it.source);
      const chip = had?.chip ?? CHIPS.find((c) => !next.some((l) => l.chip === c) && !lanterns.some((l) => l.chip === c && items.some((x) => x.source === l.source)));
      if (chip) next.push({ source: it.source, colour: it.colour.map((v) => v / 255), chip });
    }
    lanterns = next;
  }
});

function frame(t) {
  nowT = t;
  if (!dims) return;
  const T = STILL ? STILL_AT : reduced ? 40 : t;
  const flash = Math.max(0, 1 - (T - flashAt) / 0.9);
  LIT.clear();
  // ambient traffic: a packet now and then on a random trace, worked out from
  // time buckets so it needs no memory
  if (TRACES.length)
    for (let b = Math.floor(T / 0.8) - 8; b <= Math.floor(T / 0.8); b++) {
      if (hash(b, 1, 3) > 0.75) continue;
      const tr = TRACES[Math.floor(hash(b, 2, 3) * TRACES.length)];
      packet(tr, b * 0.8 + hash(b, 3, 3) * 0.8, T, PH.ink, 0.55, hash(b, 4, 3) < 0.5);
    }
  // messages: in from the edge, the chip lights, the signal goes on out
  const chipGlow = new Map();
  arrivals = arrivals.filter((a) => T - a.t0 < a.trace.cells.length / SPEED + a.tau * 6);
  for (const a of arrivals) {
    const k = 1.2;
    const arrived = packet(a.trace, a.t0, T, a.colour, k, true);
    if (!arrived) continue;
    const ta = a.t0 + a.trace.cells.length / SPEED;
    chipGlow.set(a.chip, [a.colour, Math.exp(-(T - ta) / a.tau)]);
    for (const o of a.out) packet(o, ta + 0.15, T, a.colour, 0.9, false);
  }

  cells.clear();
  // the board
  for (const [c, r, g, kind] of STATIC) {
    const i = r * cols + c;
    const lit = LIT.get(i);
    let col;
    if (kind === 0) col = scale(PH.dim, 0.45 + 0.5 * flash);
    else if (kind === 1) col = scale(PH.dim, 0.8);
    else if (kind === 2) col = scale(PH.dim, 0.6);
    else if (kind === 3) col = scale(PH.dim, 0.5);
    else col = scale(PH.dim, 0.16);
    if (lit) col = mixc(col, lit[0], Math.min(1, lit[1]));
    cells.putAt(c, r, g, col);
  }
  // chips: part numbers, or the waiting app's name, its LED blinking
  for (const chip of CHIPS) {
    const lan = lanterns.find((l) => l.chip === chip);
    const cg = chipGlow.get(chip);
    let label = chip.label, col = scale(PH.dim, 1.1);
    if (lan) {
      label = lan.source.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, chip.w - 2);
      col = scale(lan.colour, 0.85);
      const on = Math.sin(T * Math.PI * 1.2) > -0.2;
      cells.putAt(chip.x + chip.w - 2, chip.y + 1, "*", scale(lan.colour, on ? 1.4 : 0.3));
      for (let xx = chip.x; xx < chip.x + chip.w; xx++) {
        cells.putAt(xx, chip.y, xx === chip.x || xx === chip.x + chip.w - 1 ? "+" : "-", scale(lan.colour, 0.5));
        cells.putAt(xx, chip.y + chip.h - 1, xx === chip.x || xx === chip.x + chip.w - 1 ? "+" : "-", scale(lan.colour, 0.5));
      }
    }
    if (cg) {
      col = mixc(col, cg[0], cg[1]);
      // the whole outline flares in the message's colour
      for (let xx = chip.x; xx < chip.x + chip.w; xx++) {
        cells.putAt(xx, chip.y, xx === chip.x || xx === chip.x + chip.w - 1 ? "+" : "-", scale(cg[0], 0.4 + cg[1]));
        cells.putAt(xx, chip.y + chip.h - 1, xx === chip.x || xx === chip.x + chip.w - 1 ? "+" : "-", scale(cg[0], 0.4 + cg[1]));
      }
    }
    const [lx, ly] = [chip.x + Math.max(1, (chip.w - label.length) >> 1), chip.labelAt[1]];
    [...label].forEach((ch, k) => cells.putAt(lx + k, ly, ch, col));
  }
  watchSeen(lanterns, (l) => [(l.chip.x + l.chip.w / 2) * cwH, (l.chip.y + l.chip.h / 2) * chH], dims.H, 0.06);
}

crt();
startScene({
  label: "A dark circuit board in glowing green: chips and buses of traces, with packets of light running along them and fading behind.",
  fps: 20,
  fontPx: (H) => Math.max(6, Math.min(11, H / 115)),
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
