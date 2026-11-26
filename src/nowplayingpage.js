// Settings → now playing (nowplaying.rs set_now_playing, now_playing_state):
// when the corner card shows (hover, always, new songs, never), its corner,
// size, rest-to-pause, which players count, and on macOS whether Spotify and
// Music are allowed. The song playing now is shown at the top with its cover
// in characters, read again every 2 s while the page is open. Saved as you
// click.

import { attempt } from "./powerpage.js";
import { coverFor, coverView } from "./wallpapers/nowplaying.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const DEFAULTS = { on: false, show: "hover", corner: "bottom-right", size: "medium", rest_to_pause: true, hidden: [] };
const SOURCE_TEXT = { allowed: "allowed", denied: "not allowed", "not-running": "not running", error: "couldn't read it" };

/** taken(): the clock's corner, which the card can't have. Returns { show(saved), corner() }. */
export function startNowPlaying({ invoke, taken = () => null }) {
  const page = $("#page-playing");
  const note = $("#np-note");
  const view = coverView($("#np-cover"));
  let cfg = { ...DEFAULTS };
  let changedAt = -Infinity;
  let shownSong = null;
  let state = null;

  function paint() {
    const show = cfg.on ? cfg.show : "never";
    for (const b of $$("[data-set]", page)) {
      const v = b.dataset.set === "show" ? show : String(cfg[b.dataset.set]);
      b.setAttribute("aria-pressed", String(v === b.dataset.v));
    }
    $("#np-choices").classList.toggle("off", !cfg.on);
    // the clock's corner is taken
    for (const b of $$('[data-set="corner"]', page)) {
      const clock = b.dataset.v === taken();
      b.disabled = clock;
      b.title = clock ? "the clock is here" : b.dataset.v.replace("-", " ");
    }
  }

  function change(next) {
    changedAt = performance.now();
    const before = cfg;
    cfg = { ...cfg, ...next };
    paint();
    attempt(invoke("set_now_playing", { prefs: cfg }), () => ((cfg = before), paint()), note);
  }

  page.addEventListener("click", (e) => {
    const b = e.target.closest("[data-set]");
    if (!b) return;
    const key = b.dataset.set;
    if (key === "show") return change(b.dataset.v === "never" ? { on: false } : { on: true, show: b.dataset.v });
    change({ [key]: key === "rest_to_pause" ? b.dataset.v === "true" : b.dataset.v });
  });
  $("#np-players").addEventListener("change", (e) => {
    const id = e.target.dataset?.player;
    if (!id) return;
    const hidden = new Set(cfg.hidden);
    if (e.target.checked) hidden.delete(id);
    else hidden.add(id);
    change({ hidden: [...hidden] });
  });
  $("#np-source-list").addEventListener("click", (e) => {
    if (e.target.closest("[data-open]")) attempt(invoke("open_link", { url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation" }), () => {}, note);
  });

  // ---- what's playing now ----
  async function paintNow(track) {
    const title = $("#np-title");
    const sub = $("#np-sub");
    if (!track) {
      shownSong = null;
      $("#np-now").classList.add("empty");
      title.textContent = cfg.on ? "nothing playing right now" : "off";
      sub.textContent = cfg.on ? "play something and it shows here" : "pick when to show it above";
      return;
    }
    $("#np-now").classList.remove("empty");
    title.textContent = track.title;
    sub.textContent = `${track.artist ? `${track.artist} · ` : ""}${track.playing ? "playing" : "paused"} in ${track.player_name}`;
    const key = `${track.song}\u0001${track.cover.length}\u0001${track.playing}`;
    if (key === shownSong) return;
    const first = shownSong === null;
    shownSong = key;
    const cover = await coverFor(track, 24, 12);
    view.show(cover, !first && track.playing);
    if (!track.playing) view.cool(1);
  }

  function paintPlayers(players) {
    const box = $("#np-players");
    $("#np-players-hint").hidden = false;
    const html = players
      .map((p) => `<label><input type="checkbox" data-player="${esc(p.id)}"${p.shown ? " checked" : ""} /> ${esc(p.name)}</label>`)
      .join("");
    if (box.dataset.html !== html) {
      box.innerHTML = html || `<p class="dim">none yet</p>`;
      box.dataset.html = html;
    }
  }

  function paintSources(sources) {
    $("#np-sources").hidden = !sources.length;
    const html = sources
      .map((s) => {
        const open = s.state === "denied" ? ` <button type="button" data-open>open System Settings</button>` : "";
        return `<p><b>${esc(s.name)}</b> <span class="dim">${esc(s.text || SOURCE_TEXT[s.state] || s.state)}</span>${open}</p>`;
      })
      .join("");
    const list = $("#np-source-list");
    if (list.dataset.html !== html) {
      list.innerHTML = html;
      list.dataset.html = html;
    }
  }

  async function refresh() {
    if (page.hidden || document.hidden) return;
    try {
      state = await invoke("now_playing_state");
    } catch {
      return;
    }
    paintNow(state.track);
    paintPlayers(state.players ?? []);
    paintSources(state.sources ?? []);
    if (state.note && !note.textContent) note.textContent = state.note;
  }
  setInterval(refresh, 2000);
  document.addEventListener("page-shown", () => {
    if (!page.hidden) paint(); // the clock may have moved meanwhile
    refresh();
  });
  addEventListener("focus", refresh);

  return {
    corner: () => cfg.corner,
    show(saved) {
      // coming to the front reloads settings: not over a change just made
      if (performance.now() - changedAt < 1000) return;
      cfg = { ...DEFAULTS, ...(saved ?? {}) };
      paint();
      refresh();
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
