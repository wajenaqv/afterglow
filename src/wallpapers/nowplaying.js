// The now-playing corner (host.js, so every wallpaper has it): what's
// playing as a small card in a corner of each monitor: the album cover in
// coloured characters, a little equaliser, the title, the artist and a
// progress bar. Shown on hover (rest in the corner half a second, like the
// hover clock), always, or for a few seconds when the song changes.
//
//   - The cover is the real cover, shrunk to a grid of cells: brightness picks
//     a character from RAMP, each cell keeps the cover's colour (very dark
//     colours are lifted so they show on black). A song without a cover gets
//     a pattern made from its title, in its own colours.
//   - A new song decodes in: a ragged front sweeps left to right, each cell
//     scrambling a moment before it settles (heywajih.com's cover.js).
//   - Paused, the cover cools: each cell drains to a dim grey-green and its
//     character thins down the ramp, cells going at slightly different
//     moments, like a CRT fading. On play it decodes back in.
//   - Rest the cursor on the cover and a ring of characters fills round it in
//     1.5 s, then it pauses or plays (nowplaying.rs now_playing_toggle).
//     Moving away rewinds it; it won't fire twice without leaving first.
//   - It never shares a corner with the clock: Settings and nowplaying.rs
//     refuse the clock's corner.
//
// The song comes from the app (nowplaying.rs, the "nowplaying" event):
// { player_name, title, artist, playing, position_ms, length_ms, at, cover, song }.
// It costs nothing while hidden: no timers run.
//
// Mockup: docs/ideas/nowplaying-mockup.html.

export const RAMP = ".:-=+*#%@";
const SCRAMBLE = "!#%@*x&?/\\<>=+";
const DECODE_MS = 900;
const COOL_MS = 3000;
/** cover size in characters: twice as many columns as rows is square on screen */
export const SIZES = { small: [24, 12], medium: [32, 16], large: [44, 22] };

const ZONE_W = 220; // the corner you rest in, CSS px
const ZONE_H = 140;
const EDGE_X = 40;
const EDGE_TOP = 34;
const EDGE_BOTTOM = 80; // clear of a taskbar
const SHOW_AFTER = 500;
const HIDE_AFTER = 1000;
const SHOW_ON_CHANGE = 6000;
const RING_WAIT = 250; // ms on the cover before the ring starts
const RING_FILL = 1500;
const FRAMES = ["|.:|", ":|.|", ".||:", "|:.|", ".:|."];
const BAR = 18;

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- covers -> cells ----

// Shrink in halves first: one jump from 640 px to 32 skips most pixels
function shrink(img, w, h) {
  let src = img;
  let sw = img.naturalWidth || img.width;
  let sh = img.naturalHeight || img.height;
  // a wide picture (a video's) is cut to its middle square
  const side = Math.min(sw, sh);
  const c0 = document.createElement("canvas");
  c0.width = c0.height = side;
  c0.getContext("2d").drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, side, side);
  src = c0;
  sw = sh = side;
  while (sw / 2 > w * 2) {
    const c = document.createElement("canvas");
    c.width = Math.round(sw / 2);
    c.height = Math.round(sh / 2);
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}

/** An image -> { cells: [{ ch, i, r, g, b, c }], cols, rows, glow: [r, g, b] } */
export function toCells(img, cols, rows) {
  const px = shrink(img, cols, rows);
  const cells = [];
  let sr = 0, sg = 0, sb = 0, sw = 0;
  for (let i = 0; i < cols * rows; i++) {
    let r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const k = Math.min(RAMP.length - 1, Math.round(Math.sqrt(lum) * (RAMP.length - 1)));
    const top = Math.max(r, g, b);
    if (top < 80) {
      const lift = 80 / Math.max(top, 1);
      r = Math.min(255, r * lift);
      g = Math.min(255, g * lift);
      b = Math.min(255, b * lift);
    }
    // the glow colour: the cover's brightest, most colourful cells count most
    const wgt = (top - Math.min(r, g, b) + 20) * lum;
    sr += r * wgt;
    sg += g * wgt;
    sb += b * wgt;
    sw += wgt;
    cells.push({ ch: RAMP[k], i: k, r, g, b, c: `rgb(${r | 0},${g | 0},${b | 0})` });
  }
  let glow = sw > 0 ? [sr / sw, sg / sw, sb / sw] : [51, 255, 153];
  const m = Math.max(...glow, 1);
  glow = glow.map((v) => Math.round((v / m) * 255));
  return { cells, cols, rows, glow };
}

