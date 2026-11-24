// The Settings window: a sidebar of pages (wallpaper, clock, apps, power,
// activity, general, about), one shown at a time, chosen by the URL hash.
//
// In the app every change goes straight to Rust (invoke):
//   settings.rs   get_settings, set_wallpaper, set_fps, set_renderer
//   extras.rs     set_rotation, save_png, open_stills_folder, open_link
//   apps.rs       apps_state, set_app, add_app, … (appspage.js)
//   signals.rs    send_signal, unread_by_app
//   host.rs       power_state, set_paused (powerpage.js)
//   tray.rs       set_pausing, autostart_state, set_autostart
//   connectors/   connectors_state, set_connector, accounts_state, set_client,
//                 account_sign_in, account_sign_out
// Opened in a plain browser (bun run dev, localhost:5173), a stand-in keeps
// the settings in localStorage so the page can be designed there.

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import { WALLPAPERS, HUE_NAMES, TAGS, DETAILS, queryFor } from "./wallpapers/catalog.js";
import { describe } from "./wallpapers/gpu.js";
import { startApps } from "./appspage.js";
import { startPower, attempt } from "./powerpage.js";
import { startActivity } from "./activitypage.js";
import { startClock } from "./clockpage.js";
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
    case "set_oled":
      s.oled = a.on;
      s.oled_minutes = a.minutes;
      return save();
    case "set_check_updates":
      s.check_updates = a.on;
      return save();
    case "update_state":
      return { state: "ready", version: "9.9.9", text: "9.9.9 is ready: restart to update" };
    case "set_rotation":
      s.rotate = { on: a.on, minutes: a.minutes, walls: a.walls };
      return save();
    case "set_pausing":
      Object.assign(s, { pause_covered: a.covered, pause_fullscreen: a.fullscreen, pause_on_battery: a.battery, quiet_dnd: a.quietDnd });
      return save();
    // sample connectors, so the apps page and its guides can be designed here
    // (localStorage afterglow:listener = denied | ask | unsupported shows those)
    case "connectors_state": {
      const on = s.connectors ?? {};
      const listen = localStorage.getItem("afterglow:listener") ?? "ok";
      const text = { ok: "watching", denied: 'Turn on AfterGlow under "Allow apps to access your notifications". This page notices by itself.', ask: "Choose Allow when Windows asks.", unsupported: "This PC doesn't let this version of AfterGlow see notifications. The connections below still work." }[listen];
      return [
        { id: "notifications", name: "Windows notifications", on: !!on.notifications, status: { state: listen, text } },
        { id: "gmail", name: "Gmail", on: !!on.gmail, status: { state: "setup", text: "not signed in" } },
        { id: "outlook", name: "Outlook", on: !!on.outlook, status: { state: "setup", text: "not signed in" } },
        { id: "spotify", name: "Spotify", on: !!on.spotify, status: { state: "setup", text: "not signed in" } },
        { id: "steam", name: "Steam", on: !!on.steam, status: { state: "ok", text: "watching for Steam chat messages" } },
      ];
    }
    case "set_connector":
      s.connectors = { ...(s.connectors ?? {}), [a.id]: a.on };
      return save();
    case "set_client":
    case "account_sign_in":
    case "account_sign_out":
    case "preview_app":
    case "send_signal":
      return null;
    case "set_steam":
      s.steam = { messages: a.messages, online: a.online, playing: a.playing, steamid: a.steamid };
      return save();
    case "apps_state": {
      const app = (source, name, own_colour, waiting, min, allowed = true) => ({ source, name, allowed, on_new: "pulse", colour: "", own_colour, count: true, seen: min ? Date.now() - min * 60000 : 0, waiting });
      const sample = [app("whatsapp", "WhatsApp", "#25d366", 2, 3), app("discord", "Discord", "#5865f2", 1, 20), app("slack", "Slack", "#e01e5a", 0, 1500), app("onedrive", "OneDrive", "#33ff99", 0, 90, false), app("snipping-tool", "Snipping Tool", "#33ff99", 1, 60, false)];
      return { new_apps_blocked: !!s.newBlocked, setup_done: !!s.setupDone, apps: [...sample, ...(s.added ?? [])].map((x) => ({ ...x, ...(s.appChoices?.[x.source] ?? {}) })) };
    }
    case "set_app":
      s.appChoices = { ...(s.appChoices ?? {}), [a.source]: { allowed: a.allowed, on_new: a.onNew, colour: a.colour, count: a.count } };
      return save();
    case "add_app": {
      const source = a.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      s.added = [...(s.added ?? []), { source, name: a.name.trim(), allowed: true, on_new: "pulse", colour: "", own_colour: "#33ff99", count: true, seen: 0, waiting: 0 }];
      save();
      return source;
    }
    case "set_new_apps":
      s.newBlocked = a.blocked;
      return save();
    case "finish_apps_setup":
      s.setupDone = true;
      return save();
    case "accounts_state":
      return ["gmail", "outlook", "spotify"].map((id) => ({ id, client_id: "", has_secret: false, signed_in: false }));
    case "steam_state":
      return { messages: true, online: false, playing: false, steamid: "", has_key: false, can_messages: true, ...(s.steam ?? {}) };
    case "unread_by_app":
      return {};
    // sample signals, so the activity page can be designed here
    case "activity_log": {
      const now = Date.now();
      let id = 0;
      const e = (ago, source, kind, count, outcome, colour = "") => ({ id: id++, at: now - ago * 1000, source, kind, count, outcome, colour });
      return [
        e(8, "slack", "new", null, "pulse", "#e01e5a"),
        e(8, "slack", "unread", 2, "counted"),
        e(95, "whatsapp", "new", null, "held-away", "#25d366"),
        e(120, "discord", "new", null, "held-dnd", "#5865f2"),
        e(140, "spotify", "new", null, "flash"),
        e(300, "onedrive", "new", null, "blocked"),
        e(420, "whatsapp", "new", null, "replayed", "#25d366"),
        e(86400 * 2, "steam", "new", null, "pulse", "#66c0f4"),
      ];
    }
    case "power_state":
      return { paused: !!s.paused, screens: [{ w: 2560, h: 1440, reason: s.paused ? "you" : "", renderer: "gpu" }, { w: 1080, h: 1920, reason: s.paused ? "you" : "covered", renderer: "cpu" }], has_battery: false, os: /Mac/.test(navigator.userAgent) ? "macos" : "windows", cpu: 1.24 };
    case "set_paused":
      s.paused = a.on;
      return save();
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
const PAGES = ["wallpaper", "clock", "apps", "power", "activity", "general", "about"];
function show() {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "wallpaper";
  for (const s of $$("main > section")) s.hidden = s.dataset.page !== page;
  for (const a of $$(".side a")) a.setAttribute("aria-current", a.dataset.page === page ? "page" : "false");
  $("#cmd").textContent = page;
  document.body.dataset.page = page; // the wallpaper panel shows on its page only
  $("main").scrollTop = 0;
  document.dispatchEvent(new Event("page-shown")); // appspage, powerpage, activitypage
}
addEventListener("hashchange", show);

