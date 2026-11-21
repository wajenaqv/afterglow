// The Settings window: a sidebar of pages (wallpaper, apps, pausing,
// performance, about), one shown at a time, chosen by the URL hash.
//
// In the app every change goes straight to Rust (invoke):
//   settings.rs   get_settings, set_wallpaper, set_fps, set_renderer
//   extras.rs     set_rotation, save_png, open_stills_folder, open_link
//   signals.rs    set_rules, send_signal, unread_by_app
//   tray.rs       set_pausing, autostart_state, set_autostart
//   connectors/   connectors_state, set_connector, accounts_state, set_client,
//                 account_sign_in, account_sign_out
// Opened in a plain browser (bun run dev, localhost:5173), a stand-in keeps
// the settings in localStorage so the page can be designed there.

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import { WALLPAPERS, HUE_NAMES, queryFor } from "./wallpapers/catalog.js";
import { describe } from "./wallpapers/gpu.js";
import { GUIDES } from "./guides.js";
import { clockRows, STYLES as CLOCK_STYLES, NIXIE_CSS, nixieHTML } from "./wallpapers/hoverclock.js";
import { startTerminal, paintStatus, bootOn, setBoot } from "./terminal.js";

const IN_APP = "__TAURI_INTERNALS__" in window;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- talking to Rust (or the browser stand-in) ----
async function invoke(cmd, args = {}) {
  if (IN_APP) return (await import("@tauri-apps/api/core")).invoke(cmd, args);
  return standIn(cmd, args);
}
function standIn(cmd, a) {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem("afterglow:settings")) ?? {};
  } catch {}
  const save = () => {
    try {
      localStorage.setItem("afterglow:settings", JSON.stringify(s));
    } catch {}
  };
  switch (cmd) {
    case "get_settings":
      return s;
    case "set_wallpaper":
      s.wallpaper = a.id;
      s.options = { ...(s.options ?? {}), [a.id]: a.options };
      return save();
    case "set_fps":
      s.fps = a.fps;
      return save();
    case "set_renderer":
      s.renderer = a.renderer;
      return save();
    case "set_clock":
      s.clock = a.clock;
      return save();
    case "set_scramble":
      s.scramble = a.on;
      return save();
    case "set_rotation":
      s.rotate = { on: a.on, minutes: a.minutes, walls: a.walls };
      return save();
    case "set_rules":
      s.rules = a.rules;
      return save();
    case "set_pausing":
      Object.assign(s, { pause_covered: a.covered, pause_fullscreen: a.fullscreen, pause_on_battery: a.battery, quiet_dnd: a.quietDnd });
      return save();
    // sample connectors, so the apps page and its guides can be designed here
    case "connectors_state":
      return [
        { id: "notifications", name: "Windows notifications", on: false },
        { id: "gmail", name: "Gmail", on: true, status: { state: "setup", text: "needs your Google app (see the guide)" } },
        { id: "outlook", name: "Outlook", on: false },
        { id: "spotify", name: "Spotify (a pulse when the song changes)", on: false },
        { id: "steam", name: "Steam", on: true, status: { state: "setup", text: "friends need your Steam Web API key and Steam ID (see the guide)" } },
      ];
    case "accounts_state":
      return ["gmail", "outlook", "spotify"].map((id) => ({ id, client_id: "", has_secret: false, signed_in: false }));
    case "steam_state":
      return { messages: true, online: true, playing: false, steamid: "", has_key: false, can_messages: true };
    case "unread_by_app":
      return {};
    // sample signals, so the activity page can be designed here
    case "activity_log": {
      const now = Date.now();
      const e = (ago, source, kind, count, result) => ({ at: now - ago * 1000, source, kind, count, result });
      return [
        e(8, "claude", "new", null, "pulse #f20707"),
        e(8, "claude", "unread", 2, "counted (5 waiting in all)"),
        e(95, "whatsapp", "new", null, "held (you're away)"),
        e(140, "spotify", "new", null, "flash"),
        e(300, "windows-security", "new", null, "ignored (its rule says nothing)"),
        e(420, "whatsapp", "new", null, "replayed (you're back)"),
        e(900, "snipping-tool", "new", null, "pulse #33ff99"),
        e(86400 * 2, "steam", "new", null, "pulse #66c0f4"),
      ];
    }
    case "clear_activity":
      return null;
    case "autostart_state":
    case "set_autostart":
      return false;
    default:
      throw new Error("open Settings from the AfterGlow tray for this");
  }
}

