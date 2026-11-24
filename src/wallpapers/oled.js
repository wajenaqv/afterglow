// OLED care (Settings → performance, off by default), done in host.html so
// every wallpaper and the hover clock get it:
//   shift   the picture wanders a few pixels, at most one pixel every ten
//           seconds, so no edge lights the same pixels for hours
//   dark    a black cover fades in over a monitor that has been paused for a
//           minute (a paused wallpaper is a frozen picture), and over every
//           monitor once you've been away (the app says when: "rest")
// The cover lifts as soon as the wallpaper runs again.

const REACH = 8; // px, the furthest the picture moves from its place
const STEP_MS = 10_000;
const PERIOD_X = 1200, PERIOD_Y = 1700; // s; different, so the path rarely repeats
const DARK_AFTER_MS = 60_000;
const FADE_OUT = "2s", FADE_IN = "0.6s";

/** Where the picture sits at `seconds`: [dx, dy] in whole px */
export function shiftAt(seconds) {
  const at = (period) => Math.round(REACH * Math.sin((2 * Math.PI * seconds) / period)) || 0; // || 0: no -0
  return [at(PERIOD_X), at(PERIOD_Y)];
}

/**
 * frames: host.js's [{ f, x, y, w, h, paused }]; config: { on, rest }.
 * Returns { configure({ on, rest }), paused(), shift() }.
 */
export function oledCare(frames, config = {}, { darkAfter = DARK_AFTER_MS, log = () => {} } = {}) {
  let on = false, rest = false;
  let offset = [0, 0];
  let timer = 0;

  const covers = frames.map((fr) => {
    const el = document.createElement("div");
    el.className = "oled-cover";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "absolute", left: `${fr.x}px`, top: `${fr.y}px`, width: `${fr.w}px`, height: `${fr.h}px`,
      background: "var(--bg, black)", opacity: "0", pointerEvents: "none", zIndex: "3",
    });
    document.body.append(el);
    return { fr, el, wait: 0, dark: false };
  });

  const setDark = (c, dark) => {
    clearTimeout(c.wait);
    c.wait = 0;
    if (c.dark === dark) return;
    c.dark = dark;
    c.el.style.transition = `opacity ${dark ? FADE_OUT : FADE_IN} ease`;
    c.el.style.opacity = dark ? "1" : "0";
    log(`oled: monitor ${frames.indexOf(c.fr)} ${dark ? `dark (${rest ? "away" : "paused"})` : "lit"}`);
  };
  // Called on every change (and every second by the app): a running wait goes on
  const update = () => {
    for (const c of covers) {
      if (!on || (!rest && !c.fr.paused)) setDark(c, false);
      else if (rest) setDark(c, true);
      else if (!c.dark && !c.wait) c.wait = setTimeout(() => setDark(c, true), darkAfter);
    }
  };

  // `translate` adds to the clock's own `transform`. The wallpaper is clipped
  // by as much as it moves, so it never shows on the monitor next to it.
  const move = () => {
    offset = on ? shiftAt(Date.now() / 1000) : [0, 0];
    const [dx, dy] = offset;
    const translate = on ? `${dx}px ${dy}px` : "";
    const inset = [Math.max(0, -dy), Math.max(0, dx), Math.max(0, dy), Math.max(0, -dx)];
    for (const { f } of frames) {
      f.style.translate = translate;
      f.style.clipPath = on ? `inset(${inset.map((n) => `${n}px`).join(" ")})` : "";
    }
    for (const el of document.querySelectorAll(".hover-clock")) el.style.translate = translate;
  };

  const configure = (next = {}) => {
    const was = on;
    on = !!next.on;
    rest = !!next.rest;
    if (on !== was) {
      clearInterval(timer);
      timer = on ? setInterval(move, STEP_MS) : 0;
      move();
      log(`oled: care ${on ? `on, shifted ${offset}` : "off"}`);
    }
    update();
  };
  configure(config);

  return { configure, paused: update, shift: () => offset };
}
