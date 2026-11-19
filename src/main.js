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
      <div class="actions"><button type="button" class="use"></button> <button type="button" class="still">save a still</button></div>
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
    settings.renderer = input.value;
    showRunning(input.value);
  }),
);

api.get().then((saved) => {
  settings = { wallpaper: saved.wallpaper ?? "jellyfish", options: saved.options ?? {}, renderer: saved.renderer ?? "auto" };
  showRotation(saved.rotate);
  (saved.rules ?? []).forEach((r) => ruleRow(r));
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

// ---- rotation (src-tauri/src/extras.rs set_rotation) ----
// Change wallpaper every N minutes, through the ticked ones (each keeps its
// own options). All ticked is sent as "all of them".
const rotateOn = document.getElementById("rotate-on");
const rotateMinutes = document.getElementById("rotate-minutes");
const rotateWalls = document.getElementById("rotate-walls");
const stillNote = document.getElementById("still-note");
for (const w of WALLPAPERS) {
  const label = document.createElement("label");
  label.innerHTML = `<input type="checkbox" value="${w.id}" checked /> ${w.name}`;
  rotateWalls.append(label);
}
const wallBoxes = () => [...rotateWalls.querySelectorAll("input")];
async function saveRotation() {
  const walls = wallBoxes().filter((b) => b.checked).map((b) => b.value);
  rotateWalls.classList.toggle("off", !rotateOn.checked);
  if (!IN_APP) return;
  try {
    await invoke("set_rotation", { on: rotateOn.checked, minutes: Number(rotateMinutes.value), walls: walls.length === WALLPAPERS.length ? [] : walls });
  } catch (e) {
    stillNote.textContent = String(e);
  }
}
[rotateOn, rotateMinutes, ...wallBoxes()].forEach((el) => el.addEventListener("change", saveRotation));
function showRotation(r = {}) {
  rotateOn.checked = !!r.on;
  rotateMinutes.value = String(r.minutes ?? 10);
  const walls = r.walls ?? [];
  wallBoxes().forEach((b) => (b.checked = !walls.length || walls.includes(b.value)));
  rotateWalls.classList.toggle("off", !rotateOn.checked);
}

// ---- stills (extras.rs save_png) ----
// The wallpaper itself, loaded in a hidden iframe at the screen's real size
// with ?still (one frame at a random moment, sent back as a PNG), saved to
// Pictures/AfterGlow.
let stillN = 0;
function renderStill(id, options) {
  const w = Math.round(screen.width * devicePixelRatio);
  const h = Math.round(screen.height * devicePixelRatio);
  const n = String(++stillN);
  const at = Math.round(40 + Math.random() * 4000);
  const q = queryFor(options);
  const frame = document.createElement("iframe");
  frame.className = "still-frame";
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  return new Promise((resolve, reject) => {
    const done = (fn, v) => {
      removeEventListener("message", onMessage);
      clearTimeout(timer);
      frame.remove();
      fn(v);
    };
    const onMessage = (e) => {
      if (e.origin !== location.origin || e.data?.still !== n) return;
      e.data.blob ? done(resolve, { blob: e.data.blob, w, h }) : done(reject, new Error("the wallpaper sent no picture"));
    };
    const timer = setTimeout(() => done(reject, new Error("the still took too long")), 30000);
    addEventListener("message", onMessage);
    const render = settings.renderer && settings.renderer !== "auto" ? `&render=${settings.renderer}` : "";
    frame.src = `/wallpapers/${id}.html?still=${n}&at=${at}&hover=0${q ? `&${q}` : ""}${render}`;
    document.body.append(frame);
  });
}
async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function saveStill(id, button) {
  const options = optionsOf(cards.get(id));
  button.disabled = true;
  button.textContent = "rendering…";
  try {
    const { blob, w, h } = await renderStill(id, options);
    const name = ["afterglow", id, options.tint, `${w}x${h}`, Date.now().toString(36)].filter(Boolean).join("-");
    if (IN_APP) {
      const path = await invoke("save_png", { name, data: await toBase64(blob) });
      stillNote.textContent = `saved ${path}`;
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      stillNote.textContent = `downloaded ${name}.png`;
    }
  } catch (e) {
    stillNote.textContent = `couldn't save a still: ${e.message ?? e}`;
  }
  button.disabled = false;
  button.textContent = "save a still";
}
document.getElementById("open-stills").addEventListener("click", () => IN_APP && invoke("open_stills_folder").catch((e) => (stillNote.textContent = String(e))));
for (const [id, card] of cards) card.el.querySelector(".still").addEventListener("click", (e) => saveStill(id, e.currentTarget));

// ---- rules (signals.rs set_rules) ----
// One row per app: what a new message does (pulse, flash, nothing), the
// pulse colour (the app's own, or one you pick) and whether its count brings
// in jellies. Saved on every change; a bad row says why and isn't saved.
const rulesBody = document.querySelector("#rules tbody");
const rulesNote = document.getElementById("rules-note");
const OWN = { whatsapp: "#25d366", signal: "#3a76f0", telegram: "#29a9eb", slack: "#e01e5a", teams: "#7b83eb", discord: "#5865f2", gmail: "#ea4335", outlook: "#288ee8", mail: "#4aa8ff", spotify: "#1db954" };
function ruleRow(r = { source: "", on_new: "pulse", colour: "", count: true }) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="src" placeholder="whatsapp" spellcheck="false" maxlength="32" aria-label="app" /></td>
    <td><select class="on" aria-label="new message"><option value="pulse">pulse</option><option value="flash">flash</option><option value="nothing">nothing</option></select></td>
    <td class="col"><select class="which" aria-label="colour"><option value="">app's own</option><option value="pick">pick</option></select> <input type="color" class="hex" aria-label="pulse colour" /></td>
    <td><input type="checkbox" class="cnt" aria-label="counts as waiting" /></td>
    <td><button type="button" class="del" aria-label="remove rule">×</button></td>`;
  const $ = (s) => tr.querySelector(s);
  $(".src").value = r.source;
  $(".on").value = r.on_new;
  $(".which").value = r.colour ? "pick" : "";
  $(".hex").value = r.colour || OWN[r.source] || "#33ff99";
  $(".cnt").checked = r.count;
  const sync = () => {
    $(".which").hidden = $(".on").value !== "pulse";
    $(".hex").hidden = $(".which").hidden || $(".which").value !== "pick";
  };
  sync();
  tr.addEventListener("change", () => {
    sync();
    saveRules();
  });
  $(".src").addEventListener("input", () => {
    if ($(".which").value === "") $(".hex").value = OWN[$(".src").value.trim().toLowerCase()] || "#33ff99";
  });
  $(".del").addEventListener("click", () => {
    tr.remove();
    saveRules();
  });
  rulesBody.append(tr);
  return tr;
}
function readRules() {
  return [...rulesBody.rows]
    .map((tr) => ({
      source: tr.querySelector(".src").value.trim().toLowerCase(),
      on_new: tr.querySelector(".on").value,
      colour: tr.querySelector(".which").value === "pick" ? tr.querySelector(".hex").value : "",
      count: tr.querySelector(".cnt").checked,
    }))
    .filter((r) => r.source);
}
async function saveRules() {
  if (!IN_APP) return (rulesNote.textContent = "open Settings from the AfterGlow tray to save rules");
  try {
    await invoke("set_rules", { rules: readRules() });
    rulesNote.textContent = "saved";
    setTimeout(() => rulesNote.textContent === "saved" && (rulesNote.textContent = ""), 1500);
  } catch (e) {
    rulesNote.textContent = String(e);
  }
}
document.getElementById("add-rule").addEventListener("click", () => ruleRow().querySelector(".src").focus());
