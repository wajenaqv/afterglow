// The clock's styles, as characters: clockGrid(style, text, now) gives rows of
// cells [character, dim]; dim cells (unlit dots, frames, depth) are drawn
// faint. Used by the hover clock, the clock wallpaper and the Settings
// previews. Only plain ASCII: other block characters fall back to another
// font in the webview and break the grid.
//
// Figlet fonts (clock-fonts.json, made by scripts/clock-font.js): slant, big,
// doom, lean, isometric, and split-flap's digits. The rest are drawn here.

import FONTS from "./clock-fonts.json";

// ---- pixels: 5 x 7 digits ----
// heywajih's own (heywajih.com's clock wallpaper font)
const PIX7 = {
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
  ":": ["0", "0", "1", "0", "1", "0", "0"], // single-pixel dots
};
/** Seven rows of "0" and "1" for the whole time */
const pixels = (text) => Array.from({ length: 7 }, (_, y) => [...text].map((c) => PIX7[c][y]).join("0"));

const hash = (x, y, s) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- a grid of cells ----
const grid = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => [" ", 0]));
function put(g, x, y, ch, dim = 0) {
  x = Math.round(x);
  y = Math.round(y);
  if (g[y]?.[x]) g[y][x] = [ch, dim];
}
const write = (g, x, y, s, dim = 0) => [...s].forEach((ch, i) => put(g, x + i, y, ch, dim));
function fromRows(rows) {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r.padEnd(w)].map((c) => [c, 0]));
}
/** Every lit pixel of a pixel font, as (x, y) */
function eachPixel(text, fn) {
  pixels(text).forEach((r, y) => [...r].forEach((c, x) => c === "1" && fn(x, y)));
}

// ---- styles ----
const figlet = (font) => (text) => fromRows(FONTS[font]["0"].map((_, r) => [...text].map((ch) => FONTS[font][ch][r]).join("")));

// heywajih's logo ramp and its density ranges (light edge, edge, solid)
const RAMP = ".-:!+*=x#%@";
const RANGES = [null, [1, 4], [3, 7], [4, 9]];
const SHIMMER = 20_000; // ms: each character picks a new one about this often
function heywajih(text, now) {
  const PX_W = 3, PX_H = 2;
  const p = pixels(text);
  const lit = (x, y) => p[Math.floor(y / PX_H)]?.[Math.floor(x / PX_W)] === "1";
  const g = grid(p[0].length * PX_W, 7 * PX_H);
  g.forEach((row, y) =>
    row.forEach((_, x) => {
      if (!lit(x, y)) return;
      // the outermost cell of a stroke (side to side) is lighter, the rest solid
      const d = lit(x - 1, y) && lit(x + 1, y) ? 3 : hash(x, y, 5) < 0.3 ? 1 : 2;
      const [a, b] = RANGES[d];
      put(g, x, y, RAMP[a + Math.floor(hash(x, y, Math.floor(now / SHIMMER + hash(x, y, 9))) * (b - a + 1))]);
    }),
  );
  return g;
}

// Seven segments: a top, b top-right, c bottom-right, d bottom, e
// bottom-left, f top-left, g middle; five rows tall
const SEGMENTS = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function lcd(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text) {
    if (ch === ":") {
      ["   ", "   ", " o ", " o ", "   "].forEach((c, i) => (rows[i] += c));
      continue;
    }
    const s = SEGMENTS[ch];
    const on = (k, c) => (s.includes(k) ? c : " ".repeat(c.length));
    rows[0] += ` ${on("a", "___")}  `;
    rows[1] += `${on("f", "|")}   ${on("b", "|")} `;
    rows[2] += `${on("f", "|")}${on("g", "___")}${on("b", "|")} `;
    rows[3] += `${on("e", "|")}   ${on("c", "|")} `;
    rows[4] += `${on("e", "|")}${on("d", "___")}${on("c", "|")} `;
  }
  return fromRows(rows);
}

