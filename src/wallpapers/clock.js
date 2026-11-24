// The clock wallpaper (wallpapers/clock.html): the time, big and centred, in
// the same styles as the hover clock (hoverclock.js clockRows), with the date
// under it and a slow breathing glow. When the minute turns, the characters
// that change scramble into place, left to right, like heywajih's clock.
//
// Options (Settings card; also plain URL options):
//   ?style=   slant (default) | big | lcd (page text) | phosphor | heywajih |
//             light | radar | scope (drawn on a canvas)
//             (phosphor: phosphorclock.js, digits drawn by a CRT beam, GPU and
//             CPU; heywajih: heyclock.js, heywajih.com's clock as it is)
//             (light: lightclock.js, the time drawn as light like the jellies)
//             (radar and scope animate: crtclock.js draws them with the
//             night-scene renderer, GPU and CPU)
//             (anything else falls back to slant)
//   ?tint=    natural (default) | cool | grey | warm | green (the logo's fade)
//   ?fill=    gradient (default) | solid
//   ?hours=   auto (the system's setting) | 12 | 24
//   ?size=    scale (0.5-1.6)
//
// Reactions (signals.rs): pulse -> the glow swells in the app's colour and
// fades over the afterglow; lanterns -> a glowing dot per waiting app under
// the date (rest the cursor on them for a moment: seen); flash -> a quick
// brightening. count -> nothing (no jellies to add).
//
// Rendering: plain DOM text, not GPU/CPU renderers like the other
// wallpapers. The page changes once a minute (plus a CSS glow animation the
// compositor runs), so there's nothing per-frame to move to the graphics
// card: an exception to the "GPU and CPU renderer" rule, agreed for the
// clock. Paused: the glow animation stops. ?still draws the same layout into
// a canvas for "save a still".

import { params, num, STILL, STILL_AT, fontReady, sendStill, isPaused, whenResumed, onReaction, seenLantern, pointer, HOVER, cssRGB } from "./common.js";
import { clockRows, timeText, dateText, STYLES, SHIMMERS, PALETTES } from "./hoverclock.js";

// drawn on a canvas, not as page text: radar, scope and light by a scene
// renderer (GPU and CPU); heywajih by heyclock.js (heywajih.com's clock)
const CRT = ["radar", "scope", "light", "heywajih", "phosphor"];
const STYLE = [...STYLES, ...CRT].includes(params.get("style")) ? params.get("style") : "slant";
const IS_CRT = CRT.includes(STYLE);
const TINT = ["natural", "cool", "grey", "warm", "green"].includes(params.get("tint")) ? params.get("tint") : "natural";
const FILL = params.get("fill") === "solid" ? "solid" : "gradient";
const HOURS = ["12", "24"].includes(params.get("hours")) ? params.get("hours") : "auto";
const SIZE = num("size", 1, 0.5, 1.6);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// top and bottom colours of the gradient
const COLOURS = TINT === "green" ? [rgb(cssRGB("--logo-top")), rgb(cssRGB("--logo-bottom"))] : PALETTES[TINT];
function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}
const [TOP, LOW] = COLOURS;
const rowColour = (i, n) => `color-mix(in srgb, ${LOW} ${FILL === "solid" ? 85 : n > 1 ? Math.round((i / (n - 1)) * 100) : 55}%, ${TOP})`;

// the font size per style, relative to the others, before fitting
const FONT = { slant: 700, big: 700, lcd: 700 };

// ---- the page ----
const style = document.createElement("style");
style.textContent = `
  body { overflow: hidden; cursor: none; display: grid; place-items: center; }
  .clock-wall { text-align: center; font-variant-ligatures: none; }
  .clock-wall pre { margin: 0; line-height: 1.05; letter-spacing: 0; font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; }
  .clock-wall .glow { animation: breathe 6s ease-in-out infinite; }
  .clock-wall.paused .glow { animation-play-state: paused; }
  @keyframes breathe { 50% { filter: brightness(1.18); } }
  .clock-wall .date { margin-top: 1.4em; font: 400 1em/1.2 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.08em; }
  .clock-wall .lanterns { margin-top: 1em; height: 1em; display: flex; gap: 0.9em; justify-content: center; }
  .clock-wall .lanterns i { width: 0.55em; height: 0.55em; border-radius: 50%; display: block; transition: opacity 1.5s; }
  @media (prefers-reduced-motion: reduce) { .clock-wall .glow { animation: none; } }
  .clock-wall.crt { position: fixed; left: 0; right: 0; z-index: 1; }
  .clock-wall.crt .glow { display: none; }
  .clock-wall.crt .date { margin-top: 0; }`;
