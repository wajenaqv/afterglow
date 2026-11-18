// Generates assets/readme/banner.svg: the AfterGlow wordmark in figlet's Slant
// font (heywajih.com's first WAJIH style), white on the top row fading to brand
// green, with a glow that slowly breathes.
// Run: bun scripts/readme-art.js
// (The README jellyfish GIF comes from tools/record.html, under bun run dev.)
// The wordmark comes from scripts/wordmarks.json (figlet output, generated once).
// GitHub shows SVGs through <img>, so only CSS/SMIL animation works (no JS).
// textLength pins every row to its exact width whatever monospace font the
// viewer has, so the letters line up.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Brand palette (same as src/style.css)
const C = { bg: "#000000", fg: "#33ff99", accent: "#7dffc0" };
const FONT = "'JetBrains Mono', 'Cascadia Mono', Consolas, Menlo, monospace";

const LINES = JSON.parse(readFileSync(new URL("./wordmarks.json", import.meta.url), "utf8")).Slant;

const CW = 18; // px per character
const LH = 30; // px per row

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// heywajih's logo fade: white on the top row to brand green on the bottom
function rowColor(i, n) {
  const t = n > 1 ? i / (n - 1) : 1;
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${mix(255, 51)},${mix(255, 255)},${mix(255, 153)})`;
}

function bannerSVG() {
  const width = 1400;
  const cols = Math.max(...LINES.map((l) => l.length));
  const x = Math.round((width - cols * CW) / 2);
  const top = 70;
  const tagY = top + LINES.length * LH + 56;
  const height = tagY + 56;

  const rows = LINES.map((line, i) => {
    const padded = line.padEnd(cols, " ");
    return `<text x="${x}" y="${top + i * LH + LH * 0.8}" textLength="${cols * CW}" lengthAdjust="spacingAndGlyphs" fill="${rowColor(i, LINES.length)}">${esc(padded)}</text>`;
  }).join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="AfterGlow">
  <style>
    text { font-family: ${FONT}; font-size: 29px; white-space: pre; font-variant-ligatures: none; }
    .tag { fill: ${C.fg}; font-size: 22px; }
    .prompt { fill: ${C.accent}; }
    .cursor { fill: ${C.fg}; animation: blink 1.1s steps(1) infinite; }
    .crt { animation: flicker 9s infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes flicker { 0%, 96%, 100% { opacity: 1; } 97% { opacity: 0.85; } 98% { opacity: 1; } 99% { opacity: 0.92; } }
    @media (prefers-reduced-motion: reduce) { .cursor, .crt { animation: none; } }
  </style>
  <defs>
    <filter id="glow" x="-5%" y="-30%" width="110%" height="160%">
      <feGaussianBlur stdDeviation="5" result="b">
        <animate attributeName="stdDeviation" values="4;9;4" dur="6s" repeatCount="indefinite"/>
      </feGaussianBlur>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 0.2  0 0 0 0 1  0 0 0 0 0.6  0 0 0 0.9 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="100%" height="100%" rx="16" fill="${C.bg}"/>
  <g class="crt" filter="url(#glow)">
    ${rows}
  </g>
  <text class="tag" x="${width / 2}" y="${tagY}" text-anchor="middle"><tspan class="prompt">$ </tspan>live ASCII wallpapers that glow when something happens<tspan class="cursor"> &#9608;</tspan></text>
</svg>
`;
}

mkdirSync("assets/readme", { recursive: true });
writeFileSync("assets/readme/banner.svg", bannerSVG());
console.log("wrote assets/readme/banner.svg");
