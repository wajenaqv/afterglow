// The jellyfish on the GPU (WebGL2). Same picture as the CPU renderer in
// jellyfish.js, same maths, run in shaders:
//
//   1. light   every bell, arm and tentacle sample (and the marine snow) is a
//              point; a vertex shader computes its 3D position, brightness and
//              colour exactly as jellyfish.js does on the CPU, projects it to
//              its character cell, and the point adds its light into a
//              cell-sized float texture (additive blending). A second target
//              collects how much of it is tentacle.
//   2. glow    a 7 x 5 box blur of that light, in two passes (as blur()).
//   3. glyphs  a fragment shader at screen resolution: per cell, tone-map the
//              light, work out the colour and character (the ramp, tentacle
//              strokes or glow specks) and copy the character's pixels from a
//              glyph atlas drawn once with the same font.
//
// The CPU only sends a dozen numbers per jelly each frame (jellyState in
// jellyfish.js). The samples' fixed parameters (ring angles, positions down
// arms and tentacles) are built once per jelly.

import { GLYPH_GLSL, QUAD_VS, buildAtlas, compile, floatTex, gpuContext } from "./glyph-atlas.js";

const ACC_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aP;
layout(location = 1) in float aKind;
uniform vec4 uCam;      // cos yaw, sin yaw, cos pitch, sin pitch
uniform float uCamDist, uFocal;
uniform vec2 uView;     // W, H in CSS px
uniform vec2 uCell;     // cell width, height in CSS px
uniform vec2 uGrid;     // cols, rows
uniform vec3 uDeep;     // the colour of distance (0..255)
uniform float uT;
// one jelly
uniform vec3 uC;        // centre (cx, y, cz)
uniform vec2 uTilt;     // cos, sin of the tilt
uniform float uR, uHb, uP, uFlash, uFade, uExcite, uJR, uPeriod, uPhase, uPush, uReduced, uTentN;
uniform vec3 uBell, uGlow, uTentCol;
uniform float uBellStep, uBellRing, uLineStep;
// marine snow
uniform float uHalfW;
uniform vec3 uSnowCol;
out vec4 vCol;
out float vTent;
const float PI = 3.141592653589793;
const float TH_MAX = 1.3;
const float PUSH = 0.35;

float pulseF(float tt) {
  float u = fract((tt + uPhase) / uPeriod);
  return u < 0.3 ? sin((u / 0.3) * (PI / 2.0)) : pow(cos(((u - 0.3) / 0.7) * (PI / 2.0)), 2.0);
}
float pAt(float tt) { return uReduced > 0.5 ? 0.3 : max(pulseF(tt), 0.75 * uExcite); }
float pushOf(float tt) {
  float c = (tt + uPhase) / uPeriod;
  float f = min(1.0, (c - floor(c)) / 0.45);
  return floor(c) + f * f * (3.0 - 2.0 * f);
}
float drag(float lag) { return uReduced > 0.5 ? 0.0 : PUSH * (uPush - pushOf(uT - lag)); }

void off() { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vCol = vec4(0.0); vTent = 0.0; }

// jellyfish.js glowRGB: project, find the cell, weight by area and fog
void glow(vec3 p, float b, vec3 col, float isTent, float area) {
  float x1 = p.x * uCam.x - p.z * uCam.y;
  float z1 = p.x * uCam.y + p.z * uCam.x;
  float y2 = p.y * uCam.z - z1 * uCam.w;
  float z2 = p.y * uCam.w + z1 * uCam.z + uCamDist;
  if (z2 < 1.0) { off(); return; }
  float c = floor((uView.x / 2.0 + (x1 * uFocal) / z2) / uCell.x);
  float r = floor((uView.y / 2.0 - (y2 * uFocal) / z2) / uCell.y);
  if (c < 0.0 || r < 0.0 || c >= uGrid.x || r >= uGrid.y) { off(); return; }
  float cellArea = ((uCell.x * z2) / uFocal) * ((uCell.y * z2) / uFocal);
  float fog = clamp((z2 - (uCamDist - 4.0)) / 8.0, 0.0, 1.0);
  if (fog > 0.0) col += (uDeep - col) * (fog * 0.45);
  float w = (area > 0.0 ? (b * area) / cellArea : b) * (1.0 - 0.45 * fog);
  gl_Position = vec4((c + 0.5) / uGrid.x * 2.0 - 1.0, (r + 0.5) / uGrid.y * 2.0 - 1.0, 0.0, 1.0);
  vCol = vec4(col / 255.0 * w, w);
  vTent = isTent * w;
}

