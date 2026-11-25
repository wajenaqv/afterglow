// Silicon: a piece of electronics in solid glowing copper, the one the user
// picks, with signals running along its traces and the copper they pass
// glowing on behind them (the afterglow).
//   stacked    chips standing up as blocks on a board, seen at an angle
//   processor  one big chip from above, copper fanning out on every side
//   bus        traces falling from a chip off the top, with the folds real
//              boards have
//   dark       a whole board you only see where a signal has just passed
//
// Reactions: a message is a signal in the app's colour running in along one
// trace, then out along others. An app with something waiting lights a core of
// the chip (bus and dark: a trace) in its colour until you rest the cursor on
// it. A flash lights all the copper.
//
// Everything is measured in rows (u) and kept on whole rows, so level traces
// are evenly thick. Each cell's trace, and how far along it lies, is worked out
// once per size; a frame only moves the signals. One character a material: the
// colour carries the light. Drawn through cells.js.
// Options: ?board=processor|bus|dark ?tint=green|amber|ice|white ?crt=0

import { params, HOVER, pointer, STILL, STILL_AT, seeded } from "./common.js";
import { startScene, reduced } from "./nightscene.js";
import { cellBuffer } from "./cells.js";
import { PH, crt, watchSeen } from "./techy.js";
import { trackApps, now } from "./waiting.js";
import { onCPU } from "./strands.js";

const BOARD = ["processor", "bus", "dark"].find((b) => b === params.get("board")) ?? "stacked";
// without scanlines the copper is solid: its rows leave no dark gaps between them
const LINES = params.get("crt") !== "0";
const DARK = BOARD === "dark";
const GLYPHS = "#+01", cells = cellBuffer(GLYPHS);
const apps = trackApps();
// speed in u a second; `every`: seconds between signals; `tau`: how long copper
// glows on; `base`: the light of copper at rest
const { speed: SPEED, every: EVERY, tau: TAU, max: MAX, base: BASE } = {
  processor: { speed: 46, every: 0.5, tau: 1.4, max: 9, base: 0.17 },
  stacked: { speed: 46, every: 0.55, tau: 1.4, max: 9, base: 0.14 },
  dark: { speed: 34, every: 0.16, tau: 1.9, max: 26, base: 0.035 },
  bus: { speed: 40, every: 0.35, tau: 1.5, max: 10, base: 0.15 },
}[BOARD];
const rand = seeded(20261126);
const pick = (a) => a[Math.floor(rand() * a.length)];

