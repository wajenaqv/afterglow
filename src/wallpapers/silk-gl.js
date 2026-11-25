// Silk on the GPU: the points of the cloth. The same maths as light() in
// silk.js: keep them in step.

import { pointsGL } from "./points-gl.js";

const POINTS = 420000;

const vs = ({ DRAPE, THREADS, MAX }) => `
uniform float uT, uAspect, uCx, uSx, uGain;
uniform vec3 uA, uB;
uniform int uPatches;
uniform vec4 uAt[${MAX}];
uniform vec4 uHue[${MAX}];
float wander(float a, float b) { return 0.5 * sin(a) + 0.3 * sin(1.7 * a + b) + 0.2 * sin(2.9 * a - 1.3 * b); }
vec3 cloth(float v, float w) {
  float s = v * 2.0 - 1.0, t = uT;
${
  DRAPE
    ? `  float r = w * 1.35, open = 0.1 + 0.95 * pow(r, 0.8);
  float ph = s * 9.5 + 0.9 * sin(r * 2.6 - t * 0.08 + s * 2.0) + t * 0.03;
  float an = s * 0.62 * (0.55 + 0.45 * r) + 0.05 * wander(r * 2.0 - t * 0.06, 3.0);
  return vec3(
    uCx + uSx * (sin(an) * r * 1.05 + 0.075 * open * sin(ph) + 0.022 * open * sin(2.3 * ph + r * 3.0) + 0.04 * sin(t * 0.07 + r * 2.0)),
    -0.1 + cos(an) * r * 0.92 + 0.05 * open * cos(ph + 0.6) * r,
    cos(ph));`
    : `  float y = w * 1.36 - 0.18, f = 7.5 * s + 3.0 * y - t * 0.11;
  return vec3(
    uCx + uSx * (0.16 * wander(y * 2.0 - t * 0.07, 1.0) + s * (0.36 + 0.07 * sin(y * 1.7 + t * 0.06)) + 0.1 * sin(f) + 0.05 * sin(15.0 * s - 4.2 * y + t * 0.08) + 0.02 * sin(29.0 * s + 5.0 * y)),
    y + 0.05 * sin(4.0 * s + 2.0 * y + t * 0.09),
    cos(f));`
}
}
void main() {
  int i = gl_VertexID;
  float a = float(uint(i) * 3242174889u) / 4294967296.0, w = float(uint(i) * 2447445414u) / 4294967296.0;
  float th = floor(a * ${THREADS}.0), v = (th + 0.2 + 0.6 * rand(i, 1, 3)) / ${THREADS}.0;
  vec3 p = cloth(v, w);
  float e = uGain * (0.35 + 0.65 * pow(0.5 + 0.5 * p.z, 1.6)) * (0.75 + 0.25 * sin(w * 9.0 + th * 0.31 - uT * 0.25)) * smoothstep(0.1 * uAspect, 0.34 * uAspect, p.x);
  vec3 c = mix(uA, uB, clamp(0.5 + 0.5 * wander(v * 3.2 + p.y * 1.4 + uT * 0.04, 1.0), 0.0, 1.0));
  for (int n = 0; n < uPatches; n++) {
    vec2 d = (vec2(v, w) - uAt[n].xy) / uAt[n].zw;
    float k = min(1.0, uHue[n].w * 1.6 * exp(-dot(d, d)));
    c = mix(c, uHue[n].rgb, k);
    e *= 1.0 + 1.6 * k;
  }
  vCol = c * e;
  gl_Position = cellPos(p.xy);
  gl_PointSize = 1.0;
}`;

export function silkGL(spec, next) {
  return pointsGL({
    vs: vs(spec),
    draw(gl, u, { cols, rows }) {
      const { F, PAL, cw, ch } = next();
      gl.uniform2f(u.uCell, cw, ch);
      gl.uniform1f(u.uT, F.t);
      gl.uniform1f(u.uAspect, F.A);
      gl.uniform1f(u.uCx, F.cx);
      gl.uniform1f(u.uSx, F.sx);
      gl.uniform3f(u.uA, ...PAL.a);
      gl.uniform3f(u.uB, ...PAL.b);
      gl.uniform1i(u.uPatches, F.n);
      gl.uniform4fv(u["uAt[0]"], F.at);
      gl.uniform4fv(u["uHue[0]"], F.hue);
      gl.uniform1f(u.uGain, (spec.GAIN * (1 + 0.9 * F.flash) * cols * rows) / POINTS / F.sx);
      gl.drawArrays(gl.POINTS, 0, POINTS);
    },
  });
}
