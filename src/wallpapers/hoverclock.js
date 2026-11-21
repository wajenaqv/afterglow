// The hover clock (host.js): rest the cursor in a monitor's top-right corner
// for half a second and the time fades in there, in big glowing block digits
// with the logo's white-to-green fade, the day and date underneath. It fades
// out a second after the cursor leaves the corner, and costs nothing while
// hidden (no timers run). The system's 12/24-hour setting decides the format.
// Every wallpaper gets it, since it lives in the host page above the frames.

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "../brand.css";

const ZONE_W = 200; // CSS px from the right edge
const ZONE_H = 130; // CSS px from the top
const SHOW_AFTER = 500; // ms resting in the corner
const HIDE_AFTER = 1000; // ms after leaving it

// 3 x 5 pixel digits; each pixel is drawn "██" so it comes out square
const DIGITS = {
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

const hour12 = (() => {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    return hc === "h12" || hc === "h11";
  } catch {
    return false;
  }
})();

function render(now) {
  let h = now.getHours();
  const ampm = h < 12 ? "am" : "pm";
  if (hour12) h = h % 12 || 12;
  const hh = hour12 ? String(h) : String(h).padStart(2, "0");
  const text = `${hh}:${String(now.getMinutes()).padStart(2, "0")}`;
  const rows = [0, 1, 2, 3, 4].map((r) =>
    [...text]
      .map((ch) => DIGITS[ch][r].replace(/#/g, "██").replace(/ /g, "  "))
      .join("  "),
  );
  const date = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toLowerCase();
  return { rows, under: hour12 ? `${ampm} · ${date}` : date };
}

function css() {
  const style = document.createElement("style");
  style.textContent = `
    .hover-clock {
      position: absolute; pointer-events: none; z-index: 2;
      transform: translateX(-100%); text-align: right;
      font: 700 13px/1 "JetBrains Mono", ui-monospace, Consolas, monospace;
      font-variant-ligatures: none;
      opacity: 0; transition: opacity 0.6s ease;
      text-shadow: 0 0 8px rgba(var(--glow), var(--glow-a));
    }
    .hover-clock.on { opacity: 1; }
    .hover-clock pre { margin: 0; font: inherit; letter-spacing: 0; }
    .hover-clock .under {
      margin-top: 10px; font: 400 13px/1.2 "JetBrains Mono", ui-monospace, monospace;
      color: var(--dim); text-shadow: none;
    }
    @media (prefers-reduced-motion: reduce) { .hover-clock { transition: none; } }`;
  document.head.append(style);
}

/** frames: [{ x, y, w, h }] in CSS px. Returns cursor(p | null). */
export function hoverClock(frames) {
  css();
  const clocks = frames.map((fr) => {
    const el = document.createElement("div");
    el.className = "hover-clock";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, { left: `${fr.x + fr.w - 36}px`, top: `${fr.y + 30}px` });
    el.innerHTML = `<pre></pre><div class="under"></div>`;
    document.body.append(el);
    return { fr, el, inSince: null, showTimer: 0, hideTimer: 0, tick: 0 };
  });

  const paint = (c) => {
    const { rows, under } = render(new Date());
    const pre = c.el.querySelector("pre");
    pre.textContent = "";
    rows.forEach((row, i) => {
      const line = document.createElement("span");
      // the logo's fade: white on top to green at the bottom
      line.style.color = `color-mix(in srgb, var(--logo-bottom) ${Math.round((i / (rows.length - 1)) * 100)}%, var(--logo-top))`;
      line.textContent = row + "\n";
      pre.append(line);
    });
    c.el.querySelector(".under").textContent = under;
  };
  const show = (c) => {
    if (c.on) return;
    c.on = true;
    paint(c);
    c.el.classList.add("on");
    // repaint every 10 s while shown, so the minute turns over (cheap)
    c.tick = setInterval(() => paint(c), 10_000);
  };
  const hide = (c) => {
    if (!c.on) return;
    c.on = false;
    c.el.classList.remove("on");
    clearInterval(c.tick);
  };

  return function cursor(p) {
    for (const c of clocks) {
      const { x, y, w } = c.fr;
      const inside = p && p.x >= x + w - ZONE_W && p.x < x + w && p.y >= y && p.y < y + ZONE_H;
      if (inside) {
        clearTimeout(c.hideTimer);
        c.hideTimer = 0;
        if (!c.on && !c.showTimer) c.showTimer = setTimeout(() => ((c.showTimer = 0), show(c)), SHOW_AFTER);
      } else {
        clearTimeout(c.showTimer);
        c.showTimer = 0;
        if (c.on && !c.hideTimer) c.hideTimer = setTimeout(() => ((c.hideTimer = 0), hide(c)), HIDE_AFTER);
      }
    }
  };
}