let settings = { wallpaper: "jellyfish", options: {}, renderer: "auto" };

// =========================== wallpaper ===========================
const cards = new Map(); // id -> { el, preview, selects, button }

function optionsOf(card) {
  const o = {};
  for (const [key, sel] of card.selects) {
    if (sel.type === "color") {
      // a colour only counts while its menu asks for it; without the #, it's URL-safe
      const [other, value] = sel.when;
      if (card.selects.get(other)?.value === value) o[key] = sel.value.slice(1);
    } else if (sel.value) o[key] = sel.value;
  }
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

// A card is small: a live preview, the name, one line. A click opens the side
// panel with the rest: what it is, its options, use this / save a still, then
// how it reacts (catalog.js DETAILS). Each wallpaper's panel contents are built
// once, inside the panel, and only the open one shows (terminal.js turns every
// select already in the page into a cycler when it starts).
const panel = $("#wall-panel"), panelPreview = $("#panel-preview");
let openId = null;
const bigSrc = (id, options) => {
  const q = queryFor(options);
  return `/wallpapers/${id}.html?hover=0&fps=15${q ? `&${q}` : ""}`;
};
// "2/5" beside each selector: which choice of how many
function positions(card) {
  for (const sel of card.selects.values()) {
    if (sel.type === "color") {
      const [other, value] = sel.when;
      sel.closest("label").hidden = card.selects.get(other)?.value !== value;
      continue;
    }
    const shown = [...sel.options].filter((o) => !o.hidden);
    sel.closest("label").dataset.pos = `${shown.indexOf(sel.selectedOptions[0]) + 1}/${shown.length}`;
  }
}
function openPanel(id) {
  const card = cards.get(id);
  if (!card) return;
  openId = id;
  positions(card);
  for (const [cid, c] of cards) {
    c.el.classList.toggle("open", cid === id);
    c.detail.hidden = cid !== id;
  }
  panelPreview.src = bigSrc(id, optionsOf(card));
  panel.hidden = false;
  document.body.classList.add("panel-open");
  panel.scrollTop = 0;
}
function closePanel() {
  openId = null;
  panel.hidden = true;
  panelPreview.src = "about:blank";
  document.body.classList.remove("panel-open");
  for (const c of cards.values()) c.el.classList.remove("open");
}
$("#panel-close").addEventListener("click", closePanel);
const WIDE = matchMedia("(min-width: 1000px)"); // keep in step with style.css
const reactsRow = (label, text) => (text ? `<dt>${label}</dt><dd>${text}</dd>` : "");

for (const w of WALLPAPERS) {
  const d = DETAILS[w.id] ?? {};
  const el = document.createElement("article");
  el.className = "card";
  el.tabIndex = 0;
  el.innerHTML = `
    <div class="preview"><iframe title="${w.name} preview" tabindex="-1" loading="lazy"></iframe></div>
    <div class="body">
      <h3>${w.name}</h3>
      <p class="dim about">${w.about}</p>
    </div>`;
  const detail = document.createElement("div");
  detail.className = "wall-detail";
  detail.hidden = true;
  detail.innerHTML = `
    <h3>${w.name}</h3>
    <p class="long">${d.about ?? w.about}</p>
    <h4>settings</h4>
    <div class="opts"></div>
    <div class="actions"><button type="button" class="use"></button> <button type="button" class="still">save a still</button></div>
    <h4>how it reacts</h4>
    <dl>${reactsRow("new message", d.message)}${reactsRow("waiting apps", d.waiting)}${reactsRow("many unread", d.many)}${reactsRow("flash", d.flash)}${reactsRow("hover", d.hover)}</dl>`;
  const opts = $(".opts", detail);
  const selects = new Map();
  for (const o of w.options) {
    const label = document.createElement("label");
    label.innerHTML = `<span class="dim">${o.label}</span>`;
    const sel = document.createElement(o.type === "color" ? "input" : "select");
    if (o.type === "color") Object.assign(sel, { type: "color", value: o.value, when: o.when });
    else for (const [value, text] of o.choices) sel.add(new Option(text, value));
    label.append(sel);
    opts.append(label);
    selects.set(o.key, sel);
  }
  el.dataset.tag = w.tag ?? "";
  const card = { el, preview: $("iframe", el), selects, button: $(".use", detail), detail };
  cards.set(w.id, card);
  for (const sel of selects.values())
    sel.addEventListener("change", () => {
      nameHues(card);
      positions(card);
      card.preview.src = previewSrc(w.id, optionsOf(card));
      if (openId === w.id) panelPreview.src = bigSrc(w.id, optionsOf(card));
      if (settings.wallpaper === w.id) choose(w.id); // the one showing changes straight away
    });
  card.button.addEventListener("click", () => choose(w.id));
  $(".still", detail).addEventListener("click", (e) => saveStill(w.id, e.currentTarget));
  el.addEventListener("click", () => openPanel(w.id));
  el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openPanel(w.id)));
  $("#cards").append(el);
  $("#wall-details").append(detail);
}