// A bus sign: every dot there, the unlit ones faint
const flipDot = (text) => pixels(text).map((r) => [...r].flatMap((c) => (c === "1" ? [["(", 0], [")", 0]] : [[" ", 1], [".", 1]])));

// An airport board: a card per digit, its hinge at the sides
function splitFlap(text) {
  const g = grid(0, 7);
  for (const c of text) {
    const glyph = FONTS.small[c];
    const w = c === ":" ? 5 : 11;
    const part = grid(w, 7);
    if (c !== ":") {
      write(part, 0, 0, `.${"-".repeat(w - 2)}.`, 1);
      write(part, 0, 6, `'${"-".repeat(w - 2)}'`, 1);
      for (let y = 1; y < 6; y++) for (const x of [0, w - 1]) put(part, x, y, y === 3 ? "+" : "|", 1);
    }
    const x0 = Math.floor((w - glyph[0].length) / 2);
    glyph.forEach((r, y) => [...r].forEach((ch, x) => ch !== " " && put(part, x0 + x, y + 1, ch)));
    part.forEach((r, y) => g[y].push(...r));
  }
  return g;
}

// Digits as strokes between points, in a box 2 wide and 4 tall
const STARS = {
  0: [[1, 0], [2, 1], [2, 3], [1, 4], [0, 3], [0, 1], [1, 0]],
  1: [[0.2, 1], [1.2, 0], [1.2, 4]],
  2: [[0, 1], [1, 0], [2, 1], [0, 4], [2, 4]],
  3: [[0, 0], [2, 0], [1, 1.7], [2, 3], [1, 4], [0, 3.4]],
  4: [[1.5, 4], [1.5, 0], [0, 2.7], [2, 2.7]],
  5: [[2, 0], [0.2, 0], [0, 2], [1.4, 1.7], [2, 3], [1, 4], [0, 3.6]],
  6: [[1.7, 0], [0, 2.4], [0.4, 3.8], [1.7, 3.8], [2, 2.6], [1, 2], [0, 2.4]],
  7: [[0, 0], [2, 0], [0.7, 4]],
  8: [[1, 0], [2, 1], [0, 3], [1, 4], [2, 3], [0, 1], [1, 0]],
  9: [[0.4, 4], [2, 1.6], [1.6, 0.2], [0.3, 0.2], [0, 1.4], [1, 2], [2, 1.6]],
};
function constellation(text) {
  const g = grid(text.length * 11, 11);
  let x0 = 0;
  for (const c of text) {
    if (c === ":") {
      put(g, x0 + 1, 3, "*");
      put(g, x0 + 1, 7, "*");
      x0 += 5;
      continue;
    }
    const at = ([x, y]) => [x0 + x * 4, y * 2.5];
    const line = STARS[c];
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = at(line[i - 1]), [bx, by] = at(line[i]);
      const dx = bx - ax, dy = by - ay, n = Math.max(Math.abs(dx), Math.abs(dy));
      const ch = Math.abs(dx) < 0.8 ? "|" : Math.abs(dy) < 0.8 ? "-" : dx * dy > 0 ? "\\" : "/";
      for (let k = 1; k < n; k++) put(g, ax + (dx * k) / n, ay + (dy * k) / n, ch, 1);
    }
    for (const p of line) put(g, ...at(p), "*");
    x0 += 11;
  }
  return g.map((r) => r.slice(0, x0 - 2));
}

