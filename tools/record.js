// Records the README's jellyfish card: a black rounded card in the banner's
// style, a terminal line on the left and the live jellyfish wallpaper (three
// jellies, cool palette) on the right, as a looping GIF.
// The loop is seamless: the last frames cross-fade into the first ones.

import { GIFEncoder, quantize, applyPalette } from "gifenc";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

const W = 1000, H = 400, RADIUS = 14;
const FPS = 15, SECONDS = 6, BLEND = 12; // BLEND frames cross-fade the loop
const N = FPS * SECONDS;
const card = document.getElementById("card");
const ctx = card.getContext("2d", { willReadFrequently: true });
const jelly = document.getElementById("jelly");
const status = document.getElementById("status");
const button = document.getElementById("rec");

// Brand colours (as in src/brand.css), resolved by the browser
function cssRGB(v) {
  const s = document.createElement("span");
  s.style.color = `var(${v})`;
  document.body.append(s);
  const m = getComputedStyle(s).color.match(/[\d.]+/g).slice(0, 3).join(",");
  s.remove();
  return `rgb(${m})`;
}
import "../src/brand.css";
const FG = cssRGB("--fg"), ACCENT = cssRGB("--accent"), DIM = cssRGB("--dim"), BG = cssRGB("--bg");

function drawFrame(t) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const src = jelly.contentDocument?.querySelector("canvas");
  if (src) ctx.drawImage(src, W - 475, 0, 475, 400);
  // the terminal line, with a soft green glow
  ctx.save();
  ctx.shadowColor = FG;
  ctx.shadowBlur = 10;
  ctx.font = '700 19px "JetBrains Mono", monospace';
  ctx.textBaseline = "middle";
  const x = 48, y = H / 2 - 12;
  ctx.fillStyle = ACCENT;
  ctx.fillText("$ ", x, y);
  const px = x + ctx.measureText("$ ").width;
  ctx.fillStyle = FG;
  const cmd = "afterglow wallpaper jellyfish";
  ctx.fillText(cmd, px, y);
  if (Math.floor(t / 0.55) % 2 === 0) {
    const cx = px + ctx.measureText(cmd + " ").width;
    ctx.fillRect(cx, y - 11, 11, 22);
  }
  ctx.restore();
  ctx.font = '400 15px "JetBrains Mono", monospace';
  ctx.fillStyle = DIM;
  ctx.textBaseline = "middle";
  ctx.fillText("  --tint cool  --count 3", x, y + 34);
}

// Corner pixels outside the rounded card become transparent in the GIF
function cornerMask() {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = Math.max(RADIUS - x - 0.5, x + 0.5 - (W - RADIUS), 0);
      const dy = Math.max(RADIUS - y - 0.5, y + 0.5 - (H - RADIUS), 0);
      if (dx * dx + dy * dy > RADIUS * RADIUS) m[y * W + x] = 1;
    }
  return m;
}

async function record() {
  button.disabled = true;
  const frames = [];
  const total = N + BLEND;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    const due = t0 + (i * 1000) / FPS;
    while (performance.now() < due) await new Promise((r) => requestAnimationFrame(r));
    drawFrame(i / FPS);
    frames.push(ctx.getImageData(0, 0, W, H).data.slice());
    status.textContent = `capturing ${i + 1}/${total}`;
  }
  // Seamless loop: output frames BLEND..total-1, and fade the last BLEND of
  // them into the first BLEND captured frames, which come right before
  // output frame 0
  const out = frames.slice(BLEND);
  for (let j = 0; j < BLEND; j++) {
    const a = (j + 1) / (BLEND + 1);
    const dst = out[N - BLEND + j], src = frames[j];
    for (let k = 0; k < dst.length; k++) dst[k] = dst[k] * (1 - a) + src[k] * a;
  }
  status.textContent = "encoding…";
  await new Promise((r) => setTimeout(r, 0));
  // one palette for every frame (no colour shimmer), sampled from across the loop
  const pick = [0, Math.floor(N / 3), Math.floor((2 * N) / 3)];
  const sample = new Uint8ClampedArray(W * H * 4 * pick.length);
  pick.forEach((f, i) => sample.set(out[f], i * W * H * 4));
  const palette = quantize(sample, 255, { format: "rgb565" });
  const clear = palette.length;
  palette.push([0, 0, 0]);
  const mask = cornerMask();
  const gif = GIFEncoder();
  out.forEach((f, i) => {
    const index = applyPalette(f, palette.slice(0, clear), "rgb565");
    for (let p = 0; p < mask.length; p++) if (mask[p]) index[p] = clear;
    gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay: 1000 / FPS, transparent: true, transparentIndex: clear, repeat: 0 });
  });
  gif.finish();
  const bytes = gif.bytes();
  status.textContent = `saving ${(bytes.length / 1048576).toFixed(1)} MB…`;
  const res = await fetch("/__save-readme-art?name=jellyfish.gif", { method: "POST", body: bytes });
  status.textContent = res.ok ? `saved assets/readme/jellyfish.gif (${(bytes.length / 1048576).toFixed(1)} MB)` : `save failed: ${res.status}`;
  button.disabled = false;
}

// Preview the card live until recording
function preview(now) {
  if (!button.disabled) drawFrame(now / 1000);
  requestAnimationFrame(preview);
}
function ready() {
  status.textContent = "ready";
  requestAnimationFrame(preview);
}
// the frame may have finished loading before this module ran
if (jelly.contentDocument?.readyState === "complete" && jelly.contentDocument.querySelector("canvas")) ready();
else jelly.addEventListener("load", ready, { once: true });
button.addEventListener("click", record);
