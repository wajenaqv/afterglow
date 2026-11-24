// Shared building blocks for the canvas wallpapers: soft-shape maths,
// colours, and the renderer that turns light into coloured characters. The
// frame loop stops while the app pauses wallpapers.
//
// Units: screen heights (y runs 0..1 down the screen). Light is roughly
// 0..1 per channel; ink() tone-maps it, picks a character by brightness and
// keeps the light's colour, the way jellyfish.js does it.

import { params, num, hash, cssRGB, STILL, STILL_AT, fontReady, sendStill, paceFrames } from "./common.js";
import { wantGPU } from "./gpu.js";
import { createSceneGL } from "./scene-gl.js";

export const reduced = !STILL && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const preview = params.has("preview");

// ---- small maths ----
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
export const add = (a, b, f = 1) => [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f];
export const ellipse = (x, y, cx, cy, rx, ry) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
export const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
// Rounded box: centre, half width, half height, corner radius
export function box(x, y, cx, cy, hw, hh, r = 0) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
export function segment(x, y, ax, ay, bx, by) {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const h = clamp((px * dx + py * dy) / (dx * dx + dy * dy));
  return [Math.hypot(px - dx * h, py - dy * h), h];
}
export const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
};

// ---- colours ----
export const C = (r, g, b) => [r / 255, g / 255, b / 255];
export let BG = [0, 0, 0];
export function setPalette() {
  BG = cssRGB("--bg");
}

// ---- the renderer ----
const RAMP = " .:-=+*oO#%@";
const styles = new Map();
function style(r, g, b) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v / 6) * 6));
  const key = (q(r) << 16) | (q(g) << 8) | q(b);
  let s = styles.get(key);
  if (!s) styles.set(key, (s = `rgb(${q(r)},${q(g)},${q(b)})`));
  return s;
}
// Light -> [character, css colour], or null for a blank cell. The cut-off
// for blank cells is dithered per cell (h: 0..1), so light fading out ends
// in scattered dots instead of a hard outline
function ink(col, chr, h = 0.5, css = null) {
  if (css) return chr === " " ? null : [chr, css]; // the scene chose glyph and colour itself (the cloud sea)
  const L = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
  const T = 1 - Math.exp(-L * 2.2);
  if (!chr && T < 0.045 + 0.06 * h) return null;
  const top = Math.max(col[0], col[1], col[2], 1e-4);
  const f = 0.3 + 0.85 * T;
  const hot = Math.max(0, T - 0.8) * 2.5; // brightest spots run towards white
  const rgb = col.map((v) => {
    const c = (v / top) * 255 * f;
    return c + (255 - c) * hot * 0.6;
  });
  return [chr ?? RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(T * (RAMP.length - 1))))], style(rgb[0], rgb[1], rgb[2])];
}