// ---- the boards: { traces: [{ pts, via, via0 }], solids: [{ pts, tone, core, heart, top }], w }, in u ----
// The fan-out of a square chip: each pin's trace goes straight, then 45
// degrees, then straight again. Outer pins turn first, so none cross.
function fan(cx, cy, half, n, pitch, far, r) {
  const out = [], mid = (n - 1) / 2;
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < n; i++) {
      const p = (i - mid) * pitch, a = Math.abs(p), sg = Math.sign(p) || 1, d1 = 5 + (mid * pitch - a) * 0.414, dg = 5 + a * 1.05;
      const via = r() < 0.4, L = via ? 8 + r() * 34 : far;
      const turn = ([o, s]) => (side === 0 ? [cx + o, cy + s] : side === 1 ? [cx + s, cy + o] : side === 2 ? [cx - o, cy + s] : [cx + s, cy - o]);
      const local = [[half, p], [half + d1, p], [half + d1 + dg, p + sg * dg], [half + d1 + dg + L, p + sg * dg]];
      out.push({ via, pts: local.map(turn).map((q) => q.map(Math.round)) });
    }
  return out;
}
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// the cores of a chip: 4 by 4, the middle four joined into one (the heart)
function cores(size, pitch, wide, each) {
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const heart = x % 3 > 0 && y % 3 > 0;
      if (heart && (x === 2 || y === 2)) continue;
      each(x * pitch, y * pitch, heart ? wide : size, heart);
    }
}
const BOARDS = {
  processor(w, h) {
    const r = seeded(11), H = 25, cx = Math.round(w * (w > h ? 0.58 : 0.5)), cy = Math.round(h / 2);
    const solids = [{ pts: rect(cx - H, cy - H, 2 * H, 2 * H), tone: 0.2 }];
    cores(8, 10, 18, (x, y, s, heart) => solids.push({ pts: rect(cx - 19 + x, cy - 19 + y, s, s), tone: heart ? 0.62 : 0.34 + 0.16 * r(), core: !heart, heart, lift: 1 }));
    return { traces: fan(cx, cy, H, 11, 4, 300, r), solids, w: 2 };
  },
  stacked(w, h) {
    const r = seeded(5), P = (x, y, z = 0) => [w * (w > h ? 0.6 : 0.5) + (x - y) * 0.88, h * 0.54 + (x + y) * 0.48 - z], solids = [];
    let n = 0;
    // a box's three faces that show
    const box = (x, y, s, z0, z1, tone, extra) => {
      const X = x + s, Y = y + s, block = n++;
      solids.push({ pts: [P(x, Y, z0), P(X, Y, z0), P(X, Y, z1), P(x, Y, z1)], tone: tone * 0.55, block, ...extra, lift: 0.5 });
      solids.push({ pts: [P(X, y, z0), P(X, Y, z0), P(X, Y, z1), P(X, y, z1)], tone: tone * 0.3, block, ...extra, lift: 0.5 });
      solids.push({ pts: [P(x, y, z1), P(X, y, z1), P(X, Y, z1), P(x, Y, z1)], tone, block, ...extra, lift: 1 });
    };
    box(-27, -27, 54, 0, 7, 0.3, {});
    const blocks = [];
    cores(9.5, 11.5, 21, (x, y, s, heart) => blocks.push([x - 22, y - 22, s, heart ? 16 : x + y < 24 && (x === 0 || y === 0) ? 3 : 4 + Math.round(r() * 4), heart]));
    blocks.sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2]); // far to near
    for (const [x, y, s, up, heart] of blocks) box(x, y, s, 7, 7 + up, heart ? 0.85 : 0.6, { core: !heart, heart });
    return { traces: fan(0, 0, 27, 11, 4.6, 260, r).map((t) => ({ ...t, pts: t.pts.map(([x, y]) => P(x, y)) })), solids, w: 2.1 };
  },
  // traces grown at random on a coarse grid until the board is full
  dark(w, h) {
    const r = seeded(77), S = 4, gw = Math.ceil(w / S) + 2, gh = Math.ceil(h / S) + 2, occ = new Uint8Array(gw * gh), D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const ok = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && !occ[y * gw + x];
    const solids = [], traces = [];
    for (const [fx, fy, cw, ch] of [[0.36, 0.2, 9, 6], [0.66, 0.5, 12, 10], [0.42, 0.68, 6, 8], [0.85, 0.2, 7, 5]]) {
      const X = Math.round(fx * gw), Y = Math.round(fy * gh);
      for (let y = Y; y < Math.min(gh, Y + ch); y++) for (let x = X; x < Math.min(gw, X + cw); x++) occ[y * gw + x] = 1;
      solids.push({ pts: rect(X * S - 1, Y * S - 1, cw * S - 2, ch * S - 2), tone: 0.07 });
    }
    for (let k = 0; k < 5000; k++) {
      let x = Math.floor(r() * gw), y = Math.floor(r() * gh), d = Math.floor(r() * 4) * 2, run = 0;
      if (!ok(x, y)) continue;
      const pts = [[x, y]], go = (e) => {
        const [dx, dy] = D[e];
        return ok(x + dx, y + dy) && !(dx && dy && occ[y * gw + x + dx] && occ[(y + dy) * gw + x]); // never across another diagonal
      };
      occ[y * gw + x] = 1;
      for (let n = 0; n < 60; n++) {
        let e = d;
        if ((run > 3 && r() < 0.16) || !go(d)) {
          const side = r() < 0.5 ? 1 : 7;
          e = [(d + side) % 8, (d + 8 - side) % 8].find(go) ?? (go(d) ? d : -1);
          run = 0;
        }
        if (e < 0) break;
        d = e;
        run++;
        x += D[d][0];
        y += D[d][1];
        occ[y * gw + x] = 1;
        pts.push([x, y]);
      }
      if (pts.length > 5) traces.push({ pts: pts.map(([a, b]) => [a * S, b * S]), via: true, via0: true });
    }
    return { traces, solids, w: 1.6 };
  },
  bus(w, h) {
    const r = seeded(9), n = 22, x0 = w * (w > h ? 0.6 : 0.5) - (n * 3) / 2, traces = [];
    for (let i = 0; i < n; i++) {
      const a = i - (n - 1) / 2, k = Math.abs(a), X = Math.round(x0 + i * 3), y1 = 14 + Math.round((n / 2 - k) * 2.2), dg = Math.round(k * (w > h ? 4.2 : 1.8)), x2 = X + Math.sign(a) * dg;
      const pts = [[X, 8], [X, y1], [x2, y1 + dg]];
      let y = y1 + dg + 4;
      if (i % 3 === 1 && w > h) {
        // folded, to come out as long as its neighbours
        const folds = 3 + Math.floor(r() * 4);
        y += 4 + Math.round(r() * 14);
        pts.push([x2, y]);
        for (let f = 0; f < folds; f++) {
          const out = f % 2 ? -4 : 4;
          pts.push([x2 + out, y + 4], [x2 + out, y + 6], [x2, y + 10]);
          y += 10;
        }
      }
      const via = r() < 0.35;
      pts.push([x2, via ? Math.round(Math.max(y + 6, h * (0.72 + 0.2 * r()))) : Math.ceil(h) + 4]);
      traces.push({ pts, via });
    }
    return { traces, solids: [{ pts: rect(Math.round(x0 - 6), -20, n * 3 + 10, 30), tone: 0.24 }], w: 2.4 };
  },
};

