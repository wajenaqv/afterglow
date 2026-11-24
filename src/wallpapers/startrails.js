// Star trails: a long exposure of the night sky over mountain silhouettes,
// after a Python sketch the owner shared (taken as reference only). Every star
// turns slowly around the pole star; about a hundred of them leave a trail,
// a thin arc that is brightest at the star and fades towards the oldest light.
// The other stars are characters, twinkling a little; the trails are dotted
// with characters too. Two ridges of mountains along the bottom, drawn in
// characters: a slope-following ridge line, shaded rock below, light haze
// over the horizon.
//
// Drawing: the arcs are real anti-aliased lines on a canvas (thin arcs drawn
// as characters turn into noise, as the rings wallpaper showed), the rest is
// characters on the same canvas. The mountains and the sky's glow are drawn
// once per resize into a cached layer. So this wallpaper has one canvas 2D
// renderer (which the browser composites on the GPU), not a GPU and a CPU
// pair: an exception to the wallpaper rule, like the clock.
//
// Reactions: a new message lights one star's trail in the app's colour,
// which fades back over the afterglow; every app with something waiting is a
// star whose trail glows in its colour until you rest the cursor on the star;
// a flash brightens every trail.
//
// Options: ?tint=natural|warm|cool|green|colour ?fps

import { params, num, seeded, hash, STILL, STILL_AT, HOVER, pointer, onReaction, seenLantern, fontReady, sendStill, isPaused, whenResumed } from "./common.js";