document.head.append(style);

const wall = document.createElement("div");
wall.className = "clock-wall";
wall.innerHTML = `<div class="glow"><pre></pre></div><div class="date"></div><div class="lanterns"></div>`;
const pre = wall.querySelector("pre");
const dateEl = wall.querySelector(".date");
const lanternsEl = wall.querySelector(".lanterns");
if (!STILL) document.body.append(wall);

// ---- drawing the text ----
let shown = []; // the rows on screen now
function setRows(rows) {
  shown = rows;
  pre.textContent = "";
  rows.forEach((row, i) => {
    const line = document.createElement("span");
    line.style.color = rowColour(i, rows.length);
    line.textContent = row + (i < rows.length - 1 ? "\n" : "");
    pre.append(line);
  });
}

// Fit: the block of characters takes about 55% of the width (85% on a
// portrait screen), times ?size, and at most 45% of the height
function fit() {
  pre.style.font = `${FONT[STYLE]} 10px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace`;
  const w = pre.scrollWidth || 1;
  const h = pre.scrollHeight || 1;
  const portrait = innerHeight > innerWidth;
  const target = Math.min((innerWidth * (portrait ? 0.85 : 0.55) * SIZE) / w, (innerHeight * 0.45 * SIZE) / h) * 10;
  pre.style.fontSize = `${target}px`;
  pre.style.fontVariantLigatures = "none"; // the font shorthand turned them back on: == and != would merge
  wall.style.fontSize = `${Math.max(12, Math.min(28, target * 1.1))}px`; // the date
  pre.style.textShadow = `0 0 ${Math.max(6, target * 0.9)}px color-mix(in srgb, ${LOW} 55%, transparent)`;
  dateEl.style.color = `color-mix(in srgb, ${LOW} 70%, #000)`;
}

// ---- the minute turning over: changed characters scramble into place ----
const NOISE = ".:-=+*#%@";
let scramble = 0;
let turnedAt = -1e9; // when the last minute scramble started
function turnTo(rows) {
  const from = shown.length === rows.length ? shown : rows.map((r) => " ".repeat(r.length));
  const width = Math.max(...rows.map((r) => r.length));
  const t0 = performance.now();
  const DURATION = reduced ? 0 : 900;
  turnedAt = t0;
  cancelAnimationFrame(scramble);
  const step = (now) => {
    const p = DURATION ? (now - t0) / DURATION : 1;
    const mixed = rows.map((row, r) =>
      [...row]
        .map((ch, c) => {
          const old = from[r][c] ?? " ";
          if (old === ch) return ch;
          const settle = c / width; // left to right
          if (p > settle + 0.25) return ch;
          if (p < settle) return old;
          return ch === " " && Math.random() < 0.5 ? " " : NOISE[Math.floor(Math.random() * NOISE.length)];
        })
        .join(""),
    );
    setRows(mixed);
    if (p < 1.25) scramble = requestAnimationFrame(step);
    else setRows(rows);
  };
  scramble = requestAnimationFrame(step);
}
// heywajih's characters shimmer: redrawn every second (a few change), not
// while the minute is scrambling or the wallpaper is paused
let lastText = "";
function shimmer() {
  if (SHIMMERS.includes(STYLE) && !isPaused() && !reduced && lastText) {
    const rows = clockRows(STYLE, lastText);
    if (performance.now() - turnedAt > 1300) setRows(rows);
  }
  setTimeout(shimmer, 1000);
}

