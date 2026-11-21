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
//           nixie    glass tubes: the lit numeral glows orange in front of
//                    the other nine, faintly stacked behind it (neon orange
//                    always: it's what the tubes look like)
//           heywajih heywajih.com's clock: 5x7 pixel digits, each pixel 3
//                    characters by 2 rows, filled with the logo's characters
//                    (solid inside a stroke, lighter at its edges) that
//                    shimmer now and then
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

// 5 x 7 pixel digits for "heywajih" (heywajih.com's clock wallpaper font)
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
// heywajih's logo ramp and its density ranges (light edge, edge, solid)
const RAMP = ".-:!+*=x#%@";
const RANGES = [null, [1, 4], [3, 7], [4, 9]];
const hash = (x, y, s) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const SHIMMER = 20_000; // ms: each character picks a new one about this often
function heywajih(text, now = Date.now()) {
  const PX_W = 3, PX_H = 2;
  const cols = [...text].reduce((w, ch) => w + PIX7[ch][0].length, 0) * PX_W + (text.length - 1) * PX_W;
  const on = Array.from({ length: 7 * PX_H }, () => new Array(cols).fill(false));
  let ox = 0;
  for (const ch of text) {
    const g = PIX7[ch];
    for (let py = 0; py < 7; py++)
      for (let px = 0; px < g[0].length; px++)
        if (g[py][px] === "1") for (let sy = 0; sy < PX_H; sy++) for (let sx = 0; sx < PX_W; sx++) on[py * PX_H + sy][(ox + px) * PX_W + sx] = true;
    ox += g[0].length + 1;
  }
  return on.map((row, y) =>
    row
      .map((lit, x) => {
        if (!lit) return " ";
        // the outermost cell of a stroke (side to side) is lighter, the rest solid
        const d = row[x - 1] && row[x + 1] ? 3 : hash(x, y, 5) < 0.3 ? 1 : 2;
        const epoch = Math.floor(now / SHIMMER + hash(x, y, 9));
        const [a, b] = RANGES[d];
        return RAMP[a + Math.floor(hash(x, y, epoch) * (b - a + 1))];
      })
      .join("")
      .replace(/s+$/, ""),
  );
}

// ---- nixie: built as HTML (not rows of characters), styled by NIXIE_CSS ----
export const NIXIE_CSS = `
  .nixie-tubes { display: inline-flex; gap: 0.14em; align-items: center; font: 300 1em/1 "JetBrains Mono", ui-monospace, monospace; font-variant-ligatures: none; white-space: nowrap; text-shadow: none; }
  .nixie-tubes .tube { position: relative; display: inline-block; width: 0.8em; height: 1.34em; border: 0.03em solid rgba(255, 170, 100, 0.24); border-radius: 0.38em 0.38em 0.1em 0.1em; background: radial-gradient(ellipse at 50% 45%, rgba(255, 120, 40, 0.09), transparent 70%); }
  .nixie-tubes .tube > span { position: absolute; inset: 0; display: grid; place-items: center; }
  .nixie-tubes .ghost { color: rgba(255, 138, 60, 0.08); }
  .nixie-tubes .lit { color: #ffcfa3; text-shadow: 0 0 0.05em #fff4e6, 0 0 0.16em #ff8a3c, 0 0 0.42em #ff6a1c; }
  .nixie-tubes .colon { display: inline-grid; gap: 0.28em; }
  .nixie-tubes .colon i { width: 0.1em; height: 0.1em; border-radius: 50%; background: #ffb070; box-shadow: 0 0 0.12em #ff8a3c, 0 0 0.3em #ff6a1c; }`;
/** The nixie tubes for "4:43" (lit: optional digit shown per position, for cathode cycling) */
export function nixieHTML(text, lit = null) {
  const ghosts = [..."0123456789"].map((d) => `<span class="ghost">${d}</span>`).join("");
  return `<span class="nixie-tubes">${[...text]
    .map((ch, i) => (ch === ":" ? '<span class="colon"><i></i><i></i></span>' : `<span class="tube">${ghosts}<span class="lit">${lit?.[i] ?? ch}</span></span>`))
    .join("")}</span>`;
}

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
export const STYLES = ["slant", "heywajih", "nixie", "small-slant", "big", "colossal", "banner", "density", "lcd", "plain"];
/** Styles whose characters shimmer: drawn again every second while shown */
export const SHIMMERS = ["heywajih"];
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
export function clockRows(style, text = "4:43", now = Date.now()) {
  if (FONTS[style]) return figlet(text, style);
  if (style === "heywajih") return heywajih(text, now);
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
    .hover-clock pre { margin: 0; letter-spacing: 0; line-height: 1.05; font-variant-ligatures: none !important; } /* !important: each style sets the font shorthand, which turns ligatures back on (== and != would merge) */
    .hover-clock .under { white-space: nowrap; margin-top: 10px; font: 400 13px/1.2 "JetBrains Mono", ui-monospace, monospace; text-shadow: none; }
    .hover-clock.slant pre { font: 700 14px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.small-slant pre { font: 700 16px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.big pre { font: 700 12px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.colossal pre { font: 700 9px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.banner pre { font: 700 9px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.density pre { font: 700 12px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.lcd pre { font: 700 15px/1 "JetBrains Mono", ui-monospace, Consolas, monospace; }
    .hover-clock.nixie pre { font-size: 40px; }
    ${NIXIE_CSS}
    .hover-clock.heywajih pre { font: 700 6px/1.05 "JetBrains Mono", ui-monospace, Consolas, monospace; }
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
    const [top, low] = colours();
    const pre = c.el.querySelector("pre");
    if (cfg.style === "nixie") {
      pre.innerHTML = nixieHTML(timeText(now, cfg.hours));
      pre.style.textShadow = "none";
      const u = c.el.querySelector(".under");
      u.textContent = dateText(now, cfg.hours);
      u.style.color = "#a8623a";
      return;
    }
    const rows = clockRows(cfg.style, timeText(now, cfg.hours));
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
    // the minute turns over while it's shown; shimmering styles change a few
    // characters every second
    c.tick = setInterval(() => paint(c), SHIMMERS.includes(cfg.style) ? 1000 : 10_000);
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
      clocks.forEach(hide); // shown again by mode() with the right tick
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