// ---- laid out ----
let dims = null, B = null, S = 1, cols = 0, rows = 0, UX = 1, left = 0;
// the cells that hold something: where, its trace (or -1) and how far along, its solid (or -1), how much of it is covered
let LIVE = [], AT = [], OWN = [], SOL = [], COV = [], USABLE = [], CLEAR = [], CORES = [];
let halo = new Float32Array(0);
let onTrace = null, onSolid = null; // per cell of the screen: its trace, its solid, or -1

// H / 128 rows on the screen's short side, or finer by a whole number: whole rows stay whole
const fine = (H) => (onCPU() ? 1 : Math.max(1, Math.floor(Math.min(H, innerWidth) / 640)));
const fontPx = (H) => Math.max(3, Math.min(H, innerWidth) / 128 / fine(H) / 1.02);

function layout(d) {
  dims = d;
  ({ cols, rows } = d);
  S = fine(d.H);
  cells.resize(cols, rows);
  const uW = d.W / d.ch / S, uH = rows / S; // the screen in u
  UX = d.cw / d.ch / S; // a column, in u
  const UY = 1 / S;
  B = BOARDS[BOARD](uW, uH);
  const N = cols * rows, own = new Int16Array(N).fill(-1), sol = new Int16Array(N).fill(-1), at = new Float32Array(N), cov = new Float32Array(N);
  halo = new Float32Array(N);
  onTrace = own;
  onSolid = sol;
  // the cells of a box in u
  const each = (x0, y0, x1, y1, fn) => {
    for (let y = Math.max(0, Math.floor(y0 * S)); y < Math.min(rows, y1 * S); y++) for (let x = Math.max(0, Math.floor(x0 / UX)); x < Math.min(cols, x1 / UX); x++) fn(y * cols + x, (x + 0.5) * UX, (y + 0.5) * UY);
  };
  const part = (v) => Math.max(0, Math.min(1, v * S + 0.5)); // how much of a cell lies inside an edge v away
  B.traces.forEach((t, k) => {
    t.segs = [];
    t.len = 0;
    for (let n = 1; n < t.pts.length; n++) {
      const [ax, ay] = t.pts[n - 1], [bx, by] = t.pts[n], L = Math.hypot(bx - ax, by - ay), m = B.w;
      if (!L) continue;
      t.segs.push([ax, ay, bx, by, t.len, L]);
      each(Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.max(ax, bx) + m, Math.max(ay, by) + m, (i, X, Y) => {
        const u = Math.max(0, Math.min(1, ((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / (L * L)));
        const a = part(B.w / 2 - Math.hypot(X - ax - u * (bx - ax), Y - ay - u * (by - ay)));
        if (a <= 0.05 || a <= cov[i]) return;
        cov[i] = a;
        own[i] = k;
        at[i] = t.len + u * L;
      });
      t.len += L;
    }
    // vias: rings
    const R = B.w * 1.25;
    for (const [[vx, vy], s] of [...(t.via ? [[t.pts[t.pts.length - 1], t.len]] : []), ...(t.via0 ? [[t.pts[0], 0]] : [])])
      each(vx - R - 1, vy - R - 1, vx + R + 1, vy + R + 1, (i, X, Y) => {
        const D = Math.hypot(X - vx, Y - vy), a = part(R - D);
        if (a <= 0.05) return;
        cov[i] = Math.max(0, a - part(B.w * 0.5 - D));
        own[i] = k;
        at[i] = s;
      });
    // a signal is gone where its trace leaves the screen
    let s = 0;
    for (; s < t.len; s++) {
      const p = pointOn(t, s);
      if (p[0] < -4 || p[1] < -4 || p[0] > uW + 4 || p[1] > uH + 4) break;
    }
    t.reach = Math.min(t.len, Math.max(6, s));
  });
  B.solids.forEach((p, k) => {
    const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]), mid = [(xs[0] + xs[2]) / 2, (ys[0] + ys[2]) / 2];
    const edges = p.pts.map(([ax, ay], n) => {
      const [bx, by] = p.pts[(n + 1) % 4], L = Math.hypot(bx - ax, by - ay), side = Math.sign((bx - ax) * (mid[1] - ay) - (by - ay) * (mid[0] - ax));
      return (X, Y) => (side * ((bx - ax) * (Y - ay) - (by - ay) * (X - ax))) / L;
    });
    each(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (i, X, Y) => {
      const near = Math.min(...edges.map((e) => e(X, Y)));
      if (near < 0) return;
      sol[i] = k;
      own[i] = -1;
      cov[i] = Math.min(1, near / 0.9); // a dark groove round each piece
    });
  });
  LIVE = [];
  for (let i = 0; i < N; i++) if (cov[i] > 0.04) LIVE.push(i);
  const take = (T, from) => T.from(LIVE, (i) => from[i]);
  OWN = take(Int16Array, own);
  SOL = take(Int16Array, sol);
  AT = take(Float32Array, at);
  COV = take(Float32Array, cov);
  USABLE = [...new Set(OWN)].filter((k) => k >= 0 && B.traces[k].reach > 12);
  // the pieces a waiting app can take: cores, each the solids of one block
  const byCore = new Map();
  B.solids.forEach((p, k) => {
    if (!p.core) return;
    const key = p.block ?? "s" + k;
    byCore.set(key, [...(byCore.get(key) ?? []), k]);
  });
  left = uW > uH ? 0.06 : -0.3; // portrait: no dark strip on the left
  // waiting apps only take what you can see: cores not hidden behind the big
  // one, traces clear of the dark strip on the left
  const seenS = new Map(), seenT = new Map();
  LIVE.forEach((i, n) => {
    if (SOL[n] >= 0) seenS.set(SOL[n], (seenS.get(SOL[n]) ?? 0) + 1);
    else if ((i % cols) / cols > left + 0.14) seenT.set(OWN[n], (seenT.get(OWN[n]) ?? 0) + 1);
  });
  const area = (ks) => ks.reduce((a, k) => a + (seenS.get(k) ?? 0), 0), most = Math.max(0, ...[...byCore.values()].map(area));
  CORES = [...byCore.values()].filter((ks) => area(ks) > most * 0.45);
  const enough = ((B.w * S * B.w) / UX) * 8; // cells in a stretch of trace 8 widths long
  CLEAR = USABLE.filter((k) => (seenT.get(k) ?? 0) > enough);
  if (!CLEAR.length) CLEAR = USABLE;
  signals = [];
  next = -1;
}
function pointOn(t, s) {
  const e = t.segs.find((g) => s <= g[4] + g[5]) ?? t.segs[t.segs.length - 1], u = Math.max(0, Math.min(1, (s - e[4]) / e[5]));
  return [e[0] + (e[2] - e[0]) * u, e[1] + (e[3] - e[1]) * u];
}