// Coming soon: wallpapers on their way, as dim tiles
// with a sketch, so the picker shows there's more to come
const SOON = [
  { name: "black hole", tag: "sky", about: "Light bending round a black hole, traced ray by ray.", art: "  .   *    .\n   .-~~~~-.\n  ( ( @@ ) )\n   '-~~~~-'\n .    *   ." },
  { name: "cats", tag: "creatures", about: "Glowing text-art cats, asleep, in families, dancing.", art: "  /\\_/\\\n ( -.- )\n  > ^ <\n (__)_)~" },
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
  el.dataset.tag = w.tag;
  $("#cards").append(el);
}

// Tabs over the cards (the list had grown long): all, or one kind of
// wallpaper (catalog.js TAGS, each card's data-tag); the choice is remembered
const TAB_KEY = "afterglow:wallpaper-tab";
const tabsEl = $("#wall-tabs");
function showTab(tag) {
  for (const b of tabsEl.children) b.setAttribute("aria-selected", String(b.dataset.tag === tag));
  for (const el of $("#cards").children) el.hidden = !!tag && el.dataset.tag !== tag;
  localStorage.setItem(TAB_KEY, tag);
}
for (const tag of ["", ...TAGS]) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.tag = tag;
  b.setAttribute("role", "tab");
  b.textContent = tag || "all";
  b.title = `${[...$("#cards").children].filter((el) => !tag || el.dataset.tag === tag).length} wallpapers`;
  b.addEventListener("click", () => showTab(tag));
  tabsEl.append(b);
}
const savedTab = localStorage.getItem(TAB_KEY) ?? "";
showTab(["", ...TAGS].includes(savedTab) ? savedTab : "");

