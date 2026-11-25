// Points of light that add up, on the GPU (WebGL2): a spec for scene-gl.js,
// shared by the attractor and silk. Every vertex is a point the scene's vertex
// shader places (gl_Position from cellPos()) and colours (vCol); their light is
// added into a cell-sized float texture, `uAcc`, which the scene's sampleCell
// or sampleCell4 reads (POINTS_GLSL: blurred(at), a light 3x3 blur).
//
//   pointsGL({ vs, glsl, ramp, draw(gl, u, { cols, rows }), bind(gl, u) })

import { compile } from "./glyph-atlas.js";

const FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;

// for the vertex shaders
export const POINTS_VS = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uCell; // a cell in screen heights
uniform vec2 uGrid; // columns, rows
out vec3 vCol;
vec4 cellPos(vec2 s) { return vec4(s / uCell / uGrid * 2.0 - 1.0, 0.0, 1.0); }
float rand(int n, int k, int z) { // common.js hash()
  uint h = uint(n) * 374761393u + uint(k) * 668265263u + uint(z) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
`;
export const POINTS_GLSL = `
uniform highp sampler2D uAcc;
vec3 blurred(ivec2 at) {
  ivec2 size = textureSize(uAcc, 0);
  vec3 s = vec3(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 j = at + ivec2(x, y);
      if (j.x < 0 || j.y < 0 || j.x >= size.x || j.y >= size.y) continue;
      s += texelFetch(uAcc, j, 0).rgb * (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
    }
  return s / 16.0;
}
`;

export function pointsGL({ vs, glsl, ramp, draw, bind = () => {} }) {
  let prog = null, vao = null, fbo = null, acc = null, cols = 0, rows = 0;
  return {
    ramp,
    glsl: POINTS_GLSL + glsl,
    init(gl) {
      if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return false;
      prog = compile(gl, POINTS_VS + vs, FS);
      vao = gl.createVertexArray();
      return true;
    },
    pre(gl, g) {
      if (g.cols !== cols || g.rows !== rows) {
        ({ cols, rows } = g);
        if (fbo) {
          gl.deleteFramebuffer(fbo);
          gl.deleteTexture(acc);
        }
        acc = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, acc);
        for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, cols, rows);
        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, cols, rows);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog.p);
      gl.bindVertexArray(vao);
      gl.uniform2f(prog.u.uGrid, cols, rows);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      draw(gl, prog.u, { cols, rows });
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
    bind(gl, u, unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, acc);
      gl.uniform1i(u.uAcc, unit);
      bind(gl, u);
    },
  };
}
