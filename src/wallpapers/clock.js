// The clock wallpaper (wallpapers/clock.html): the time, big and centred, in
// the same styles as the hover clock (clockstyles.js), with the date
// under it and a slow breathing glow. When the minute turns, the characters
// that change scramble into place, left to right, like heywajih's clock.
//
// Options (Settings card; also plain URL options):
//   ?style=   slant (default) and the other styles of clockstyles.js (page
//             text), or tube | jelly | eclipse | heywajih | radar (and, switched
//             off, phosphor | light | scope) (drawn on a
//             canvas)
//             (tube, jelly, eclipse: glowclock.js)
//             (phosphor: phosphorclock.js, digits drawn by a CRT beam, GPU and
//             CPU; heywajih: heyclock.js, heywajih.com's clock as it is)
//             (light: lightclock.js, the time drawn as light like the jellies)
//             (radar and scope animate: crtclock.js draws them with the
//             night-scene renderer, GPU and CPU)
//             (only those in clockstyles.js WALL_STYLES are offered; anything
//             else falls back to slant)
//   ?tint=    natural (default) | cool | grey | warm | green (the logo's fade) |
//             custom, with ?colour=rrggbb (one flat colour)
//   ?fill=    gradient (default) | solid
//   ?hours=   auto (the system's setting) | 12 | 24
//   ?size=    scale (0.5-1.6)
//
// Reactions (signals.rs): pulse -> the glow swells in the app's colour and
// fades over the afterglow; lanterns -> a glowing dot per waiting app under
// the date (rest the cursor on one for a moment: seen); flash -> a quick
// brightening. count -> nothing (no jellies to add).
//
// Rendering: plain DOM text, not GPU/CPU renderers like the other
// wallpapers. The page changes once a minute (plus a CSS glow animation the
// compositor runs), so there's nothing per-frame to move to the graphics
// card: an exception to the "GPU and CPU renderer" rule, agreed for the
// clock. Paused: the glow animation stops. ?still draws the same layout into
// a canvas for "save a still".

import { params, num, STILL, STILL_AT, fontReady, sendStill, isPaused, whenResumed, onReaction, seenLantern, pointer, HOVER, cssRGB } from "./common.js";
import { timeText, dateText, is12 } from "./hoverclock.js";
import { STYLES, WALL_STYLES, clockGrid, everyOf, weightOf } from "./clockstyles.js";
import { brandColours, paintGrid, parseHex, rowColour as colourOfRow } from "./clockcolours.js";

// drawn on a canvas, not as page text: radar, scope and light by a scene
// renderer (GPU and CPU); heywajih by heyclock.js (heywajih.com's clock)
// tube, jelly and eclipse by glowclock.js; phosphor and light are the older
// clocks tube and jelly replaced, switched off
const GLOW = ["tube", "jelly", "eclipse"];
const CRT = ["radar", "scope", "light", "heywajih", "phosphor", ...GLOW];
const RENAMED = { phosphor: "tube", light: "jelly" };
// ?all (tools/clocks.html) shows the switched-off ones too
const OFFERED = params.has("all") ? [...STYLES, ...CRT] : WALL_STYLES;
const asked = params.get("style");
const STYLE = OFFERED.includes(asked) ? asked : (RENAMED[asked] ?? "slant");
const IS_CRT = CRT.includes(STYLE);
const TINT = ["natural", "cool", "grey", "warm", "green", "custom"].includes(params.get("tint")) ? params.get("tint") : "natural";
const FILL = params.get("fill") === "solid" ? "solid" : "gradient";
const HOURS = ["12", "24"].includes(params.get("hours")) ? params.get("hours") : "auto";
const SIZE = num("size", 1, 0.5, 1.6);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// the clock's own palettes, [top, bottom] of the gradient; green is the logo's
// fade, custom one colour of your own (?colour=rrggbb)
const PALETTES = {
  natural: [[255, 225, 240], [185, 140, 255]],
  cool: [[217, 245, 255], [63, 140, 255]],
  grey: [[245, 245, 245], [142, 148, 156]],
  warm: [[255, 227, 207], [255, 122, 77]],
};
const OWN = parseHex(params.get("colour")) ?? [255, 255, 255];
const COLOURS = TINT === "green" ? brandColours() : TINT === "custom" ? [OWN, OWN] : PALETTES[TINT];
const rgb = (c) => `rgb(${c.join(", ")})`;
const LOW = rgb(COLOURS[1]);