const loaded = new Map(); // url -> Promise<Image | null>
function loadImage(url) {
  if (!loaded.has(url)) {
    if (loaded.size > 8) loaded.clear();
    loaded.set(url, new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = url;
    }));
  }
  return loaded.get(url);
}

/** A cover for a song without one: two colours and a circle, from its title */
export function patternCover(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507)), ((h >>> 0) % 1000) / 1000);
  const hue = rnd() * 360;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, `hsl(${hue} 70% 18%)`);
  g.addColorStop(1, `hsl(${(hue + 40 + rnd() * 80) % 360} 75% 45%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 96, 96);
  x.fillStyle = `hsl(${(hue + 180) % 360} 80% 70%)`;
  x.beginPath();
  x.arc(20 + rnd() * 56, 20 + rnd() * 56, 12 + rnd() * 18, 0, 7);
  x.fill();
  return c;
}

/** The song's cover as cells (its picture, or a pattern) */
export async function coverFor(track, cols, rows) {
  const img = track.cover ? await loadImage(track.cover) : null;
  return toCells(img ?? patternCover(`${track.title}\u0001${track.artist}`), cols, rows);
}

// ---- the cover on screen ----

// Cooling: a cell drains towards a dim phosphor grey-green and thins down
// the ramp; a cooled cover stays readable as a ghost of itself
const COOL_RGB = [80, 130, 105];
function coolCell(k, amt, jitter) {
  const t = Math.max(0, Math.min(1, amt * 1.5 - jitter * 0.5)); // this cell's own progress
  if (t <= 0) return [k.ch, k.c];
  const dim = 1 - 0.25 * t;
  const mix = (a, b) => Math.round((a + (b - a) * t) * dim);
  const i = Math.max(Math.min(k.i, 1), Math.round(k.i * (1 - 0.6 * t)));
  return [RAMP[i], `rgb(${mix(k.r, COOL_RGB[0])},${mix(k.g, COOL_RGB[1])},${mix(k.b, COOL_RGB[2])})`];
}

/** A <pre> of spans that shows a cover, decodes into the next and cools. */
export function coverView(pre) {
  let spans = [], cols = 0, rows = 0, raf = 0, jitter = [], current = null;
  function build(c, r) {
    cols = c;
    rows = r;
    spans = [];
    pre.textContent = "";
    jitter = Array.from({ length: c * r }, () => Math.random());
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < c; x++) pre.appendChild((spans[y * c + x] = document.createElement("span")));
      if (y < r - 1) pre.appendChild(document.createTextNode("\n"));
    }
  }
  function cool(amt) {
    if (!current) return;
    current.cells.forEach((k, i) => {
      const [ch, c] = coolCell(k, amt, jitter[i]);
      if (spans[i].textContent !== ch) spans[i].textContent = ch;
      spans[i].style.color = c;
    });
  }
  function show(cover, animate = true) {
    cancelAnimationFrame(raf);
    current = cover;
    if (cover.cols !== cols || cover.rows !== rows) {
      build(cover.cols, cover.rows);
      animate = false;
    }
    if (reduced || !animate) {
      cover.cells.forEach((k, i) => {
        spans[i].textContent = k.ch;
        spans[i].style.color = k.c;
      });
      return;
    }
    const lag = Array.from({ length: rows }, () => Math.random() * 0.25);
    const t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / DECODE_MS;
      let done = true;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const at = (x / cols) * 0.75 + lag[y]; // when this cell starts
          const s = spans[y * cols + x];
          const k = cover.cells[y * cols + x];
          if (t < at) {
            done = false; // the old cover is still there
          } else if (t < at + 0.12) {
            done = false;
            s.textContent = SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
            s.style.color = k.c;
          } else if (s.textContent !== k.ch) {
            s.textContent = k.ch;
            s.style.color = k.c;
          }
        }
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  return { show, cool, stop: () => cancelAnimationFrame(raf) };
}

// ---- the card ----

let styled = false;
function css() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .np-card { position: absolute; z-index: 2; display: flex; gap: 18px; align-items: flex-end; pointer-events: none;
      opacity: 0; transition: opacity 0.6s ease; isolation: isolate; font-variant-ligatures: none; }
    .np-card.on { opacity: 1; }
    .np-card.right { flex-direction: row-reverse; text-align: right; }
    .np-card.top { align-items: flex-start; }
    /* a faint dark patch behind it, no edge, so the wallpaper doesn't mix into the cover */
    .np-card::before { content: ""; position: absolute; inset: -26px -30px; z-index: -1; border-radius: 40px; background: rgba(0,0,0,.55); filter: blur(18px); }
    .np-card pre { margin: 0; font: 400 12px/12px "JetBrains Mono", ui-monospace, monospace; font-variant-ligatures: none !important; letter-spacing: 0; white-space: pre; }
    .np-card .np-cover { filter: drop-shadow(0 0 4px rgba(var(--np-glow), calc(.35 * (1 - var(--np-cool, 0))))); }
    .np-card .np-cw { position: relative; }
    .np-card .np-ring { position: absolute; left: -1ch; top: -12px; transition: opacity .5s; }
    .np-card .np-ring.gone { opacity: 0; }
    .np-card .np-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 360px; }
    .np-card .np-eq { font: 400 13px/1 "JetBrains Mono", monospace; color: rgb(var(--np-glow)); text-shadow: 0 0 6px rgba(var(--np-glow), .6); white-space: pre; }
    .np-card .np-title { font: 700 17px/1.3 "JetBrains Mono", monospace; color: #fff; text-shadow: 0 0 8px rgba(var(--np-glow), .7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .np-card .np-artist { font: 400 13px/1.3 "JetBrains Mono", monospace; color: rgba(var(--np-glow), .85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .np-card .np-bar { font: 400 12px/1.4 "JetBrains Mono", monospace; color: rgba(var(--np-glow), .55); white-space: pre; }
    .np-card .np-bar b { font-weight: 400; color: rgb(var(--np-glow)); text-shadow: 0 0 5px rgba(var(--np-glow), .7); }
    .np-card.paused .np-eq, .np-card.paused .np-title { opacity: .6; }
    @media (prefers-reduced-motion: reduce) { .np-card, .np-card .np-ring { transition: none; } }`;
  document.head.append(style);
}