const TRACES = {
  0: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]],
  1: [[[0, 1], [1, 0], [1, 4]], [[0, 4], [2, 4]]],
  2: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 4], [2, 4]]],
  3: [[[0, 0], [2, 0], [2, 4], [0, 4]], [[0, 2], [2, 2]]],
  4: [[[0, 0], [0, 2], [2, 2]], [[2, 0], [2, 4]]],
  5: [[[2, 0], [0, 0], [0, 2], [2, 2], [2, 4], [0, 4]]],
  6: [[[2, 0], [0, 0], [0, 4], [2, 4], [2, 2], [0, 2]]],
  7: [[[0, 0], [2, 0], [2, 4]]],
  8: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]], [[0, 2], [2, 2]]],
  9: [[[2, 2], [0, 2], [0, 0], [2, 0], [2, 4], [0, 4]]],
};
function circuit(text) {
  const g = grid(text.length * 10, 9);
  let x0 = 0;
  for (const c of text) {
    if (c === ":") {
      put(g, x0 + 1, 2, "o");
      put(g, x0 + 1, 6, "o");
      x0 += 4;
      continue;
    }
    for (const line of TRACES[c]) {
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], [bx, by] = line[i];
        const n = Math.max(Math.abs(bx - ax) * 3, Math.abs(by - ay) * 2);
        for (let k = 0; k <= n; k++) put(g, x0 + (ax + ((bx - ax) * k) / n) * 3, (ay + ((by - ay) * k) / n) * 2, ay === by ? "-" : ax === bx ? "|" : "/");
      }
      line.forEach((p, i) => put(g, x0 + p[0] * 3, p[1] * 2, i === 0 || i === line.length - 1 ? "o" : "+"));
    }
    x0 += 10;
  }
  return g.map((r) => r.slice(0, x0 - 2));
}

// Solid digits, with a faint depth behind them
function extruded(text) {
  const g = grid(pixels(text)[0].length * 2 + 2, 9);
  for (let d = 2; d > 0; d--) eachPixel(text, (x, y) => write(g, x * 2 + d, y + d, "\\\\", 1));
  eachPixel(text, (x, y) => write(g, x * 2, y, "##"));
  return g;
}

// Leaning strokes
function hatch(text) {
  const g = grid(pixels(text)[0].length * 2 + 6, 7);
  eachPixel(text, (x, y) => write(g, x * 2 + 6 - y, y, "//"));
  return g;
}

// Digits lit inside falling code
const CODE = "0123456789+-=<>*:.%#";
const RAIN_STEP = 350; // ms
function rain(text, now) {
  const p = pixels(text), s = Math.floor(now / RAIN_STEP);
  const g = grid(p[0].length * 2 + 4, 9);
  g.forEach((row, y) =>
    row.forEach((_, x) => {
      const lit = p[y - 1]?.[(x - 2) >> 1] === "1";
      const falls = (((y - s + x * 5) % 11) + 11) % 11 < 4;
      if (lit || falls) put(g, x, y, CODE[Math.floor(hash(x, y, lit ? s >> 3 : s) * CODE.length)], lit ? 0 : 1);
    }),
  );
  return g;
}

// A column per digit, a row per bit (8 4 2 1), the digit under it
function binary(text) {
  const digits = text.padStart(5, "0").replace(":", "");
  const g = grid(25, 6);
  const col = (i) => 4 + i * 5 + (i > 1 ? 2 : 0);
  [8, 4, 2, 1].forEach((bit, y) => {
    put(g, 0, y, String(bit), 1);
    [...digits].forEach((c, i) => write(g, col(i), y, +c & bit ? "(@)" : "( )", +c & bit ? 0 : 1));
  });
  [...digits].forEach((c, i) => put(g, col(i) + 1, 5, c, 1));
  return g;
}

// A round face
function dial(text, now) {
  const d = new Date(now);
  const g = grid(33, 17), cx = 16, cy = 8;
  const at = (turn, r) => [cx + Math.sin(turn * 2 * Math.PI) * 15.5 * r, cy - Math.cos(turn * 2 * Math.PI) * 7.8 * r];
  for (let i = 0; i < 60; i++) put(g, ...at(i / 60, 1), i % 5 ? "." : "o", i % 15 ? 1 : 0);
  const hand = (turn, len, ch) => {
    for (let r = 0.06; r < len; r += 0.03) put(g, ...at(turn, r), ch);
  };
  hand((d.getHours() + d.getMinutes() / 60) / 12, 0.52, "#");
  hand(d.getMinutes() / 60, 0.82, "*");
  put(g, cx, cy, "@");
  return g;
}