// ---- the sidebar: the Slant AG, white on top fading to green ----
const AG = ["    ___   ______", "   /   | / ____/", "  / /| |/ / __  ", " / ___ / /_/ /  ", "/_/  |_\\____/   "];
AG.forEach((line, i) => {
  const row = document.createElement("span");
  const t = Math.round((i / (AG.length - 1)) * 100);
  row.style.color = `color-mix(in srgb, var(--logo-bottom) ${t}%, var(--logo-top))`;
  row.textContent = line + "\n";
  $("#mark").append(row);
});

// ---- pages ----
const PAGES = ["wallpaper", "clock", "apps", "pausing", "performance", "activity", "about"];
function show() {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "wallpaper";
  for (const s of $$("main > section")) s.hidden = s.dataset.page !== page;
  for (const a of $$(".side a")) a.setAttribute("aria-current", a.dataset.page === page ? "page" : "false");
  $("#cmd").textContent = page;
  $("main").scrollTop = 0;
  if (page === "apps") refreshApps();
  if (page === "activity") refreshActivity();
}
addEventListener("hashchange", show);

let settings = { wallpaper: "jellyfish", options: {}, renderer: "auto" };

// =========================== wallpaper ===========================
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

function markShowing() {
  for (const [id, card] of cards) {
    const on = settings.wallpaper === id;
    card.el.classList.toggle("on", on);
    card.button.textContent = on ? "● showing" : "use this";
    card.button.disabled = on;
    card.button.setAttribute("aria-pressed", String(on));
  }
}

async function choose(id) {
  const options = optionsOf(cards.get(id));
  await invoke("set_wallpaper", { id, options });
  settings.wallpaper = id;
  settings.options = { ...settings.options, [id]: options };
  markShowing();
  paintStatus();
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
  const opts = $(".opts", el);
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
  const card = { el, preview: $("iframe", el), selects, button: $(".use", el) };
  cards.set(w.id, card);
  for (const sel of selects.values())
    sel.addEventListener("change", () => {
      nameHues(card);
      card.preview.src = previewSrc(w.id, optionsOf(card));
      if (settings.wallpaper === w.id) choose(w.id); // the one showing changes straight away
    });
  card.button.addEventListener("click", () => choose(w.id));
  $(".still", el).addEventListener("click", (e) => saveStill(w.id, e.currentTarget));
  $("#cards").append(el);
}

// Coming soon: wallpapers on their way (from heywajih.com), as dim tiles
// with a sketch, so the picker shows there's more to come
const SOON = [
  { name: "constellation", about: "A cat drawn in the stars: chart lines join the stars into a cat, then it dissolves and the next one forms.", art: "  *        *\n   \\      /\n    *----*\n    |    |\n    *    *--*" },
  { name: "black hole", about: "Light bending around a black hole, traced ray by ray: a glowing disk, its lensed halo and warped stars.", art: "  .   *    .\n   .-~~~~-.\n  ( ( @@ ) )\n   '-~~~~-'\n .    *   ." },
  { name: "cats", about: "Glowing text-art cats: one asleep in the corner, a whole family, and a troupe that dances.", art: "  /\\_/\\\n ( -.- )\n  > ^ <\n (__)_)~" },
];
for (const w of SOON) {
  const el = document.createElement("article");
  el.className = "card soon";
  el.innerHTML = `
    <div class="preview"><pre></pre></div>
    <div class="body">
      <h3></h3>
      <p class="dim about"></p>
      <p class="soon-tag">coming soon</p>
    </div>`;
  el.querySelector("pre").textContent = w.art;
  el.querySelector("h3").textContent = w.name;
  el.querySelector(".about").textContent = w.about;
  $("#cards").append(el);
}

// Previews render at 960x540 and are scaled to fit their card
const fit = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty("--k", String(e.contentRect.width / 960));
});
$$(".preview").forEach((p) => fit.observe(p));

