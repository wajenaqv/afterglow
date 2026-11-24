// The hover clock (host.js): rest the cursor in a chosen corner of a monitor
// for half a second and the time fades in there, with the day and date
// underneath. It fades out a second after the cursor leaves the corner, and
// costs nothing while hidden (no timers run). The system's 12/24-hour
// setting decides the format. Every wallpaper gets it, since it lives in the
// host page above the frames.
//
// Settings → clock (extras.rs Clock, live through the "clock" event): off, on
// hover or always, and:
//   style   clockstyles.js
//   corner  top-right (default), top-left, bottom-right, bottom-left
//   colour  wallpaper: what the wallpaper is drawn in (clockcolours.js);
//           brand: the logo's white-to-green fade; or a colour of your own,
//           "#rrggbb"
//   fill    gradient (light at the top into the colour) or solid

import "@fontsource/jetbrains-mono/300.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "../brand.css";
import { clockGrid, everyOf, sizeOf, validStyle, weightOf } from "./clockstyles.js";
import { clockColours, paintGrid } from "./clockcolours.js";

const ZONE_W = 220; // CSS px from the side edge
const ZONE_H = 140; // CSS px from the top or bottom edge
const EDGE_X = 36; // where the clock sits, from the side
const EDGE_TOP = 30; // ... from the top
const EDGE_BOTTOM = 72; // ... from the bottom (clear of a taskbar)
const SHOW_AFTER = 500; // ms resting in the corner
const HIDE_AFTER = 1000; // ms after leaving it

/** Sizes: how much bigger than the base size (CSS zoom) */
const SIZES = { small: 0.75, medium: 1, large: 1.4, huge: 2 };

// 12 or 24 hours: "auto" follows the system's setting, "12" or "24" (24-hour
// time, "military" time) choose
const systemHour12 = (() => {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    return hc === "h12" || hc === "h11";
  } catch {
    return false;
  }
})();
export const is12 = (hours) => (hours === "12" ? true : hours === "24" ? false : systemHour12);

/** "4:43" or "16:43" */
export function timeText(now, hours = "auto") {
  let h = now.getHours();
  const twelve = is12(hours);
  if (twelve) h = h % 12 || 12;
  const hh = twelve ? String(h) : String(h).padStart(2, "0");
  return `${hh}:${String(now.getMinutes()).padStart(2, "0")}`;
}
/** "pm · sat, nov 21" (no am/pm in 24-hour time) */
export function dateText(now, hours = "auto") {
  const date = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toLowerCase();
  return is12(hours) ? `${now.getHours() < 12 ? "am" : "pm"} · ${date}` : date;
}

function css() {
  const style = document.createElement("style");
  style.textContent = `
    .hover-clock {
      position: absolute; pointer-events: none; z-index: 2;
      font-variant-ligatures: none;
      opacity: 0; transition: opacity 0.6s ease;
    }
    .hover-clock.on { opacity: 1; }
    .hover-clock.right { text-align: right; }
    .hover-clock pre { margin: 0; letter-spacing: 0; line-height: 1.05; font-variant-ligatures: none !important; } /* !important: each style sets the font shorthand, which turns ligatures back on (== and != would merge) */
    .hover-clock .under { white-space: nowrap; margin-top: 10px; font: 400 13px/1.2 "JetBrains Mono", ui-monospace, monospace; text-shadow: none; }
    .hover-clock pre { font: 700 12px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    @media (prefers-reduced-motion: reduce) { .hover-clock { transition: none; } }`;
  document.head.append(style);
}

/**
 * frames: [{ x, y, w, h, paused? }] in CSS px; config: { on, style, corner,
 * colour, … }; wall: { wall, tint }, the wallpaper showing.
 * root: what the clocks are put in (Settings' preview has its own box).
 * Returns { cursor(p | null), configure(config), setWall({ wall, tint }),
 * setHue(i, hue), setHidden(hidden) }.
 */
