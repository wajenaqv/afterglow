// Circuit board: a dark PCB in phosphor green. Chips with pins and part
// numbers, traces routed from pin to pin on two layers (the lower one dotted,
// passing underneath), small parts in the gaps. Packets of bits run along the
// traces and the copper they pass glows on behind them (the afterglow). The
// parts work: what arrives changes what a chip shows, and the chip may send
// something on; crystals tick; the processor's registers and cores switch.
//
// Reactions: a new message is a packet in the app's colour coming in from the
// edge of the board, passed on from chip to chip; every app with something
// waiting takes a chip, which shows the app's name and a blinking LED in its
// colour until you rest the cursor on it; a flash surges through the copper.
//
// The board is made once per screen size (seeded, so it is the same each time)
// by circuitboard.js. Drawn through cells.js.
// Options: ?board=processor (one big chip) ?traffic=busy ?tint=green|amber|ice|white ?crt=0

import { STILL, HOVER, pointer, params, seeded } from "./common.js";
import { startScene, reduced, preview } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, mixc, scale, watchSeen } from "./techy.js";
import { trackApps } from "./waiting.js";
import { makeBoard } from "./circuitboard.js";

const BUSY = params.get("traffic") === "busy", BIG = params.get("board") === "processor";
// seconds between packets, how many at once, how often a chip sends something on
const EVERY = BUSY ? 0.09 : 0.32, MAX = BUSY ? 60 : 16, PASS_ON = BUSY ? 0.7 : 0.4;
const SPEED = BUSY ? 30 : 24; // cells a second
const TAU = 1.7; // seconds the copper glows on
const cells = cellBuffer("-|/\\o+*=.:[]()#_'><x" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
const apps = trackApps();
const rand = seeded(815);
const pick = (a) => a[Math.floor(rand() * a.length)];

let dims = null, cols = 0, rows = 0, B = null, ICS = [], clock = 0, next = 0;
let GLYPH = [], TOP = [], GLOW = [], HUE = [], REST = [];
const hot = new Set(); // cells still glowing
let packs = []; // { t: trace, back, colour or null, n: bits, bits, power, hops, pos }

function layout(d) {
  dims = d;
  if (d.cols === cols && d.rows === rows) return; // the fonts arriving changes nothing
  ({ cols, rows } = d);
  cells.resize(cols, rows);
  B = makeBoard(cols, rows, BIG);
  ICS = B.chips.filter((c) => c.kind === "ic");
  const N = cols * rows;
  GLYPH = [new Array(N), new Array(N)];
  TOP = new Uint8Array(N);
  GLOW = [new Float32Array(N), new Float32Array(N)];
  HUE = [new Array(N).fill(null), new Array(N).fill(null)];
  hot.clear();
  packs = [];
  for (const t of B.traces)
    t.cells.forEach((i, k) => {
      GLYPH[t.L][i] = t.via && k === t.cells.length - 1 ? "o" : t.L ? (t.ch[k] === "-" ? "." : ":") : t.ch[k];
      if (!t.L) TOP[i] = 1;
    });
  // the board at rest: [cell, character, light]
  REST = [];
  const add = (x, y, g, k) => REST.push([y * cols + x, g, k * (0.45 + 0.55 * Math.min(1, Math.max(0, (x / cols - 0.1) / 0.15)))]);
  for (const [x, y, g, k] of B.decor) add(x, y, g, k);
  for (const L of [1, 0]) GLYPH[L].forEach((g, i) => g && !(L && TOP[i]) && add(i % cols, Math.floor(i / cols), g, g === "o" ? 0.42 : L ? 0.2 : 0.36));
  for (const c of B.chips) {
    c.act = 0;
    c.hue = null;
    c.mem = Array.from({ length: c.w * c.h }, () => Math.floor(rand() * 16));
  }
  // under way when the wallpaper starts (a still or reduced motion shows just this)
  for (let k = 0; k < 120; k++) step(0.05);
}

// ---- packets ----
function send(t, back, colour, n, power, hops = 0, wait = 0) {
  packs.push({ t, back, colour, n, power, hops, pos: -wait * SPEED, bits: Array.from({ length: n }, () => (rand() < 0.5 ? "0" : "1")) });
}
function arrive(p) {
  const c = p.back ? p.t.A : p.t.B;
  if (!c) return;
  c.act = Math.min(1.2, c.act + 0.6 * p.power);
  c.hue = p.colour;
  for (let k = 0; k < 6 + p.n * 3; k++) c.mem[Math.floor(rand() * c.mem.length)] = Math.floor(rand() * 16);
  // and the chip sends something on
  const list = c.outs.filter(([t]) => t !== p.t);
  if (!list.length) return;
  const n = p.colour ? (p.hops > 0 ? 2 : 0) : packs.length < MAX && rand() < PASS_ON ? 1 : 0;
  for (let k = 0; k < n; k++) {
    const [t, back] = pick(list);
    send(t, back, p.colour, p.colour ? 6 : 2 + Math.floor(rand() * 6), p.colour ? 1.1 : 0.75, p.hops - 1, 0.2 + 0.15 * k);
  }
}
const sent = new Set();
function messages() {
  for (const m of apps.messages) {
    if (sent.has(m.t0)) continue;
    sent.add(m.t0);
    if (sent.size > 40) sent.delete(sent.values().next().value);
    const pool = B.edge.length ? B.edge : B.traces;
    if (!pool.length) continue;
    const t = pick(pool);
    if (reduced) arrive({ t, back: false, colour: m.colour, n: 8, power: 2, hops: 0 });
    else send(t, false, m.colour, 8, 1.4, 2);
  }
}
function step(dt) {
  clock += dt;
  if (B.traces.length && clock > next) {
    next = clock + EVERY * (0.4 + rand() * 1.2);
    if (packs.length < MAX) {
      const t = pick(B.traces), back = rand() < 0.5;
      // now and then a whole bus goes at once
      const all = rand() < (BUSY ? 0.2 : 0.07) ? B.traces.filter((q) => q.A === t.A && q.B === t.B && q.L === t.L).slice(0, 5) : [t];
      for (const q of all) send(q, back, null, 2 + Math.floor(rand() * 5), 0.75);
    }
  }
  for (const c of B.chips) {
    c.act *= Math.exp(-dt / (c.hue ? 2.4 : 0.9));
    if (c.act < 0.03) c.hue = null;
    if (c.kind !== "xtal") continue;
    const tick = Math.floor(clock / 4.8 + c.n * 0.5); // the clock ticks out along one of its traces
    if (c.tick === tick) continue;
    c.tick = tick;
    c.act = Math.max(c.act, 0.6);
    if (c.outs.length) send(...c.outs[tick % c.outs.length], null, 1, 0.6);
  }
  for (const L of [0, 1]) {
    const g = GLOW[L], h = HUE[L];
    for (const i of hot) g[i] *= Math.exp(-dt / (h[i] ? 2.6 : TAU));
  }
  for (const i of hot) if (GLOW[0][i] < 0.02 && GLOW[1][i] < 0.02) hot.delete(i);
  const moving = packs;
  packs = [];
  for (const p of moving) {
    const was = p.pos, n = p.t.cells.length, { L } = p.t;
    p.pos += SPEED * dt;
    for (let k = Math.max(0, Math.ceil(was)); k <= Math.min(n - 1, p.pos); k++) {
      const i = p.t.cells[p.back ? n - 1 - k : k];
      if (GLOW[L][i] < p.power || p.colour) {
        GLOW[L][i] = p.power;
        HUE[L][i] = p.colour;
      }
      hot.add(i);
    }
    if (was < n - 1 && p.pos >= n - 1) arrive(p);
    if (p.pos < n + p.n) packs.push(p);
  }
}

// ---- drawing ----
const put = (x, y, g, col, k, white = 0) => cells.putAt(x, y, g, white ? mixc(scale(col, Math.min(1, k)), PH.flash, white) : scale(col, Math.min(1, k)));
function text(s, x, y, col, k, white) {
  for (let j = 0; j < s.length; j++) if (s[j] !== " ") put(x + j, y, s[j], col, k, white);
}
const BLANK = "01#+x:=*";
const hex = (v) => v.toString(16).toUpperCase();

const DRAW = {
  xtal: (c, col, k) => text("16.000MHZ", c.x + 2, c.y + 1, col, 0.35 + 0.55 * k),
  header: (c, col, k) => text("o o o o o o o o o o o", c.x + 2, c.y + 1, col, 0.32 + 0.5 * k),
  ic(c, col, k, app) {
    const s = (app ? app.source.toUpperCase().replace(/[^A-Z0-9]/g, "") : c.label).slice(0, c.w - 4), two = c.h > 5;
    text(s, c.x + ((c.w - s.length) >> 1), c.y + (c.h >> 1) - (two ? 1 : 0), col, 0.45 + 0.5 * k);
    if (two) text(c.mem.slice(0, c.w - 6).map((m) => (m > 7 ? "1" : "0")).join(""), c.x + 3, c.y + (c.h >> 1) + 1, col, 0.18 + 0.5 * k);
    const on = app ? Math.sin(clock * 3.8) > -0.2 : c.act > 0.25;
    put(c.x + c.w - 3, c.y + 1, "*", col, on ? 1 : 0.2, on ? 0.3 : 0);
    put(c.x + 2, c.y + 1, "o", col, 0.35);
  },
  // a field of bits
  ram(c, col, k) {
    for (let y = 1; y < c.h - 1; y++)
      for (let x = 2; x < c.w - 2; x++) {
        const m = c.mem[y * c.w + x];
        put(c.x + x, c.y + y, m > 11 ? "#" : m > 7 ? ":" : ".", col, (m > 11 ? 0.24 : 0.13) + 0.6 * k * (m / 15));
      }
    text("RAM", c.x + c.w - 6, c.y, col, 0.4 + 0.4 * k);
  },
  // registers, and cores that switch now and then
  cpu(c, col, k) {
    const R = c.h - 4, at = Math.floor(clock * 2) % R;
    for (let y = 0; y < R; y++) {
      const on = y === at;
      if (on && c.reg !== at) {
        c.reg = at;
        c.mem[y * 8 + Math.floor(rand() * 8)] = Math.floor(rand() * 16);
      }
      text("R" + hex(y % 16), c.x + 3, c.y + 2 + y, col, 0.24 + 0.3 * k);
      text(c.mem.slice(y * 8, y * 8 + 8).map(hex).join(""), c.x + 6, c.y + 2 + y, col, on ? 0.75 : 0.27 + 0.4 * k, on ? 0.2 : 0);
    }
    const bw = 9, bh = 4;
    let n = 0;
    for (let y = c.y + 2; y + bh <= c.y + c.h - 1; y += bh + 1)
      for (let x = c.x + 18; x + bw <= c.x + c.w - 2; x += bw + 1, n++) {
        const busy = Math.max(0, Math.sin(clock * (0.22 + (n % 5) * 0.06) + n * 2.4)) ** (BUSY ? 3 : 9);
        for (let b = 0; b < bh; b++)
          for (let a = 0; a < bw; a++) {
            const m = c.mem[(n * 37 + b * bw + a) % c.mem.length], flat = b === 0 || b === bh - 1, edge = flat || a === 0 || a === bw - 1;
            put(x + a, y + b, flat ? "-" : edge ? "|" : BLANK[m >> 1], col, (edge ? 0.2 : 0.16) + (0.55 * busy + 0.3 * k) * (0.4 + m / 25));
          }
        if (busy > 0.4 && rand() < 0.2) c.mem[(n * 37 + Math.floor(rand() * 36)) % c.mem.length] = Math.floor(rand() * 16);
      }
    text("AG-64 PROCESSOR", c.x + ((c.w - 15) >> 1), c.y, col, 0.55 + 0.4 * k);
  },
};

let last = 0;
function frame() {
  if (!dims || !B) return;
  const at = performance.now(), dt = Math.min(0.1, (at - last) / 1000);
  last = at;
  apps.tidy();
  messages();
  // reduced motion: the packets stand still, but reactions still fade
  if (reduced) for (const c of B.chips) c.act *= 0.75;
  else if (!STILL) step(dt);
  const flash = apps.flash(), ink = PH.ink;
  cells.clear();
  for (const [i, g, k] of REST) cells.put(i, g, scale(ink, k * (1 + 1.6 * flash)));
  for (const i of hot) {
    const L = TOP[i] ? 0 : 1, k = GLOW[L][i];
    if (k > 0.03) cells.put(i, GLYPH[L][i], scale(HUE[L][i] ?? ink, Math.min(1, 0.36 + (L ? 0.36 : 0.55) * k)));
  }
  // the packets themselves: bits, the first one brightest
  for (const p of packs) {
    const n = p.t.cells.length;
    for (let k = Math.min(p.n, n) - 1; k >= 0; k--) {
      const j = Math.floor(p.pos) - k;
      if (j < 0 || j >= n) continue;
      const i = p.t.cells[p.back ? n - 1 - j : j], f = 1 - 0.6 * (k / p.n);
      if (p.t.L && TOP[i]) continue; // underneath
      cells.put(i, p.bits[k], mixc(scale(p.colour ?? ink, 0.5 + 0.5 * f), PH.flash, (p.colour ? 0.35 : 0.6) * f));
    }
  }
  for (const c of B.chips) {
    const app = apps.waiting.find((a) => chipOf(a) === c), col = app ? app.colour : (c.hue ?? ink), k = Math.max(c.act, app ? 0.55 * apps.lit(app) : 0, 0.5 * flash), e = 0.4 + 0.55 * k;
    for (let x = c.x; x < c.x + c.w; x++) {
      const g = x === c.x || x === c.x + c.w - 1 ? "+" : "-";
      put(x, c.y, g, col, e);
      put(x, c.y + c.h - 1, g, col, e);
    }
    for (let y = c.y + 1; y < c.y + c.h - 1; y++) {
      put(c.x, y, "|", col, e);
      put(c.x + c.w - 1, y, "|", col, e);
    }
    text(c.ref, c.x + 1, c.y, col, 0.4 + 0.4 * k);
    DRAW[c.kind](c, col, k, app);
  }
  if (HOVER) {
    // anywhere on the chip, or a little beside it
    const x = pointer.x / dims.cw, y = pointer.y / dims.ch;
    const hit = pointer.on && apps.waiting.find((a) => {
      const c = chipOf(a);
      return c && x > c.x - 2 && x < c.x + c.w + 2 && y > c.y - 1 && y < c.y + c.h + 1;
    });
    watchSeen(hit ? [hit] : [], () => [pointer.x / dims.H, pointer.y / dims.H], dims.H);
  }
}
const chipOf = (a) => ICS[a.i % Math.max(1, ICS.length)];

crt();
startScene({
  label: "A dark circuit board in glowing green: chips and buses of traces, with packets of bits running along them and fading behind.",
  fps: 20,
  fontPx: (H) => (preview ? Math.max(3, H / 100) : Math.max(6, Math.min(11, H / 115))),
  layout,
  frame,
  sample: cells.sample,
  gpu: cells.gpu,
});