// ---- the page ----
const style = document.createElement("style");
style.textContent = `
  body { overflow: hidden; cursor: none; display: grid; place-items: center; }
  .clock-wall { text-align: center; font-variant-ligatures: none; }
  .clock-wall pre { width: max-content; margin: 0 auto; text-align: left; line-height: 1.05; letter-spacing: 0; font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; }
  .clock-wall .glow { animation: breathe 6s ease-in-out infinite; }
  .clock-wall.paused .glow { animation-play-state: paused; }
  @keyframes breathe { 50% { filter: brightness(1.18); } }
  .clock-wall .date { margin-top: 1.4em; font: 400 1em/1.2 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.08em; }
  .clock-wall .lanterns { margin-top: 1.3em; height: 1.2em; display: flex; gap: 1.7em; justify-content: center; align-items: center; }
  .clock-wall .lanterns i { width: 0.5em; height: 0.5em; border-radius: 50%; display: block; position: relative; background: var(--c); animation: lantern 4.5s ease-in-out infinite; animation-delay: var(--late); transition: opacity 0.5s, transform 0.8s; }
  .clock-wall .lanterns i::before { content: ""; position: absolute; inset: -1.1em; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--c) 46%, transparent) 0, color-mix(in srgb, var(--c) 15%, transparent) 38%, transparent 70%); transition: opacity 0.8s, transform 0.8s; }
  .clock-wall .lanterns i.drain { animation: none; transform: scale(0.45); opacity: 0.35; }
  .clock-wall .lanterns i.drain::before { opacity: 0; transform: scale(0.4); }
  .clock-wall .lanterns i.gone { animation: none; opacity: 0; }
  .clock-wall.paused .lanterns i { animation-play-state: paused; }
  @keyframes lantern { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .clock-wall .glow, .clock-wall .lanterns i { animation: none; } }
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
let shown = []; // the cells on screen now
function setCells(cells) {
  shown = cells;
  paintGrid(pre, cells, COLOURS, FILL === "solid");
}
const cellsNow = (now = new Date()) => clockGrid(STYLE, timeText(now, HOURS), now.getTime(), is12(HOURS));

// Fit: the block of characters takes about 55% of the width (85% on a
// portrait screen), times ?size, and at most 45% of the height
function fit() {
  pre.style.font = `${weightOf(STYLE)} 10px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace`;
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
function turnTo(cells) {
  const from = shown;
  const width = Math.max(...cells.map((r) => r.length));
  const t0 = performance.now();
  const DURATION = reduced ? 0 : 900;
  turnedAt = t0;
  cancelAnimationFrame(scramble);
  const step = (now) => {
    const p = DURATION ? (now - t0) / DURATION : 1;
    const mixed = cells.map((row, r) =>
      row.map((cell, c) => {
        const old = from[r]?.[c] ?? [" ", 0];
        if (old[0] === cell[0] && old[1] === cell[1]) return cell;
        const settle = c / width; // left to right
        if (p > settle + 0.25) return cell;
        if (p < settle) return old;
        return cell[0] === " " && Math.random() < 0.5 ? [" ", 0] : [NOISE[Math.floor(Math.random() * NOISE.length)], cell[1]];
      }),
    );
    if (p < 1.25) {
      setCells(mixed);
      scramble = requestAnimationFrame(step);
    } else setCells(cells);
  };
  scramble = requestAnimationFrame(step);
}
// Moving styles (rain, bars, …) are drawn again in between, not while the
// minute is scrambling or the wallpaper is paused
function move() {
  const every = everyOf(STYLE);
  if (!every || reduced) return;
  if (!isPaused() && shown.length && performance.now() - turnedAt > 1300) setCells(cellsNow());
  setTimeout(move, every);
}

function tick(first = false) {
  const now = new Date();
  if (IS_CRT) {
    // radar and scope draw themselves; the time and date go under the face
    dateEl.textContent = GLOW.includes(STYLE) ? dateText(now, HOURS) : `${timeText(now, HOURS)} · ${dateText(now, HOURS)}`;
    setTimeout(() => tick(), 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 30);
    return;
  }
  const cells = cellsNow(now);
  // scrambling would hide what a moving style is doing anyway; a style whose
  // size changes with the time (words) is fitted again
  const resized = !first && (cells.length !== shown.length || cells[0].length !== shown[0].length);
  if (first || resized || isPaused() || everyOf(STYLE)) setCells(cells);
  else turnTo(cells);
  if (resized) fit();
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
  if (r.type === "lanterns") showLanterns(Array.isArray(r.items) ? r.items : []);
});

// Waiting apps: a glowing dot each, under the date. A dot keeps its place (and
// its breathing) while others come and go.
const dots = () => [...lanternsEl.children].filter((d) => !d.classList.contains("gone"));
function showLanterns(items) {
  for (const dot of dots())
    if (!items.some((l) => l.source === dot.dataset.source)) {
      dot.classList.add("gone");
      setTimeout(() => dot.remove(), 500);
    }
  for (const l of items) {
    const c = `rgb(${l.colour.join(",")})`;
    let dot = dots().find((d) => d.dataset.source === l.source);
    if (!dot) {
      dot = document.createElement("i");
      dot.dataset.source = l.source;
      dot.style.setProperty("--late", `${-1.4 * lanternsEl.children.length}s`);
      lanternsEl.append(dot);
    }
    dot.classList.remove("drain");
    dot.style.setProperty("--c", c);
  }
}

// Rest the cursor on a dot for 0.8 s: it drains, and its app is seen
let over = null; // { dot, since }
function hoverLoop() {
  const reach = Math.max(13, (parseFloat(getComputedStyle(lanternsEl).fontSize) || 16) * 1.05);
  const hit =
    HOVER && pointer.on
      ? dots().find((d) => {
          // the middle of the dot: it shrinks while it drains
          const b = d.getBoundingClientRect();
          return Math.hypot(pointer.x - b.left - b.width / 2, pointer.y - b.top - b.height / 2) < reach;
        })
      : null;
  if (over && over.dot !== hit) {
    over.dot.classList.remove("drain");
    over = null;
  }
  if (hit && !over) {
    over = { dot: hit, since: performance.now() };
    hit.classList.add("drain");
  } else if (over && performance.now() - over.since > 800) {
    seenLantern(over.dot.dataset.source);
    over.since = Infinity; // once; the app sends the new list back
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
  const rows = cellsNow(when);
  // the same fit as the page, measured on the canvas
  ctx.font = `${weightOf(STYLE)} 10px "JetBrains Mono", Consolas, monospace`;
  const cw = ctx.measureText("M").width;
  const cols = Math.max(...rows.map((r) => r.length));
  const portrait = H > W;
  const px = Math.min((W * (portrait ? 0.85 : 0.55) * SIZE) / (cols * cw), (H * 0.45 * SIZE) / (rows.length * 10.5)) * 10;
  ctx.font = `${weightOf(STYLE)} ${px}px "JetBrains Mono", Consolas, monospace`;
  const charW = ctx.measureText("M").width;
  const lineH = px * 1.05;
  const x0 = (W - cols * charW) / 2;
  const datePx = Math.max(12, Math.min(28, px * 1.1));
  const blockH = rows.length * lineH + datePx * 2.6;
  const y0 = (H - blockH) / 2;
  ctx.textBaseline = "top";
  // a soft glow: the text drawn blurred first in the low colour
  const paint = () => rows.forEach((row, i) => {
    // a character at a time on the grid: whole rows would let the font merge
    // pairs like == and != into ligatures
    row.forEach(([ch, dim], c) => {
      if (ch === " ") return;
      ctx.fillStyle = rgb(colourOfRow(COLOURS, i, rows.length, dim, FILL === "solid"));
      ctx.fillText(ch, x0 + c * charW, y0 + i * lineH);
    });
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
// ---- radar and scope ----
let crt = null;
if (IS_CRT) {
  const unit = (c) => c.map((v) => v / 255);
  // natural: the green of real phosphor; the other palettes their main colour
  const tint = TINT === "natural" ? [0.2, 1, 0.55] : unit(COLOURS[1]);
  wall.classList.add("crt");
  if (GLOW.includes(STYLE)) {
    import("./glowclock.js").then(({ startGlowClock }) => {
      crt = startGlowClock({ kind: STYLE, tint: TINT, colours: TINT === "natural" ? null : COLOURS.map(unit).map((c, i, all) => (FILL === "solid" ? all[1] : c)), hours: HOURS, size: SIZE });
      crt.onLayout(({ bottom }) => {
        wall.style.top = `${bottom + innerHeight * 0.075}px`;
        wall.style.fontSize = `${Math.max(13, Math.min(26, Math.min(innerWidth, innerHeight) * 0.022))}px`;
        const low = STYLE === "tube" && TINT !== "custom" ? { natural: [128, 255, 107], green: [51, 255, 153], warm: [255, 168, 41], cool: [87, 168, 255], grey: [199, 214, 242] }[TINT] : COLOURS[1];
        dateEl.style.color = `color-mix(in srgb, ${rgb(low)} 62%, #000)`;
      });
    });
  } else if (STYLE === "phosphor") {
    // the beam-drawn CRT clock; it draws its own date
    dateEl.style.display = "none";
    import("./phosphorclock.js").then(({ startPhosphorClock }) => {
      startPhosphorClock({ onLayout: ({ bottom }) => (wall.style.top = `${bottom + 40}px`) });
    });
  } else if (STYLE === "heywajih") {
    // heywajih.com's clock: the logo's white-to-green by default (as on the
    // site), or a palette when one is picked; the date is in its own grid
    dateEl.style.display = "none";
    const logo = !params.has("tint") || TINT === "green";
    const [top, low] = logo ? brandColours() : COLOURS;
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
    import("./lightclock.js").then(({ startLightClock }) => {
      crt = startLightClock({ tint: TINT, own: TINT === "green" || TINT === "custom" ? COLOURS.map(unit) : null, hours: HOURS, size: SIZE, fps: 30 });
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
    if (IS_CRT) return pauseLoop(), hoverLoop();
    addEventListener("resize", fit);
    pauseLoop();
    hoverLoop();
    move();
  });
}