void main() {
  gl_PointSize = 1.0;
  int kind = int(aKind + 0.5);
  if (kind == 3) {
    // marine snow, drifting slowly down
    float y = mod(aP.y - uT * (0.08 + aP.w * 0.06) + 10.0, 20.0) - 10.0;
    glow(vec3(aP.x * uHalfW * 1.05 + sin(uT * 0.2 + aP.w * 9.0) * 0.3, y, aP.z), 0.06 + 0.1 * aP.w, uSnowCol, 0.0, 0.0);
    return;
  }
  vec3 local;
  float b;
  vec3 col;
  float isTent = 0.0;
  float area;
  if (kind == 0) {
    // bell: ring th, sample i of the ring
    float th = aP.x, i = aP.y;
    float sth = sin(th), cth = cos(th);
    float ring = max(10.0, floor(sth * uR * uBellRing + 0.5));
    if (i >= ring) { off(); return; }
    float thf = th / TH_MAX;
    float edge = max(0.0, th - 1.02);
    float flare = 1.0 + edge * (0.45 * (1.0 - uP) - 0.5 * uP);
    float ny = cth * (uR / uHb);
    float whiten = pow(thf, 5.0) * 0.4;
    vec3 rim = uBell + (vec3(255.0) - uBell) * whiten;
    float gr = abs(th - 0.5);
    float ph = (i / ring) * PI * 2.0;
    float cph = cos(ph), sph = sin(ph);
    float scallop = 1.0 + 0.035 * sin(ph * 16.0) * thf;
    local = vec3(uR * sth * cph * scallop * flare, uHb * cth, uR * sth * sph * scallop * flare);
    float nx = sth * cph, nz = sth * sph;
    float nl = sqrt(nx * nx + ny * ny + nz * nz);
    float facing = abs((nx * uCam.y - nz * uCam.x) / nl); // view = (sin yaw, 0, -cos yaw)
    b = 0.02 + 0.22 * pow(max(0.0, 1.0 - facing), 2.2);
    b += 0.3 * pow(thf, 8.0);
    if (abs(sin(ph * 4.0)) < 0.07 && th > 0.25) b += 0.18;
    float gq = abs(sin(ph * 2.0));
    float gonad = gr < 0.14 && gq > 0.6 ? 1.0 - gr / 0.14 : 0.0;
    b += gonad * 0.7;
    b *= uFlash;
    col = gonad > 0.2 ? uGlow : rim;
    area = uBellStep * uR * ((PI * 2.0) / uBellRing);
  } else if (kind == 1) {
    // oral arm a, s units down, u across
    float a = aP.x, s = aP.y, u = aP.z, armLen = aP.w;
    float ang = a * (PI / 2.0) + 0.4;
    float ca = cos(ang), sa = sin(ang);
    float sway = sin(s * 1.6 - uT * 1.1 + a) * 0.15 * s;
    float ruffle = sin(s * 9.0 + u * 3.0 - uT * 2.0) * 0.08;
    float w = u * 0.12 * uJR * (1.0 - s / (1.2 * armLen));
    local = vec3(ca * (0.12 + sway) - sa * w + ruffle * ca, uHb * 0.15 - s - drag(s * 0.08) * 0.6, sa * (0.12 + sway) + ca * w + ruffle * sa);
    b = 0.14 * uFlash * (1.0 - (s / armLen) * 0.6);
    col = uGlow + (uBell - uGlow) * 0.5;
    area = uLineStep * 0.07 * uJR;
  } else {
    // tentacle i, s units down, len long
    float i = aP.x, s = aP.y, len = aP.z;
    float ph = (i / uTentN) * PI * 2.0;
    float rx = uR * sin(TH_MAX) * cos(ph), rz = uR * sin(TH_MAX) * sin(ph), ry = uHb * cos(TH_MAX);
    float k = s / len;
    float wave1 = sin(s * 1.1 - uT * 1.5 + i * 1.7) * 0.35 * k;
    float wave2 = cos(s * 0.8 - uT * 1.1 + i) * 0.25 * k;
    float lag = s * 0.11;
    float pl = pAt(uT - lag);
    float follow = (1.0 - 0.18 * pl) / (1.0 - 0.18 * uP);
    float spread = (1.0 + 0.05 * s * (1.0 - pl)) * follow;
    local = vec3(rx * spread + wave1, ry - s - drag(lag) * 0.7, rz * spread + wave2);
    b = 1.1 * (1.0 - k * 0.85);
    col = uTentCol;
    isTent = 1.0;
    area = uLineStep * 0.05;
  }
  // local -> world: the jelly's small tilt around the z axis
  vec3 world = vec3(uC.x + local.x * uTilt.x - local.y * uTilt.y, uC.y + local.x * uTilt.y + local.y * uTilt.x, uC.z + local.z);
  glow(world, b * uFade, col, isTent, area);
}`;

const ACC_FS = `#version 300 es
precision highp float;
in vec4 vCol;
in float vTent;
layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oTent;
void main() { oLight = vCol; oTent = vec4(vTent, 0.0, 0.0, 0.0); }`;

// jellyfish.js blur(): a sum over a window, divided by its full size
const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform ivec2 uDir;
uniform int uLo, uHi;
uniform float uDiv;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uSrc, 0);
  vec4 s = vec4(0.0);
  for (int d = -3; d <= 3; d++) {
    if (d < uLo || d > uHi) continue;
    ivec2 q = p + uDir * d;
    if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
    s += texelFetch(uSrc, q, 0);
  }
  o = s / uDiv;
}`;

