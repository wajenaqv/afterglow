// The hover clock (host.js): rest the cursor in a chosen corner of a monitor
// for half a second and the time fades in there, with the day and date
// underneath. It fades out a second after the cursor leaves the corner, and
// costs nothing while hidden (no timers run). The system's 12/24-hour
// setting decides the format. Every wallpaper gets it, since it lives in the
// host page above the frames.
//
// Settings → wallpaper → clock (extras.rs Clock, live through the "clock"
// event): off, on hover or always, style, corner and colour:
//   style   slant    figlet's Slant digits, the AfterGlow banner's font
//           small-slant, big, colossal, banner: more figlet fonts
//                    (all in clock-fonts.json, made by scripts/clock-font.js)
//           density  3x5 pixel digits in shading blocks, softer at the ends
//           lcd      seven segments drawn with _ and |
//           plain    the time in a large, thin mono font
//   corner  top-right (default), top-left, bottom-right, bottom-left
//   fill    gradient (light at the top into the colour) or solid
//   colour  wallpaper: the palette of what's showing (?tint=); brand: the
//           logo's white-to-green fade

import "@fontsource/jetbrains-mono/300.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "../brand.css";
import FONTS from "./clock-fonts.json";

const ZONE_W = 220; // CSS px from the side edge
const ZONE_H = 140; // CSS px from the top or bottom edge
const EDGE_X = 36; // where the clock sits, from the side
const EDGE_TOP = 30; // ... from the top
const EDGE_BOTTOM = 72; // ... from the bottom (clear of a taskbar)
const SHOW_AFTER = 500; // ms resting in the corner
const HIDE_AFTER = 1000; // ms after leaving it

// The colours of each wallpaper palette (?tint=), top to bottom, like the
// jellyfish TINTS: light at the top running into the palette's main hue
export const PALETTES = {
  natural: ["#ffe1f0", "#b98cff"],
  cool: ["#d9f5ff", "#3f8cff"],
  grey: ["#f5f5f5", "#8e949c"],
  warm: ["#ffe3cf", "#ff7a4d"],
};

// 3 x 5 pixel digits for "density"
const PIXELS = {
  0: ["###", "# #", "# #", "# #", "###"],
  1: [" # ", "## ", " # ", " # ", "###"],
  2: ["###", "  #", "###", "#  ", "###"],
  3: ["###", "  #", " ##", "  #", "###"],
  4: ["# #", "# #", "###", "  #", "  #"],
  5: ["###", "#  ", "###", "  #", "###"],
  6: ["###", "#  ", "###", "# #", "###"],
  7: ["###", "  #", "  #", " # ", " # "],
  8: ["###", "# #", "###", "# #", "###"],
  9: ["###", "# #", "###", "  #", "###"],
  ":": [" ", "#", " ", "#", " "],
};

// Seven segments for "lcd": a top, b top-right, c bottom-right, d bottom,
// e bottom-left, f top-left, g middle
const SEGMENTS = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
// Five rows tall, each digit five characters wide:
//    ___       a
//   |   |    f   b
//   |___|      g
//   |   |    e   c
//   |___|      d
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
  return rows;
}

// Pixel digits drawn with ASCII density characters from AfterGlow's own font
// (like heywajih's logo): "@@" inside a stroke and "%%" at its ends.
// (A faint ".." beside the strokes looked messy inside the digits. Shading blocks
// ░▒▓ aren't in JetBrains Mono's subset: the browser drew them from another
// font, a different size, and the digits came out broken.)
function density(text) {
  return [0, 1, 2, 3, 4].map((r) =>
    [...text]
      .map((ch) => {
        const g = PIXELS[ch];
        const at = (rr, cc) => g[rr]?.[cc] === "#";
        return [...g[r]]
          .map((p, c) => {
            const n = [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].filter(Boolean).length;
            if (p !== "#") return "  ";
            return n <= 1 ? "%%" : "@@";
          })
          .join("");
      })
      .join("  "),
  );
}

