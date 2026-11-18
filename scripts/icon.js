// Generates the AfterGlow logo: "AG" in figlet's Slant font (the README
// banner's style), drawn as vector strokes so it's crisp at every size and
// needs no font. Each character of the figlet art becomes a stroke inside
// its cell:  _ bottom edge   / and \ corner to corner   | down the middle.
// Neighbouring strokes meet exactly, as the characters do in a monospace font.
//
//   assets/icon/app.svg        the app icon: black rounded square, the AG
//                              fading white to brand green, with a soft glow
//   assets/icon/tray.svg       Windows tray: bold green AG, transparent, no glow
//   assets/icon/tray-mac.svg   macOS menu bar: bold black AG (a template image
//                              that macOS tints for light and dark menu bars)
//
// Run: bun scripts/icon.js && bun run tauri icon assets/icon/app.svg
// (src-tauri/icons/ then holds every size; tray PNGs: see CLAUDE.md)

import { mkdirSync, writeFileSync } from "node:fs";

// Brand colours (src/brand.css)
const FG = "#33ff99";
const TOP = "#ffffff";
const BG = "#000000";

// figlet -f slant AG
const ART = [
  "    ___   ______",
  "   /   | / ____/",
  "  / /| |/ / __  ",
  " / ___ / /_/ /  ",
  "/_/  |_\\____/   ",
];
const COLS = Math.max(...ART.map((l) => l.length));
const ROWS = ART.length;

// Stroke segments in cell units (x across, y down; a cell is 1 x 2, like a
// monospace character)
function segments() {
  const out = [];
  ART.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      const x = c, y = r * 2;
      if (ch === "_") out.push([x, y + 2, x + 1, y + 2]);
      else if (ch === "/") out.push([x, y + 2, x + 1, y]);
      else if (ch === "\\") out.push([x, y, x + 1, y + 2]);
      else if (ch === "|") out.push([x + 0.5, y, x + 0.5, y + 2]);
    });
  });
  return out;
}

// The strokes as one path, scaled by `unit` px per cell width, at (ox, oy)
function path(unit, ox, oy) {
  return segments()
    .map(([x1, y1, x2, y2]) => `M${(ox + x1 * unit).toFixed(2)} ${(oy + y1 * unit).toFixed(2)}L${(ox + x2 * unit).toFixed(2)} ${(oy + y2 * unit).toFixed(2)}`)
    .join("");
}

function appIcon() {
  const S = 1024;
  // macOS-style icon: a rounded square inset in the canvas
  const inset = 100, side = S - inset * 2, radius = 185;
  const unit = (side * 0.74) / COLS; // the art fills ~74% of the square's width
  const w = COLS * unit, h = ROWS * 2 * unit;
  const ox = (S - w) / 2, oy = (S - h) / 2 + unit * 0.4;
  const d = path(unit, ox, oy);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="${oy}" x2="0" y2="${oy + h}">
      <stop offset="0" stop-color="${TOP}"/>
      <stop offset="1" stop-color="${FG}"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${(unit * 0.32).toFixed(1)}"/>
    </filter>
  </defs>
  <rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}" fill="${BG}"/>
  <rect x="${inset + 3}" y="${inset + 3}" width="${side - 6}" height="${side - 6}" rx="${radius - 3}" fill="none" stroke="${FG}" stroke-opacity="0.18" stroke-width="6"/>
  <path d="${d}" fill="none" stroke="${FG}" stroke-opacity="0.75" stroke-width="${(unit * 0.3).toFixed(1)}" stroke-linecap="round" filter="url(#glow)"/>
  <path d="${d}" fill="none" stroke="url(#fade)" stroke-width="${(unit * 0.15).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

// Tray icons: the same AG with thick strokes so it still reads at 16-32 px.
// Windows: on a black rounded square like the app icon, so it stands out on
// light and dark taskbars alike. macOS: the AG alone in black, filling the
// square, as a template image (macOS recolours it for the menu bar).
function trayIcon({ colour, plate }) {
  const S = 256;
  const unit = (S * (plate ? 0.84 : 0.96)) / COLS;
  const w = COLS * unit, h = ROWS * 2 * unit;
  const ox = (S - w) / 2, oy = (S - h) / 2;
  const back = plate ? `<rect width="${S}" height="${S}" rx="${S * 0.22}" fill="${BG}"/>\n  ` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  ${back}<path d="${path(unit, ox, oy)}" fill="none" stroke="${colour}" stroke-width="${(unit * (plate ? 0.5 : 0.42)).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

mkdirSync("assets/icon", { recursive: true });
writeFileSync("assets/icon/app.svg", appIcon());
writeFileSync("assets/icon/tray.svg", trayIcon({ colour: FG, plate: true }));
writeFileSync("assets/icon/tray-mac.svg", trayIcon({ colour: "#000000", plate: false }));
console.log("wrote assets/icon/app.svg, tray.svg, tray-mac.svg");