export function hoverClock(frames, config = {}, wall = {}, root = document.body) {
  css();
  let cfg = { on: true, always: false, style: "slant", corner: "top-right", colour: "wallpaper", fill: "gradient", size: "medium", hours: "auto", ...config };
  cfg.style = validStyle(cfg.style);
  let showing = wall;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clocks = frames.map((fr) => {
    const el = document.createElement("div");
    el.className = "hover-clock";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<pre></pre><div class="under"></div>`;
    root.append(el);
    return { fr, el, showTimer: 0, hideTimer: 0, tick: 0, on: false, hue: null, text: "" };
  });

  const right = () => cfg.corner.endsWith("right");
  const bottom = () => cfg.corner.startsWith("bottom");

  const paint = (c) => {
    const now = new Date();
    const colours = clockColours(cfg.colour, showing.wall, showing.tint, c.hue);
    const low = `rgb(${colours[1].join(",")})`;
    c.text = timeText(now, cfg.hours);
    const pre = c.el.querySelector("pre");
    pre.style.fontSize = `${sizeOf(cfg.style)}px`;
    pre.style.fontWeight = weightOf(cfg.style);
    pre.style.textAlign = "left"; // the grid's own columns, whatever the corner
    paintGrid(pre, clockGrid(cfg.style, c.text, now.getTime(), is12(cfg.hours)), colours, cfg.fill === "solid");
    pre.style.textShadow = `0 0 8px color-mix(in srgb, ${low} 60%, transparent)`;
    const u = c.el.querySelector(".under");
    u.textContent = dateText(now, cfg.hours);
    u.style.color = `color-mix(in srgb, ${low} 65%, #000)`;
  };

  // where each clock sits, for the corner, and its style
  const place = () => {
    for (const c of clocks) {
      const { x, y, w, h } = c.fr;
      c.el.className = `hover-clock ${cfg.style}${right() ? " right" : ""}${c.on ? " on" : ""}`;
      // zoom also scales left/top, so they are divided by it to stay in the corner
      const z = SIZES[cfg.size] ?? 1;
      c.el.style.zoom = String(z);
      Object.assign(c.el.style, {
        left: `${(right() ? x + w - EDGE_X : x + EDGE_X) / z}px`,
        top: `${(bottom() ? y + h - EDGE_BOTTOM : y + EDGE_TOP) / z}px`,
        transform: `translate(${right() ? "-100%" : "0"}, ${bottom() ? "-100%" : "0"})`,
      });
      if (c.on) paint(c);
    }
  };
  const show = (c) => {
    if (c.on) return;
    c.on = true;
    paint(c);
    c.el.classList.add("on");
    // drawn again when the minute turns over; moving styles also in between,
    // unless the wallpaper is paused
    const every = reduced ? 0 : everyOf(cfg.style);
    c.tick = setInterval(() => {
      if ((every && !c.fr.paused) || timeText(new Date(), cfg.hours) !== c.text) paint(c);
    }, every || 1000);
  };
  const hide = (c) => {
    if (!c.on) return;
    c.on = false;
    c.el.classList.remove("on");
    clearInterval(c.tick);
  };

  // always on: every monitor shows it; off: none; hover: shown on demand.
  // Never while the clock wallpaper is showing (setHidden): one clock is enough.
  let hidden = false;
  const mode = () => {
    if (!cfg.on || hidden) clocks.forEach(hide);
    else if (cfg.always) clocks.forEach(show);
    else clocks.forEach(hide);
  };
  place();
  mode();

  return {
    cursor(p) {
      if (!cfg.on || cfg.always || hidden) return;
      for (const c of clocks) {
        const { x, y, w, h } = c.fr;
        const inX = p && (right() ? p.x >= x + w - ZONE_W && p.x < x + w : p.x >= x && p.x < x + ZONE_W);
        const inY = p && (bottom() ? p.y >= y + h - ZONE_H && p.y < y + h : p.y >= y && p.y < y + ZONE_H);
        if (cfg.on && inX && inY) {
          clearTimeout(c.hideTimer);
          c.hideTimer = 0;
          if (!c.on && !c.showTimer) c.showTimer = setTimeout(() => ((c.showTimer = 0), show(c)), SHOW_AFTER);
        } else {
          clearTimeout(c.showTimer);
          c.showTimer = 0;
          if (c.on && !c.hideTimer) c.hideTimer = setTimeout(() => ((c.hideTimer = 0), hide(c)), HIDE_AFTER);
        }
      }
    },
    configure(next) {
      cfg = { ...cfg, ...next };
      cfg.style = validStyle(cfg.style);
      clocks.forEach(hide); // shown again by mode() with the right tick
      place();
      mode();
    },
    setHidden(next) {
      hidden = !!next;
      mode();
    },
    setWall(next) {
      showing = next;
      clocks.forEach((c) => {
        c.hue = null; // the new wallpaper says its own
        if (c.on) paint(c);
      });
    },
    // the big jellyfish's own hue on monitor i
    setHue(i, hue) {
      const c = clocks[i];
      if (!c || c.hue === hue) return;
      c.hue = hue;
      if (c.on) paint(c);
    },
  };
}
