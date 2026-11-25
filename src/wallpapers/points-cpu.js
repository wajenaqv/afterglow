// The CPU side of the point wallpapers (attractor, silk): the blur over the
// cells' added-up light and its turning into characters, as points-gl.js does
// on the GPU, and the settings that keep them affordable without a usable GPU.

import { hash } from "./common.js";
import { smooth as sstep } from "./nightscene.js";
import { fineFont, onCPU } from "./strands.js";

// No "-" or "=" (rows of them drew lines across the picture), and how much of
// its cell each character covers (bold JetBrains Mono, measured)
export const GLYPHS = ".:;+*voX#%@";
export const INK = [0.052, 0.092, 0.124, 0.184, 0.213, 0.234, 0.284, 0.325, 0.349, 0.363, 0.461];

// 1 2 1 along `step` (3: across; a row's length: down); past the edge is dark
function pass(from, to, step, row) {
  const n = from.length;
  if (step === 3)
    for (let r = 0; r < n; r += row)
      for (let i = r; i < r + row; i++) to[i] = ((i < r + 3 ? 0 : from[i - 3]) + 2 * from[i] + (i >= r + row - 3 ? 0 : from[i + 3])) * 0.25;
  else for (let i = 0; i < n; i++) to[i] = ((i < step ? 0 : from[i - step]) + 2 * from[i] + (i + step >= n ? 0 : from[i + step])) * 0.25;
}
// 3x3 over acc (rgb per cell), in place, through tmp
export function blur(acc, tmp, cols) {
  pass(acc, tmp, 3, cols * 3);
  pass(tmp, acc, cols * 3, cols * 3);
}
// Every character is drawn as text on the CPU: larger ones, fewer frames (the
// motion is very slow). ?fine keeps the GPU's size, to compare the two
export const pointFont = (H) => (onCPU() ? Math.max(8, Math.min(13, Math.min(H, innerWidth) / 95)) : fineFont(H));
export const pointFps = () => (onCPU() ? 8 : 20);

// One cell's light (acc, rgb at i) -> nightscene.js's [col, char, css]. Points
// add up without limit: held below full. The light is colour x ink, so no step
// shows where the character changes
const col = [0, 0, 0], BLANK = [col, " ", "-"], css = new Map();
export function inkCell(acc, i, cell, faint) {
  const top = Math.max(acc[i], acc[i + 1], acc[i + 2]);
  if (top < faint) return BLANK; // too faint to be worth drawing as text
  const full = 1 - Math.exp(-top * 1.5), tone = 0.44 * full;
  if (tone < 0.008 + 0.016 * hash(cell[0], cell[1], 5)) return BLANK;
  let n = 0;
  while (n < 10 && INK[n] < tone * 1.2) n++;
  const lift = Math.min(1, tone / INK[n]), hot = 0.3 * sstep(0.65, 1, full), d = (hash(cell[0], cell[1], 7) - 0.5) / 63;
  const Q = (v) => {
    const c = v / top;
    return Math.round(Math.min(1, Math.max(0, (c + (1 - c) * hot) * lift + d)) * 63) * 4;
  };
  const key = (Q(acc[i]) << 16) | (Q(acc[i + 1]) << 8) | Q(acc[i + 2]);
  let style = css.get(key);
  if (!style) css.set(key, (style = `rgb(${key >> 16},${(key >> 8) & 255},${key & 255})`));
  return [col, GLYPHS[n], style];
}
