// Settings → activity: what each app did, newest first, in plain words
// (signals.rs activity_log), with a way to block or allow the app right
// there. Totals per app are folded away below. Drawn again only when
// something changed, so buttons don't vanish under the cursor.

import { esc } from "./appspage.js";

const $ = (sel, root = document) => root.querySelector(sel);

const SHOWN = ["pulse", "flash", "replayed"];
function words(e) {
  switch (e.outcome) {
    case "pulse":
      return "lit up";
    case "flash":
      return "flashed";
    case "replayed":
      return "shown when you came back";
    case "held-away":
      return "waiting: you were away";
    case "held-dnd":
      return "waiting: Do Not Disturb is on";
    case "missed":
      return "not shown: too many at once while you were away";
    case "dropped":
      return "not shown: you blocked it";
    case "blocked":
      return "not shown: blocked";
    default:
      return e.kind === "clear" || e.count === 0 ? "nothing waiting any more" : `${e.count ?? 0} waiting`;
  }
}
const when = (ms) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
};

export function startActivity({ invoke }) {
  const page = $("#page-activity");
  const note = $("#act-note");
  let log = [];
  let apps = new Map();
  let drawn = "";

  const nameOf = (source) => (source === "simulator" ? "test signal" : (apps.get(source)?.name ?? source));
  const dot = (source, colour) => `<span class="dot" style="--c: ${esc(colour || apps.get(source)?.colour || apps.get(source)?.own_colour || "var(--logo-bottom)")}" aria-hidden="true"></span>`;

  function paint() {
    const all = $("#act-all").checked;
    const key = JSON.stringify([all, log.map((e) => [e.id, e.outcome]), [...apps.values()].map((a) => [a.source, a.allowed, a.name, a.colour])]);
    if (key === drawn) return;
    drawn = key;
    const rows = (all ? log : log.filter((e) => e.kind === "new" || e.kind === "flash")).slice(0, 200);
    const focused = document.activeElement?.closest?.("#act-log button")?.dataset.entry;
    $("#act-log").innerHTML = rows
      .map((e) => {
        const a = apps.get(e.source);
        const shown = SHOWN.includes(e.outcome);
        const button = a ? `<button type="button" data-entry="${e.id}" data-app="${esc(e.source)}" aria-label="${a.allowed ? "block" : "allow"} ${esc(a.name)}">${a.allowed ? "block" : "allow"}</button>` : "";
        return `<div class="act-row"><span class="dim">${esc(when(e.at))}</span><span class="act-app">${dot(e.source, e.colour)} ${esc(nameOf(e.source))}</span><span class="${shown ? "" : "dim"}">${esc(words(e))}</span>${button}</div>`;
      })
      .join("");
    if (focused) $(`#act-log [data-entry="${focused}"]`)?.focus();
    $("#act-none").hidden = rows.length > 0;

    // per app: shown, not shown (blocked, dropped, too many), still waiting
    const totals = new Map();
    for (const e of log) {
      if (e.kind !== "new" && e.kind !== "flash") continue;
      const t = totals.get(e.source) ?? { shown: 0, waiting: 0, not: 0, last: 0 };
      if (SHOWN.includes(e.outcome)) t.shown++;
      else if (e.outcome.startsWith("held")) t.waiting++;
      else t.not++;
      t.last = Math.max(t.last, e.at);
      totals.set(e.source, t);
    }
    $("#act-apps tbody").innerHTML = [...totals]
      .sort((x, y) => y[1].last - x[1].last)
      .map(([s, t]) => `<tr><td class="name">${esc(nameOf(s))}</td><td>${t.shown}</td><td>${t.waiting}</td><td>${t.not}</td><td class="dim">${esc(when(t.last))}</td></tr>`)
      .join("");
  }

  async function refresh() {
    if (page.hidden) return;
    try {
      const [entries, state] = await Promise.all([invoke("activity_log"), invoke("apps_state")]);
      log = entries;
      apps = new Map(state.apps.map((a) => [a.source, a]));
      paint();
    } catch (e) {
      note.textContent = String(e);
    }
  }
  $("#act-log").addEventListener("click", (e) => {
    const a = apps.get(e.target.dataset.app);
    if (!a) return;
    invoke("set_app", { source: a.source, allowed: !a.allowed, onNew: a.on_new, colour: a.colour, count: a.count })
      .then(() => {
        note.textContent = `${a.name} is ${a.allowed ? "blocked" : "allowed"} now`;
        return refresh();
      })
      .catch((err) => (note.textContent = String(err)));
  });
  $("#act-all").addEventListener("change", paint);
  $("#act-clear").addEventListener("click", () => invoke("clear_activity").then(refresh).catch((e) => (note.textContent = String(e))));
  setInterval(refresh, 2000);
  document.addEventListener("page-shown", refresh);
}