// jellyfish.js render(): per cell, light -> colour and character
const GLYPH_FS = `#version 300 es
precision highp float;
uniform sampler2D uLight, uTent, uGlow;
uniform vec2 uCell;     // CSS px
uniform float uDpr;
uniform float uCanvasH; // device px
uniform vec3 uBG;       // 0..255
out vec4 o;
${GLYPH_GLSL}
void main() {
  vec3 bg = uBG / 255.0;
  vec2 css = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y) / uDpr;
  ivec2 cell = ivec2(floor(css.x / uCell.x), floor(css.y / uCell.y));
  ivec2 size = textureSize(uLight, 0);
  if (cell.x >= size.x || cell.y >= size.y) { o = vec4(bg, 1.0); return; }
  vec4 own4 = texelFetch(uLight, cell, 0);
  vec4 halo = texelFetch(uGlow, cell, 0);
  float tent = texelFetch(uTent, cell, 0).r;
  float own = own4.a;
  float a = own + halo.a * 0.7;
  if (a < 0.03) { o = vec4(bg, 1.0); return; }
  float L = 1.0 - exp(-a * 1.3);
  if (L < 0.05) { o = vec4(bg, 1.0); return; }
  vec3 c0 = (own4.rgb + halo.rgb * 0.7) / a * 255.0;
  float hot = max(0.0, L - 0.75) * 2.0;
  float f = 0.25 + 0.95 * L;
  vec3 c = c0 * f + (vec3(255.0) - c0 * f) * hot * 0.6;
  c = clamp(floor(c / 6.0 + 0.5) * 6.0, 0.0, 255.0); // style(): colours quantised to 6s
  // atlas slots: 0-3 glow specks ".'\`:", 4-7 strokes "|!:;", 8-18 ramp ".:-=+*oO#%@"
  float g;
  if (own < a * 0.35) g = min(3.0, floor(L * 2.0 * 4.0));
  else if (tent > own * 0.6) g = 4.0 + min(3.0, floor((1.0 - L) * 4.0));
  else g = 8.0 + clamp(floor(L * 11.0 + 0.5), 1.0, 11.0) - 1.0;
  vec2 local = (css - vec2(cell) * uCell) * uDpr;
  o = vec4(mix(bg, c / 255.0, glyphInk(g, c, local)), 1.0);
}`;

const GLYPHS = ".'`:" + "|!:;" + ".:-=+*oO#%@";

