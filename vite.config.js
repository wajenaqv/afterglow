import { defineConfig } from "vite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Dev-only: tools/record.html posts the finished README GIF here and it is
// written to assets/readme/. configureServer only runs under `vite` (dev),
// never in builds, and only files under assets/readme/ with a fixed name can
// be written.
const README_FILES = new Set(["jellyfish.gif"]);
function readmeArtSaver() {
  return {
    name: "readme-art-saver",
    configureServer(server) {
      server.middlewares.use("/__save-readme-art", (req, res) => {
        const name = new URL(req.url, "http://x").searchParams.get("name");
        if (req.method !== "POST" || !README_FILES.has(name)) {
          res.statusCode = 400;
          return res.end("bad request");
        }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          writeFileSync(resolve(__dirname, "assets/readme", name), buf);
          res.end(String(buf.length));
        });
      });
    },
  };
}

// Tauri loads the dev server in dev and the built `dist/` in release.
export default defineConfig({
  clearScreen: false,
  plugins: [readmeArtSaver()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        jellyfish: resolve(__dirname, "wallpapers/jellyfish.html"),
      },
    },
  },
});