// Full-screen canvas scene.
//   layout(dims)            on start and resize; dims = { W, H, A, cw, ch, cols, rows }
//   frame(t)                once per frame before sampling (move things)
//   sample(X, Y, t, cell)   -> [colour, char or null] for the cell centred at (X, Y)
//   overlay(t, list)        optional: push [col, row, char, colour] drawn on top
//   fontPx(H)               optional: character size in px for a screen H tall
//                           (default H / 105, 6-12 px; smaller = finer detail)
//   gpu                     optional: the same scene for the GPU renderer
//                           (scene-gl.js): { glsl, bind }. Used when the
//                           Rendering setting allows (gpu.js) and the scene has
//                           no overlay; otherwise the CPU renderer below.
export function startScene({ label, fps = 20, layout, frame: onFrame, sample, overlay, fontPx: sizeFor, gpu }) {
  const newCanvas = () => {
    const c = document.createElement("canvas");
    c.className = "canvas-wall";
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", label);
    return c;
  };
  let canvas = newCanvas();
  document.body.appendChild(canvas);
  let ctx = null;
  let GLR = gpu && !overlay && wantGPU() ? createSceneGL(canvas, { still: STILL, spec: gpu }) : null;
  if (GLR) {
    document.documentElement.dataset.renderer = "gpu";
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      console.warn("afterglow: GPU context lost, switching the scene to the CPU");
      GLR = null;
      const fresh = newCanvas();
      canvas.replaceWith(fresh);
      canvas = fresh;
      ctx = canvas.getContext("2d");
      document.documentElement.dataset.renderer = "cpu";
      resize();
      render(performance.now());
    });
  } else {
    ctx = canvas.getContext("2d");
    document.documentElement.dataset.renderer = "cpu";
  }
  const measure = document.createElement("canvas").getContext("2d"); // for character widths
  const dims = {};

  function resize() {
    const dpr = STILL ? 1 : devicePixelRatio || 1; // stills are exactly the size asked for
    const W = innerWidth, H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const fontPx = sizeFor ? sizeFor(H) : Math.max(6, Math.min(12, H / 105));
    const font = `700 ${fontPx}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
    measure.font = font;
    // the character pitch is a whole number of device pixels: with a fractional
    // pitch (about 5.2 px) every fifth or sixth cell samples two empty pixel
    // columns in a row, which shows as black vertical lines running down the picture
    const cw = Math.max(1, Math.round(measure.measureText("M").width * dpr)) / dpr, ch = fontPx * 1.02;
    Object.assign(dims, { W, H, A: W / H, cw, ch, cols: Math.ceil(W / cw), rows: Math.ceil(H / ch) });
    if (GLR) GLR.resize({ dpr, cw, ch, cols: dims.cols, rows: dims.rows, fontPx, font });
    else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = font;
      ctx.textBaseline = "top";
    }
    layout(dims);
  }

  const start = performance.now();
  function render(now) {
    const { W, H, cw, ch, cols, rows } = dims;
    const t = STILL ? STILL_AT : reduced ? 0 : (now - start) / 1000 + 20;
    onFrame?.(t);
    if (GLR) return GLR.draw({ H, bg: BG });
    const groups = new Map();
    const put = (c, r, ik) => {
      if (!ik) return;
      let list = groups.get(ik[1]);
      if (!list) groups.set(ik[1], (list = []));
      list.push(c, r, ik[0]);
    };
    const top = [];
    overlay?.(t, top);
    const taken = new Set(top.map(([c, r]) => r * cols + c));
    const cell = [0, 0];
    for (let r = 0; r < rows; r++) {
      const Y = ((r + 0.5) * ch) / H;
      for (let c = 0; c < cols; c++) {
        if (taken.has(r * cols + c)) continue;
        cell[0] = c;
        cell[1] = r;
        const [col, chr, css] = sample(((c + 0.5) * cw) / H, Y, t, cell);
        put(c, r, ink(col, chr, hash(c, r, 5), css));
      }
    }
    for (const [c, r, chr, col] of top) put(c, r, ink(col, chr));
    ctx.fillStyle = `rgb(${BG.join(",")})`;
    ctx.fillRect(0, 0, W, H);
    for (const [s, list] of groups) {
      ctx.fillStyle = s;
      for (let i = 0; i < list.length; i += 3) ctx.fillText(list[i + 2], list[i] * cw, list[i + 1] * ch);
    }
  }

  if (STILL) {
    // One frame at the chosen moment, handed to the stills page
    fontReady().then(() => {
      resize();
      render(0);
      sendStill(canvas);
    });
    return dims;
  }
  resize();
  addEventListener("resize", () => {
    resize();
    render(performance.now());
  });
  document.fonts?.ready.then(() => {
    resize();
    render(performance.now());
  });
  // ?fps lowers the rate (Settings → performance), never raises it
  paceFrames(reduced ? 1 : preview ? 8 : Math.min(fps, num("fps", fps, 10, 60)), render);
  return dims;
}
