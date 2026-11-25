// The CPU side of the point wallpapers (attractor, silk): a light blur over the
// cells' added-up light, as points-gl.js does on the GPU, and the settings that
// keep them affordable without a usable GPU.

import { fineFont, onCPU } from "./strands.js";

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
