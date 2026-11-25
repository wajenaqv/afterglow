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
          writeFileSync(resolve(import.meta.dirname, "assets/readme", name), buf);
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
        main: resolve(import.meta.dirname, "index.html"),
        host: resolve(import.meta.dirname, "wallpapers/host.html"),
        jellyfish: resolve(import.meta.dirname, "wallpapers/jellyfish.html"),
        "big-jellyfish": resolve(import.meta.dirname, "wallpapers/big-jellyfish.html"),
        paws: resolve(import.meta.dirname, "wallpapers/paws.html"),
        clock: resolve(import.meta.dirname, "wallpapers/clock.html"),
        cloudsea: resolve(import.meta.dirname, "wallpapers/cloudsea.html"),
        sakura: resolve(import.meta.dirname, "wallpapers/sakura.html"),
        constellation: resolve(import.meta.dirname, "wallpapers/constellation.html"),
        currents: resolve(import.meta.dirname, "wallpapers/currents.html"),
        magnet: resolve(import.meta.dirname, "wallpapers/magnet.html"),
        attractor: resolve(import.meta.dirname, "wallpapers/attractor.html"),
        silk: resolve(import.meta.dirname, "wallpapers/silk.html"),
        startrails: resolve(import.meta.dirname, "wallpapers/startrails.html"),
        radar: resolve(import.meta.dirname, "wallpapers/radar.html"),
        life: resolve(import.meta.dirname, "wallpapers/life.html"),
        circuit: resolve(import.meta.dirname, "wallpapers/circuit.html"),
        impossible: resolve(import.meta.dirname, "wallpapers/impossible.html"),
      },
    },
  },
});