function tick(first = false) {
  const now = new Date();
  if (IS_CRT) {
    // radar and scope draw themselves; the time and date go under the face
    dateEl.textContent = `${timeText(now, HOURS)} · ${dateText(now, HOURS)}`;
    setTimeout(() => tick(), 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 30);
    return;
  }
  lastText = timeText(now, HOURS);
  const rows = clockRows(STYLE, lastText);
  if (first || isPaused()) setRows(rows);
  else turnTo(rows);
  dateEl.textContent = dateText(now, HOURS);
  if (first) fit();
  // the next minute, on the minute
  setTimeout(() => tick(), 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 30);
}

// ---- reactions ----
const glowEl = wall.querySelector(".glow");
let pulseTimer = 0;
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    const c = `rgb(${r.colour.join(",")})`;
    const fade = Math.max(0.5, r.afterglow || 4);
    glowEl.style.transition = "none";
    glowEl.style.filter = `drop-shadow(0 0 18px ${c}) drop-shadow(0 0 40px ${c})`;
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      glowEl.style.transition = `filter ${fade}s ease-out`;
      glowEl.style.filter = "";
    }, 300);
  } else if (r.type === "flash") {
    glowEl.style.transition = "none";
    glowEl.style.filter = "brightness(1.8)";
    setTimeout(() => {
      glowEl.style.transition = "filter 0.6s ease-out";
      glowEl.style.filter = "";
    }, 120);
  }
  if (r.type === "pulse" || r.type === "flash") crt?.react(r);
  if (r.type === "lanterns") {
    lanternsEl.textContent = "";
    for (const l of Array.isArray(r.items) ? r.items : []) {
      const dot = document.createElement("i");
      const c = `rgb(${l.colour.join(",")})`;
      dot.style.background = c;
      dot.style.boxShadow = `0 0 10px ${c}, 0 0 22px ${c}`;
      dot.dataset.source = l.source;
      lanternsEl.append(dot);
    }
  }
});

// Rest the cursor on the dots (or just above or below them) for 0.8 s: seen
let overSince = null;
function hoverLoop() {
  if (HOVER && pointer.on && lanternsEl.children.length) {
    const b = lanternsEl.getBoundingClientRect();
    const over = pointer.x > b.left - 30 && pointer.x < b.right + 30 && pointer.y > b.top - 30 && pointer.y < b.bottom + 30;
    if (over) {
      overSince ??= performance.now();
      if (performance.now() - overSince > 800) {
        for (const dot of [...lanternsEl.children]) seenLantern(dot.dataset.source);
        overSince = null;
      }
    } else overSince = null;
  }
  setTimeout(hoverLoop, 150);
}

// ---- pause: the glow stops breathing ----
function pauseLoop() {
  wall.classList.toggle("paused", isPaused());
  if (isPaused()) whenResumed(pauseLoop);
  else setTimeout(pauseLoop, 1000);
}

