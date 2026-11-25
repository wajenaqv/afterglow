// The heywajih.com clock (the clock wallpaper there), brought over as it is:
// HH:MM drawn the way the heywajih logo is. The digits (a 5x7 pixel font,
// each font pixel 3 characters by 2 rows, so the time is about 78 x 14 big
// characters) become a density map like the logo trace: solid inside, lighter
// at the edges. Each cell keeps one character from the logo's RAMP and only
// rarely changes it (the logo's idle shimmer), rows fade from the logo's top
// colour to its bottom colour, and a soft light sweep passes every 7 seconds.
// When the minute changes, only the cells that differ scramble, left to
// right. Hover: characters near the moving cursor scramble into glitch glyphs
// and settle back within a second. The date sits under it in the same grid.
//
// AfterGlow additions: palettes, reactions (a pulse starts a sweep in the
// app's colour and tints the digits, fading over the afterglow; a flash lights
// every cell for a moment), pause, and stills.
//
// Drawn on a canvas, one character per cell (about 1,500 cells, cheap on the
// CPU): the clock is the agreed exception to the GPU and CPU renderer rule.

import { hash, HOVER_FX, pointer, stillFor, STILL, STILL_AT, sendStill, fontReady, paceFrames } from "./common.js";
import { timeText, is12 } from "./hoverclock.js";