// Returns null when WebGL2 or float render targets aren't available, or the
// shaders don't compile: the caller then uses the CPU renderer.
// opts: { still, jellies, templateFor(j) -> Float32Array of [p0, p1, p2, p3, kind]*, snow }
export function createJellyGL(canvas, opts) {
  const gl = gpuContext(canvas, opts.still);
  if (!gl) return null;

  let acc, blur, glyph;
  try {
    acc = compile(gl, ACC_VS, ACC_FS);
    blur = compile(gl, QUAD_VS, BLUR_FS);
    glyph = compile(gl, QUAD_VS, GLYPH_FS);
  } catch (e) {
    console.warn("afterglow: GPU jellyfish unavailable, using the CPU:", e.message);
    return null;
  }

  // Fixed sample parameters: one vertex buffer per jelly, one for the snow
  const vaoFor = (data) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
    gl.bindVertexArray(null);
    return { vao, count: data.length / 5 };
  };
  const jellyVaos = new Map(opts.jellies.map((j) => [j, vaoFor(opts.templateFor(j))]));
  const snowVao = vaoFor(opts.snow);
  const emptyVao = gl.createVertexArray();

  // Cell-sized float targets
  const tex = (w, h) => floatTex(gl, w, h);
  const fbo = (...textures) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return f;
  };
  let g = null; // per-size state
  let atlasTex = gl.createTexture();

  function resize({ dpr, cw, ch, cols, rows, fontPx, font }) {
    if (g) [g.light, g.tent, g.tmp, g.glow].forEach((t) => gl.deleteTexture(t));
    const light = tex(cols, rows), tentT = tex(cols, rows), tmp = tex(cols, rows), glowT = tex(cols, rows);
    g = { cols, rows, cw, ch, dpr, light, tent: tentT, tmp, glow: glowT, accFbo: fbo(light, tentT), tmpFbo: fbo(tmp), glowFbo: fbo(glowT) };
    // the glyph atlas (glyph-atlas.js)
    const { slotW, slotH } = buildAtlas(gl, atlasTex, GLYPHS, { cw, ch, dpr, fontPx, font });
    g.slotW = slotW;
    g.slotH = slotH;
  }

  // frame: { t, W, H, camDist, focal, cam: [cy, sy, cp, sp], halfW, deep, snowCol, bg, reduced,
  //          bellStep, bellRing, lineStep, jellies: [{ j, s: jellyState }] }
  function draw(f) {
    if (!g) return;
    // 1. light
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.accFbo);
    gl.viewport(0, 0, g.cols, g.rows);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(acc.p);
    const u = acc.u;
    gl.uniform4f(u.uCam, ...f.cam);
    gl.uniform1f(u.uCamDist, f.camDist);
    gl.uniform1f(u.uFocal, f.focal);
    gl.uniform2f(u.uView, f.W, f.H);
    gl.uniform2f(u.uCell, g.cw, g.ch);
    gl.uniform2f(u.uGrid, g.cols, g.rows);
    gl.uniform3f(u.uDeep, ...f.deep);
    gl.uniform1f(u.uT, f.t);
    gl.uniform1f(u.uHalfW, f.halfW);
    gl.uniform3f(u.uSnowCol, ...f.snowCol);
    gl.uniform1f(u.uReduced, f.reduced ? 1 : 0);
    gl.uniform1f(u.uBellStep, f.bellStep);
    gl.uniform1f(u.uBellRing, f.bellRing);
    gl.uniform1f(u.uLineStep, f.lineStep);
    gl.bindVertexArray(snowVao.vao);
    if (snowVao.count) gl.drawArrays(gl.POINTS, 0, snowVao.count);
    for (const { j, s } of f.jellies) {
      gl.uniform3f(u.uC, s.cx, s.y, s.cz);
      gl.uniform2f(u.uTilt, s.ct, s.st);
      gl.uniform1f(u.uR, s.R);
      gl.uniform1f(u.uHb, s.Hb);
      gl.uniform1f(u.uP, s.p);
      gl.uniform1f(u.uFlash, s.flash);
      gl.uniform1f(u.uFade, s.fade);
      gl.uniform1f(u.uExcite, j.excite || 0);
      gl.uniform1f(u.uJR, s.jr);
      gl.uniform1f(u.uPeriod, j.period);
      gl.uniform1f(u.uPhase, j.phase);
      gl.uniform1f(u.uPush, s.push);
      gl.uniform1f(u.uTentN, j.tentacles);
      gl.uniform3f(u.uBell, ...s.col.bell);
      gl.uniform3f(u.uGlow, ...s.col.glow);
      gl.uniform3f(u.uTentCol, ...s.col.tent);
      const v = jellyVaos.get(j);
      gl.bindVertexArray(v.vao);
      gl.drawArrays(gl.POINTS, 0, v.count);
    }
    gl.disable(gl.BLEND);

    // 2. glow: 7 across, then 5 down
    gl.bindVertexArray(emptyVao);
    gl.useProgram(blur.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blur.u.uSrc, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.tmpFbo);
    gl.bindTexture(gl.TEXTURE_2D, g.light);
    gl.uniform2i(blur.u.uDir, 1, 0);
    gl.uniform1i(blur.u.uLo, -3);
    gl.uniform1i(blur.u.uHi, 3);
    gl.uniform1f(blur.u.uDiv, 7);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.glowFbo);
    gl.bindTexture(gl.TEXTURE_2D, g.tmp);
    gl.uniform2i(blur.u.uDir, 0, 1);
    gl.uniform1i(blur.u.uLo, -2);
    gl.uniform1i(blur.u.uHi, 2);
    gl.uniform1f(blur.u.uDiv, 5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. glyphs, to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(glyph.p);
    const bind = (unit, t, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(glyph.u[name], unit);
    };
    bind(0, g.light, "uLight");
    bind(1, g.tent, "uTent");
    bind(2, g.glow, "uGlow");
    bind(3, atlasTex, "uAtlas");
    gl.uniform2f(glyph.u.uCell, g.cw, g.ch);
    gl.uniform1f(glyph.u.uDpr, g.dpr);
    gl.uniform1f(glyph.u.uCanvasH, canvas.height);
    gl.uniform3f(glyph.u.uBG, ...f.bg);
    gl.uniform1f(glyph.u.uAtlasW, g.slotW);
    gl.uniform1f(glyph.u.uAtlasH, g.slotH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Dev aid (?debug): the per-cell light as [r*w, g*w, b*w (0..1), w] floats
  function readLight() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.accFbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const out = new Float32Array(g.cols * g.rows * 4);
    gl.readPixels(0, 0, g.cols, g.rows, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { data: out, cols: g.cols, rows: g.rows };
  }

  return { gl, resize, draw, readLight };
}