// A figlet font from clock-fonts.json: each character's rows side by side
function figlet(text, font) {
  const glyphs = FONTS[font];
  return glyphs["0"].map((_, r) => [...text].map((ch) => glyphs[ch][r]).join(""));
}

/** Every style, in the order Settings shows them */
export const STYLES = ["slant", "small-slant", "big", "colossal", "banner", "density", "lcd", "plain"];
/** Sizes: how much bigger than the base size (CSS zoom) */
export const SIZES = { small: 0.75, medium: 1, large: 1.4, huge: 2 };

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
const is12 = (hours) => (hours === "12" ? true : hours === "24" ? false : systemHour12);

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

/** The clock's rows for a style (Settings previews them, the wallpaper draws them) */
export function clockRows(style, text = "4:43") {
  if (FONTS[style]) return figlet(text, style);
  return style === "density" ? density(text) : style === "lcd" ? lcd(text) : [text];
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
    .hover-clock pre { margin: 0; letter-spacing: 0; line-height: 1.05; }
    .hover-clock .under { margin-top: 10px; font: 400 13px/1.2 "JetBrains Mono", ui-monospace, monospace; text-shadow: none; }
    .hover-clock.slant pre { font: 700 14px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.small-slant pre { font: 700 16px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.big pre { font: 700 12px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.colossal pre { font: 700 9px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.banner pre { font: 700 9px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.density pre { font: 700 12px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.lcd pre { font: 700 15px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.plain pre { font: 300 52px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 2px; }
    @media (prefers-reduced-motion: reduce) { .hover-clock { transition: none; } }`;
  document.head.append(style);
}

/**
 * frames: [{ x, y, w, h }] in CSS px; config: { on, style, corner, colour };
 * tint: the wallpaper's palette ("" = natural).
 * Returns { cursor(p | null), configure(config), setTint(tint) }.
 */
export function hoverClock(frames, config = {}, tint = "") {
  css();
  let cfg = { on: true, always: false, style: "slant", corner: "top-right", colour: "wallpaper", fill: "gradient", size: "medium", hours: "auto", ...config };
  let palette = tint || "natural";

  const clocks = frames.map((fr) => {
    const el = document.createElement("div");
    el.className = "hover-clock";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<pre></pre><div class="under"></div>`;
    document.body.append(el);
    return { fr, el, showTimer: 0, hideTimer: 0, tick: 0, on: false };
  });

  const colours = () => (cfg.colour === "brand" ? ["var(--logo-top)", "var(--logo-bottom)"] : (PALETTES[palette] ?? PALETTES.natural));
  const right = () => cfg.corner.endsWith("right");
  const bottom = () => cfg.corner.startsWith("bottom");

  const paint = (c) => {
    const now = new Date();
    const rows = clockRows(cfg.style, timeText(now, cfg.hours));
    const [top, low] = colours();
    const pre = c.el.querySelector("pre");
    pre.textContent = "";
    rows.forEach((row, i) => {
      const line = document.createElement("span");
      // gradient: light at the top into the hue at the bottom; solid: the hue (a touch lighter, so it still glows)
      const t = cfg.fill === "solid" ? 85 : rows.length > 1 ? Math.round((i / (rows.length - 1)) * 100) : 55;
      line.style.color = `color-mix(in srgb, ${low} ${t}%, ${top})`;
      line.textContent = row + (i < rows.length - 1 ? "\n" : "");
      pre.append(line);
    });
    pre.style.textShadow = `0 0 ${cfg.style === "plain" ? 16 : 8}px color-mix(in srgb, ${low} 60%, transparent)`;
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
    c.tick = setInterval(() => paint(c), 10_000); // the minute turns over while it's shown
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
      place();
      mode();
    },
    setHidden(next) {
      hidden = !!next;
      mode();
    },
    setTint(next) {
      palette = next || "natural";
      clocks.forEach((c) => c.on && paint(c));
    },
  };
}
