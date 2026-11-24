// Settings → awake: keep awake (awake.rs). The switch by hand, the apps that
// keep the computer awake while they run or are in front, and when not to.

import { attempt } from "./powerpage.js";

const $ = (sel, root = document) => root.querySelector(sel);

/** "42 min", "3 h 5 min" */
const span = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

/** Returns { show(saved) }: fill the section from settings.awake */
export function startAwake({ invoke, inApp }) {
  const page = $("#page-awake");
  const note = $("#awake-note");
  const hand = [...document.querySelectorAll("#awake-now button")];
  const screen = $("#awake-screen");
  const battery = $("#awake-battery");
  const linger = $("#awake-linger");
  const list = $("#awake-apps");
  const pick = $("#awake-pick");
  let saved = { screen: false, on_battery: false, linger: 1, apps: [] };
  let running = [];
  let changedAt = -Infinity;

  function show(a) {
    saved = { screen: false, on_battery: false, linger: 1, apps: [], ...(a ?? {}) };
    screen.checked = saved.screen;
    battery.checked = saved.on_battery;
    linger.value = String(saved.linger);
    $("#awake-linger-row").hidden = !saved.apps.length;
    paintApps();
    paintPicker();
  }

  // Clicking the window also brings it to the front, which reloads every
  // setting: what it read just before a change must not undo the change
  function showSaved(a) {
    if (performance.now() - changedAt > 1000) show(a);
  }

  function save(change) {
    changedAt = performance.now();
    const before = saved;
    const next = { ...saved, ...change };
    show(next);
    return attempt(invoke("set_awake", { awake: next }), () => show(before), note).then(soon);
  }

  function paintApps() {
    list.replaceChildren(
      ...saved.apps.map((app) => {
        const row = document.createElement("div");
        row.className = "awake-row";
        const name = document.createElement("span");
        name.textContent = app.name;
        name.title = app.id;
        const when = document.createElement("select");
        when.name = "while";
        when.setAttribute("aria-label", `${app.name} keeps the computer awake`);
        when.append(new Option("while running", "running"), new Option("while in front", "front"));
        when.value = app.front ? "front" : "running";
        when.addEventListener("change", () => save({ apps: saved.apps.map((a) => (a.id === app.id ? { ...a, front: when.value === "front" } : a)) }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "remove";
        remove.setAttribute("aria-label", `remove ${app.name}`);
        remove.addEventListener("click", () => save({ apps: saved.apps.filter((a) => a.id !== app.id) }));
        row.append(name, when, remove);
        return row;
      }),
    );
  }

  function paintPicker() {
    const before = pick.value;
    const free = running.filter((r) => !saved.apps.some((a) => a.id === r.id));
    const group = (label, apps) => {
      const g = document.createElement("optgroup");
      g.label = label;
      g.append(...apps.map((r) => new Option(r.name, r.id)));
      return g;
    };
    const open = free.filter((r) => r.windowed);
    const hidden = free.filter((r) => !r.windowed);
    pick.replaceChildren(new Option("pick an app", ""), ...(open.length ? [group("open now", open)] : []), ...(hidden.length ? [group("in the background", hidden)] : []));
    pick.value = free.some((r) => r.id === before) ? before : "";
    $("#awake-add").disabled = !pick.value;
  }

  async function loadRunning() {
    if (page.hidden) return;
    try {
      running = await invoke("awake_apps");
      paintPicker();
    } catch (e) {
      if (inApp) note.textContent = String(e);
    }
  }

  async function refresh() {
    if (page.hidden) return;
    try {
      const s = await invoke("awake_state");
      for (const b of hand) b.setAttribute("aria-pressed", String(b.dataset.v === s.choice));
      let text = "○ the computer can go to sleep";
      if (s.error) text = `○ couldn't keep it awake: ${s.error}`;
      else if (s.battery) text = `○ not keeping it awake: on battery or saving power (${s.reason})`;
      else if (s.held) text = `● awake for ${span(s.minutes)}: ${s.reason}${s.left != null ? `, ${span(s.left)} left` : ""}`;
      const el = $("#awake-state");
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle("dim", !s.held);
    } catch (e) {
      if (inApp) note.textContent = String(e);
    }
  }
  // a change takes effect in the next look, a moment later
  const soon = () => setTimeout(refresh, 150);

  for (const b of hand) b.addEventListener("click", () => attempt(invoke("set_awake_now", { choice: b.dataset.v }), refresh, note).then(soon));
  screen.addEventListener("change", () => save({ screen: screen.checked }));
  battery.addEventListener("change", () => save({ on_battery: battery.checked }));
  linger.addEventListener("change", () => save({ linger: Number(linger.value) }));
  pick.addEventListener("change", () => ($("#awake-add").disabled = !pick.value));
  $("#awake-add").addEventListener("click", () => {
    const app = running.find((r) => r.id === pick.value);
    if (app) save({ apps: [...saved.apps, { id: app.id, name: app.name, front: false }] });
  });

  const shown = () => {
    refresh();
    loadRunning();
  };
  setInterval(refresh, 2000);
  document.addEventListener("page-shown", shown);
  addEventListener("focus", loadRunning);
  shown();
  return { show: showSaved };
}
