// Settings → apps. Three parts, refreshed every 2 s while the page is open:
//   the listener      one switch for Windows notifications (macOS: Dock
//                     badges), with a plain line when the system refuses.
//                     The first time, a three-step card stands in its place;
//                     it ends when a real message has been heard.
//   your apps         every app heard from (apps.rs): ticked = allowed,
//                     unticked = blocked; "customize" opens its choices
//   more connections  Steam, Spotify, Gmail, Outlook: "connect" opens the
//                     guide (guides.js) one step at a time
// Rows are made once and then updated in place, never while you're in one of
// their fields, so the refresh doesn't fight your typing.

import { GUIDES } from "./guides.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};

// Colours offered besides the app's own (data, like the app colours in apps.rs)
const SWATCHES = ["#25d366", "#58a6ff", "#8f7bff", "#ff5fa2", "#ff5a4f", "#ffb454", "#33ff99"];

const LISTENERS = {
  notifications: {
    name: "Windows notifications",
    allow: "choose Allow if Windows asks",
    settings: ["open Windows settings", "ms-settings:privacy-notifications"],
    denied: "Windows isn't letting AfterGlow see notifications",
    how: "When an app sends you a notification, the wallpaper lights up in its colour.",
  },
  dock: {
    name: "Dock badges",
    allow: "turn on AfterGlow in System Settings when macOS asks",
    settings: ["open System Settings", "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"],
    denied: "macOS isn't letting AfterGlow see Dock badges",
    how: "When an app gets a red badge in the Dock, the wallpaper lights up in its colour.",
  },
};
const CONNECTIONS = {
  steam: "chat messages, no account needed",
  spotify: "a pulse on each new song · needs Premium",
  gmail: "exact unread count · advanced, 5 min",
  outlook: "exact unread count · advanced, 3 min",
};