const TAU = Math.PI * 2;
const reduced = !STILL && matchMedia("(prefers-reduced-motion: reduce)").matches;
const preview = params.has("preview");
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rgb = (c, a = 1) => `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- palettes: the reference is black and white; real trails have colour ----
const TINTS = {
  natural: { star: [0.88, 0.91, 1.0], rock: [0.55, 0.56, 0.6], haze: [0.5, 0.52, 0.58], bg: [0.012, 0.014, 0.02] },
  warm: { star: [1.0, 0.9, 0.78], rock: [0.46, 0.4, 0.36], haze: [0.6, 0.5, 0.42], bg: [0.02, 0.014, 0.012] },
  cool: { star: [0.75, 0.88, 1.0], rock: [0.34, 0.4, 0.5], haze: [0.4, 0.5, 0.65], bg: [0.008, 0.012, 0.024] },
  green: { star: [0.55, 1.0, 0.78], rock: [0.28, 0.45, 0.38], haze: [0.3, 0.6, 0.45], bg: [0.006, 0.016, 0.012] },
  colour: { star: null, rock: [0.42, 0.43, 0.46], haze: [0.5, 0.52, 0.58], bg: [0.012, 0.014, 0.02] },
};
const PAL = TINTS[params.get("tint")] ?? TINTS.natural;
// "colour": each star its own temperature, blue-white to orange
const starColour = (h) => PAL.star ?? mixc([0.7, 0.82, 1.0], [1.0, 0.78, 0.55], h);

// ---- the sky ----
const RATE = 0.02; // radians per second the sky turns (a turn in about five minutes)
const NSTARS = 380, NTRAILS = 60; // kept sparse: a clean sky (150 trails and 700 stars read as too dense)
let W = 0, H = 0, A = 1, dpr = 1, cw = 0, ch = 0, cols = 0, rows = 0, fontPx = 10;
let POLE = [0, 0]; // in screen heights
let STARS = []; // { r, b (bearing), e (energy), ph, col, trail (radians of arc, 0 for none) }
function makeStars() {
  const r = seeded(6923);
  STARS = Array.from({ length: NSTARS }, (_, i) => {
    const trail = i < NTRAILS;
    // radius: spread over the sky so the arcs fill it; a few beyond the screen's corners
    const rad = Math.sqrt(0.002 + r() * 0.998) * 1.25;
    // brightness: most stars faint, the trailed ones bright
    const e = trail ? 0.55 + 0.43 * r() : 0.08 + 0.75 * Math.pow(r(), 3.5);
    return { r: rad, b: r() * TAU, e, ph: r() * TAU, col: starColour(r()), trail: trail ? 0.3 + 0.9 * r() : 0, h: r() };
  });
}
const starAt = (s, t) => {
  const a = s.b - RATE * t;
  return [POLE[0] + s.r * Math.cos(a), POLE[1] + s.r * Math.sin(a)];
};

// ---- the mountains: two ridges, a profile per character column ----
let FAR = [], NEAR = [], SKY = [], SKYF = []; // ridge height per column, in rows (fractional); SKY: the highest of the two, whole rows; SKYF: fractional
function ridge(keys, amp, seed) {
  const r = seeded(seed);
  const out = new Float32Array(cols);
  const octaves = [22, 47, 91].map((n, k) => ({ w: [0.74, 0.3, 0.18][k], v: Array.from({ length: n }, () => r() * 2 - 1) }));
  for (let c = 0; c < cols; c++) {
    const u = c / Math.max(1, cols - 1);
    let j = 0;
    while (j < keys.length - 2 && keys[j + 1][0] < u) j++;
    const [u0, y0] = keys[j], [u1, y1] = keys[j + 1];
    let y = y0 + (y1 - y0) * clamp01((u - u0) / (u1 - u0));
    for (const o of octaves) {
      const p = u * (o.v.length - 1), k = Math.min(o.v.length - 2, Math.floor(p)), f = p - k;
      y += (amp * o.w * (o.v[k] + (o.v[k + 1] - o.v[k]) * f)) / 100;
    }
    out[c] = (y * H) / ch;
  }
  return out;
}
function makeMountains() {
  // key points: (share of the width, height as a share of the screen); peaks rise towards the right
  FAR = ridge([[0, 0.86], [0.08, 0.84], [0.15, 0.8], [0.22, 0.85], [0.3, 0.84], [0.38, 0.79], [0.45, 0.77], [0.52, 0.82], [0.6, 0.84], [0.68, 0.79], [0.75, 0.82], [0.82, 0.78], [0.9, 0.83], [1, 0.8]], 1.6, 138);
  NEAR = ridge([[0, 0.9], [0.1, 0.88], [0.2, 0.9], [0.3, 0.92], [0.42, 0.9], [0.52, 0.93], [0.6, 0.9], [0.68, 0.85], [0.74, 0.8], [0.79, 0.74], [0.84, 0.79], [0.9, 0.84], [1, 0.86]], 2.2, 432);
  SKYF = Array.from({ length: cols }, (_, c) => Math.min(FAR[c], NEAR[c]));
  SKY = SKYF.map((v) => Math.round(v));
}

// ---- the still layer: sky glow, haze and the mountains, drawn once per resize ----
let layer = null;
function drawLayer() {
  layer = document.createElement("canvas");
  layer.width = Math.round(W * dpr);
  layer.height = Math.round(H * dpr);
  const g = layer.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // haze over the horizon, and a faint pool of light round the pole
  const hz = g.createLinearGradient(0, H * 0.55, 0, H * 0.9);
  hz.addColorStop(0, rgb(PAL.haze, 0));
  hz.addColorStop(1, rgb(PAL.haze, 0.09));
  g.fillStyle = hz;
  g.fillRect(0, 0, W, H);
  const pg = g.createRadialGradient(POLE[0] * H, POLE[1] * H, 0, POLE[0] * H, POLE[1] * H, H * 0.45);
  pg.addColorStop(0, rgb(PAL.haze, 0.05));
  pg.addColorStop(1, rgb(PAL.haze, 0));
  g.fillStyle = pg;
  g.fillRect(0, 0, W, H);
  g.font = `400 ${fontPx}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
  g.textBaseline = "top";
  const grain = (c, r) => hash(c, r, 71);
  const range = (profile, colour, strength) => {
    // the rock, opaque, so it hides the trails behind it
    g.fillStyle = rgb(PAL.bg.map((v) => v * 1.2));
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, profile[0] * ch);
    for (let c = 0; c < cols; c++) g.lineTo((c + 0.5) * cw, profile[c] * ch); // smooth: only the characters keep to the grid
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    for (let c = 0; c < cols; c++) {
      const top = Math.round(profile[c]);
      for (let r = top; r < rows; r++) {
        const depth = r - top, gr = grain(c, r);
        // shaded strata, lighter just under the ridge
        const layers = Math.sin(c * 0.41 + depth * 0.25) + Math.sin(c * 0.21 - depth * 0.44);
        const light = Math.max(0, 0.28 + 0.18 * layers + 0.18 * gr);
        const shade = Math.exp(-depth / 13);
        let chr = null, k = 0;
        if (depth === 0) {
          const slope = (profile[Math.min(cols - 1, c + 1)] - profile[Math.max(0, c - 1)]) / 2;
          chr = slope < -0.31 ? "/" : slope > 0.31 ? "\\" : "-";
          k = (0.7 + 0.5 * gr) * strength;
        } else if (depth < 6.5 && light > 0.7) {
          chr = "/";
          k = 0.5 * strength;
        } else if (light + gr * 0.53 > 0.71) {
          chr = gr > 0.76 ? "." : ":";
          k = light * shade * 1.2 * strength;
        }
        if (chr && k > 0.03) {
          g.fillStyle = rgb(colour.map((v) => v * k));
          g.fillText(chr, c * cw, r * ch);
        }
      }
    }
  };
  range(FAR, PAL.rock.map((v) => v * 0.62), 0.75);
  range(NEAR, PAL.rock, 1);
}

