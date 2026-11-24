// Scenes that lay out their own characters (sakura, constellation): each
// frame the scene puts a glyph and a colour into the cells it uses, and both
// renderers draw the same buffer. The CPU draws it as text (nightscene.js
// "direct" sample: [col, char, css]); the GPU uploads it as a texture and
// draws it through scene-gl.js's direct mode, so the two can't drift apart.
// For scenes where only some cells hold something, this is much cheaper than
// working out every cell's light.
//
//   const cells = cellBuffer(".:*+-|/\\");   every character the scene draws
//   cells.resize(cols, rows)                 from the scene's layout()
//   cells.clear(); cells.put(i, "*", [r, g, b] 0..1); cells.has(i)
//   startScene({ ..., sample: cells.sample, gpu: cells.gpu })

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const q4 = (v) => Math.round(clamp01(v) * 63) * 4; // colours in steps of 4 (fewer canvas styles)
const BLANK = [[0, 0, 0], " ", "-"];

export function cellBuffer(glyphs) {
  const SLOT = Object.fromEntries([...glyphs].map((ch, k) => [ch, k + 1]));
  let cols = 0, rows = 0;
  // per cell: r, g, b (0..255) and the glyph slot (0 blank, else its place in `glyphs` + 1)
  let CELL = new Uint8Array(0);
  const cssCache = new Map();
  const cssAt = (k) => {
    const key = (CELL[k] << 16) | (CELL[k + 1] << 8) | CELL[k + 2];
    let s = cssCache.get(key);
    if (!s) cssCache.set(key, (s = `rgb(${CELL[k]},${CELL[k + 1]},${CELL[k + 2]})`));
    return s;
  };
  let tex = null;
  return {
    resize(c, r) {
      cols = c;
      rows = r;
      CELL = new Uint8Array(c * r * 4);
    },
    clear: () => CELL.fill(0),
    put(i, g, c) {
      const k = i * 4, s = SLOT[g];
      if (!s) return; // not in `glyphs` (a space, or a character the scene forgot to list)
      CELL[k] = q4(c[0]);
      CELL[k + 1] = q4(c[1]);
      CELL[k + 2] = q4(c[2]);
      CELL[k + 3] = s;
    },
    // put by column and row, ignoring cells off the screen
    putAt(c, r, g, col) {
      if (c >= 0 && r >= 0 && c < cols && r < rows) this.put(r * cols + c, g, col);
    },
    has: (i) => CELL[i * 4 + 3] !== 0,
    sample(X, Y, t, cell) {
      const k = (cell[1] * cols + cell[0]) * 4, s = CELL[k + 3];
      return s ? [BLANK[0], glyphs[s - 1], cssAt(k)] : BLANK;
    },
    gpu: {
      ramp: glyphs,
      glsl: `
uniform sampler2D uCells;
vec4 sampleCell4(vec2 P) {
  vec4 c = texelFetch(uCells, ivec2(floor(gl_FragCoord.xy)), 0);
  return vec4(c.rgb, floor(c.a * 255.0 + 0.5));
}`,
      bind(gl, u, unit) {
        if (!tex) {
          tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
        }
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, CELL);
        gl.uniform1i(u.uCells, unit);
      },
    },
  };
}
