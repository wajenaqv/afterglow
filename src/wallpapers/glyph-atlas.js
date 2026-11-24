// The glyph atlas shared by the GPU renderers: the characters a wallpaper
// draws, rendered once with the wallpaper's font, at 16 brightness levels.
//
// Why levels: Chrome shapes a character's edges by the brightness of its
// colour (dim text gets thinner edges, ~75-80% of the ink of white at the
// dark end). The CPU renderers draw each character in its own colour, so to
// look the same, each row of the atlas holds the glyphs drawn in one grey,
// and the shader reads the row matching each cell's colour brightness.
// Drawn light on black, like the wallpapers' text on the dark background
// (over a transparent background Chrome draws heavier edges).

const LEVELS = 16;
const levelGrey = (level) => Math.round(((level + 0.5) / LEVELS) * 255);

// GLSL: ink coverage (0..1) of glyph slot g for a cell coloured c (0..255),
// at local device-pixel offset `local` inside the cell
export const GLYPH_GLSL = `
uniform sampler2D uAtlas;
uniform float uAtlasW;  // device px per glyph slot
uniform float uAtlasH;  // device px per brightness row
float glyphInk(float g, vec3 c, vec2 local) {
  float lum = dot(c / 255.0, vec3(0.2126, 0.7152, 0.0722));
  float level = clamp(floor(lum * ${LEVELS}.0), 0.0, ${LEVELS - 1}.0);
  float grey = floor((level + 0.5) / ${LEVELS}.0 * 255.0 + 0.5) / 255.0;
  float ink = texelFetch(uAtlas, ivec2(g * uAtlasW + local.x, level * uAtlasH + local.y), 0).r / grey;
  return clamp(ink, 0.0, 1.0);
}`;

// Draw the atlas for `glyphs` (a string, one slot each) into texture `tex`.
// Returns the slot size in device px.
export function buildAtlas(gl, tex, glyphs, { cw, ch, dpr, fontPx, font }) {
  const slotW = Math.ceil(cw * dpr) + 1;
  const slotH = Math.ceil(ch * dpr) + 1;
  const ac = document.createElement("canvas");
  ac.width = slotW * glyphs.length;
  ac.height = slotH * LEVELS;
  const actx = ac.getContext("2d", { alpha: false });
  actx.fillStyle = "#000";
  actx.fillRect(0, 0, ac.width, ac.height);
  actx.font = font.replace(/[\d.]+px/, `${fontPx * dpr}px`);
  actx.textBaseline = "top";
  for (let level = 0; level < LEVELS; level++) {
    const v = levelGrey(level);
    actx.fillStyle = `rgb(${v},${v},${v})`;
    [...glyphs].forEach((chr, i) => actx.fillText(chr, i * slotW, level * slotH));
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ac);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return { slotW, slotH };
}

// Shader helpers shared by the GPU renderers
export function compile(gl, vsSrc, fsSrc) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

// A full-screen triangle (draw 3 vertices with an empty vertex array)
export const QUAD_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// A float texture to render into (cell-sized light buffers). Half floats can
// be blended (the jellyfish adds light up); full floats when no blending is
// needed and exactness matters (the scenes' dithered cut-off)
export function floatTex(gl, w, h, full = false) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (full) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// A WebGL2 context fit for the GPU renderers, or null
export function gpuContext(canvas, still) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: !!still });
  if (!gl) return null;
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return null;
  return gl;
}