// ---- reactions ----
let lit = []; // a trail lit by a new message: { star, colour, t0, tau }
let lanterns = []; // { source, colour, star }
let flashAt = -1e9, nowT = 0, overSince = null;
// trails a reaction can use: bright, mid-sky, their star above the mountains
function usableTrails(t) {
  return STARS.slice(0, NTRAILS)
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => {
      const [x, y] = starAt(s, t);
      return s.r > 0.15 && s.r < 0.75 && x > A * 0.22 && x < A - 0.05 && y > 0.05 && y < 0.6;
    });
}
onReaction((r) => {
  if (r.type === "pulse" && Array.isArray(r.colour)) {
    const pool = usableTrails(nowT).filter(({ i }) => !lanterns.some((l) => l.star === i) && !lit.some((p) => p.star === i));
    if (!pool.length) return;
    const { i } = pool[Math.floor(Math.random() * pool.length)];
    lit.push({ star: i, colour: r.colour.map((v) => v / 255), t0: nowT, tau: Math.max(1, (r.afterglow ?? 6) / 3) });
    if (lit.length > 4) lit.shift();
  } else if (r.type === "flash") flashAt = nowT;
  else if (r.type === "lanterns") {
    const items = Array.isArray(r.items) ? r.items.filter((l) => Array.isArray(l.colour)) : [];
    const next = [];
    for (const it of items.slice(0, 6)) {
      const had = lanterns.find((l) => l.source === it.source);
      let star = had?.star;
      if (star == null) {
        const pool = usableTrails(nowT).filter(({ i }) => !next.some((l) => l.star === i) && !lanterns.some((l) => l.star === i));
        if (!pool.length) continue;
        star = pool[Math.floor(Math.random() * pool.length)].i;
      }
      next.push({ source: it.source, colour: it.colour.map((v) => v / 255), star });
    }
    lanterns = next;
  }
});
function watchHover(t) {
  if (!HOVER || !pointer.on || !lanterns.length) return void (overSince = null);
  const X = pointer.x / H, Y = pointer.y / H;
  const l = lanterns.find((l) => {
    const [x, y] = starAt(STARS[l.star], t);
    return Math.hypot(X - x, Y - y) < 0.035;
  });
  if (!l) return void (overSince = null);
  if (overSince?.source !== l.source) overSince = { source: l.source, at: performance.now() };
  else if (performance.now() - overSince.at > 800) {
    seenLantern(l.source);
    overSince = null;
  }
}