// ---- rotation: every N minutes, through the ticked wallpapers ----
const rotateOn = $("#rotate-on");
const rotateMinutes = $("#rotate-minutes");
const rotateWalls = $("#rotate-walls");
const stillNote = $("#still-note");
for (const w of WALLPAPERS) {
  const label = document.createElement("label");
  label.innerHTML = `<input type="checkbox" value="${w.id}" checked /> ${w.name}`;
  rotateWalls.append(label);
}
const wallBoxes = () => $$("input", rotateWalls);
async function saveRotation() {
  const walls = wallBoxes().filter((b) => b.checked).map((b) => b.value);
  rotateWalls.classList.toggle("off", !rotateOn.checked);
  try {
    // all ticked is sent as "all of them" (also any added later)
    await invoke("set_rotation", { on: rotateOn.checked, minutes: Number(rotateMinutes.value), walls: walls.length === WALLPAPERS.length ? [] : walls });
  } catch (e) {
    stillNote.textContent = String(e);
  }
}
[rotateOn, rotateMinutes, ...wallBoxes()].forEach((el) => el.addEventListener("change", saveRotation));
// ---- clock page (extras.rs set_clock, src/wallpapers/hoverclock.js) ----
// Show it (hover / always / never), the four styles as small previews you
// click to pick, and corner, colour and fill. Saved on every change; the
// wallpapers update straight away.
const clockShowInputs = $$('input[name="clock-show"]');
const clockCorner = $("#clock-corner");
const clockColour = $("#clock-colour");
const clockFill = $("#clock-fill");
const clockSize = $("#clock-size");
const clockHours = $("#clock-hours");
let clockStyle = "slant";
const clockShow = () => clockShowInputs.find((i) => i.checked)?.value ?? "hover";
for (const id of CLOCK_STYLES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "clock-style " + id;
  b.dataset.style = id;
  b.setAttribute("role", "radio");
  b.innerHTML = '<pre></pre><span class="dim"></span>';
  if (id === "nixie") b.querySelector("pre").innerHTML = nixieHTML("4:43");
  else b.querySelector("pre").textContent = clockRows(id).join("\n");
  b.querySelector(":scope > span").textContent = id.replace("-", " "); // (nixie's tubes are spans too)
  b.addEventListener("click", () => {
    clockStyle = id;
    saveClock();
  });
  $("#clock-styles").append(b);
}
// the nixie preview's tubes
document.head.append(Object.assign(document.createElement("style"), { textContent: NIXIE_CSS }));
function markClock() {
  for (const b of $$(".clock-style")) {
    const on = b.dataset.style === clockStyle;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  $("#page-clock").classList.toggle("clock-off", clockShow() === "never");
}
function saveClock() {
  markClock();
  const show = clockShow();
  const clock = { on: show !== "never", always: show === "always", style: clockStyle, corner: clockCorner.value, colour: clockColour.value, fill: clockFill.value, size: clockSize.value, hours: clockHours.value };
  invoke("set_clock", { clock })
    .then(() => ($("#clock-note").textContent = ""))
    .catch((e) => ($("#clock-note").textContent = String(e)));
}
[...clockShowInputs, clockCorner, clockColour, clockFill, clockSize, clockHours].forEach((el) => el.addEventListener("change", saveClock));
function showClock(c = {}) {
  const show = c.on === false ? "never" : c.always ? "always" : "hover";
  clockShowInputs.forEach((i) => (i.checked = i.value === show));
  clockStyle = c.style ?? "slant";
  clockCorner.value = c.corner ?? "top-right";
  clockColour.value = c.colour ?? "wallpaper";
  clockFill.value = c.fill ?? "gradient";
  clockSize.value = c.size ?? "medium";
  clockHours.value = c.hours ?? "auto";
  markClock();
}

// Hover scramble on or off (settings.rs set_scramble; the wallpaper reloads)
$("#scramble").addEventListener("change", (e) => invoke("set_scramble", { on: e.target.checked }).catch((err) => (stillNote.textContent = String(err))));

function showRotation(r = {}) {
  rotateOn.checked = !!r.on;
  rotateMinutes.value = String(r.minutes ?? 10);
  const walls = r.walls ?? [];
  wallBoxes().forEach((b) => (b.checked = !walls.length || walls.includes(b.value)));
  rotateWalls.classList.toggle("off", !rotateOn.checked);
}

// ---- stills: the wallpaper rendered once at the screen's real size ----
// (a hidden iframe with ?still sends one frame back as a PNG)
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
      stillNote.textContent = `saved ${await invoke("save_png", { name, data: await toBase64(blob) })}`;
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
$("#open-stills").addEventListener("click", () => invoke("open_stills_folder").catch((e) => (stillNote.textContent = String(e))));

// =========================== apps ===========================
// Two parts: what AfterGlow listens to (connectors and accounts), and one
// row per app saying what its messages do. The "every app" row is the
// default (the "*" rule); an app row that hasn't been changed follows it,
// shown dim. Changing a row gives that app its own rule (signals.rs Rule);
// "reset" drops it again. Saved on every change.

// ---- listen to: one block per connector ----
// A switch, a status line and a "how to set it up" guide (src/guides.js).
// The guide opens by itself while a switched-on connector still needs
// something from you (access, keys, sign-in); the button toggles it any time.
// Accounts (Gmail, Outlook, Spotify) get their key fields at the end of the
// guide. Inputs are left alone while focused, so the 2-second refresh
// doesn't fight your typing.
const connectorsEl = $("#connectors");
const guideOpen = new Map(); // id -> true/false once you've toggled it yourself

function guideHTML(id) {
  const g = GUIDES[id];
  if (!g) return "";
  const part = (p) => {
    if (typeof p === "string") return esc(p);
    if (p.b) return `<b>${esc(p.b)}</b>`;
    if (p.link) return `<a href="${esc(p.url)}" data-open="${esc(p.url)}">${esc(p.link)} ↗</a>`;
    if (p.copy) return `<code>${esc(p.copy)}</code><button type="button" class="copy" data-copy="${esc(p.copy)}">copy</button>`;
    return "";
  };
  return `<p class="dim">${esc(g.intro)}</p>
    <ol>${g.steps.map((s) => `<li>${s.map(part).join("")}</li>`).join("")}</ol>`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function connectorBlock(c) {
  let block = $(`[data-id="${c.id}"]`, connectorsEl);
  if (!block) {
    block = document.createElement("div");
    block.className = "connector";
    block.dataset.id = c.id;
    block.innerHTML = `
      <div class="head">
        <label><input type="checkbox" /> <span class="name"></span></label>
        <span class="status dim"></span>
        ${GUIDES[c.id] ? `<button type="button" class="how">how to set it up</button>` : ""}
      </div>
      <div class="guide" hidden>${guideHTML(c.id)}</div>`;
    $("input", block).addEventListener("change", (e) => invoke("set_connector", { id: c.id, on: e.target.checked }).then(refreshApps));
    $(".how", block)?.addEventListener("click", () => {
      guideOpen.set(c.id, $(".guide", block).hidden);
      refreshApps();
    });
    connectorsEl.append(block);
  }
  $("input", block).checked = c.on;
  $(".name", block).textContent = c.name;
  const status = $(".status", block);
  status.textContent = c.on ? (c.status?.text ?? "starting…") : "off";
  status.dataset.state = c.on ? (c.status?.state ?? "") : "off";
  // needs you: switched on but not working yet
  block.needsYou = c.on && c.status?.state !== "ok";
  showGuide(block);
}
function showGuide(block) {
  const open = guideOpen.get(block.dataset.id) ?? !!block.needsYou;
  $(".guide", block).hidden = !open;
  const how = $(".how", block);
  if (how) how.textContent = open ? "hide the guide" : "how to set it up";
}

// The account's key fields, at the end of its guide
function accountFields(a) {
  const block = $(`[data-id="${a.id}"]`, connectorsEl);
  if (!block) return;
  let fields = $(".account", block);
  if (!fields) {
    fields = document.createElement("div");
    fields.className = "account";
    const secret = a.id === "gmail" ? `<input class="secret" type="password" placeholder="client secret" autocomplete="off" aria-label="client secret" />` : "";
    fields.innerHTML = `
      <input class="client" placeholder="client id" autocomplete="off" spellcheck="false" aria-label="client id" /> ${secret}
      <button type="button" class="save">save</button>
      <button type="button" class="signin"></button>
      <span class="note dim"></span>`;
    const note = $(".note", fields);
    $(".save", fields).addEventListener("click", () =>
      invoke("set_client", { id: a.id, clientId: $(".client", fields).value.trim(), clientSecret: ($(".secret", fields)?.value ?? "").trim() })
        .then(() => {
          const s = $(".secret", fields);
          if (s) s.value = "";
          note.textContent = "saved: now sign in";
          refreshApps();
        })
        .catch((e) => (note.textContent = String(e))),
    );
    $(".signin", fields).addEventListener("click", (e) => {
      const out = e.target.dataset.signedIn === "1";
      note.textContent = out ? "" : "finish signing in in your browser…";
      invoke(out ? "account_sign_out" : "account_sign_in", { id: a.id })
        .then(refreshApps)
        .catch((err) => (note.textContent = String(err)));
    });
    $(".guide", block).append(fields);
  }
  const client = $(".client", fields);
  if (document.activeElement !== client) client.value = a.client_id;
  const secret = $(".secret", fields);
  if (secret && document.activeElement !== secret) secret.placeholder = a.has_secret ? "client secret (saved)" : "client secret";
  const btn = $(".signin", fields);
  btn.textContent = a.signed_in ? "sign out" : "sign in";
  btn.dataset.signedIn = a.signed_in ? "1" : "0";
  btn.disabled = !a.client_id;
  if (a.signed_in && $(".note", fields).textContent.startsWith("finish")) $(".note", fields).textContent = "signed in";
  // an account counts as needing you until it's signed in
  block.needsYou = $("input", block).checked && !a.signed_in;
  showGuide(block);
}

// Steam: its three parts, the Steam ID and the Web API key, at the end of
// its guide (connectors/steam.rs set_steam). The key field is never filled
// back in (it's in the keychain); "saved" shows when there is one.
function steamFields(st) {
  const block = $('[data-id="steam"]', connectorsEl);
  if (!block) return;
  let fields = $(".steam", block);
  if (!fields) {
    fields = document.createElement("div");
    fields.className = "account steam";
    fields.innerHTML = `
      <label><input type="checkbox" class="st-messages" /> chat messages</label>
      <label><input type="checkbox" class="st-online" /> friends coming online</label>
      <label><input type="checkbox" class="st-playing" /> friends starting a game</label>
      <div class="break"></div>
      <input class="st-id" placeholder="profile link or Steam ID" autocomplete="off" spellcheck="false" aria-label="Steam profile" />
      <input class="st-key" type="password" placeholder="Steam Web API key" autocomplete="off" aria-label="Steam Web API key" />
      <button type="button" class="save">save</button>
      <span class="note dim"></span>`;
    $(".save", fields).addEventListener("click", () => {
      const note = $(".note", fields);
      note.textContent = "saving…";
      invoke("set_steam", {
        messages: $(".st-messages", fields).checked,
        online: $(".st-online", fields).checked,
        playing: $(".st-playing", fields).checked,
        steamid: $(".st-id", fields).value,
        apiKey: $(".st-key", fields).value,
      })
        .then((id) => {
          $(".st-key", fields).value = "";
          note.textContent = id ? `saved (Steam ID ${id})` : "saved";
          fields.dataset.loaded = "";
          refreshApps();
        })
        .catch((e) => (note.textContent = String(e)));
    });
    $(".guide", block).append(fields);
  }
  // fill in from the app once (and after each save), so typing isn't overwritten
  if (!fields.dataset.loaded) {
    fields.dataset.loaded = "1";
    $(".st-messages", fields).checked = st.messages;
    $(".st-online", fields).checked = st.online;
    $(".st-playing", fields).checked = st.playing;
    $(".st-id", fields).value = st.steamid;
  }
  $(".st-messages", fields).disabled = !st.can_messages;
  $(".st-messages", fields).parentElement.title = st.can_messages ? "" : "Windows only for now";
  $(".st-key", fields).placeholder = st.has_key ? "Steam Web API key (saved)" : "Steam Web API key";
}

// Guide links open in the browser (or OS settings); copy buttons copy
connectorsEl.addEventListener("click", async (e) => {
  const link = e.target.closest("[data-open]");
  if (link) {
    e.preventDefault();
    if (IN_APP) invoke("open_link", { url: link.dataset.open }).catch(() => {});
    else window.open(link.dataset.open, "_blank", "noopener");
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.textContent = "copied";
      setTimeout(() => (copy.textContent = "copy"), 1500);
    } catch {}
  }
});

// ---- what each app does ----
// Known apps and their own colours (signals.rs COLOURS)
const KNOWN = [
  ["whatsapp", "WhatsApp", "#25d366"],
  ["signal", "Signal", "#3a76f0"],
  ["telegram", "Telegram", "#29a9eb"],
  ["slack", "Slack", "#e01e5a"],
  ["teams", "Teams", "#7b83eb"],
  ["discord", "Discord", "#5865f2"],
  ["gmail", "Gmail", "#ea4335"],
  ["outlook", "Outlook", "#288ee8"],
  ["mail", "Mail", "#4aa8ff"],
  ["spotify", "Spotify", "#1db954"],
  ["steam", "Steam", "#66c0f4"],
];
const BRAND = "#33ff99";
const ownColour = (source) => KNOWN.find(([id]) => id === source)?.[2] ?? BRAND;
const DEFAULT_RULE = { on_new: "pulse", colour: "", count: true };
const appsBody = $("#apps tbody");
const appsNote = $("#apps-note");
const rows = new Map(); // source -> { tr, own (has its own rule), custom }

function ruleOf(row) {
  return {
    on_new: $(".on", row.tr).value,
    colour: $(".which", row.tr).value === "pick" ? $(".hex", row.tr).value : "",
    count: $(".cnt", row.tr).checked,
  };
}
function setRow(row, rule) {
  $(".on", row.tr).value = rule.on_new;
  $(".which", row.tr).value = rule.colour ? "pick" : "";
  $(".hex", row.tr).value = rule.colour || ownColour(row.source);
  $(".cnt", row.tr).checked = rule.count;
  // a colour only matters for a pulse
  $(".which", row.tr).hidden = rule.on_new !== "pulse";
  $(".hex", row.tr).hidden = rule.on_new !== "pulse" || !rule.colour;
  $(".dot", row.tr).style.background = rule.on_new === "pulse" ? rule.colour || ownColour(row.source) : "transparent";
}
function defaults() {
  return rows.has("*") ? ruleOf(rows.get("*")) : DEFAULT_RULE;
}
// Rows that follow the default show its values, dimmed
function followDefault() {
  const d = defaults();
  for (const row of rows.values()) {
    if (row.source === "*") continue;
    row.tr.classList.toggle("inherit", !row.own);
    $(".reset", row.tr).hidden = !row.own || row.custom;
    if (!row.own) setRow(row, d);
  }
}

function appRow(source, { name, custom = false, rule = null } = {}) {
  if (rows.has(source)) return rows.get(source);
  const tr = document.createElement("tr");
  const label = source === "*" ? `every app <span class="dim">default</span>` : name ?? source;
  tr.innerHTML = `
    <td class="name"><span class="dot" aria-hidden="true"></span> ${custom && !source ? `<input class="src" placeholder="build" spellcheck="false" maxlength="32" aria-label="app name" />` : `<span>${label}</span>`}</td>
    <td><select class="on" aria-label="new message"><option value="pulse">pulse</option><option value="flash">flash</option><option value="nothing">nothing</option></select></td>
    <td class="col"><select class="which" aria-label="colour"><option value="">${source === "*" ? "each app's own" : "its own"}</option><option value="pick">pick…</option></select> <input type="color" class="hex" aria-label="pulse colour" /></td>
    <td><input type="checkbox" class="cnt" aria-label="counts as waiting" /></td>
    <td class="waiting dim"></td>
    <td class="row-actions">${source === "*" ? "" : `<button type="button" class="try">try</button>`} <button type="button" class="reset" hidden>reset</button>${custom ? ` <button type="button" class="del" aria-label="remove">×</button>` : ""}</td>`;
  const row = { tr, source, own: !!rule || custom || source === "*", custom };
  rows.set(source, row);
  setRow(row, rule ?? defaults());

  tr.addEventListener("change", (e) => {
    if (e.target.classList.contains("src")) return;
    if ($(".which", tr).value === "pick" && e.target.classList.contains("which")) $(".hex", tr).value = ownColour(row.source);
    row.own = true;
    setRow(row, ruleOf(row));
    followDefault();
    saveRules();
  });
  // a new app: named first, then it's a row like any other
  const src = $(".src", tr);
  if (src)
    src.addEventListener("change", () => {
      const name = src.value.trim().toLowerCase();
      if (!name || rows.has(name)) return (appsNote.textContent = name ? `${name} is already in the list` : "");
      rows.delete(row.source);
      row.source = name;
      rows.set(name, row);
      src.replaceWith(Object.assign(document.createElement("span"), { textContent: name }));
      setRow(row, ruleOf(row));
      saveRules();
    });
  $(".try", tr)?.addEventListener("click", () => sendSignal({ source: row.source || "test", kind: "new" }));
  $(".reset", tr).addEventListener("click", () => {
    row.own = false;
    followDefault();
    saveRules();
  });
  $(".del", tr)?.addEventListener("click", () => {
    rows.delete(row.source);
    tr.remove();
    saveRules();
  });
  // "every app" stays last
  const every = rows.get("*")?.tr;
  if (every && every !== tr) appsBody.insertBefore(tr, every);
  else appsBody.append(tr);
  followDefault();
  return row;
}

function readRules() {
  const out = [];
  for (const row of rows.values()) {
    if (!row.source || !row.own) continue;
    const r = ruleOf(row);
    // the default row is only saved when it differs from the built-in one
    if (row.source === "*" && r.on_new === "pulse" && !r.colour && r.count) continue;
    out.push({ source: row.source, ...r });
  }
  return out;
}
async function saveRules() {
  try {
    await invoke("set_rules", { rules: readRules() });
    appsNote.textContent = "saved";
    setTimeout(() => appsNote.textContent === "saved" && (appsNote.textContent = ""), 1500);
  } catch (e) {
    appsNote.textContent = String(e);
  }
}
function showRules(rules = []) {
  const star = rules.find((r) => r.source === "*");
  appRow("*", { rule: star ?? DEFAULT_RULE });
  for (const [id, name] of KNOWN) appRow(id, { name, rule: rules.find((r) => r.source === id) });
  for (const r of rules) if (r.source !== "*" && !rows.has(r.source)) appRow(r.source, { custom: true, rule: r });
  followDefault();
}
$("#add-app").addEventListener("click", () => {
  const row = appRow("", { custom: true });
  $(".src", row.tr)?.focus();
});

// ---- refreshing what the apps page shows (every 2 s while it's open) ----
async function refreshApps() {
  if ($("#page-apps").hidden) return;
  try {
    const list = await invoke("connectors_state");
    if (!list.length) connectorsEl.textContent = IN_APP ? "none on this computer yet" : "open Settings from the AfterGlow tray to see these";
    list.forEach(connectorBlock);
    (await invoke("accounts_state")).forEach(accountFields);
    if ($('[data-id="steam"]', connectorsEl)) steamFields(await invoke("steam_state"));
    const waiting = await invoke("unread_by_app");
    for (const row of rows.values()) $(".waiting", row.tr).textContent = waiting[row.source] ? String(waiting[row.source]) : "";
    // apps that turned up through a connector but aren't listed yet
    for (const source of Object.keys(waiting)) if (source !== "simulator" && !rows.has(source)) appRow(source, { custom: true });
  } catch (e) {
    connectorsEl.textContent = String(e);
  }
}
setInterval(refreshApps, 2000);

// ---- try it: the simulator (signals.rs send_signal) ----
// The "waiting" buttons keep their own count, sent as the "simulator" app's
// unread count (added to any real apps' counts)
let simWaiting = 0;
const waitingNote = $("#waiting");
async function sendSignal(signal) {
  try {
    await invoke("send_signal", { signal });
  } catch (e) {
    waitingNote.textContent = String(e);
  }
}
$$("[data-signal]").forEach((b) => b.addEventListener("click", () => sendSignal(JSON.parse(b.dataset.signal))));
$$("[data-waiting]").forEach((b) =>
  b.addEventListener("click", () => {
    simWaiting = Number(b.dataset.waiting) === 0 ? 0 : simWaiting + Number(b.dataset.waiting);
    waitingNote.textContent = simWaiting ? `${simWaiting} waiting` : "";
    sendSignal(simWaiting ? { source: "simulator", kind: "unread", count: simWaiting } : { source: "simulator", kind: "clear" });
  }),
);

// =========================== activity ===========================
// Settings → activity (signals.rs activity_log): every signal, newest first
const actShow = $$('input[name="activity-show"]');
let actLast = [];
const SHOWN = /^(pulse|flash|replayed)/;
const clockOf = (ms) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString([], { hour12: false });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
};
function renderActivity() {
  const glows = (actShow.find((i) => i.checked)?.value ?? "glows") === "glows";
  const rows = glows ? actLast.filter((e) => e.kind === "new" || e.kind === "flash") : actLast;
  // by app: how many showed, how many were held or ignored, and the last time
  const apps = new Map();
  for (const e of actLast) {
    if (e.kind !== "new" && e.kind !== "flash") continue;
    const a = apps.get(e.source) ?? { shown: 0, held: 0, last: e.at };
    if (SHOWN.test(e.result)) a.shown++;
    else a.held++;
    a.last = Math.max(a.last, e.at);
    apps.set(e.source, a);
  }
  $("#act-apps tbody").innerHTML =
    [...apps]
      .sort((x, y) => y[1].last - x[1].last)
      .map(([src, a]) => `<tr><td class="name">${esc(src)}</td><td>${a.shown}</td><td class="${a.held ? "" : "dim"}">${a.held}</td><td class="dim">${clockOf(a.last)}</td></tr>`)
      .join("") || '<tr><td class="dim" colspan="4">nothing yet</td></tr>';
  const shown = rows.slice(0, 200);
  $("#act-log tbody").innerHTML =
    shown
      .map((e) => `<tr><td class="dim" style="white-space:nowrap">${clockOf(e.at)}</td><td class="name">${esc(e.source)}</td><td>${esc(e.kind)}</td><td class="dim">${e.count ?? ""}</td><td class="${SHOWN.test(e.result) ? "" : "dim"}">${esc(e.result)}</td></tr>`)
      .join("") || '<tr><td class="dim" colspan="5">nothing yet</td></tr>';
  $("#act-note").textContent = rows.length > 200 ? `showing the latest 200 of ${rows.length}` : `${rows.length} shown`;
}
async function refreshActivity() {
  if ($("#page-activity").hidden) return;
  try {
    actLast = await invoke("activity_log");
    renderActivity();
  } catch (e) {
    $("#act-note").textContent = String(e);
  }
}
actShow.forEach((i) => i.addEventListener("change", renderActivity));
$("#act-clear").addEventListener("click", () => invoke("clear_activity").then(refreshActivity));
setInterval(refreshActivity, 2000);

