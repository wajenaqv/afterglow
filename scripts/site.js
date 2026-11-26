// Puts the download page together in dist-site/ from site/ and the shared
// brand files. `bun scripts/site.js --serve` also shows it on localhost:5180.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist-site");
const font = "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-";
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(join(root, "site"), out, { recursive: true });
for (const [from, to] of [
  ["src/brand.css", "brand.css"],
  ["src/themes.css", "themes.css"],
  ["assets/icon/app.svg", "app.svg"],
  ["assets/site/reaction.mp4", "reaction.mp4"],
  ["assets/site/reel.mp4", "reel.mp4"],
  ["assets/site/reel-poster.webp", "reel-poster.webp"],
  ["assets/site/share.png", "share.png"],
  ["assets/site/poster.webp", "poster.webp"],
  ["assets/site/tile-edge.mp4", "tile-edge.mp4"],
  ["assets/site/tile-awake.mp4", "tile-awake.mp4"],
  ["assets/site/tile-jobs.mp4", "tile-jobs.mp4"],
  ["assets/site/tile-clock.mp4", "tile-clock.mp4"],
  [font + "400-normal.woff2", "mono-400.woff2"],
  [font + "700-normal.woff2", "mono-700.woff2"],
]) cpSync(join(root, from), join(out, to));
console.log("built dist-site");

if (process.argv.includes("--serve")) {
  Bun.serve({
    hostname: "localhost",
    port: 5180,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const file = Bun.file(join(out, path === "/" ? "index.html" : path));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
  console.log("http://localhost:5180");
}
