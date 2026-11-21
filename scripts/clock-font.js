// Generates src/wallpapers/clock-fonts.json: the digits and colon of the
// figlet fonts the clock offers (hover clock and the clock wallpaper):
//   slant        Slant, the AfterGlow banner's font (the default)
//   small-slant  Small Slant, a compact slant
//   big          Big, rounded
//   colossal     Colossal, large and detailed
//   banner       Banner3, made of #
// Only fonts drawn with plain ASCII: block-character fonts (Electronic)
// fall back to another font in the webview and break, like the first
// density clock did. Each character is rendered on its own at full width,
// so the clock can join them in any order; trailing blank rows are cut.
// Run after changing it: bun scripts/clock-font.js (figlet is a dev dependency)
import figlet from "figlet";
import { writeFileSync } from "node:fs";

const FONTS = { slant: "Slant", "small-slant": "Small Slant", big: "Big", colossal: "Colossal", banner: "Banner3" };
const out = {};
for (const [id, font] of Object.entries(FONTS)) {
  const glyphs = {};
  for (const ch of "0123456789:") glyphs[ch] = figlet.textSync(ch, { font, horizontalLayout: "full" }).split("\n");
  // rows that are blank in every glyph at the bottom are cut
  let rows = Math.max(...Object.values(glyphs).map((l) => l.length));
  while (rows > 1 && Object.values(glyphs).every((l) => !(l[rows - 1] ?? "").trim())) rows--;
  for (const ch in glyphs) {
    const lines = glyphs[ch].slice(0, rows);
    while (lines.length < rows) lines.push("");
    const w = Math.max(...lines.map((l) => l.length));
    glyphs[ch] = lines.map((l) => l.padEnd(w));
  }
  out[id] = glyphs;
  console.log(`${id}: ${rows} rows`);
}
// Slant's own 8 has a bracketed top half, ( __ ), while every other digit is
// drawn with slashes, so it looked like another font: two slanted loops
// pinched at the waist with > <, like slant's own 3 (two plain stacked
// loops looked like the 0 when drawn big)
out.slant["8"] = ["   ____ ", "  / __ \\", " > __  <", "/ /_/ / ", "\\____/  "];
writeFileSync("src/wallpapers/clock-fonts.json", JSON.stringify(out) + "\n");
console.log("wrote src/wallpapers/clock-fonts.json");
