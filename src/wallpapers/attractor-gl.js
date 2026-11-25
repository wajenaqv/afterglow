// The attractor on the GPU, through points-gl.js: every vertex starts at its own
// fixed random spot and goes through the map some twenty times. The same maths
// as light() and sample() in attractor.js: keep them in step.

import { pointsGL } from "./points-gl.js";

const POINTS = 900000;

const VS = `
uniform vec4 uMap;      // a b c d
uniform vec2 uRot;      // cos, sin
uniform vec4 uPlace;    // centre, scale (screen heights)
uniform vec3 uA, uB;    // the two hues
uniform float uT, uGain;
uniform vec4 uLine;     // a thread: start, direction
uniform vec4 uThread;   // colour, and points in it (0 = the veils)
uniform int uSteps;
vec2 map(vec2 p) {
  return vec2(sin(uMap.x * p.y) + uMap.z * cos(uMap.x * p.x), sin(uMap.y * p.x) + uMap.w * cos(uMap.y * p.y));
}
void main() {
  vec2 p;
  if (uThread.w > 0.5) {
    p = uLine.xy + uLine.zw * ((float(gl_VertexID) + 0.5) / uThread.w - 0.5);
    for (int k = 0; k < uSteps; k++) p = map(p);
    vCol = uThread.rgb * uGain;
  } else {
    p = vec2(rand(gl_VertexID, 1, 0), rand(gl_VertexID, 2, 0)) * 2.0 - 1.0;
    vec2 was = p;
    int n = 15 + gl_VertexID % 8;
    for (int k = 0; k < n; k++) { was = p; p = map(p); }
    float h = 0.5 + 0.5 * sin(1.1 * (p.x - was.x) + 0.7 * (p.y - was.y) + 0.03 * uT);
    vCol = mix(uA, uB, h) * uGain;
  }
  vec2 s = uPlace.xy + vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x) * uPlace.zw;
  gl_Position = cellPos(s);
  gl_PointSize = 1.0;
}`;
export function attractorGL(next) {
  return pointsGL({
    vs: VS,
    draw(gl, u, { cols, rows }) {
      const { F, PAL, cw, ch, VEIL, THREAD } = next();
      gl.uniform2f(u.uCell, cw, ch);
      gl.uniform4f(u.uMap, F.a, F.b, F.c, F.d);
      gl.uniform2f(u.uRot, F.cs, F.sn);
      gl.uniform4f(u.uPlace, F.cx, F.cy, F.sx, F.sy);
      gl.uniform3f(u.uA, ...PAL.a);
      gl.uniform3f(u.uB, ...PAL.b);
      gl.uniform1f(u.uT, F.t);
      gl.uniform4f(u.uThread, 0, 0, 0, 0);
      gl.uniform1f(u.uGain, ((VEIL * (1 + 1.2 * F.flash) * cols * rows) / POINTS) * (0.06 / (F.sx * F.sy)) * 0.9);
      gl.drawArrays(gl.POINTS, 0, POINTS);
      for (const t of F.threads) {
        const N = t.bead ? 500 : 5000;
        gl.uniform4f(u.uLine, t.x, t.y, t.dx, t.dy);
        gl.uniform4f(u.uThread, ...t.colour, N);
        gl.uniform1i(u.uSteps, t.n);
        gl.uniform1f(u.uGain, ((THREAD * t.k * 5000) / N) * (t.bead ? 0.35 : 1) * (0.0076 / ch));
        gl.drawArrays(gl.POINTS, 0, N);
      }
    },
  });
}