const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Where the song is now: it moves on by itself while playing */
const positionOf = (t) => Math.min(t.length_ms || Infinity, t.position_ms + (t.playing ? Math.max(0, Date.now() - t.at) : 0));

/** The ring's cells in order, clockwise from the middle of the top */
function ringPath(W, H) {
  const p = [];
  const mid = W >> 1;
  for (let x = mid; x < W; x++) p.push([x, 0]);
  for (let y = 1; y < H; y++) p.push([W - 1, y]);
  for (let x = W - 2; x >= 0; x--) p.push([x, H - 1]);
  for (let y = H - 2; y >= 0; y--) p.push([0, y]);
  for (let x = 1; x < mid; x++) p.push([x, 0]);
  return p;
}

/**
 * frames: [{ x, y, w, h }] in CSS px (host.js); prefs: Settings → now playing
 * (nowplaying.rs Prefs; never the clock's corner); toggle(): pause or play.
 * Returns { cursor(p | null), configure(prefs), setTrack(track | null) }.
 */
export function nowPlaying(frames, prefs = {}, { toggle = () => {}, root = document.body } = {}) {
  css();
  let cfg = { on: false, show: "hover", corner: "bottom-right", size: "medium", rest_to_pause: true, ...prefs };
  let track = null;
  let cover = null; // the current song's cells
  let coolAmt = 0;
  let coolRaf = 0;
  let changeTimer = 0;

  const cards = frames.map((fr) => {
    const el = document.createElement("div");
    el.className = "np-card";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<div class="np-cw"><pre class="np-cover"></pre><pre class="np-ring gone"></pre></div><div class="np-meta"><div class="np-eq"></div><div class="np-title"></div><div class="np-artist"></div><div class="np-bar"></div></div>`;
    root.append(el);
    const c = { fr, el, view: coverView(el.querySelector(".np-cover")), ring: el.querySelector(".np-ring"), on: false, hovered: false, showTimer: 0, hideTimer: 0 };
    c.ringState = { p: 0, onCover: false, armed: true, since: 0, raf: 0, last: 0 };
    return c;
  });

  const right = () => cfg.corner.endsWith("right");
  const bottom = () => cfg.corner.startsWith("bottom");

  function place() {
    for (const c of cards) {
      const { x, y, w, h } = c.fr;
      c.el.className = `np-card ${right() ? "right" : "left"} ${bottom() ? "bottom" : "top"}${c.on ? " on" : ""}${track && !track.playing ? " paused" : ""}`;
      Object.assign(c.el.style, {
        left: right() ? "" : `${x + EDGE_X}px`,
        right: right() ? `${innerWidth - (x + w) + EDGE_X}px` : "",
        top: bottom() ? "" : `${y + EDGE_TOP}px`,
        bottom: bottom() ? `${innerHeight - (y + h) + EDGE_BOTTOM}px` : "",
      });
    }
  }

  // ---- text and bar ----
  let tick = 0;
  let frame = 0;
  function text() {
    if (!track) return;
    const pos = positionOf(track);
    const len = track.length_ms;
    for (const c of cards) {
      if (!c.on) continue;
      c.el.querySelector(".np-eq").textContent = track.playing ? FRAMES[frame % FRAMES.length] : "....";
      if (len > 0) {
        const k = Math.round((pos / len) * BAR);
        c.el.querySelector(".np-bar").innerHTML = `${mmss(pos)} <b>${"=".repeat(k)}</b>${"-".repeat(BAR - k)} ${mmss(len)}`;
      } else c.el.querySelector(".np-bar").textContent = track.player_name;
    }
  }
  function ticking() {
    const want = track && track.playing && cards.some((c) => c.on);
    if (want && !tick)
      tick = setInterval(() => {
        frame++;
        text();
      }, 500);
    if (!want && tick) {
      clearInterval(tick);
      tick = 0;
    }
  }

  // ---- showing ----
  function setOn(c, on) {
    if (c.on === on) return;
    c.on = on;
    c.el.classList.toggle("on", on);
    if (on) {
      c.el.querySelector(".np-title").textContent = track?.title ?? "";
      c.el.querySelector(".np-artist").textContent = track?.artist || track?.player_name || "";
      text();
    } else ringReset(c);
    ticking();
  }
  function mode() {
    for (const c of cards) {
      const want = !!(cfg.on && track && (cfg.show === "always" || c.hovered || changeTimer));
      setOn(c, want);
    }
  }

  // ---- the song ----
  async function setTrack(next) {
    const before = track;
    track = next && next.title ? next : null;
    if (!track) {
      cover = null;
      mode();
      return;
    }
    const newSong = !before || before.song !== track.song || before.cover !== track.cover;
    if (newSong) {
      const [cols, rows] = SIZES[cfg.size] ?? SIZES.medium;
      const made = await coverFor(track, cols, rows);
      if (track !== next) return; // a newer song came in meanwhile
      cover = made;
      for (const c of cards) {
        c.el.style.setProperty("--np-glow", cover.glow.join(","));
        c.el.querySelector(".np-title").textContent = track.title;
        c.el.querySelector(".np-artist").textContent = track.artist || track.player_name;
      }
      coolAmt = track.playing ? 0 : 1;
      setCool(coolAmt);
      for (const c of cards) {
        c.view.show(cover, !!before && track.playing);
        if (!track.playing) c.view.cool(1);
      }
      if (before && cfg.show === "change") {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => ((changeTimer = 0), mode()), SHOW_ON_CHANGE);
      }
    } else if (before.playing !== track.playing) {
      playState(track.playing);
    }
    place();
    mode();
    text();
    ticking();
  }

  function setCool(v) {
    for (const c of cards) c.el.style.setProperty("--np-cool", String(v));
  }
  // paused: cool over 3 s; playing: decode back in from the cooled cover
  function playState(playing) {
    cancelAnimationFrame(coolRaf);
    if (!cover) return;
    if (!playing) {
      cards.forEach((c) => c.view.stop());
      const t0 = performance.now();
      const from = coolAmt;
      const step = (now) => {
        coolAmt = Math.min(1, from + (now - t0) / (reduced ? 1 : COOL_MS));
        cards.forEach((c) => c.view.cool(coolAmt));
        setCool(coolAmt);
        if (coolAmt < 1) coolRaf = requestAnimationFrame(step);
      };
      coolRaf = requestAnimationFrame(step);
    } else {
      coolAmt = 0;
      setCool(0);
      cards.forEach((c) => c.view.show(cover, true));
    }
  }

  // ---- rest to pause ----
  function drawRing(c, p) {
    const [cols, rows] = SIZES[cfg.size] ?? SIZES.medium;
    const W = cols + 2, H = rows + 2;
    const path = ringPath(W, H);
    const n = Math.round(p * path.length);
    const grid = Array.from({ length: H }, () => Array(W).fill(" "));
    path.forEach(([x, y], i) => {
      const cornerCell = (x === 0 || x === W - 1) && (y === 0 || y === H - 1);
      const ch = cornerCell ? "+" : y === 0 || y === H - 1 ? "-" : "|";
      if (i < n) {
        const head = i >= n - 3 && p < 1; // the leading end burns brightest
        grid[y][x] = `<span style="color:${head ? "#fff" : "rgb(var(--np-glow))"};text-shadow:0 0 6px rgba(var(--np-glow),.8)">${ch}</span>`;
      } else grid[y][x] = `<span style="color:rgba(var(--np-glow),.22)">.</span>`;
    });
    c.ring.innerHTML = grid.map((row) => row.join("")).join("\n");
  }
  function ringReset(c) {
    const r = c.ringState;
    cancelAnimationFrame(r.raf);
    Object.assign(r, { p: 0, onCover: false, armed: true, raf: 0 });
    c.ring.classList.add("gone");
  }
  function ringLoop(c, now) {
    const r = c.ringState;
    const dt = now - r.last;
    r.last = now;
    if (r.onCover && r.armed) {
      if (now - r.since > RING_WAIT) {
        r.p = Math.min(1, r.p + dt / RING_FILL);
        c.ring.classList.remove("gone");
      }
    } else r.p = Math.max(0, r.p - (dt * 3) / RING_FILL); // rewinds three times as fast
    if (r.p >= 1 && r.armed) {
      r.armed = false; // not again until the cursor has left the cover
      drawRing(c, 1);
      toggle();
      setTimeout(() => c.ring.classList.add("gone"), 350);
    } else if (r.armed) drawRing(c, r.p);
    if (r.armed && r.p === 0) c.ring.classList.add("gone");
    r.raf = r.p > 0 || r.onCover ? requestAnimationFrame((t) => ringLoop(c, t)) : 0;
  }
  function restOn(c, p) {
    const r = c.ringState;
    let on = false;
    if (p && c.on && cfg.rest_to_pause && track) {
      const b = c.el.querySelector(".np-cover").getBoundingClientRect();
      const pad = 6;
      on = p.x >= b.left - pad && p.x <= b.right + pad && p.y >= b.top - pad && p.y <= b.bottom + pad;
    }
    if (on === r.onCover) return;
    r.onCover = on;
    if (on) r.since = performance.now();
    else r.armed = true;
    if (!r.raf) {
      r.last = performance.now();
      r.raf = requestAnimationFrame((t) => ringLoop(c, t));
    }
  }

  // ---- hover ----
  function inZone(c, p) {
    if (!p) return false;
    const { x, y, w, h } = c.fr;
    const inX = right() ? p.x >= x + w - ZONE_W && p.x < x + w : p.x >= x && p.x < x + ZONE_W;
    const inY = bottom() ? p.y >= y + h - ZONE_H && p.y < y + h : p.y >= y && p.y < y + ZONE_H;
    if (inX && inY) return true;
    if (!c.on) return false;
    // once shown, the whole card (and a margin) keeps it up
    const b = c.el.getBoundingClientRect();
    return p.x >= b.left - 40 && p.x <= b.right + 40 && p.y >= b.top - 40 && p.y <= b.bottom + 40;
  }

  place();
  mode();

  return {
    cursor(p) {
      if (!cfg.on || !track) return;
      for (const c of cards) {
        restOn(c, p);
        if (cfg.show === "always") continue;
        if (inZone(c, p)) {
          clearTimeout(c.hideTimer);
          c.hideTimer = 0;
          if (!c.hovered && !c.showTimer) c.showTimer = setTimeout(() => ((c.showTimer = 0), (c.hovered = true), mode()), SHOW_AFTER);
        } else {
          clearTimeout(c.showTimer);
          c.showTimer = 0;
          if (c.hovered && !c.hideTimer) c.hideTimer = setTimeout(() => ((c.hideTimer = 0), (c.hovered = false), mode()), HIDE_AFTER);
        }
      }
    },
    configure(next) {
      const sizeChanged = next.size && next.size !== cfg.size;
      cfg = { ...cfg, ...next };
      if (sizeChanged && track) {
        const t = track;
        track = null;
        setTrack(t);
      }
      place();
      mode();
    },
    setTrack,
  };
}