// A preview only runs while you can see it: on screen, with this window in
// front. (Each is a whole wallpaper; a dozen kept drawing behind other windows.)
const onScreen = new WeakMap(); // iframe -> bool
const previewFrames = () => $$(".preview iframe");
function tellPreview(f) {
  const value = document.hidden || !document.hasFocus() || onScreen.get(f) === false;
  f.contentWindow?.postMessage({ type: "paused", value }, location.origin);
}
const seenPreviews = new IntersectionObserver((entries) => {
  for (const e of entries) {
    onScreen.set(e.target, e.isIntersecting);
    tellPreview(e.target);
  }
});
for (const f of previewFrames()) {
  seenPreviews.observe(f);
  f.addEventListener("load", () => tellPreview(f)); // a new page starts running
}
for (const type of ["focus", "blur"]) addEventListener(type, () => previewFrames().forEach(tellPreview));
document.addEventListener("visibilitychange", () => previewFrames().forEach(tellPreview));

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
const clockPage = startClock({ invoke, settings: () => settings }); // clockpage.js

// Hover scramble on or off (settings.rs set_scramble; the wallpaper reloads)
$("#scramble").addEventListener("change", (e) => invoke("set_scramble", { on: e.target.checked }).catch((err) => (stillNote.textContent = String(err))));

// OLED care on or off (settings.rs set_oled)

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
startApps({ invoke, inApp: IN_APP }); // appspage.js

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
startActivity({ invoke }); // activitypage.js

// =========================== power (and the quiet rule on apps) ===========================
const power = startPower({ invoke, inApp: IN_APP }); // powerpage.js
const powerNote = $("#power-note");
const pauseBoxes = $$("[data-pause]");
const pauseBox = (k) => pauseBoxes.find((b) => b.dataset.pause === k).checked;
pauseBoxes.forEach((b) =>
  b.addEventListener("change", () =>
    attempt(
      invoke("set_pausing", { covered: pauseBox("covered"), fullscreen: pauseBox("fullscreen"), battery: pauseBox("battery"), quietDnd: pauseBox("quiet_dnd") }),
      () => (b.checked = !b.checked),
      b.dataset.pause === "quiet_dnd" ? $("#quiet-note") : powerNote,
    ),
  ),
);
function showPausing(s) {
  const v = { covered: s.pause_covered, fullscreen: s.pause_fullscreen, battery: s.pause_on_battery, quiet_dnd: s.quiet_dnd };
  pauseBoxes.forEach((b) => (b.checked = v[b.dataset.pause] ?? true));
}
const fpsInputs = $$('input[name="fps"]');
const renderInputs = $$('input[name="render"]');
// a radio that couldn't be saved goes back to the saved choice
fpsInputs.forEach((input) => input.addEventListener("change", () => input.checked && attempt(invoke("set_fps", { fps: Number(input.value) }), load, powerNote)));
renderInputs.forEach((input) =>
  input.addEventListener("change", () => {
    if (!input.checked) return;
    settings.renderer = input.value;
    attempt(invoke("set_renderer", { renderer: input.value }), load, powerNote);
    paintStatus();
  }),
);
const oledBox = $("#oled");
const oledMinutes = $("#oled-minutes");
function showOled() {
  $("#oled-more").hidden = !oledBox.checked;
}
[oledBox, oledMinutes].forEach((el) =>
  el.addEventListener("change", () => {
    showOled();
    attempt(invoke("set_oled", { on: oledBox.checked, minutes: Number(oledMinutes.value) }), load, powerNote);
  }),
);

// =========================== general ===========================
const generalNote = $("#general-note");
$("#autostart").addEventListener("change", (e) =>
  attempt(invoke("set_autostart", { on: e.target.checked }), () => (e.target.checked = !e.target.checked), generalNote).then((on) => {
    if (typeof on === "boolean") e.target.checked = on;
  }),
);