// =========================== pausing ===========================
const pauseBoxes = $$("[data-pause]");
const pausingNote = $("#pausing-note");
const pauseBox = (k) => pauseBoxes.find((b) => b.dataset.pause === k).checked;
pauseBoxes.forEach((b) =>
  b.addEventListener("change", () =>
    invoke("set_pausing", { covered: pauseBox("covered"), fullscreen: pauseBox("fullscreen"), battery: pauseBox("battery"), quietDnd: pauseBox("quiet_dnd") }).catch((e) => (pausingNote.textContent = String(e))),
  ),
);
$("#autostart").addEventListener("change", async (e) => {
  try {
    e.target.checked = await invoke("set_autostart", { on: e.target.checked });
  } catch (err) {
    pausingNote.textContent = String(err);
  }
});
function showPausing(s) {
  const v = { covered: s.pause_covered, fullscreen: s.pause_fullscreen, battery: s.pause_on_battery, quiet_dnd: s.quiet_dnd };
  pauseBoxes.forEach((b) => (b.checked = v[b.dataset.pause] ?? true));
}

// =========================== performance ===========================
const fpsInputs = $$('input[name="fps"]');
fpsInputs.forEach((input) => input.addEventListener("change", () => input.checked && invoke("set_fps", { fps: Number(input.value) })));
const renderInputs = $$('input[name="render"]');
function showRunning(pref) {
  const { gpu, text } = describe(pref);
  $("#running").textContent = text;
  $("#running").className = gpu ? "on" : "";
}
renderInputs.forEach((input) =>
  input.addEventListener("change", () => {
    if (!input.checked) return;
    invoke("set_renderer", { renderer: input.value });
    settings.renderer = input.value;
    showRunning(input.value);
    paintStatus();
  }),
);