// ---- drawing ----
let canvas = null, ctx = null;
const BANDS = 14; // each trail drawn in bands, the oldest light dimmest
function glyphAt(x, y, chr, colour) {
  const c = Math.floor((x * H) / cw), r = Math.floor((y * H) / ch);
  if (c < 0 || c >= cols || r < 0 || r >= SKY[c]) return; // off screen or behind the mountains
  ctx.fillStyle = colour;
  ctx.fillText(chr, c * cw, r * ch);
}
function render(now) {
  const t = STILL ? STILL_AT : reduced ? 40 : (now - start) / 1000 + 40;
  nowT = t;
  const flash = Math.max(0, 1 - (t - flashAt) / 0.8);
  lit = lit.filter((p) => t - p.t0 < p.tau * 6);
  watchHover(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = rgb(PAL.bg);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // the trails: thin arcs round the pole, clipped above the mountains
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, SKYF[0] * ch);
  for (let c = 0; c < cols; c++) ctx.lineTo((c + 0.5) * cw, SKYF[c] * ch);
  ctx.lineTo(W, 0);
  ctx.closePath();
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 0; i < NTRAILS; i++) {
    const s = STARS[i];
    const head = s.b - RATE * t;
    const lan = lanterns.find((l) => l.star === i);
    const pu = lit.find((p) => p.star === i);
    let colour = s.col, boost = 1 + 0.8 * flash, width = 1;
    if (lan) {
      colour = lan.colour;
      boost *= 1.5 + 0.3 * Math.sin(t * 1.6 + i);
      width = 1.5;
    }
    if (pu) {
      const k = Math.exp(-(t - pu.t0) / pu.tau);
      colour = mixc(colour, pu.colour, k);
      boost *= 1 + 1.6 * k;
      width = 1 + 0.6 * k;
    }
    ctx.lineWidth = width;
    const R = s.r * H, cx = POLE[0] * H, cy = POLE[1] * H;
    for (let k = 0; k < BANDS; k++) {
      // band k runs from older (k = 0, at the tail) to newer light (at the star)
      const a0 = head + s.trail * (1 - k / BANDS), a1 = head + s.trail * (1 - (k + 1) / BANDS);
      const age = 1 - (k + 0.5) / BANDS;
      const cadence = 0.8 + 0.2 * Math.sin(a0 * 9 + s.ph) ** 2; // a little unevenness along the trail
      const alpha = Math.min(0.95, s.e * (0.12 + 0.75 * Math.pow(1 - age, 0.6)) * cadence * boost * 0.75);
      ctx.strokeStyle = rgb(colour, alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, R, a1, a0); // the sky turns anticlockwise on screen (facing north): older light at larger angles
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // characters: dots along the newer part of each trail, then the stars themselves
  ctx.font = `400 ${fontPx}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  for (let i = 0; i < NTRAILS; i++) {
    const s = STARS[i];
    const lan = lanterns.find((l) => l.star === i);
    const pu = lit.find((p) => p.star === i);
    const colour = lan ? lan.colour : pu ? mixc(s.col, pu.colour, Math.exp(-(t - pu.t0) / pu.tau)) : s.col;
    const step = (cw * 3.5) / (s.r * H); // about every three or four characters
    const head = s.b - RATE * t;
    for (let a = step; a < s.trail * 0.3; a += step) {
      const k = 1 - a / (s.trail * 0.3);
      const alpha = s.e * 0.5 * k * (1 + 0.8 * flash);
      if (alpha < 0.06) continue;
      glyphAt(POLE[0] + s.r * Math.cos(head + a), POLE[1] + s.r * Math.sin(head + a), ".", rgb(colour, alpha));
    }
  }
  for (let i = 0; i < NSTARS; i++) {
    const s = STARS[i];
    const lan = i < NTRAILS && lanterns.find((l) => l.star === i);
    const tw = reduced ? 0.95 : 0.91 + 0.08 * Math.sin(t * 1.62 + s.ph);
    const e = s.e * tw * (1 + 0.6 * flash) * (lan ? 1.3 : 1);
    if (e < 0.05) continue;
    const chr = e > 0.74 ? "*" : e > 0.46 ? "+" : e > 0.22 ? ":" : ".";
    const [x, y] = starAt(s, t);
    glyphAt(x, y, chr, rgb(lan ? mixc(lan.colour, [1, 1, 1], 0.25) : s.col, Math.min(1, 0.25 + e)));
  }
  // the pole star, steady, with a little cross of light
  const pc = Math.floor((POLE[0] * H) / cw), pr = Math.floor((POLE[1] * H) / ch);
  const pole = (dc, dr, chr, a) => {
    ctx.fillStyle = rgb(mixc(PAL.star ?? [0.95, 0.96, 1], [1, 1, 1], 0.3), a);
    ctx.fillText(chr, (pc + dc) * cw, (pr + dr) * ch);
  };
  pole(0, 0, "*", 1);
  pole(1, 0, ".", 0.4);
  pole(-1, 0, ".", 0.4);
  pole(0, 1, ":", 0.3);
  pole(0, -1, ":", 0.3);

  // the mountains in front of it all
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
}

function resize() {
  dpr = STILL ? 1 : devicePixelRatio || 1;
  W = innerWidth;
  H = innerHeight;
  A = W / H;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  fontPx = Math.max(6, Math.min(11, H / 115));
  const m = document.createElement("canvas").getContext("2d");
  m.font = `400 ${fontPx}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
  // a whole number of device pixels per character (no gaps creeping in)
  cw = Math.max(1, Math.round(m.measureText("M").width * dpr)) / dpr;
  ch = fontPx * 1.05;
  cols = Math.ceil(W / cw);
  rows = Math.ceil(H / ch);
  // the pole: a little right of centre and high, the left fifth stays quiet for desktop icons
  POLE = A > 1.2 ? [A * 0.6, 0.3] : [A * 0.5, 0.3];
  makeMountains();
  drawLayer();
}

let start = performance.now();
canvas = document.createElement("canvas");
canvas.className = "canvas-wall";
canvas.setAttribute("role", "img");
canvas.setAttribute("aria-label", "Star trails: a long exposure of the night sky, stars drawing arcs around the pole star above dark mountains, in text characters.");
document.body.appendChild(canvas);
ctx = canvas.getContext("2d");
document.documentElement.dataset.renderer = "cpu";
makeStars();

if (STILL) {
  fontReady().then(() => {
    resize();
    render(0);
    sendStill(canvas);
  });
} else {
  resize();
  addEventListener("resize", () => {
    resize();
    render(performance.now());
  });
  fontReady().then(() => {
    resize();
    render(performance.now());
  });
  const fps = reduced ? 1 : preview ? 8 : num("fps", 20, 10, 30);
  const interval = 1000 / fps;
  let last = 0;
  const tick = (now) => {
    if (isPaused()) return whenResumed(() => requestAnimationFrame(tick));
    requestAnimationFrame(tick);
    if (document.hidden || now - last < interval - 2) return;
    last = now;
    render(now);
  };
  requestAnimationFrame(tick);
}
