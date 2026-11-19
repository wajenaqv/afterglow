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
import { describe } from "./wallpapers/gpu.js";

const IN_APP = "__TAURI_INTERNALS__" in window;

const api = IN_APP
  ? {
      get: async () => (await import("@tauri-apps/api/core")).invoke("get_settings"),
      set: async (id, options) => (await import("@tauri-apps/api/core")).invoke("set_wallpaper", { id, options }),
      setFps: async (fps) => (await import("@tauri-apps/api/core")).invoke("set_fps", { fps }),
      setRenderer: async (renderer) => (await import("@tauri-apps/api/core")).invoke("set_renderer", { renderer }),
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
      setFps: async (fps) => {
        const s = await api.get();
        s.fps = fps;
        try {
          localStorage.setItem("afterglow:settings", JSON.stringify(s));
        } catch {}
      },
      setRenderer: async (renderer) => {
        const s = await api.get();
        s.renderer = renderer;
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
      <p class="dim reacts">reacts to: ${(w.reacts ?? []).join(" · ") || "nothing yet"}</p>
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
// ---- connectors (src-tauri/src/connectors) ----
// One row per connector this computer offers: a switch and a status line
// saying what it sees, or what it still needs. Refreshed every 2 s.
const connectorsEl = document.getElementById("connectors");
async function invoke(cmd, args) {
  return (await import("@tauri-apps/api/core")).invoke(cmd, args);
}
function connectorRow(c) {
  let row = connectorsEl.querySelector(`[data-id="${c.id}"]`);
  if (!row) {
    row = document.createElement("label");
    row.className = "connector";
    row.dataset.id = c.id;
    row.innerHTML = `<input type="checkbox" /> <span class="name"></span> <span class="status dim"></span>`;
    row.querySelector("input").addEventListener("change", (e) => invoke("set_connector", { id: c.id, on: e.target.checked }).then(refreshConnectors));
    connectorsEl.append(row);
  }
  row.querySelector("input").checked = c.on;
  row.querySelector(".name").textContent = c.name;
  const status = row.querySelector(".status");
  status.textContent = c.on ? (c.status?.text ?? "starting…") : "off";
  status.dataset.state = c.on ? (c.status?.state ?? "") : "off";
}
// Accounts (Gmail, Outlook, Spotify): the app registration and sign-in,
// shown under the connector's row. Inputs are left alone while focused, so
// the 2-second refresh doesn't fight your typing.
function accountPanel(a) {
  const row = connectorsEl.querySelector(`[data-id="${a.id}"]`);
  if (!row) return;
  let panel = connectorsEl.querySelector(`[data-account="${a.id}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "account";
    panel.dataset.account = a.id;
    const secret = a.id === "gmail" ? `<input class="secret" type="password" placeholder="client secret" autocomplete="off" />` : "";
    panel.innerHTML = `
      <input class="client" placeholder="client id" autocomplete="off" spellcheck="false" /> ${secret}
      <button type="button" class="save">save</button>
      <button type="button" class="signin"></button>
      <div class="dim redirect"></div>`;
    panel.querySelector(".save").addEventListener("click", () =>
      invoke("set_client", { id: a.id, clientId: panel.querySelector(".client").value, clientSecret: panel.querySelector(".secret")?.value ?? "" }).then(() => {
        const s = panel.querySelector(".secret");
        if (s) s.value = "";
        refreshConnectors();
      }),
    );
    panel.querySelector(".signin").addEventListener("click", (e) => invoke(e.target.dataset.signedIn === "1" ? "account_sign_out" : "account_sign_in", { id: a.id }).then(refreshConnectors));
    row.after(panel);
  }
  const client = panel.querySelector(".client");
  if (document.activeElement !== client) client.value = a.client_id;
  const secret = panel.querySelector(".secret");
  if (secret && document.activeElement !== secret) secret.placeholder = a.has_secret ? "client secret (saved)" : "client secret";
  const btn = panel.querySelector(".signin");
  btn.textContent = a.signed_in ? "sign out" : "sign in";
  btn.dataset.signedIn = a.signed_in ? "1" : "0";
  btn.disabled = !a.client_id;
  panel.querySelector(".redirect").textContent = `redirect URI to register: ${a.redirect}`;
}

async function refreshConnectors() {
  if (!IN_APP) return (connectorsEl.textContent = "open Settings from the AfterGlow tray to see the connectors");
  try {
    const list = await invoke("connectors_state");
    if (!list.length) connectorsEl.textContent = "none on this computer yet";
    list.forEach(connectorRow);
    (await invoke("accounts_state")).forEach(accountPanel);
  } catch (e) {
    connectorsEl.textContent = String(e);
  }
}
refreshConnectors();
setInterval(refreshConnectors, 2000);

// ---- the signal simulator (signals.rs send_signal) ----
// The "waiting" buttons keep their own count, sent as the "simulator" app's
// unread count (added to any real apps' counts by the bus)
let simWaiting = 0;
const waitingNote = document.getElementById("waiting");
async function sendSignal(signal) {
  if (!IN_APP) return (waitingNote.textContent = "open Settings from the AfterGlow tray to send signals");
  try {
    await (await import("@tauri-apps/api/core")).invoke("send_signal", { signal });
  } catch (e) {
    waitingNote.textContent = String(e);
  }
}
document.querySelectorAll("[data-signal]").forEach((b) => b.addEventListener("click", () => sendSignal(JSON.parse(b.dataset.signal))));
document.querySelectorAll("[data-waiting]").forEach((b) =>
  b.addEventListener("click", () => {
    simWaiting = Number(b.dataset.waiting) === 0 ? 0 : simWaiting + Number(b.dataset.waiting);
    waitingNote.textContent = simWaiting ? `${simWaiting} waiting` : "";
    sendSignal(simWaiting ? { source: "simulator", kind: "unread", count: simWaiting } : { source: "simulator", kind: "clear" });
  }),
);
document.getElementById("copy-curl").addEventListener("click", async (e) => {
  try {
    await navigator.clipboard.writeText(document.getElementById("curl").textContent);
    e.target.textContent = "copied";
    setTimeout(() => (e.target.textContent = "copy"), 1500);
  } catch {}
});

// The version, from the app (tauri.conf.json), in the footer
if (IN_APP)
  import("@tauri-apps/api/app").then(async ({ getVersion }) => {
    document.getElementById("version").textContent = `afterglow v${await getVersion()} · MIT`;
  });

// The frame rate (every wallpaper)
const fpsInputs = [...document.querySelectorAll('input[name="fps"]')];
fpsInputs.forEach((input) => input.addEventListener("change", () => input.checked && api.setFps(Number(input.value))));

// Rendering: GPU or CPU, and what that means on this computer
const renderInputs = [...document.querySelectorAll('input[name="render"]')];
const running = document.getElementById("running");
function showRunning(pref) {
  const { gpu, text } = describe(pref);
  running.textContent = text;
  running.className = gpu ? "on" : "";
}
renderInputs.forEach((input) =>
  input.addEventListener("change", () => {
    if (!input.checked) return;
    api.setRenderer(input.value);
    showRunning(input.value);
  }),
);

api.get().then((saved) => {
  settings = { wallpaper: saved.wallpaper ?? "jellyfish", options: saved.options ?? {} };
  const fps = String(saved.fps ?? 30);
  fpsInputs.forEach((input) => (input.checked = input.value === fps));
  const render = saved.renderer ?? "auto";
  renderInputs.forEach((input) => (input.checked = input.value === render));
  showRunning(render);
  for (const [id, card] of cards) {
    const mine = settings.options[id] ?? {};
    for (const [key, sel] of card.selects) sel.value = mine[key] ?? "";
    nameHues(card);
    card.preview.src = previewSrc(id, optionsOf(card));
  }
  refresh();
});
