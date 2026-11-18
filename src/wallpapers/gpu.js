// Which renderer a wallpaper uses: the GPU (WebGL2) or the CPU (canvas 2D).
//
// Every wallpaper has both (CLAUDE.md, rules for wallpapers). The choice is
// the Settings → performance "Rendering" setting, passed to wallpaper pages
// as ?render=gpu|cpu (no parameter = automatic):
//   automatic  the GPU when WebGL2 works on real hardware, else the CPU
//   gpu        the GPU whenever WebGL2 works at all (even software emulation)
//   cpu        always the CPU
// A GPU renderer that fails to start, or whose context is lost (driver
// update, GPU reset), hands over to the CPU renderer (see each wallpaper).

const params = new URLSearchParams(location.search);
export const RENDER_PREF = ["gpu", "cpu"].includes(params.get("render")) ? params.get("render") : "auto";

let cached;
// What this machine's WebGL2 can do: null when there's no WebGL2 at all,
// else { name, software, floatTargets } (floatTargets: can render into
// 16-bit float textures, which the GPU renderers need to add up light)
export function gpuInfo() {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl) {
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const raw = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      cached = {
        name: prettyName(raw),
        raw,
        software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(raw),
        floatTargets: !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float"),
      };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {}
  return cached;
}

// "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)"
//   -> "NVIDIA GeForce RTX 4070"
export function prettyName(raw) {
  const angle = /^ANGLE \(([^,]+),\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Metal|Vulkan|,|$)/i.exec(raw);
  const name = angle ? angle[2] : raw;
  return name.replace(/\s+/g, " ").trim();
}

// Should this wallpaper draw on the GPU?
export function wantGPU(pref = RENDER_PREF) {
  if (pref === "cpu") return false;
  const g = gpuInfo();
  if (!g || !g.floatTargets) return false;
  return pref === "gpu" ? true : !g.software;
}

// A line for Settings: what "automatic" picks here, or why it can't use the GPU
export function describe(pref) {
  const g = gpuInfo();
  if (pref === "cpu") return { gpu: false, text: "CPU (canvas 2D)" };
  if (!g) return { gpu: false, text: "CPU: this computer has no WebGL2" };
  if (!g.floatTargets) return { gpu: false, text: `CPU: ${g.name} can't render float textures` };
  if (g.software && pref !== "gpu") return { gpu: false, text: `CPU: only a software GPU here (${g.name})` };
  return { gpu: true, text: `GPU · ${g.name}` };
}