export function startApps({ invoke, inApp }) {
  const page = $("#page-apps");
  const note = $("#apps-note");
  const fail = (e) => setText(note, String(e));
  let state = { apps: [], setup_done: true, new_apps_blocked: false };
  let listener = null;

  // ---- the listener and the first-time card ----
  let workingSince = 0; // when this window first saw the listener working
  let heardName = "";
  const turn = (on) => listener && invoke("set_connector", { id: listener.id, on }).then(refresh).catch(fail);
  $("#listen-on").addEventListener("change", (e) => turn(e.target.checked));
  $("#setup-on").addEventListener("click", () => turn(true));
  for (const id of ["#setup-done", "#setup-skip"]) $(id).addEventListener("click", () => invoke("finish_apps_setup").then(refresh).catch(fail));
  $("#listen-fix").addEventListener("click", () => {
    const st = listener?.status?.state;
    if (st === "denied") openLink(LISTENERS[listener.id].settings[1]);
    else turn(true); // the question again
  });

  function showListener() {
    const firstTime = !state.setup_done && !!listener;
    $("#setup").hidden = !firstTime;
    $("#listen").hidden = firstTime || !listener;
    $("#apps-main").hidden = firstTime;
    if (!listener) return void ($("#listen-problem").hidden = true);
    const about = LISTENERS[listener.id];
    const st = listener.on ? (listener.status?.state ?? "") : "off";
    const working = st === "ok";
    $("#listen-on").checked = listener.on;
    setText($("#listen-name"), `listen to ${about.name}`);
    const n = state.apps.length;
    setText($("#listen-status"), !listener.on ? "○ off: these apps can't light up" : working ? `● working · ${n} app${n === 1 ? "" : "s"} seen` : st === "off" || !st ? "starting…" : "○ needs you");
    $("#listen-status").dataset.state = working ? "ok" : "off";

    // what's wrong, in words, with a button where one helps
    const bad = ["denied", "ask", "unsupported", "setup", "error"].includes(st);
    $("#listen-problem").hidden = !bad;
    if (bad) {
      setText($("#listen-what"), st === "denied" ? about.denied : st === "ask" ? "waiting for your answer" : `${about.name} aren't available`);
      setText($("#listen-why"), listener.status.text);
      $("#listen-fix").hidden = !["denied", "ask"].includes(st);
      setText($("#listen-fix"), st === "denied" ? about.settings[0] : "ask again");
    }

    if (!firstTime) return;
    if (working && !workingSince) workingSince = Date.now();
    const heard = workingSince ? state.apps.find((a) => a.seen >= workingSince) : null;
    if (heard) heardName = heard.name;
    const step = heardName ? 3 : working ? 2 : listener.on ? 1 : 0;
    setText($("#setup-how"), about.how);
    setText($("#setup-s0"), `listen to ${about.name}`);
    setText($("#setup-s1"), about.allow);
    $$("#setup li").forEach((li, i) => {
      li.dataset.now = String(i === step);
      setText($(".mark-box", li), step > i ? "[x]" : i === step ? "[>]" : "[ ]");
    });
    $("#setup-on").hidden = step !== 0;
    $("#setup-wait").hidden = step !== 2;
    $("#setup-works").hidden = step !== 3;
    setText($("#setup-heard"), `It works: ${heardName} was heard.`);
    $("#setup-skip").hidden = step === 3;
  }

  // ---- your apps ----
  const list = $("#app-list");
  const find = $("#app-find");
  const rows = new Map(); // source -> { el, app }
  const ago = (ms) => {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    if (min < 60 * 24) return `${Math.floor(min / 60)} h ago`;
    const d = Math.floor(min / (60 * 24));
    return d === 1 ? "yesterday" : `${d} days ago`;
  };
  const about = (a) => (!a.allowed ? "blocked" : [a.waiting ? `${a.waiting} waiting` : "", a.seen ? ago(a.seen) : ""].filter(Boolean).join(" · ") || "nothing yet");

  function send(a) {
    run++; // a refresh already on its way would show the old choice
    paintRow(rows.get(a.source));
    return invoke("set_app", { source: a.source, allowed: a.allowed, onNew: a.on_new, colour: a.colour, count: a.count }).catch(fail);
  }
  function makeRow(a) {
    const el = document.createElement("div");
    el.className = "app-row";
    el.dataset.source = a.source;
    el.innerHTML = `
      <div class="app-head">
        <label><input type="checkbox" class="allow" /><span class="dot" aria-hidden="true"></span><span class="app-name"></span></label>
        <span class="app-status"></span>
        <button type="button" class="open" aria-expanded="false">customize</button>
      </div>
      <div class="app-more" hidden>
        <label>new message</label><span><select class="on" aria-label="new message"><option value="pulse">pulse</option><option value="flash">flash</option></select></span>
        <span class="col">colour</span><span class="col swatches"></span>
        <span>waiting messages</span><label><input type="checkbox" class="cnt" /> add to the scene</label>
        <span></span><span class="app-acts"><button type="button" class="preview-app">preview</button> <button type="button" class="normal">back to normal</button></span>
      </div>`;
    const row = { el, app: a };
    rows.set(a.source, row);
    $(".swatches", el).innerHTML =
      [...new Set([a.own_colour, ...SWATCHES])].map((c) => `<button type="button" class="swatch" data-c="${esc(c)}" style="--c: ${esc(c)}" aria-label="colour ${esc(c)}"></button>`).join("") +
      `<input type="color" class="hex" aria-label="another colour" title="another colour" />`;
    $(".allow", el).addEventListener("change", (e) => {
      row.app.allowed = e.target.checked;
      if (!row.app.allowed) openRow(row, false);
      send(row.app);
    });
    $(".open", el).addEventListener("click", () => openRow(row, $(".app-more", el).hidden));
    $(".on", el).addEventListener("change", (e) => {
      row.app.on_new = e.target.value;
      send(row.app);
    });
    $(".cnt", el).addEventListener("change", (e) => {
      row.app.count = e.target.checked;
      send(row.app);
    });
    const colour = (c) => {
      row.app.colour = c === row.app.own_colour ? "" : c;
      send(row.app);
    };
    $(".swatches", el).addEventListener("click", (e) => e.target.dataset.c && colour(e.target.dataset.c));
    $(".hex", el).addEventListener("change", (e) => colour(e.target.value));
    $(".preview-app", el).addEventListener("click", () => invoke("preview_app", { source: row.app.source }).catch(fail));
    $(".normal", el).addEventListener("click", () => {
      Object.assign(row.app, { on_new: "pulse", colour: "", count: true });
      send(row.app);
    });
    return row;
  }
  function openRow(row, open) {
    for (const r of rows.values()) {
      const on = r === row && open;
      $(".app-more", r.el).hidden = !on;
      $(".open", r.el).setAttribute("aria-expanded", String(on));
      setText($(".open", r.el), on ? "close" : "customize");
    }
  }
  function paintRow({ el, app }) {
    const now = app.colour || app.own_colour;
    el.style.setProperty("--c", now);
    el.classList.toggle("blocked", !app.allowed);
    $(".allow", el).checked = app.allowed;
    setText($(".app-name", el), app.name);
    setText($(".app-status", el), about(app));
    $(".app-status", el).classList.toggle("dim", !app.allowed || !app.waiting);
    $(".open", el).disabled = !app.allowed;
    $(".on", el).value = app.on_new;
    $(".cnt", el).checked = app.count;
    $$(".col", el).forEach((c) => (c.hidden = app.on_new !== "pulse"));
    $$(".swatch", el).forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.c === now)));
    if (document.activeElement !== $(".hex", el)) $(".hex", el).value = now;
  }
  function showApps() {
    const firstFill = !rows.size;
    const fresh = state.apps.filter((a) => !rows.has(a.source));
    // allowed first, then the latest; after that rows stay where they are
    // (only newcomers go on top), so nothing jumps while you're clicking
    fresh.sort((a, b) => b.allowed - a.allowed || b.seen - a.seen || a.name.localeCompare(b.name));
    const made = fresh.map((a) => makeRow(a).el);
    if (firstFill) list.append(...made);
    else list.prepend(...made);
    for (const a of state.apps) {
      const row = rows.get(a.source);
      row.app = a;
      const select = $(".on", row.el);
      if (document.activeElement !== select) paintRow(row);
    }
    $("#apps-none").hidden = state.apps.length > 0;
    const policy = $("#new-apps");
    if (document.activeElement !== policy) policy.value = state.new_apps_blocked ? "blocked" : "allowed";
    filter();
  }
  function filter() {
    const q = find.value.trim().toLowerCase();
    let exact = false;
    for (const { el, app } of rows.values()) {
      el.hidden = !!q && !app.name.toLowerCase().includes(q) && !app.source.includes(q);
      exact ||= app.name.toLowerCase() === q || app.source === q;
    }
    $("#app-add").hidden = !q || exact;
    setText($("#app-add-name"), find.value.trim());
  }
  find.addEventListener("input", filter);
  function addApp() {
    invoke("add_app", { name: find.value })
      .then((source) => {
        find.value = "";
        setText(note, "");
        return refresh().then(() => rows.get(source)?.el.scrollIntoView({ block: "nearest" }));
      })
      .catch(fail);
  }
  $("#app-add button").addEventListener("click", addApp);
  find.addEventListener("keydown", (e) => e.key === "Enter" && !$("#app-add").hidden && addApp());
  $("#new-apps").addEventListener("change", (e) => invoke("set_new_apps", { blocked: e.target.value === "blocked" }).catch(fail));

  // ---- more connections ----
  const conns = $("#connectors");
  const part = (p) => {
    if (typeof p === "string") return esc(p);
    if (p.b) return `<b>${esc(p.b)}</b>`;
    if (p.link) return `<a href="${esc(p.url)}" data-open="${esc(p.url)}">${esc(p.link)} ↗</a>`;
    if (p.copy) return `<code>${esc(p.copy)}</code><button type="button" class="copy" data-copy="${esc(p.copy)}">copy</button>`;
    return "";
  };
  const blocks = new Map(); // id -> { el, c, step }

  function makeConnection(c) {
    const el = document.createElement("div");
    el.className = "app-row connection";
    el.dataset.source = c.id;
    el.innerHTML = `
      <div class="app-head"><span class="app-name"></span><span class="app-status"></span><button type="button" class="open" aria-expanded="false"></button></div>
      <div class="guide wizard" hidden>
        <p class="dim"></p>
        <div class="step-of"></div>
        ${GUIDES[c.id].steps.map((s) => `<div class="step" hidden>${s.map(part).join("")}</div>`).join("")}
        <div class="fields-here"></div>
        <p class="wiz-note" role="status"></p>
        <div class="wiz-nav"><button type="button" class="back">back</button><button type="button" class="next">done, next</button><button type="button" class="off">disconnect</button></div>
      </div>`;
    const b = { el, c, step: 0 };
    blocks.set(c.id, b);
    $(".wizard > p", el).textContent = GUIDES[c.id].intro;
    $(".open", el).addEventListener("click", () => {
      const open = $(".wizard", el).hidden;
      for (const o of blocks.values()) $(".wizard", o.el).hidden = !(o === b && open);
      $(".wiz-note", el).textContent = "";
      refresh();
    });
    $(".back", el).addEventListener("click", () => ((b.step -= 1), paintConnection(b)));
    $(".next", el).addEventListener("click", () => ((b.step += 1), paintConnection(b)));
    $(".off", el).addEventListener("click", async () => {
      try {
        if (b.account?.signed_in) await invoke("account_sign_out", { id: c.id });
        await invoke("set_connector", { id: c.id, on: false });
        b.step = 0;
        $(".wizard", el).hidden = true;
        refresh();
      } catch (e) {
        $(".wiz-note", el).textContent = String(e);
      }
    });
    (c.id === "steam" ? steamFields : accountFields)(b);
    conns.append(el);
    return b;
  }
  function paintConnection(b) {
    const { el, c } = b;
    const ok = c.on && c.status?.state === "ok";
    const open = !$(".wizard", el).hidden;
    const last = GUIDES[c.id].steps.length - 1;
    // Steam's chat needs no guide: its steps only show for friends
    const steps = c.id !== "steam" || $(".st-online", el).checked || $(".st-playing", el).checked;
    if (b.account?.signed_in) b.step = last;
    b.step = Math.max(0, Math.min(last, b.step));
    setText($(".app-name", el), c.name);
    setText($(".app-status", el), ok ? `● ${c.status.text}` : c.on ? (c.status?.text ?? "starting…") : CONNECTIONS[c.id]);
    $(".app-status", el).classList.toggle("dim", !c.on);
    setText($(".open", el), open ? "close" : ok ? "change" : c.on ? "finish setup" : "connect");
    $(".open", el).setAttribute("aria-expanded", String(open));
    const done = b.account?.signed_in;
    $$(".step", el).forEach((s, i) => (s.hidden = !steps || done || i !== b.step));
    $(".step-of", el).hidden = !steps || done;
    setText($(".step-of", el), `step ${b.step + 1} of ${last + 1}`);
    $(".fields-here", el).hidden = c.id !== "steam" && !done && b.step !== last;
    $$(".st-friends", el).forEach((f) => (f.hidden = !steps));
    $(".back", el).hidden = !steps || done || b.step === 0;
    $(".next", el).hidden = !steps || done || b.step === last;
    $(".off", el).hidden = !c.on && !done;
    // why it isn't working stays readable while you fix it
    if (open && c.on && c.status?.state === "error") setText($(".wiz-note", el), c.status.text);
  }

  // Gmail, Outlook, Spotify: the client id (and Google's secret), then sign in
  function accountFields(b) {
    const id = b.c.id;
    const secret = id === "gmail" ? `<input class="secret" type="password" placeholder="client secret" autocomplete="off" aria-label="client secret" />` : "";
    const f = $(".fields-here", b.el);
    f.className += " account";
    f.innerHTML = `<input class="client" placeholder="client id" autocomplete="off" spellcheck="false" aria-label="client id" /> ${secret} <button type="button" class="signin use">sign in</button>`;
    $(".signin", f).addEventListener("click", async () => {
      const say = $(".wiz-note", b.el);
      const clientId = $(".client", f).value.trim();
      if (!clientId) return void (say.textContent = "paste the client id first");
      if (id === "gmail" && !$(".secret", f).value.trim() && !b.account?.has_secret) return void (say.textContent = "paste the client secret too");
      try {
        await invoke("set_client", { id, clientId, clientSecret: ($(".secret", f)?.value ?? "").trim() });
        if ($(".secret", f)) $(".secret", f).value = "";
        await invoke("set_connector", { id, on: true });
        await invoke("account_sign_in", { id });
        say.textContent = "finish signing in in your browser…";
        refresh();
      } catch (e) {
        say.textContent = String(e);
      }
    });
  }
  function paintAccount(a) {
    const b = blocks.get(a.id);
    if (!b) return;
    const justSigned = a.signed_in && b.account && !b.account.signed_in;
    b.account = a;
    const client = $(".client", b.el);
    if (document.activeElement !== client && !client.value) client.value = a.client_id;
    if ($(".secret", b.el)) $(".secret", b.el).placeholder = a.has_secret ? "client secret (saved)" : "client secret";
    setText($(".signin", b.el), a.signed_in ? "sign in again" : "sign in");
    if (justSigned) $(".wiz-note", b.el).textContent = "connected";
    paintConnection(b);
  }

  // Steam: chat works by itself; friends need a key and the profile. The key
  // is never filled back in (it's in the keychain).
  function steamFields(b) {
    const f = $(".fields-here", b.el);
    f.className += " account steam";
    f.innerHTML = `
      <label class="st-chat"><input type="checkbox" class="st-messages" /> chat messages</label>
      <label><input type="checkbox" class="st-online" /> friends coming online</label>
      <label><input type="checkbox" class="st-playing" /> friends starting a game</label>
      <div class="break"></div>
      <input class="st-id st-friends" placeholder="profile link or Steam ID" autocomplete="off" spellcheck="false" aria-label="Steam profile" />
      <input class="st-key st-friends" type="password" placeholder="Steam Web API key" autocomplete="off" aria-label="Steam Web API key" />
      <div class="break"></div>
      <button type="button" class="use st-save">connect Steam</button>`;
    // the steps go between the switches and the fields they explain
    b.el.querySelector(".step-of").before(f);
    f.addEventListener("change", () => paintConnection(b));
    $(".st-save", f).addEventListener("click", async () => {
      const say = $(".wiz-note", b.el);
      const friends = $(".st-online", f).checked || $(".st-playing", f).checked;
      const messages = $(".st-messages", f).checked && !$(".st-messages", f).disabled;
      if (!friends && !messages) return void (say.textContent = "tick at least one thing");
      if (friends && (!$(".st-id", f).value.trim() || (!$(".st-key", f).value.trim() && !b.steam?.has_key))) return void (say.textContent = "friends need your profile and key");
      say.textContent = "saving…";
      try {
        await invoke("set_steam", {
          messages: $(".st-messages", f).checked,
          online: $(".st-online", f).checked,
          playing: $(".st-playing", f).checked,
          steamid: $(".st-id", f).value,
          apiKey: $(".st-key", f).value,
        });
        $(".st-key", f).value = "";
        await invoke("set_connector", { id: "steam", on: true });
        b.steam = null; // fill in again from what was saved
        say.textContent = "connected";
        refresh();
      } catch (e) {
        say.textContent = String(e);
      }
    });
  }
  function paintSteam(st) {
    const b = blocks.get("steam");
    if (!b) return;
    if (!b.steam) {
      $(".st-messages", b.el).checked = st.messages && st.can_messages;
      $(".st-online", b.el).checked = st.online;
      $(".st-playing", b.el).checked = st.playing;
      $(".st-id", b.el).value = st.steamid;
    }
    b.steam = st;
    $(".st-messages", b.el).disabled = !st.can_messages;
    $(".st-chat", b.el).hidden = !st.can_messages;
    if (!st.can_messages) CONNECTIONS.steam = "friends online · 2 min";
    $(".st-key", b.el).placeholder = st.has_key ? "Steam Web API key (saved)" : "Steam Web API key";
    setText($(".st-save", b.el), b.c.on ? "save" : "connect Steam");
    paintConnection(b);
  }

  // Guide links open in the browser (or the system's settings); copy buttons copy
  function openLink(url) {
    if (inApp) invoke("open_link", { url }).catch(fail);
    else if (url.startsWith("https://")) window.open(url, "_blank", "noopener");
  }
  page.addEventListener("click", async (e) => {
    const link = e.target.closest("[data-open]");
    if (link) {
      e.preventDefault();
      return openLink(link.dataset.open);
    }
    const copy = e.target.closest("[data-copy]");
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.textContent = "copied";
      setTimeout(() => (copy.textContent = "copy"), 1500);
    } catch {}
  });

  // ---- refreshing ----
  let run = 0;
  async function refresh() {
    if (page.hidden) return;
    const mine = ++run;
    try {
      const [apps, connectors, accounts, steam] = await Promise.all([invoke("apps_state"), invoke("connectors_state"), invoke("accounts_state"), invoke("steam_state")]);
      if (mine !== run) return; // a later refresh is already on its way
      state = apps;
      listener = connectors.find((c) => LISTENERS[c.id]) ?? null;
      showListener();
      showApps();
      for (const id of Object.keys(CONNECTIONS)) {
        const c = connectors.find((x) => x.id === id);
        if (!c) continue;
        const b = blocks.get(id) ?? makeConnection(c);
        b.c = c;
        if (id === "steam") paintSteam(steam);
        else paintAccount(accounts.find((a) => a.id === id) ?? { id, client_id: "" });
      }
    } catch (e) {
      fail(e);
    }
  }
  setInterval(refresh, 2000);
  document.addEventListener("page-shown", refresh);
  return refresh;
}
