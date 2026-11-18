// The Settings window: pick the wallpaper and its options.
//
// In the app it talks to Rust (src-tauri/src/settings.rs):
//   get_settings  -> { wallpaper, options: { <id>: { key: value } }, ... }
//   set_wallpaper(id, options) switches every monitor and saves the choice
// Opened in a plain browser (bun run dev, localhost:5173), a stand-in keeps
// the choice in localStorage so the page can be designed there.

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import marks from "../scripts/wordmarks.json";
import { WALLPAPERS, HUE_NAMES, queryFor } from "./wallpapers/catalog.js";

const IN_APP = "__TAURI_INTERNALS__" in window;

const api = IN_APP
  ? {
      get: async () => (await import("@tauri-apps/api/core")).invoke("get_settings"),
      set: async (id, options) => (await import("@tauri-apps/api/core")).invoke("set_wallpaper", { id, options }),
    }
  : {
      get: async () => {
        try {
          return JSON.parse(localStorage.getItem("afterglow:settings")) ?? {};
        } catch {
          return {};
        }
      },
      set: async (id, options) => {
        const s = await api.get();
        s.wallpaper = id;
        s.options = { ...(s.options ?? {}), [id]: options };
        try {
          localStorage.setItem("afterglow:settings", JSON.stringify(s));
        } catch {}
      },
    };

// ---- the wordmark: Slant, white on top fading to green (heywajih's logo fade) ----
const mark = document.getElementById("mark");
const lines = marks.Slant;
lines.forEach((line, i) => {
  const row = document.createElement("span");
  row.className = "mark-row";
  const t = Math.round((i / Math.max(1, lines.length - 1)) * 100);
  row.style.color = `color-mix(in srgb, var(--logo-bottom) ${t}%, var(--logo-top))`;
  row.textContent = line + "\n";
  mark.append(row);
});

// ---- the cards ----
const cardsEl = document.getElementById("cards");
let settings = { wallpaper: "jellyfish", options: {} };
const cards = new Map(); // id -> { el, preview, selects, button }

function optionsOf(card) {
  const o = {};
  for (const [key, sel] of card.selects) if (sel.value) o[key] = sel.value;
  return o;
}

// The big jellyfish's colour menu names the colours of the chosen palette
function nameHues(card) {
  const hue = card.selects.get("hue");
  if (!hue) return;
  const names = HUE_NAMES[card.selects.get("tint")?.value ?? ""] ?? HUE_NAMES[""];
  [...hue.options].slice(1).forEach((opt, i) => {
    opt.textContent = names[i] ?? "";
    opt.hidden = !names[i];
  });
  if (hue.selectedOptions[0]?.hidden) hue.selectedIndex = 0;
}

function previewSrc(id, options) {
  const q = queryFor(options);
  return `/wallpapers/${id}.html?preview&hover=0${q ? `&${q}` : ""}`;
}

function refresh() {
  for (const [id, card] of cards) {
    const on = settings.wallpaper === id;
    card.el.classList.toggle("on", on);
    card.button.textContent = on ? "● showing" : "use this";
    card.button.disabled = on;
    card.button.setAttribute("aria-pressed", String(on));
  }
}

async function choose(id) {
  const card = cards.get(id);
  const options = optionsOf(card);
  await api.set(id, options);
  settings.wallpaper = id;
  settings.options = { ...settings.options, [id]: options };
  refresh();
}

for (const w of WALLPAPERS) {
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="preview"><iframe title="${w.name} preview" tabindex="-1" loading="lazy"></iframe></div>
    <div class="body">
      <h3>${w.name}</h3>
      <p class="dim about">${w.about}</p>
      <div class="opts"></div>
      <button type="button" class="use"></button>
    </div>`;
  const opts = el.querySelector(".opts");
  const selects = new Map();
  for (const o of w.options) {
    const label = document.createElement("label");
    label.innerHTML = `<span class="dim">${o.label}</span>`;
    const sel = document.createElement("select");
    for (const [value, text] of o.choices) sel.add(new Option(text, value));
    label.append(sel);
    opts.append(label);
    selects.set(o.key, sel);
  }
  const card = { el, preview: el.querySelector("iframe"), selects, button: el.querySelector(".use") };
  cards.set(w.id, card);

  for (const sel of selects.values())
    sel.addEventListener("change", () => {
      nameHues(card);
      card.preview.src = previewSrc(w.id, optionsOf(card));
      // the wallpaper that's showing changes straight away
      if (settings.wallpaper === w.id) choose(w.id);
    });
  card.button.addEventListener("click", () => choose(w.id));
  cardsEl.append(el);
}

// Previews render at 960x540 and are scaled to fit their card
const fit = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty("--k", String(e.contentRect.width / 960));
});
document.querySelectorAll(".preview").forEach((p) => fit.observe(p));

// Fill in what's saved, then start the previews
api.get().then((saved) => {
  settings = { wallpaper: saved.wallpaper ?? "jellyfish", options: saved.options ?? {} };
  for (const [id, card] of cards) {
    const mine = settings.options[id] ?? {};
    for (const [key, sel] of card.selects) sel.value = mine[key] ?? "";
    nameHues(card);
    card.preview.src = previewSrc(id, optionsOf(card));
  }
  refresh();
});