// Hours, minutes and seconds filling up. The time's own text says whether
// the hours run to 12 or 24.
function bars(text, now, twelve) {
  const d = new Date(now);
  const hours = twelve ? d.getHours() % 12 : d.getHours();
  const g = grid(29, 5);
  const row = (y, name, share, label) => {
    write(g, 0, y, `${name} [`, 1);
    for (let i = 0; i < 22; i++) put(g, 3 + i, y, i < Math.round(share * 22) ? "#" : "-", i < Math.round(share * 22) ? 0 : 1);
    write(g, 25, y, "]", 1);
    write(g, 27, y, label);
  };
  row(0, "h", hours / (twelve ? 12 : 24), text.split(":")[0].padStart(2));
  row(2, "m", d.getMinutes() / 60, text.split(":")[1]);
  row(4, "s", d.getSeconds() / 60, String(d.getSeconds()).padStart(2, "0"));
  return g;
}

// The time in words, to the nearest five minutes
const HOURS = "twelve one two three four five six seven eight nine ten eleven".split(" ");
const PAST = { 5: "five", 10: "ten", 15: "quarter", 20: "twenty", 25: "twenty five", 30: "half" };
function words(text, now) {
  const d = new Date(now);
  const m = Math.round(d.getMinutes() / 5) * 5;
  const hour = HOURS[d.getHours() % 12], next = HOURS[(d.getHours() + 1) % 12];
  if (m === 0) return fromRows([hour, "o'clock"]);
  if (m === 60) return fromRows([next, "o'clock"]);
  return fromRows(m <= 30 ? [`${PAST[m]} past`, hour] : [`${PAST[60 - m]} to`, next]);
}

// Each style: how it's drawn; px, the hover clock's font size at medium;
// every (ms), how often it changes while shown, if it moves
const ALL = {
  text: { draw: (text) => fromRows([text]), px: 52, weight: 400 }, // just the time, in the normal font
  slant: { draw: figlet("slant"), px: 14 },
  heywajih: { draw: heywajih, px: 6, every: 1000 },
  big: { draw: figlet("big"), px: 12 },
  lcd: { draw: lcd, px: 15 },
  doom: { draw: figlet("doom"), px: 12 },
  lean: { draw: figlet("lean"), px: 9 },
  isometric: { draw: figlet("isometric"), px: 10 },
  "flip-dot": { draw: flipDot, px: 9 },
  "split-flap": { draw: splitFlap, px: 12 },
  constellation: { draw: constellation, px: 11 },
  circuit: { draw: circuit, px: 11 },
  extruded: { draw: extruded, px: 9 },
  hatch: { draw: hatch, px: 10 },
  rain: { draw: rain, px: 9, every: RAIN_STEP },
  binary: { draw: binary, px: 14 },
  dial: { draw: dial, px: 10 },
  bars: { draw: bars, px: 13, every: 1000 },
  words: { draw: words, px: 24 },
};

/** Every style, in the order Settings shows them (extras.rs CLOCK_STYLES) */
export const STYLES = Object.keys(ALL);
/** The styles the clock wallpaper offers, in order. The others (big, doom, lean,
 * isometric, lcd, dial, circuit, constellation, binary, split-flap, scope, and the older phosphor and light) are
 * only switched off: add a name here to bring it back. The corner clock has
 * every style in STYLES. */
export const WALL_STYLES = ["slant", "heywajih", "extruded", "tube", "jelly", "eclipse", "radar", "flip-dot", "hatch", "rain", "bars", "words", "text"];
export const validStyle = (s) => (STYLES.includes(s) ? s : "slant");
/** The hover clock's font size at medium, px */
export const sizeOf = (style) => ALL[style].px;
/** The font weight it's drawn in */
export const weightOf = (style) => ALL[style].weight ?? 700;
/** How often a moving style changes, ms (0: it only changes with the minute) */
export const everyOf = (style) => ALL[style].every ?? 0;
/** The time as rows of cells [character, dim] */
export function clockGrid(style, text = "4:43", now = Date.now(), twelve = true) {
  return ALL[validStyle(style)].draw(text, now, twelve);
}