// ---- still: the same layout drawn into a canvas ----
async function still() {
  await fontReady();
  const W = innerWidth, H = innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = rgb(cssRGB("--bg"));
  ctx.fillRect(0, 0, W, H);
  const when = new Date(2026, 0, 1, 9 + Math.floor(STILL_AT) % 12, Math.floor(STILL_AT * 7) % 60);
  const rows = clockRows(STYLE, timeText(when, HOURS));
  // the same fit as the page, measured on the canvas
  ctx.font = `${FONT[STYLE]} 10px "JetBrains Mono", Consolas, monospace`;
  const cw = ctx.measureText("M").width;
  const cols = Math.max(...rows.map((r) => r.length));
  const portrait = H > W;
  const px = Math.min((W * (portrait ? 0.85 : 0.55) * SIZE) / (cols * cw), (H * 0.45 * SIZE) / (rows.length * 10.5)) * 10;
  ctx.font = `${FONT[STYLE]} ${px}px "JetBrains Mono", Consolas, monospace`;
  const charW = ctx.measureText("M").width;
  const lineH = px * 1.05;
  const x0 = (W - cols * charW) / 2;
  const datePx = Math.max(12, Math.min(28, px * 1.1));
  const blockH = rows.length * lineH + datePx * 2.6;
  const y0 = (H - blockH) / 2;
  ctx.textBaseline = "top";
  // a soft glow: the text drawn blurred first in the low colour
  const paint = () => rows.forEach((row, i) => {
    ctx.fillStyle = mixed(i, rows.length);
    // a character at a time on the grid: whole rows would let the font merge
    // pairs like == and != into ligatures
    [...row].forEach((ch, c) => ch !== " " && ctx.fillText(ch, x0 + c * charW, y0 + i * lineH));
  });
  ctx.shadowColor = LOW;
  ctx.shadowBlur = Math.max(6, px * 0.9);
  paint();
  ctx.shadowBlur = 0;
  paint();
  ctx.font = `400 ${datePx}px "JetBrains Mono", Consolas, monospace`;
  ctx.fillStyle = LOW;
  ctx.globalAlpha = 0.7;
  const d = dateText(when, HOURS);
  ctx.fillText(d, (W - ctx.measureText(d).width) / 2, y0 + rows.length * lineH + datePx * 1.4);
  sendStill(canvas);
}
// canvas colours can't use color-mix: blend the two hex colours by hand
function mixed(i, n) {
  const t = FILL === "solid" ? 0.85 : n > 1 ? i / (n - 1) : 0.55;
  const a = toRGB(TOP), b = toRGB(LOW);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(",")})`;
}
function toRGB(c) {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
  const n = c.match(/\d+/g);
  return n ? n.slice(0, 3).map(Number) : [255, 255, 255];
}

// ---- radar and scope ----
let crt = null;
if (IS_CRT) {
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
  // natural: the green of real phosphor; the other palettes their main colour
  const tint = TINT === "natural" ? [0.2, 1, 0.55] : TINT === "green" ? cssRGB("--logo-bottom").map((v) => v / 255) : hex(PALETTES[TINT][1]);
  wall.classList.add("crt");
  if (STYLE === "phosphor") {
    // the beam-drawn CRT clock; it draws its own date
    dateEl.style.display = "none";
    import("./phosphorclock.js").then(({ startPhosphorClock }) => {
      startPhosphorClock({ onLayout: ({ bottom }) => (wall.style.top = `${bottom + 40}px`) });
    });
  } else if (STYLE === "heywajih") {
    // heywajih.com's clock: the logo's white-to-green by default (as on the
    // site), or a palette when one is picked; the date is in its own grid
    dateEl.style.display = "none";
    const toRGB3 = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const logo = !params.has("tint") || TINT === "green";
    const [top, low] = logo ? [cssRGB("--logo-top"), cssRGB("--logo-bottom")] : PALETTES[TINT].map(toRGB3);
    const colours = {
      bg: cssRGB("--bg"),
      top,
      low,
      bright: logo ? cssRGB("--bright") : [255, 255, 255],
      dim: logo ? cssRGB("--dim") : low.map((v) => v * 0.55),
      glow: low,
    };
    import("./heyclock.js").then(({ startHeyClock }) => {
      crt = startHeyClock({ colours, hours: HOURS, size: SIZE, fps: 30 });
      crt.onLayout(({ bottom }) => (wall.style.top = `${bottom + 6}px`));
    });
  } else if (STYLE === "light") {
    // the date is part of the light; only the lantern dots stay in the page
    dateEl.style.display = "none";
    const brand = [cssRGB("--logo-top"), cssRGB("--logo-bottom")].map((v) => v.map((x) => x / 255));
    import("./lightclock.js").then(({ startLightClock }) => {
      crt = startLightClock({ tint: TINT, brand, hours: HOURS, size: SIZE, fps: 30 });
      crt.onLayout(({ bottom }) => (wall.style.top = `${bottom + 10}px`));
    });
  } else import("./crtclock.js").then(({ startCrtClock }) => {
    crt = startCrtClock({ style: STYLE, tint, size: SIZE, fps: 30 });
    crt.onLayout(({ cy, R }) => {
      wall.style.top = `${cy + R + 28}px`;
      wall.style.fontSize = `${Math.max(13, Math.min(22, R * 0.075))}px`;
      dateEl.style.color = `rgb(${tint.map((v) => Math.round(v * 170)).join(",")})`;
    });
  });
}

if (STILL && IS_CRT) {
  // the scene renderer sends its own still
} else if (STILL) still();
else {
  fontReady().then(() => {
    tick(true);
    if (IS_CRT) return hoverLoop();
    addEventListener("resize", fit);
    pauseLoop();
    hoverLoop();
    shimmer();
  });
}
