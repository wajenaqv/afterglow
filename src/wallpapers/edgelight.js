// The lights of edge (edge.rs): the state of each one and how the four looks
// draw them. Used by the edge windows (edge.js) and the previews in Settings
// (edgepage.js). Colours come with the items; nothing here picks one.
//
//   const e = edgeLights(canvas)
//   e.set({ items: [{ source, colour }], shown, look, side, strength })
//   e.pop(source)          something new: its light swells
//   e.cursor([x, y]|null)  CSS px within the canvas; resting 0.8 s on a light
//                          calls e.onSeen(source)
//   e.running(bool)        stop drawing altogether (previews out of sight)

const PLACES = [0.5, 0.36, 0.64, 0.22, 0.78, 0.43, 0.57, 0.29, 0.71, 0.15, 0.85];
const POWER = { faint: 0.5, soft: 0.8, clear: 1.2 };
const RAMP = " .:-=+*#%@";
const DWELL = 0.8; // seconds of resting the cursor: seen
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function edgeLights(canvas, { scale = 1 } = {}) {
  const ctx = canvas.getContext("2d");
  let cfg = { items: [], shown: false, look: "thread", side: "bottom", strength: "soft" };
  let lights = []; // { source, col, to, home, amp, pop, drain, away, gone }
  let W = 0;
  let H = 0;
  let mouse = null;
  let shown = 0;
  let last = 0;
  let timer = 0;
  let on = true;
  const api = { onSeen: () => {}, set, pop, cursor, running };

  const flat = () => cfg.side === "top" || cfg.side === "bottom";
  const span = () => (flat() ? W : H);
  // u along the edge, v inward -> canvas px
  const xy = (u, v) => (cfg.side === "bottom" ? [u, H - v] : cfg.side === "top" ? [u, v] : cfg.side === "left" ? [v, u] : [W - v, u]);
  const rgba = (c, a) => `rgba(${c.map(Math.round)},${Math.min(1, a)})`;

  function place() {
    const free = PLACES.find((p) => !lights.some((l) => l.home === p && !l.gone));
    return free ?? 0.08 + 0.84 * ((lights.length * 0.618) % 1);
  }

  function set(next) {
    cfg = { ...cfg, ...next };
    for (const item of cfg.items) {
      const l = lights.find((x) => x.source === item.source && !x.gone);
      if (l) l.to = item.colour;
      else lights.push({ source: item.source, col: [...item.colour], to: item.colour, home: place(), amp: 0, pop: 1, drain: 0, away: false, gone: false });
    }
    for (const l of lights) if (!cfg.items.some((i) => i.source === l.source)) l.gone = true;
    kick();
  }
  function pop(source) {
    for (const l of lights) if (l.source === source && !l.gone) l.pop = 1;
    kick();
  }
  function cursor(at) {
    mouse = at;
    if (mouse && shown > 0.01) kick();
  }
  function running(yes) {
    on = yes;
    if (on) kick();
  }
  function kick() {
    if (timer || !on) return;
    last = performance.now();
    timer = requestAnimationFrame(frame);
  }

  // a soft half-ellipse of light lying on the edge
  function pool(u, ru, rv, col, a, width = 0.35) {
    const [x, y] = xy(u, 0);
    ru *= scale;
    rv *= scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flat() ? ru : rv, flat() ? rv : ru);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (let i = 0; i <= 8; i++) {
      const r = i / 8;
      g.addColorStop(r, rgba(col, Math.min(1, a) * Math.exp((-r * r) / (width * width * 2)) * (1 - r)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  const white = (c) => c.map((k) => k + (255 - k) * 0.85);

  const LOOKS = {
    thread(l) {
      const w = 110 + l.pop * 60;
      pool(l.u, w * 1.3, 34, l.col, l.a * 0.4);
      pool(l.u, w, 10, l.col, l.a * 0.6);
      pool(l.u, w * 0.9, 4, l.col, l.a * 1.3, 0.6);
      pool(l.u, w * 0.4, 3, white(l.col), l.a * 0.5, 0.6);
    },
    embers(l) {
      const r = 26 + l.pop * 14;
      pool(l.u, r, r, l.col, l.a * 0.6);
      pool(l.u, 8, 8, l.col, l.a * 1.5, 0.6);
      pool(l.u, 4, 4, white(l.col), l.a * 0.8, 0.6);
    },
    tide(l) {
      pool(l.u, 230 + l.pop * 70, 90 + l.pop * 30, l.col, l.a * 0.36, 0.4);
      pool(l.u, 130, 14, l.col, l.a * 0.42);
    },
  };

  function glyphs(list, now) {
    const along = (flat() ? 7 : 12) * scale;
    const deep = (flat() ? 12 : 7) * scale;
    ctx.font = `${11 * scale}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let r = 0; r < (flat() ? 2 : 4); r++)
      for (let i = 0; i * along < span(); i++) {
        const u = (i + 0.5) * along;
        const v = (r + 0.5) * deep;
        let t = 0;
        const c = [0, 0, 0];
        for (const l of list) {
          const d = (u - l.u) / ((48 + l.pop * 40) * scale);
          const e = l.a * Math.exp(-d * d - v / (13 * scale));
          if (e < 0.004) continue;
          t += e;
          for (let k = 0; k < 3; k++) c[k] += e * l.col[k];
        }
        const n = Math.sin(i * 127.1 + r * 311.7 + (still ? 0 : Math.floor(now / 400)) * 0.9) * 0.5 + 0.5;
        const lit = Math.min(1, t * 1.5 * (0.8 + 0.4 * n));
        const g = RAMP[Math.min(9, Math.floor(lit * 10))];
        if (g === " ") continue;
        const [x, y] = xy(u, v);
        ctx.fillStyle = rgba(c.map((k) => k / t), 0.25 + lit);
        ctx.fillText(g, x, y);
      }
  }

  function frame(now) {
    timer = 0;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const dpr = devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    const [pw, ph] = [Math.round(W * dpr), Math.round(H * dpr)];
    if (canvas.width !== pw || canvas.height !== ph) [canvas.width, canvas.height] = [pw, ph];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    shown += ((cfg.shown ? 1 : 0) - shown) * Math.min(1, dt * 4);
    const list = [];
    let busy = false; // moving enough to want the faster rate
    for (const l of lights) {
      for (let k = 0; k < 3; k++) l.col[k] += (l.to[k] - l.col[k]) * Math.min(1, dt * 3);
      l.amp += ((l.gone ? 0 : 1) - l.amp) * Math.min(1, dt * (l.gone ? 3 : 2.2));
      l.pop *= Math.exp(-dt / 1.6);
      // a slow wander of a few px, kind to OLED screens
      const u = l.home * span() + (still ? 0 : Math.sin(now / 47000 + l.home * 20) * 8 * scale);
      let over = false;
      if (mouse) {
        const [x, y] = xy(u, 0);
        const [dx, dy] = [Math.abs(mouse[0] - x), Math.abs(mouse[1] - y)];
        over = (flat() ? dx : dy) < 45 && (flat() ? dy : dx) < 22;
      }
      // a cursor that was already there when the light came isn't looking at it
      if (!over) l.away = true;
      const looking = over && l.away && cfg.shown && !l.gone && l.amp > 0.5;
      l.drain = Math.max(0, Math.min(1, l.drain + (looking ? dt / DWELL : -dt * 2)));
      if (l.drain >= 1 && !l.gone) {
        l.gone = true;
        api.onSeen(l.source);
      }
      const breathe = still ? 0.6 : 0.6 + 0.16 * Math.sin((now / 1000) * ((Math.PI * 2) / 6) + l.home * 9);
      const a = l.amp * shown * (POWER[cfg.strength] ?? 0.8) * (breathe + l.pop * 0.7) * (1 - l.drain * 0.85);
      busy ||= l.pop > 0.05 || looking || l.drain > 0 || Math.abs(l.amp - (l.gone ? 0 : 1)) > 0.03;
      if (a > 0.003) list.push({ u, a, pop: l.pop, col: l.col });
    }
    lights = lights.filter((l) => !(l.gone && l.amp < 0.01));
    ctx.clearRect(0, 0, W, H);
    // lights add up with each other; over the apps they tint, since a
    // see-through window can't add light to what's under it
    ctx.globalCompositeOperation = cfg.look === "glyphs" ? "source-over" : "lighter";
    if (cfg.look === "glyphs") glyphs(list, now);
    else for (const l of list) (LOOKS[cfg.look] ?? LOOKS.thread)(l);

    // nothing to see: stop until something changes
    if (!on || (!cfg.shown && shown < 0.01) || (!lights.length && !cfg.items.length)) return;
    busy ||= Math.abs(shown - (cfg.shown ? 1 : 0)) > 0.03;
    if (still && !busy) return;
    timer = setTimeout(() => (timer = requestAnimationFrame(frame)), busy ? 1000 / 30 - 8 : 1000 / 12 - 8);
  }
  return api;
}
