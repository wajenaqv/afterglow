// Generates the animated SVGs used by README.md:
//   assets/readme/banner.svg  the AfterGlow wordmark in glowing ASCII
//   assets/readme/demo.svg    a jellyfish pulsing green on a WhatsApp message
// Run: bun scripts/readme-art.js
// GitHub shows SVGs through <img>, so only SMIL/CSS animation works (no JS).
// Characters are plain ASCII so any monospace font lines them up; textLength
// pins every row to the same width whatever font the viewer has.

import { mkdirSync, writeFileSync } from "node:fs";

// Brand palette (same as src/style.css)
const C = {
  bg: "#000000",
  fg: "#33ff99",
  dim: "#4d8f6e",
  accent: "#7dffc0",
  bright: "#ffffff",
  glow: "51,255,153",
};
const FONT = "'JetBrains Mono', 'Cascadia Mono', Consolas, Menlo, monospace";

// ---------- banner ----------

// 5x7 pixel font, only the letters we need.
const GLYPHS = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  f: ["..##.", ".#...", ".#...", "####.", ".#...", ".#...", ".#..."],
  t: [".....", ".#...", ".#...", "####.", ".#...", ".#...", "..##."],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  l: [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  w: [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
};

const PX_W = 3; // characters per font pixel, across (like heywajih's clock)
const PX_H = 2; // rows per font pixel
const PAD = 3; // empty cells around the word, room for glow specks

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function wordGrid(word) {
  const cols = [];
  [...word].forEach((ch, i) => {
    if (i) cols.push(...Array(PX_W).fill(null)); // one-pixel gap
    const g = GLYPHS[ch];
    for (let px = 0; px < 5; px++)
      for (let k = 0; k < PX_W; k++) cols.push(g.map((row) => row[px] === "#"));
  });
  const W = cols.length + PAD * 2;
  const H = 7 * PX_H + PAD * 2;
  const on = (x, y) => {
    const cx = x - PAD;
    const cy = Math.floor((y - PAD) / PX_H);
    if (cx < 0 || cx >= cols.length || cy < 0 || cy > 6) return false;
    return !!(cols[cx] && cols[cx][cy]);
  };
  return { W, H, on };
}

function bannerSVG() {
  const { W, H, on } = wordGrid("AfterGlow");
  const CW = 8; // px per character
  const LH = 15; // px per row
  const left = 40;
  const top = 34;
  const artW = W * CW;
  const width = artW + left * 2;
  const tagY = top + H * LH + 34;
  const height = tagY + 46;

  // near(x, y): how many on-cells within a small radius (for edges and specks)
  const near = (x, y, r) => {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r * 2; dx <= r * 2; dx++) if (on(x + dx, y + dy)) n++;
    return n;
  };

  const rows = [];
  for (let y = 0; y < H; y++) {
    // row colour: white at the top fading to brand green (heywajih's logo fade)
    const t = Math.min(1, Math.max(0, (y - PAD) / (7 * PX_H - 1)));
    const mix = (a, b) => Math.round(a + (b - a) * t);
    const rowColor = `rgb(${mix(255, 51)},${mix(255, 255)},${mix(255, 153)})`;
    let runs = [];
    let cur = null;
    for (let x = 0; x < W; x++) {
      let ch = " ";
      let cls = "s";
      if (on(x, y)) {
        const inner = near(x, y, 1);
        ch = inner >= 13 ? "@" : inner >= 10 ? "#" : inner >= 7 ? "%" : "*";
        if (hash(x, y) < 0.06) ch = "=";
        cls = "c";
      } else {
        const n = near(x, y, 1);
        const r = hash(x, y);
        if (n >= 3 && r < 0.55) ch = r < 0.2 ? "+" : ":";
        else if (n >= 1 && r < 0.35) ch = r < 0.15 ? "." : "'";
        else if (near(x, y, 2) && r < 0.07) ch = ".";
        if (ch !== " ") cls = "g";
      }
      if (!cur || cur.cls !== cls) {
        cur = { cls, text: "" };
        runs.push(cur);
      }
      cur.text += ch;
    }
    const body = runs
      .map((r) => (r.cls === "c" ? `<tspan fill="${rowColor}">${r.text}</tspan>` : r.cls === "g" ? `<tspan class="g">${r.text}</tspan>` : r.text))
      .join("");
    rows.push({ y: top + y * LH, body });
  }

  const rowText = (cls) =>
    rows
      .map((r) => `<text class="${cls}" x="${left}" y="${r.y}" textLength="${artW}" lengthAdjust="spacingAndGlyphs">${r.body}</text>`)
      .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="AfterGlow">
  <style>
    text { font-family: ${FONT}; font-size: 13px; white-space: pre; font-variant-ligatures: none; }
    .g { fill: ${C.dim}; }
    .tag { fill: ${C.fg}; font-size: 17px; }
    .prompt { fill: ${C.accent}; }
    .cursor { fill: ${C.fg}; animation: blink 1.1s steps(1) infinite; }
    .flicker { animation: flicker 9s infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes flicker { 0%, 96%, 100% { opacity: 1; } 97% { opacity: 0.82; } 98% { opacity: 1; } 99% { opacity: 0.9; } }
    @media (prefers-reduced-motion: reduce) { .cursor, .flicker { animation: none; } }
  </style>
  <defs>
    <filter id="glow" x="-10%" y="-30%" width="120%" height="160%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 ${51 / 255}  0 0 0 0 1  0 0 0 0 ${153 / 255}  0 0 0 0.9 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="sweep" gradientUnits="userSpaceOnUse" x1="-400" y1="0" x2="-100" y2="0">
      <stop offset="0" stop-color="#000"/>
      <stop offset="0.5" stop-color="#fff"/>
      <stop offset="1" stop-color="#000"/>
      <animate attributeName="x1" values="-400;${width + 100};${width + 100}" keyTimes="0;0.45;1" dur="7s" repeatCount="indefinite"/>
      <animate attributeName="x2" values="-100;${width + 400};${width + 400}" keyTimes="0;0.45;1" dur="7s" repeatCount="indefinite"/>
    </linearGradient>
    <mask id="sweepMask"><rect width="${width}" height="${height}" fill="url(#sweep)"/></mask>
  </defs>
  <rect width="100%" height="100%" rx="14" fill="${C.bg}"/>
  <g class="flicker" filter="url(#glow)">
    ${rowText("w")}
  </g>
  <g mask="url(#sweepMask)" opacity="0.75" style="fill:${C.bright}">
    ${rows.map((r) => `<text x="${left}" y="${r.y}" textLength="${artW}" lengthAdjust="spacingAndGlyphs" fill="${C.bright}">${r.body.replace(/<tspan[^>]*>/g, "").replace(/<\/tspan>/g, "")}</text>`).join("\n    ")}
  </g>
  <text class="tag" x="${width / 2}" y="${tagY}" text-anchor="middle"><tspan class="prompt">$ </tspan>live ASCII wallpapers that glow when something happens<tspan class="cursor"> &#9608;</tspan></text>
</svg>
`;
}

// ---------- demo ----------

const JELLY = [
  "          .-=~~~~~=-.          ",
  "       .=~ .  .  .  ~=.        ",
  "     .~  .   .:.   .  ~.       ",
  "    /  .  :  .:.  :  .  \\      ",
  "   :~=-.__.-=~~=-.__.-=~:      ",
  "    ;  :| :!: |: :!: |:  ;     ",
  "     ! :| ;:  |  :; |: !       ",
  "     : !  :!  ;  !:  ! :       ",
  "      ;:  !   :   !  :;        ",
  "       :  ;   !   ;  :         ",
  "         '    :    '           ",
  "              .                ",
];

function demoSVG() {
  const width = 900;
  const height = 300;
  const DUR = "6s";
  const pink = "#ff9ecf";
  const jx = 560;
  const jy = 50;
  const LH = 18;
  const jellyRows = JELLY.map(
    (line, i) => `<text x="${jx}" y="${jy + i * LH}" textLength="${line.length * 8.4}" lengthAdjust="spacingAndGlyphs">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`,
  ).join("\n      ");

  // one 6 s loop: message arrives at 0.6 s, pulse peaks at 1 s, afterglow fades by 5 s
  const kt = "0;0.1;0.17;0.4;0.85;1";
  const log = [
    { at: 0.1, y: 112, html: `<tspan fill="${C.accent}">&#9679; whatsapp</tspan><tspan fill="${C.fg}">   new message</tspan>` },
    { at: 0.17, y: 142, html: `<tspan fill="${C.dim}">  jellyfish</tspan><tspan fill="${C.fg}">  pulse </tspan><tspan fill="${C.fg}">#33ff99</tspan>` },
    { at: 0.24, y: 172, html: `<tspan fill="${C.dim}">  afterglow</tspan><tspan fill="${C.fg}">  4s</tspan>` },
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="A WhatsApp message arrives and the jellyfish pulses green, then fades">
  <style>
    text { font-family: ${FONT}; font-size: 14px; white-space: pre; font-variant-ligatures: none; }
    .log { font-size: 16px; }
    .head { fill: ${C.dim}; font-size: 13px; }
  </style>
  <defs>
    <filter id="g" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" rx="14" fill="${C.bg}"/>
  <text class="head" x="48" y="66">signals</text>
  ${log
    .map(
      (l) => `<text class="log" x="48" y="${l.y}" opacity="0">${l.html}
    <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${l.at};${(l.at + 0.04).toFixed(2)};0.78;0.9;1" dur="${DUR}" repeatCount="indefinite"/>
  </text>`,
    )
    .join("\n  ")}
  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -6;0 -2;0 0;0 0" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/>
    <g filter="url(#g)" opacity="0.35">
      <animate attributeName="opacity" values="0.3;0.3;1;0.6;0.3;0.3" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/>
      <g fill="${pink}">
        <animate attributeName="fill" values="${pink};${pink};${C.fg};${C.fg};${pink};${pink}" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/>
      ${jellyRows}
      </g>
    </g>
    <g fill="${pink}">
      <animate attributeName="fill" values="${pink};${pink};#eafff3;${C.fg};${pink};${pink}" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/>
      ${jellyRows}
    </g>
  </g>
</svg>
`;
}

mkdirSync("assets/readme", { recursive: true });
writeFileSync("assets/readme/banner.svg", bannerSVG());
writeFileSync("assets/readme/demo.svg", demoSVG());
console.log("wrote assets/readme/banner.svg and assets/readme/demo.svg");