// =========================== updates (general) and about ===========================
if (IN_APP)
  import("@tauri-apps/api/app").then(async ({ getVersion }) => {
    const v = `AfterGlow v${await getVersion()}`;
    $("#version").textContent = v.toLowerCase();
    $("#about-version").textContent = v;
  });
// Updates (updates.rs): what it's doing, read every 2 s while general is showing
const updateText = $("#update-text");
async function showUpdate() {
  const u = await invoke("update_state").catch(() => null);
  if (!u) return;
  updateText.textContent = u.text;
  $("#update-install").hidden = u.state !== "ready";
  $("#update-check").hidden = ["ready", "off"].includes(u.state);
  $("#update-check").disabled = ["checking", "downloading"].includes(u.state);
}
$("#update-check").addEventListener("click", () => invoke("check_update").then(() => setTimeout(showUpdate, 200)).catch((e) => (updateText.textContent = String(e))));
$("#update-install").addEventListener("click", (e) => {
  e.currentTarget.disabled = true;
  updateText.textContent = "restarting…";
  invoke("install_update").catch((err) => (updateText.textContent = String(err)));
});
$("#check-updates").addEventListener("change", (e) => attempt(invoke("set_check_updates", { on: e.target.checked }), () => (e.target.checked = !e.target.checked), generalNote));
showUpdate();
setInterval(() => !$("#page-general").hidden && !$("#update-install").disabled && showUpdate(), 2000);

$("#open-log").addEventListener("click", () => invoke("open_log").catch((e) => ($("#log-note").textContent = String(e))));
$("#report").addEventListener("click", () => {
  const url = "https://github.com/wajenaqv/afterglow/issues/new";
  if (IN_APP) invoke("open_link", { url }).catch((e) => ($("#log-note").textContent = String(e)));
  else window.open(url, "_blank", "noopener");
});
$("#copy-details").addEventListener("click", async () => {
  const note = $("#log-note");
  try {
    const s = await invoke("get_settings");
    const p = await invoke("power_state");
    const connectors = await invoke("connectors_state");
    const lines = [
      $("#about-version").textContent,
      `system: ${p.os}, ${navigator.userAgent}`,
      `wallpaper: ${s.wallpaper} ${JSON.stringify(s.options?.[s.wallpaper] ?? {})}, ${s.fps} fps, rendering ${s.renderer}`,
      ...p.screens.map((m, i) => `monitor ${i + 1}: ${m.w}x${m.h}, ${m.renderer || "no renderer"}, ${m.reason || "running"}`),
      `graphics: ${describe("auto").text}`,
      `pause: covered ${s.pause_covered}, fullscreen ${s.pause_fullscreen}, battery ${s.pause_on_battery}; quiet ${s.quiet_dnd}; oled ${s.oled}`,
      // only the state: the text can hold a song's name
      `connections: ${connectors.map((c) => `${c.id} ${c.on ? (c.status?.state ?? "starting") : "off"}`).join(", ")}`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    note.textContent = "copied";
  } catch (e) {
    note.textContent = String(e);
  }
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
  showRotation(saved.rotate);
  clockPage.show(saved.clock);
  $("#scramble").checked = saved.scramble ?? true;
  oledBox.checked = saved.oled ?? false;
  oledMinutes.value = String(saved.oled_minutes ?? 5);
  showOled();
  $("#check-updates").checked = saved.check_updates ?? true;
  showPausing(saved);
  $("#autostart").checked = await invoke("autostart_state");
  if (first) {
    for (const [id, card] of cards) {
      const mine = settings.options[id] ?? {};
      for (const [key, sel] of card.selects) {
        if (sel.type !== "color") sel.value = mine[key] ?? "";
        else if (mine[key]) sel.value = `#${mine[key]}`;
      }
      nameHues(card);
      positions(card);
      card.preview.src = previewSrc(id, optionsOf(card));
    }
    // start with the one showing open, when there's room for the panel beside
    // the cards (on a narrow window it would hide them)
    if (WIDE.matches) openPanel(settings.wallpaper);
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
    // what the wallpapers report, else what this choice should give
    gpu: power.last()?.screens.find((m) => m.renderer)?.renderer === "cpu" ? false : describe(settings.renderer).gpu,
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
