// The night-scene renderer (nightscene.js startScene) on the GPU (WebGL2).
// Same picture as the CPU one: a scene's sample() runs once per character
// cell, then ink() turns each cell's light into a character and colour.
//
//   1. light   a fragment shader at cell resolution runs the scene's
//              sampleCell(X, Y) (GLSL the scene provides, the same maths as
//              its JS sample()) into a cell-sized float texture
//   2. glyphs  a fragment shader at screen resolution: nightscene.js ink()
//              per cell (tone curve, dithered cut-off for fading light,
//              colour), and the character's pixels from the glyph atlas
//
// The scene's spec: { glsl, bind(gl, u, unit) }. `glsl` declares its own
// uniforms and defines `vec3 sampleCell(vec2 P)` (P in screen heights, like
// sample(X, Y)); bind() sets those uniforms each frame (texture units from
// `unit` up are free for it).

import { GLYPH_GLSL, QUAD_VS, buildAtlas, compile, floatTex, gpuContext } from "./glyph-atlas.js";

const RAMP = ".:-=+*oO#%@"; // nightscene.js RAMP without the blank

const lightFS = (glsl) => `#version 300 es
precision highp float;
uniform vec2 uCell;  // CSS px
uniform float uH;    // screen height, CSS px
out vec4 o;
${glsl}
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 P = vec2((cell.x + 0.5) * uCell.x, (cell.y + 0.5) * uCell.y) / uH;
  o = vec4(sampleCell(P), 1.0);
}`;

// nightscene.js ink() and common.js hash()
const GLYPH_FS = `#version 300 es
precision highp float;
uniform sampler2D uLight;
uniform vec2 uCell;
uniform float uDpr, uCanvasH;
uniform vec3 uBG; // 0..255
out vec4 o;
${GLYPH_GLSL}
// common.js hash(x, y, z): the same 32-bit integer maths
float hash3(int x, int y, int z) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
void main() {
  vec3 bg = uBG / 255.0;
  vec2 css = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y) / uDpr;
  ivec2 cell = ivec2(floor(css.x / uCell.x), floor(css.y / uCell.y));
  ivec2 size = textureSize(uLight, 0);
  if (cell.x >= size.x || cell.y >= size.y) { o = vec4(bg, 1.0); return; }
  vec3 col = texelFetch(uLight, cell, 0).rgb;
  float L = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;
  float T = 1.0 - exp(-L * 2.2);
  if (T < 0.045 + 0.06 * hash3(cell.x, cell.y, 5)) { o = vec4(bg, 1.0); return; }
  float top = max(max(col.r, col.g), max(col.b, 1e-4));
  float f = 0.3 + 0.85 * T;
  float hot = max(0.0, T - 0.8) * 2.5;
  vec3 c = (col / top) * 255.0 * f;
  c = c + (vec3(255.0) - c) * hot * 0.6;
  c = clamp(floor(c / 6.0 + 0.5) * 6.0, 0.0, 255.0); // style(): colours quantised to 6s
  float g = clamp(floor(T * 11.0 + 0.5), 1.0, 11.0) - 1.0;
  vec2 local = (css - vec2(cell) * uCell) * uDpr;
  o = vec4(mix(bg, c / 255.0, glyphInk(g, c, local)), 1.0);
}`;

// Returns null when the GPU can't be used (the caller falls back to the CPU)
export function createSceneGL(canvas, { still, spec }) {
  const gl = gpuContext(canvas, still);
  if (!gl) return null;
  let light, glyph;
  try {
    light = compile(gl, QUAD_VS, lightFS(spec.glsl));
    glyph = compile(gl, QUAD_VS, GLYPH_FS);
  } catch (e) {
    console.warn("afterglow: GPU scene unavailable, using the CPU:", e.message);
    return null;
  }
  const emptyVao = gl.createVertexArray();
  const atlasTex = gl.createTexture();
  let g = null;

  function resize({ dpr, cw, ch, cols, rows, fontPx, font }) {
    if (g) gl.deleteTexture(g.light);
    const lightTex = floatTex(gl, cols, rows, gl.getExtension("EXT_color_buffer_float") != null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    g = { dpr, cw, ch, cols, rows, light: lightTex, fbo, ...buildAtlas(gl, atlasTex, RAMP, { cw, ch, dpr, fontPx, font }) };
  }

  // { H, bg (0..255) }
  function draw({ H, bg }) {
    if (!g) return;
    gl.bindVertexArray(emptyVao);
    // 1. light per cell. Rows: the texture's row r is the screen's row r
    // (gl_FragCoord.y counts from 0 at the texture's first row)
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.viewport(0, 0, g.cols, g.rows);
    gl.useProgram(light.p);
    gl.uniform2f(light.u.uCell, g.cw, g.ch);
    gl.uniform1f(light.u.uH, H);
    spec.bind(gl, light.u, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. glyphs to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(glyph.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.light);
    gl.uniform1i(glyph.u.uLight, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(glyph.u.uAtlas, 1);
    gl.uniform1f(glyph.u.uAtlasW, g.slotW);
    gl.uniform1f(glyph.u.uAtlasH, g.slotH);
    gl.uniform2f(glyph.u.uCell, g.cw, g.ch);
    gl.uniform1f(glyph.u.uDpr, g.dpr);
    gl.uniform1f(glyph.u.uCanvasH, canvas.height);
    gl.uniform3f(glyph.u.uBG, ...bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { gl, resize, draw };
}