// =========================== about ===========================
if (IN_APP)
  import("@tauri-apps/api/app").then(async ({ getVersion }) => {
    const v = `AfterGlow v${await getVersion()}`;
    $("#version").textContent = v.toLowerCase();
    $("#about-version").textContent = v;
  });
$("#open-log").addEventListener("click", () => invoke("open_log").catch((e) => ($("#log-note").textContent = String(e))));
$("#copy-curl").addEventListener("click", async (e) => {
  try {
    await navigator.clipboard.writeText($("#curl").textContent);
    e.target.textContent = "copied";
    setTimeout(() => (e.target.textContent = "copy"), 1500);
  } catch {}
});
$$("a[href^='https://']").forEach((a) =>
  a.addEventListener("click", (e) => {
    if (!IN_APP) return;
    e.preventDefault();
    invoke("open_link", { url: a.href });
  }),
);

// =========================== load ===========================
// Fill every page from what's saved. Again when the window comes back to
// the front, so changes made in the tray menu show here too.
let first = true;
async function load() {
  const saved = await invoke("get_settings");
  settings = { wallpaper: saved.wallpaper ?? "jellyfish", options: saved.options ?? {}, renderer: saved.renderer ?? "auto" };
  const fps = String(saved.fps ?? 30);
  fpsInputs.forEach((input) => (input.checked = input.value === fps));
  renderInputs.forEach((input) => (input.checked = input.value === settings.renderer));
  showRunning(settings.renderer);
  showRotation(saved.rotate);
  showClock(saved.clock);
  $("#scramble").checked = saved.scramble ?? true;
  showPausing(saved);
  $("#autostart").checked = await invoke("autostart_state");
  if (first) {
    showRules(saved.rules ?? []);
    for (const [id, card] of cards) {
      const mine = settings.options[id] ?? {};
      for (const [key, sel] of card.selects) sel.value = mine[key] ?? "";
      nameHues(card);
      card.preview.src = previewSrc(id, optionsOf(card));
    }
    first = false;
  }
  markShowing();
  paintStatus();
}
addEventListener("focus", () => load().catch(() => {}));
show();

// ---- the terminal look (terminal.js): text controls, the command on the
// prompt line, the status bar and the boot lines ----
const fpsNow = () => fpsInputs.find((i) => i.checked)?.value;
startTerminal({
  invoke,
  status: () => ({
    wallpaper: WALLPAPERS.find((w) => w.id === settings.wallpaper)?.name ?? settings.wallpaper,
    tint: settings.options[settings.wallpaper]?.tint || "",
    fps: fpsNow(),
    gpu: describe(settings.renderer).gpu,
  }),
  bootLines: () => [
    "loading settings",
    `${WALLPAPERS.length} wallpapers, ${SOON.length} on the way`,
    `renderer: ${describe(settings.renderer).gpu ? "gpu" : "cpu"}`,
    "listening for your apps",
  ],
});
$("#boot").checked = bootOn();
$("#boot").addEventListener("change", (e) => setBoot(e.target.checked));
load();
