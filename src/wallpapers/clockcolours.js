// The clock's colours: what the showing wallpaper is drawn in (palettes.js,
// the wallpapers' own palettes), the brand's fade, or one colour you pick.
//
// Always one smooth gradient, [top, low] (0-255 RGB): light at the top of the
// digits into the colour at the bottom. Wallpapers of several hues (jellyfish,
// paw prints, star colours) fade from one into the next; a hue per digit was
// tried and looked like blocks of colour.

import { TINTS, PAWS, CLOUDS, SAKURA, CONSTELLATION, STARTRAILS, STAR_COOL, STAR_HOT, CURRENTS, MAGNET, ATTRACTOR, SILK, PHOSPHORS } from "./palettes.js";

const bytes = (c) => c.map((v) => Math.round(v * 255)); // from 0-1
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const pale = (c, k = 0.7) => mix(c, [255, 255, 255], k);
/** Bright enough to read on black, keeping the hue */
const readable = (c) => {
  const k = 190 / Math.max(...c, 1);
  return k > 1 ? c.map((v) => Math.round(v * k)) : c;
};

const jelly = (tint) => {
  const { hues } = TINTS[tint] ?? TINTS.natural;
  return [pale(hues[0].bell), hues[1].bell];
};
const phosphor = (tint) => {
  const p = PHOSPHORS[tint] ?? PHOSPHORS.green;
  return [bytes(p.flash), bytes(p.ink)];
};
// each wallpaper's colours for its palette choice (?tint=)
const WALLS = {
  jellyfish: jelly,
  // one jelly: its own hue, which can be a random one (the wallpaper says which)
  "big-jellyfish": (tint, hue) => {
    if (hue == null) return jelly(tint);
    const { hues } = TINTS[tint] ?? TINTS.natural;
    const h = hues[hue % hues.length];
    return [pale(h.tent), h.bell];
  },
  paws: (tint) => {
    const { tints } = PAWS[tint] ?? PAWS.natural;
    return [pale(bytes(tints[0])), bytes(tints[1])];
  },
  cloudsea: (tint) => {
    // the glow at the horizon into the night above it
    const [night, mid] = (CLOUDS[tint] ?? CLOUDS.natural).glow.map(bytes);
    return [pale(mid, 0.5), readable(mix(mid, night, 0.6))];
  },
  sakura: (tint) => {
    const p = SAKURA[tint] ?? SAKURA.natural;
    return [bytes(p.pale), mix(bytes(p.petal), bytes(p.deep), 0.5)];
  },
  constellation: (tint) => {
    const p = CONSTELLATION[tint] ?? CONSTELLATION.natural;
    return [bytes(p.bright), bytes(p.line)];
  },
  startrails: (tint) => {
    const { star } = STARTRAILS[tint] ?? STARTRAILS.natural;
    if (!star) return [pale(bytes(STAR_COOL), 0.3), bytes(STAR_HOT)];
    const c = bytes(star);
    return [pale(c, 0.5), c.map((v) => Math.round(v * 0.72))];
  },
  currents: (tint) => {
    const hues = CURRENTS[tint] ?? CURRENTS.natural;
    return [pale(bytes(hues[0]), 0.5), readable(bytes(hues[2]))];
  },
  magnet: (tint) => {
    const p = MAGNET[tint] ?? MAGNET.natural;
    return [pale(bytes(p.plus), 0.5), readable(bytes(p.minus))];
  },
  attractor: (tint) => {
    const p = ATTRACTOR[tint] ?? ATTRACTOR.natural;
    return [pale(bytes(p.b), 0.5), readable(bytes(p.a))];
  },
  silk: (tint) => {
    const p = SILK[tint] ?? SILK.natural;
    return [pale(bytes(p.b), 0.5), readable(bytes(p.a))];
  },
  radar: phosphor,
  life: phosphor,
  circuit: phosphor,
  silicon: phosphor,
  impossible: phosphor,
};
export const wallColours = (wall, tint, hue = null) => (WALLS[wall] ?? jelly)(tint || "natural", hue);

/** A colour of the page's (a CSS variable), as 0-255 RGB */
function cssColour(name) {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
}
export const brandColours = () => [cssColour("--logo-top"), cssColour("--logo-bottom")];

/** "#rrggbb" or "rrggbb" -> [r, g, b], else null */
export function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(s ?? "");
  return m ? [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)) : null;
}

/**
 * The colours for a clock's setting: "wallpaper", "brand" or "#rrggbb".
 * A picked colour is the same from top to bottom.
 */
export function clockColours(setting, wall, tint, hue) {
  const own = parseHex(setting);
  if (own) return [own, own];
  return setting === "brand" ? brandColours() : wallColours(wall, tint, hue);
}

/** One row's colour, 0-255 RGB (y of n rows); dim cells are faint */
export function rowColour([top, low], y, n, dim, solid) {
  const c = mix(top, low, solid ? 0.85 : n > 1 ? y / (n - 1) : 0.55);
  return dim ? c.map((v) => Math.round(v * 0.4)) : c;
}

/** Draw a grid of cells (clockstyles.js) into a <pre>: a span per colour run */
export function paintGrid(pre, cells, colours, solid = false) {
  const n = cells.length;
  const out = document.createDocumentFragment();
  cells.forEach((row, y) => {
    let run = "", last = 0;
    const flush = () => {
      if (!run) return;
      const span = document.createElement("span");
      span.style.color = `rgb(${rowColour(colours, y, n, last, solid).join(",")})`;
      // one line of text has no rows to fade over: the fade is inside the letters
      if (n === 1 && !solid && String(colours[0]) !== String(colours[1])) {
        Object.assign(span.style, {
          background: `linear-gradient(rgb(${colours[0].join(",")}) 15%, rgb(${colours[1].join(",")}) 85%)`,
          webkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          textShadow: "none", // it would show through the letters
          filter: `drop-shadow(0 0 6px rgba(${colours[1].join(",")}, 0.5))`,
        });
      }
      span.textContent = run;
      out.append(span);
      run = "";
    };
    for (const [ch, dim] of row) {
      if (ch !== " " && dim !== last) {
        flush();
        last = dim;
      }
      run += ch;
    }
    if (y < n - 1) run += "\n";
    flush();
  });
  pre.replaceChildren(out);
}
