// Builds src-tauri/icons/icon.ico (the Windows app icon) from
// assets/icon/app.svg, after `bun run tauri icon` (which writes its own
// icon.ico; this replaces it).
//
// Why: `tauri icon` stores every size as PNG and has no 96 or 128 px image.
// Windows' desktop at its "Large icons" size (96 px) couldn't show that
// icon at all: the AfterGlow shortcut showed a generic app icon, then a
// blank page when pointed at the .ico itself, while the same AG drawn as
// bitmaps showed fine. So: 16-128 px as 32-bit bitmaps (with an alpha
// channel and an empty AND mask), 256 px as PNG, like Windows' own icons.
//
// Run: bun scripts/icon-ico.js
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
const [svgPath = "assets/icon/app.svg", out = "src-tauri/icons/icon.ico", mode] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, "utf8");
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const entries = SIZES.map((s) => {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: s } }).render();
  const asPng = mode !== "allbmp" && s >= 256;
  if (asPng) return { s, data: img.asPng() };
  const px = img.pixels; // RGBA, top-down
  const rowMask = Math.ceil(s / 32) * 4;
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(s, 4); hdr.writeInt32LE(s * 2, 8);
  hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14); hdr.writeUInt32LE(0, 16);
  hdr.writeUInt32LE(s * s * 4 + rowMask * s, 20);
  const xor = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const src = ((s - 1 - y) * s + x) * 4, dst = (y * s + x) * 4; // bottom-up, BGRA
    xor[dst] = px[src + 2]; xor[dst + 1] = px[src + 1]; xor[dst + 2] = px[src]; xor[dst + 3] = px[src + 3];
  }
  const and = Buffer.alloc(rowMask * s); // all 0: use the alpha channel
  return { s, data: Buffer.concat([hdr, xor, and]) };
});
const dir = Buffer.alloc(6 + 16 * entries.length);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
let off = dir.length;
entries.forEach((e, i) => {
  const o = 6 + i * 16;
  dir[o] = e.s >= 256 ? 0 : e.s; dir[o + 1] = e.s >= 256 ? 0 : e.s;
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(e.data.length, o + 8); dir.writeUInt32LE(off, o + 12);
  off += e.data.length;
});
fs.writeFileSync(out, Buffer.concat([dir, ...entries.map((e) => e.data)]));
console.log("wrote", out, off, "bytes,", entries.map((e) => e.s + (mode !== "allbmp" && e.s >= 256 ? "png" : "bmp")).join(" "));