// ---- the signals ----
let signals = []; // { k: trace, t0, back, colour or null, power, reach, head }
let next = -1; // when the next one sets off
const send = (k, t0, o) => signals.push({ k, t0, back: false, colour: null, power: 1, reach: B.traces[k].reach, head: 0, ...o });
const sent = new Set(); // messages already sent off
function traffic(T) {
  if (!USABLE.length) return;
  if (next < 0) {
    // already under way when the wallpaper starts
    next = T;
    for (let n = 0; n < MAX; n++) send(pick(USABLE), T - rand() * 3, { back: BOARD !== "bus" && rand() < 0.4 });
  }
  signals = signals.filter((s) => T - s.t0 < s.reach / SPEED + TAU * 5);
  if (T > next && !reduced) {
    next = T + EVERY * (0.5 + rand());
    if (signals.length < MAX * 2) send(pick(USABLE), T, { back: BOARD !== "bus" && rand() < 0.4 });
  }
  for (const m of apps.messages) {
    if (sent.has(m.t0)) continue;
    sent.add(m.t0);
    if (sent.size > 40) sent.delete(sent.values().next().value);
    const k = pick(USABLE);
    m.k = k;
    m.run = B.traces[k].reach / SPEED;
    if (reduced) continue;
    send(k, T, { back: true, colour: m.colour, power: 1.5 });
    for (let n = 0; n < 4; n++) send(pick(USABLE), T + m.run + 0.1 * n, { colour: m.colour, power: 1.2 });
  }
  for (const s of signals) s.head = (T - s.t0) * SPEED;
}
// the piece of a waiting app: the solids of a core, or a trace
const spread = (i, n) => Math.floor(((i * 0.618 + 0.3) % 1) * n);
const coreOf = (a) => CORES[(a.i * (CORES.length % 5 ? 5 : 3) + 1) % CORES.length];
const traceOf = (a) => CLEAR[spread(a.i, CLEAR.length)];