const FONT = {
  0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["0", "0", "1", "0", "1", "0", "0"], // single-pixel dots (2x2 looked too big)
};
// the logo's glyph ramp and density ranges (▒ ▓ █ -> 1 2 3)
const RAMP = ".-:!+*=x#%@";
const RANGES = [null, [1, 4], [3, 7], [4, 9]];
const GLITCH = "!<>-_\\/[]{}=+*^?#%@$&01";
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const PX_W = 3, PX_H = 2;
const BLOCK_COLS = 25 * PX_W; // "HH:MM" is 25 font pixels wide
const BLOCK_ROWS = 7 * PX_H + 3; // plus the date line
const DIM = 1, FG = 2, BRIGHT = 3;

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const place = zone.split("/").pop().replace(/_/g, " ");
const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// colours: { top, low, bright, dim, glow } as [r, g, b] 0..255
export function startHeyClock({ colours, hours = "auto", size = 1, fps = 30 }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.className = "canvas-wall";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The time in big glowing characters, like the heywajih logo, with the date underneath.");
  document.body.append(canvas);
  // heywajih.com's CRT layer over everything: faint scanlines and a vignette
  const crt = document.createElement("div");
  crt.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2;background:repeating-linear-gradient(to bottom, rgba(255,255,255,0.03) 0 1px, transparent 1px 3px), radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.65) 100%)";
  if (!STILL) document.body.append(crt);
  const ctx = canvas.getContext("2d");
  const css = (c) => `rgb(${c.map(Math.round).join(",")})`;
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

  let cols = 0, rows = 0, cw = 0, ch = 0, W = 0, H = 0, font = "";
  let layoutKey = "", L = null, shown = "", cells = new Map(), rowCols = [];
  const listeners = [];
  const settle = (d) => ({ d, base: rand(...RANGES[d]), scr: null });

  function fontPx() {
    const scale = Math.min(2.5, Math.max(0.3, size));
    const share = innerWidth < innerHeight ? 0.9 : 0.6;
    const byWidth = (innerWidth * share * scale) / (BLOCK_COLS * 0.6); // a character is ~0.6em wide
    const byHeight = (innerHeight * 0.8) / BLOCK_ROWS;
    return Math.max(4, Math.min(byWidth, byHeight));
  }
  function measure() {
    const dpr = STILL ? 1 : devicePixelRatio || 1;
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const px = fontPx();
    font = `400 ${px}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;
    ctx.textBaseline = "top";
    cw = ctx.measureText("M").width;
    ch = px; // line-height 1, like heywajih's grid
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);
    layoutKey = "";
  }

  function now(d = new Date()) {
    const twelve = is12(hours);
    const period = twelve ? (d.getHours() < 12 ? "am" : "pm") : "";
    return { text: timeText(d, hours), date: `${dateFormat.format(d)} · ${place}${period ? ` · ${period}` : ""}`.toLowerCase() };
  }

  // density map of the text: cell index -> 1 (▒), 2 (▓), 3 (█)
  function trace(text) {
    const on = new Set();
    let ox = 0;
    for (const c of text) {
      const glyph = FONT[c];
      for (let py = 0; py < 7; py++)
        for (let px = 0; px < glyph[0].length; px++) {
          if (glyph[py][px] !== "1") continue;
          for (let sy = 0; sy < L.pxH; sy++) for (let sx = 0; sx < L.pxW; sx++) on.add((L.y0 + py * L.pxH + sy) * L.cols + L.x0 + (ox + px) * L.pxW + sx);
        }
      ox += glyph[0].length + 1;
    }
    const map = new Map();
    for (const k of on) {
      const inside = on.has(k - 1) && on.has(k + 1);
      map.set(k, inside ? 3 : hash(k % L.cols, Math.floor(k / L.cols), 5) < 0.3 ? 1 : 2);
    }
    return map;
  }

  // reactions
  let pulse = null; // { col, at, life }
  let flashAt = -1e9;
  let sweepAt = 0; // the light sweep's clock: a pulse restarts it
  function react(r) {
    if (reduced) return;
    if (r.type === "pulse" && Array.isArray(r.colour)) {
      pulse = { col: r.colour, at: clock, life: Math.max(2, (r.afterglow || 4) + 1) };
      sweepAt = clock;
    } else if (r.type === "flash") flashAt = clock;
  }

  let clock = 0;
  const puts = []; // [x, y, ch, kind]
  function frame(t, when) {
    clock = t;
    const time = now(when);
    const widthPx = [...time.text].reduce((w, c) => w + FONT[c][0].length, 0) + time.text.length - 1;
    let pxW = PX_W, pxH = PX_H;
    if (widthPx * pxW > cols) [pxW, pxH] = [2, 1];
    const key = `${cols}x${rows}/${pxW}x${pxH}/${widthPx}`;
    if (key !== layoutKey || ((reduced || STILL) && time.text !== shown)) {
      layoutKey = key;
      L = { cols, pxW, pxH, x0: Math.floor((cols - widthPx * pxW) / 2), y0: Math.floor((rows - 7 * pxH) / 2) - 1 };
      cells = new Map([...trace(time.text)].map(([k, d]) => [k, settle(d)]));
      const n = 7 * pxH;
      rowCols = Array.from({ length: n }, (_, i) => mix(colours.top, colours.low, n === 1 ? 0.6 : i / (n - 1)));
      shown = time.text;
      const bottom = (L.y0 + n + 3) * ch;
      listeners.forEach((fn) => fn({ bottom }));
    } else if (time.text !== shown) {
      // new minute: cells that change scramble one by one, left to right
      const next = trace(time.text);
      for (const k of new Set([...cells.keys(), ...next.keys()])) {
        const want = next.get(k) ?? 0;
        const c = cells.get(k);
        if ((c?.scr ? c.scr.d : c?.d ?? 0) === want) continue;
        const start = t + ((k % cols) - L.x0) * 0.012 + Math.random() * 0.15;
        const scr = { start, end: start + 0.15 + Math.random() * 0.25, d: want };
        if (c) c.scr = scr;
        else cells.set(k, { d: 0, base: 0, scr });
      }
      shown = time.text;
    }

    // light sweep: one diagonal pass of 1.6 s every 7 s
    const height = 7 * L.pxH;
    const span = widthPx * L.pxW + height * 2 + 10;
    const band = Math.max(3, span / 28);
    const phase = ((t - sweepAt) % 7) / 1.6;
    const wavePos = reduced || STILL || phase > 1 ? -1e4 : phase * span - band;
    // hover: strong while the cursor moves, gone a second after it stops
    const live = HOVER_FX && pointer.on ? Math.max(0, 1 - stillFor() / 0.9) : 0;
    const px = pointer.x / cw, py = pointer.y / ch;
    const flash = Math.max(0, 1 - (t - flashAt) / 0.35);

    puts.length = 0;
    for (const [k, c] of cells) {
      if (c.scr && t >= c.scr.end) {
        if (!c.scr.d) {
          cells.delete(k);
          continue;
        }
        Object.assign(c, settle(c.scr.d));
      }
      const x = k % cols, y = (k - x) / cols;
      if (c.scr && t >= c.scr.start) {
        puts.push(x, y, GLITCH[rand(0, GLITCH.length - 1)], BRIGHT);
        continue;
      }
      if (!c.d) continue;
      if (!reduced && !STILL && Math.random() < 0.0015) c.base = rand(...RANGES[c.d]); // idle shimmer
      if (live > 0) {
        const near = 1 - Math.hypot((x + 0.5 - px) / 7, (y + 0.5 - py) / 3.5);
        if (near > 0 && Math.random() < near * live * 0.9) {
          puts.push(x, y, GLITCH[rand(0, GLITCH.length - 1)], BRIGHT);
          continue;
        }
      }
      const wave = Math.max(0, 1 - Math.abs(x - L.x0 + (y - L.y0) * 2 - wavePos) / band);
      puts.push(x, y, RAMP[Math.min(RAMP.length - 1, c.base + Math.round(wave * 2))], wave > 0.35 || flash > 0.5 ? BRIGHT : FG);
    }
    // the date, quietly underneath, in the same grid
    const ly = L.y0 + height + 2;
    const lx = Math.floor((cols - time.date.length) / 2);
    [...time.date].forEach((c, i) => c !== " " && puts.push(lx + i, ly, c, DIM));

    // paint: colours per kind (and per row for the digits)
    const pk = pulse ? Math.max(0, 1 - (t - pulse.at) / pulse.life) : 0;
    if (pulse && pk <= 0) pulse = null;
    const tint = (c) => (pk > 0 ? mix(c, pulse.col, 0.65 * pk ** 1.5) : c);
    ctx.fillStyle = css(colours.bg);
    ctx.fillRect(0, 0, W, H);
    ctx.font = font;
    for (let i = 0; i < puts.length; i += 4) {
      const x = puts[i], y = puts[i + 1], kind = puts[i + 3];
      if (kind === BRIGHT) continue; // drawn last, with their glow
      ctx.fillStyle = css(kind === DIM ? colours.dim : tint(rowCols[y - L.y0] ?? colours.low));
      ctx.fillText(puts[i + 2], x * cw, y * ch);
    }
    ctx.save();
    ctx.shadowColor = `rgba(${tint(colours.glow).map(Math.round).join(",")},0.45)`;
    ctx.shadowBlur = 6;
    ctx.fillStyle = css(tint(colours.bright));
    for (let i = 0; i < puts.length; i += 4) if (puts[i + 3] === BRIGHT) ctx.fillText(puts[i + 2], puts[i] * cw, puts[i + 1] * ch);
    ctx.restore();
  }

  const api = { react, onLayout: (fn) => listeners.push(fn) };

  if (STILL) {
    fontReady().then(() => {
      measure();
      frame(0, new Date(2026, 0, 1, 9 + (Math.floor(STILL_AT) % 12), Math.floor(STILL_AT * 7) % 60));
      sendStill(canvas);
    });
    return api;
  }
  measure();
  addEventListener("resize", measure);
  document.fonts?.ready.then(measure);
  const t0 = performance.now();
  paceFrames(reduced ? 1 : fps, (ms) => frame(reduced ? 0 : (ms - t0) / 1000));
  return api;
}
