// Writes latest.json, the list installed copies read to find a newer version
// (src-tauri/src/updates.rs), from the .sig files next to it:
//   bun scripts/latest-json.js <tag> <folder with the .sig files>
// release.yml runs it once both builds have uploaded.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [tag, dir] = process.argv.slice(2);
const version = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? "")?.[1];
if (!version || !dir) throw new Error("usage: bun scripts/latest-json.js v0.1.2 <folder>");

function entry(ending) {
  const found = readdirSync(dir).filter((f) => f.endsWith(`${ending}.sig`));
  if (found.length !== 1) throw new Error(`expected one ${ending}.sig, found: ${found.join(", ") || "none"}`);
  return {
    signature: readFileSync(join(dir, found[0]), "utf8").trim(),
    url: `https://github.com/wajenaqv/afterglow/releases/download/${tag}/${found[0].slice(0, -".sig".length)}`,
  };
}

const win = entry(`_${version}_x64-setup.exe`);
const mac = entry("_universal.app.tar.gz"); // one app for both chips
const out = join(dir, "latest.json");
writeFileSync(out, JSON.stringify({ version, pub_date: new Date().toISOString(), platforms: { "windows-x86_64": win, "darwin-x86_64": mac, "darwin-aarch64": mac } }, null, 2) + "\n");
console.log(`wrote ${out} for ${version}`);