function frame(t) {
  if (!dims) return;
  const T = STILL ? STILL_AT : reduced ? 20 : t;
  apps.tidy();
  traffic(T);
  // by trace, so a cell looks only at its own
  const by = B.traces.map(() => null), R = 7;
  halo.fill(0);
  for (const s of signals) {
    (by[s.k] ??= []).push(s);
    if (s.head < 0 || s.head > s.reach) continue;
    const [x, y] = pointOn(B.traces[s.k], s.back ? s.reach - s.head : s.head);
    for (let r = Math.max(0, Math.floor((y - R) * S)); r < Math.min(rows, (y + R) * S); r++)
      for (let c = Math.max(0, Math.floor((x - R) / UX)); c < Math.min(cols, (x + R) / UX); c++) halo[r * cols + c] += 0.35 * s.power * Math.exp(-(((c + 0.5) * UX - x) ** 2 + ((r + 0.5) / S - y) ** 2) / 9);
  }
  const litSolid = new Map(), litTrace = new Map();
  for (const a of apps.waiting) {
    if (CORES.length) for (const k of coreOf(a)) litSolid.set(k, [a.colour, apps.lit(a)]);
    else if (USABLE.length) litTrace.set(traceOf(a), [a.colour, apps.lit(a)]);
  }
  if (reduced) for (const m of apps.messages) litTrace.set(m.k, [m.colour, apps.glow(m)]);
  // signals leaving or reaching the chip warm its heart; a message tints it
  let warm = 0, tint = null, tinted = 0;
  for (const s of signals) {
    const dt = s.back ? T - s.t0 - s.reach / SPEED : T - s.t0;
    if (dt > 0) warm += 0.12 * Math.exp(-dt / 0.8);
  }
  for (const m of apps.messages) {
    const dt = now() - m.t0 - (reduced ? 0 : (m.run ?? 0));
    const k = dt > 0 ? Math.min(1, dt / 0.2) * Math.exp(-dt / (m.tau * 0.5)) : 0;
    if (k > tinted) [tint, tinted] = [m.colour, k];
  }
  const flash = apps.flash(), ink = PH.ink;
  cells.clear();
  for (let n = 0; n < LIVE.length; n++) {
    const i = LIVE[n], r = (i / cols) | 0, c = i - r * cols;
    let k, hot = 0, col = null, mix = 0, slot = 1;
    if (SOL[n] >= 0) {
      const p = B.solids[SOL[n]], a = litSolid.get(SOL[n]);
      k = p.tone * (1 + 0.1 * Math.sin(SOL[n] * 5 + T * 0.6) + 0.5 * flash) + (p.heart ? warm * p.lift : 0) + halo[i] * 0.3;
      if (p.tone < 0.25) {
        // the chip's package: a lighter character, or a dimmer solid
        slot = LINES ? 2 : 1;
        k *= LINES ? 1.3 : 0.7;
      }
      if (a) {
        k += (0.9 * p.lift - k) * a[1];
        col = a[0];
        mix = a[1];
      }
      if (p.heart && tinted > 0.02) {
        col = tint;
        mix = tinted;
        k += 0.5 * tinted * p.lift;
      }
      k *= COV[n];
    } else {
      // the left of the screen stays dark, for the icons
      const edge = Math.max(0, Math.min(1, ((c + 0.5) / cols - left) / 0.2));
      let glow = 0;
      const list = by[OWN[n]];
      if (DARK) slot = (c * 7 + r * 13 + OWN[n]) % 5 < 2 ? 3 : 4;
      if (list)
        for (const s of list) {
          const d = s.head - (s.back ? s.reach - AT[n] : AT[n]);
          if (d < 0 || (s.back && AT[n] > s.reach)) continue;
          const e = d / SPEED, g = (0.4 * Math.exp(-e / 0.12) + 0.75 * Math.exp(-e / TAU)) * s.power;
          if (g > glow) {
            glow = g;
            col = s.colour;
            mix = 1;
          }
          if (d < 10) hot = Math.max(hot, Math.exp(-d / 1.6));
        }
      const a = litTrace.get(OWN[n]);
      if (a) {
        glow = Math.max(glow, 0.65 * a[1]);
        col = a[0];
        mix = a[1];
      }
      k = (BASE * edge * (1 + 2 * flash) + glow * Math.max(0.12, edge) + halo[i] * edge * (DARK ? 0.9 : 0.5) + (DARK ? 0.25 * flash * edge : 0)) * COV[n];
    }
    k *= LINES ? 1.25 : 0.9; // what the scanlines take
    if (k < 0.03) continue;
    const w = Math.min(0.85, 0.8 * hot + 0.25 * Math.max(0, k - 0.9)), m = Math.min(1, k);
    let R0 = ink[0], G0 = ink[1], B0 = ink[2];
    if (col) {
      R0 += (col[0] - R0) * mix;
      G0 += (col[1] - G0) * mix;
      B0 += (col[2] - B0) * mix;
    }
    cells.putSlot(i, slot, (R0 + (1 - R0) * w) * m, (G0 + (1 - G0) * w) * m, (B0 + (1 - B0) * w) * m);
  }
  if (HOVER) {
    const hit = underCursor();
    watchSeen(hit ? [hit] : [], () => [pointer.x / dims.H, pointer.y / dims.H], dims.H);
  }
}
// The waiting app whose core or trace is under the cursor: the nearest one
// within a couple of u, so a thin trace is easy to rest on
function underCursor() {
  if (!pointer.on || !apps.waiting.length) return null;
  const C = Math.floor(pointer.x / dims.cw), Q = Math.floor(pointer.y / dims.ch), reach = 2.2;
  let best = reach, found = null;
  for (let r = Math.max(0, Math.floor(Q - reach * S)); r <= Math.min(rows - 1, Q + reach * S); r++)
    for (let c = Math.max(0, Math.floor(C - reach / UX)); c <= Math.min(cols - 1, C + reach / UX); c++) {
      const i = r * cols + c, d = Math.hypot((c - C) * UX, (r - Q) / S);
      if (d >= best) continue;
      const app = apps.waiting.find((a) => (CORES.length ? coreOf(a).includes(onSolid[i]) : USABLE.length && traceOf(a) === onTrace[i]));
      if (app) [best, found] = [d, app];
    }
  return found;
}

crt();
startScene({
  label: "Electronics in solid glowing copper, with signals running along the traces and the copper glowing on behind them.",
  fps: () => (onCPU() ? 15 : 20),
  layout,
  frame,
  fontPx,
  sample: cells.sample,
  gpu: cells.gpu,
  fill: !LINES,
});
