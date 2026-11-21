// Generates src/wallpapers/clock-slant.json: figlet's Slant digits and colon
// for the hover clock's "slant" style (the AfterGlow banner's font). Each
// character is rendered on its own at full width, so the clock can join
// them in any order. Run once after changing it: bun scripts/clock-font.js
import figlet from "figlet";
import { writeFileSync } from "node:fs";

const out = {};
for (const ch of "0123456789:") {
  const lines = figlet.textSync(ch, { font: "Slant", horizontalLayout: "full" }).split("\n");
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  out[ch] = lines;
}
const rows = Math.max(...Object.values(out).map((l) => l.length));
for (const ch in out) {
  while (out[ch].length < rows) out[ch].push("");
  const w = Math.max(...out[ch].map((l) => l.length));
  out[ch] = out[ch].map((l) => l.padEnd(w));
}
writeFileSync("src/wallpapers/clock-slant.json", JSON.stringify(out, null, 1) + "\n");
console.log(`wrote src/wallpapers/clock-slant.json (${rows} rows)`);
for (const ch of "4:43") console.log(out[ch].join("\n"));
