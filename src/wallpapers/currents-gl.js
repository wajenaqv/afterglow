// Currents' strands on the GPU (WebGL2), a spec for scene-gl.js. currents.js
// traces the strands and hands over their pieces; here
//
//   1. pieces  one instanced quad per short straight piece, at cell
//              resolution: each cell's light v from its distance to the
//              piece's line. The brightest wins a cell: v is written as the
//              depth, tested with GREATER, so what belongs to it (whose strand,
//              which direction, its colour) comes along
//   2. cells   (scene-gl.js's light pass) light -> character and colour
//   3. glyphs  scene-gl.js's own glyph pass
//
// The same maths as the CPU renderer in currents.js frame(): keep them in step.

import { compile } from "./glyph-atlas.js";

const PIECE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPiece;  // x, y, and the direction
layout(location = 1) in float aWhich; // strand * 512 + its place along the strand
uniform highp sampler2D uStrands;     // two texels a strand: r g b light, len pieces white id
uniform vec2 uCellH;                  // a cell's size in screen heights
uniform vec2 uGrid;                   // columns, rows
flat out vec4 vPiece;
flat out vec4 vLight;  // light at the middle, its slope, 1 / width^2, how white
flat out vec4 vBase;   // colour, strand id
flat out float vDir;
void main() {
  int which = int(aWhich + 0.5), strand = which / 512;
  vec4 a = texelFetch(uStrands, ivec2(0, strand), 0), b = texelFetch(uStrands, ivec2(1, strand), 0);
  float fr = float(which - strand * 512) / b.y;
  float w = uCellH.y * (0.34 + 0.26 * smoothstep(0.0, 0.65, fr) * (1.0 - smoothstep(0.75, 1.0, fr)));
  vPiece = aPiece;
  vLight = vec4(a.w * (0.1 + 0.95 * pow(fr, 1.3)), a.w * 0.95 * 1.3 * pow(max(fr, 0.02), 0.3) / b.x, 1.0 / (w * w), 0.2 * smoothstep(0.7, 1.0, fr) * b.z);
  vBase = vec4(a.rgb, b.w);
  // the character for a thin line this way (currents.js glyph())
  vec2 d = aPiece.zw, ad = abs(d);
  float fy = fract(aPiece.y / uCellH.y);
  if (ad.y > 0.9 * ad.x) vDir = ad.y > 2.9 * ad.x ? 0.0 : d.x * d.y > 0.0 ? 2.0 : 1.0;
  else vDir = fy < 0.3 ? 3.0 : fy < 0.68 ? 4.0 : fy < 0.86 ? 5.0 : 6.0;
  // the cells it can reach
  vec2 h = ad * uCellH.y * 1.1 * 0.5 + w * 1.6;
  vec2 lo = floor((aPiece.xy - h) / uCellH), hi = floor((aPiece.xy + h) / uCellH) + 1.0;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  gl_Position = vec4(mix(lo, hi, corner) / uGrid * 2.0 - 1.0, 0.0, 1.0);
}`;

const PIECE_FS = `#version 300 es
precision highp float;
flat in vec4 vPiece;
flat in vec4 vLight;
flat in vec4 vBase;
flat in float vDir;
uniform vec2 uCellH;
layout(location = 0) out vec4 oCell;   // light, strand id, slot (7 = beside the line), how white
layout(location = 1) out vec4 oColour;
void main() {
  vec2 e = (floor(gl_FragCoord.xy) + 0.5) * uCellH - vPiece.xy;
  float al = dot(e, vPiece.zw);
  if (abs(al) > uCellH.y * 1.1 * 0.62) discard;
  float pe = e.x * vPiece.w - e.y * vPiece.z, e2 = pe * pe * vLight.z;
  if (e2 > 2.6) discard;
  float v = (vLight.x + vLight.y * al) * exp(-e2);
  if (v < 0.045) discard;
  oCell = vec4(v, vBase.w, e2 < 0.8 ? vDir : 7.0, vLight.w);
  oColour = vec4(vBase.rgb, 1.0);
  gl_FragDepth = min(v * 0.25, 1.0);
}`;

const CELLS_GLSL = `
uniform highp sampler2D uLit;
uniform highp sampler2D uColour;
float dither(ivec2 c) { // common.js hash(c, r, 7)
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + 7u * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
vec4 sampleCell4(vec2 P) {
  ivec2 at = ivec2(floor(gl_FragCoord.xy)), size = textureSize(uLit, 0);
  vec4 a = texelFetch(uLit, at, 0);
  float v = a.x;
  if (v <= 0.0) return vec4(0.0);
  vec3 base = texelFetch(uColour, at, 0).rgb;
  vec3 col = base + (1.0 - base) * a.w * v;
  // where a brighter strand touches, this one gives way
  bool touched = false;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 j = at + ivec2(x, y);
      if (j.x < 0 || j.y < 0 || j.x >= size.x || j.y >= size.y) continue;
      vec4 b = texelFetch(uLit, j, 0);
      if (b.x > v && b.y != a.y) touched = true;
    }
  if (touched) {
    if (a.z > 6.5) return vec4(0.0);
    v *= 0.35;
  }
  float g = a.z;
  if (v >= 0.13 || g > 6.5) g = 7.0 + min(8.0, floor(pow(min(v * 1.1, 1.0), 0.55) * 9.0));
  col *= 1.8 * pow(v, 0.7);
  float top = max(col.r, max(col.g, col.b));
  if (top >= 0.75) {
    float held = 1.0 - 0.25 * exp((0.75 - top) / 0.25);
    col *= held / top;
    col += (1.0 - col) * 0.6 * (1.0 - exp((held - top) / 0.8));
  }
  col += (dither(at) - 0.5) / 63.0;
  return vec4(floor(clamp(col, 0.0, 1.0) * 63.0 + 0.5) * 4.0 / 255.0, g + 1.0); // cells.js's steps of 4
}`;

// next(): what to draw, from currents.js: { pieces (5 floats each), count,
//   strands (8 floats each), strandCount, cwH, chH }
export function strandsGL(ramp, next) {
  let prog = null, vao = null, buf = null, strandTex = null, fbo = null, lit = null, colour = null, depth = null;
  let cols = 0, rows = 0, strandRows = 0;

  function texture(gl, format) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    if (format) gl.texStorage2D(gl.TEXTURE_2D, 1, format, cols, rows);
    return t;
  }
  function targets(gl) {
    if (fbo) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(lit);
      gl.deleteTexture(colour);
      gl.deleteRenderbuffer(depth);
    }
    lit = texture(gl, gl.RGBA32F);
    colour = texture(gl, gl.RGBA16F);
    depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, cols, rows);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lit, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, colour, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }

  return {
    ramp,
    glsl: CELLS_GLSL,
    // false: this GPU can't (the scene falls back to the CPU)
    init(gl) {
      if (!gl.getExtension("EXT_color_buffer_float")) return false;
      prog = compile(gl, PIECE_VS, PIECE_FS);
      buf = gl.createBuffer();
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);
      return true;
    },
    // before the light pass: the pieces into cells
    pre(gl, g) {
      const d = next();
      if (g.cols !== cols || g.rows !== rows) {
        cols = g.cols;
        rows = g.rows;
        targets(gl);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, cols, rows);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.depthMask(true);
      gl.clearBufferfv(gl.DEPTH, 0, [0]);
      if (!d.count) return;
      gl.useProgram(prog.p);
      gl.activeTexture(gl.TEXTURE0);
      if (!strandTex || d.strandCount > strandRows) {
        if (strandTex) gl.deleteTexture(strandTex);
        strandTex = texture(gl, 0);
        strandRows = d.strands.length / 8; // room for every strand
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 2, strandRows);
      }
      gl.bindTexture(gl.TEXTURE_2D, strandTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, d.strandCount, gl.RGBA, gl.FLOAT, d.strands);
      gl.uniform1i(prog.u.uStrands, 0);
      gl.uniform2f(prog.u.uCellH, d.cwH, d.chH);
      gl.uniform2f(prog.u.uGrid, cols, rows);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, d.pieces, gl.STREAM_DRAW, 0, d.count * 5);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.GREATER);
      gl.disable(gl.BLEND);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.count);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
    },
    bind(gl, u, unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, lit);
      gl.uniform1i(u.uLit, unit);
      gl.activeTexture(gl.TEXTURE0 + unit + 1);
      gl.bindTexture(gl.TEXTURE_2D, colour);
      gl.uniform1i(u.uColour, unit + 1);
    },
  };
}
