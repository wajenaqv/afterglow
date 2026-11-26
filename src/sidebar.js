// The Settings window's sidebar: the features in two groups, each saying what
// it's doing now ("jellyfish", "2 waiting", "off"), and the settings apart at
// the bottom. Read again every 3 s, and a moment after anything is changed.

import { WALLPAPERS } from "./wallpapers/catalog.js";

const $ = (sel, root = document) => root.querySelector(sel);
const sum = (o) => Object.values(o ?? {}).reduce((a, n) => a + (Number(n) || 0), 0);

/** page -> [text, is it on] from what Rust says. Parts that couldn't be read are missing. */
export function states({ settings: s, apps, unread, awake, jobs, playing }) {
  const out = {};
  if (s) {
    out.wallpaper = [(WALLPAPERS.find((w) => w.id === (s.wallpaper ?? "jellyfish"))?.name ?? s.wallpaper).toLowerCase(), true];
    const c = { on: true, always: false, ...(s.clock ?? {}) };
    out.clock = !c.on ? ["off", false] : s.wallpaper === "clock" ? ["hidden", false] : [c.always ? "always" : "on hover", true];
    out.edge = s.edge?.on ? [s.edge.look, true] : ["off", false];
    if (!s.now_playing?.on) out.playing = ["off", false];
    else if (playing) out.playing = !playing.track ? ["nothing playing", false] : [playing.track.playing ? "playing" : "paused", true];
  }
  if (apps) {
    const on = apps.apps.filter((a) => a.allowed).length;
    const waiting = sum(unread);
    out.apps = waiting ? [`${waiting} waiting`, true] : on ? [`${on} allowed`, true] : ["none yet", false];
  }
  if (s && jobs) {
    const n = (state) => jobs.jobs.filter((j) => j.state === state).length;
    if (!s.jobs?.on) out.jobs = ["off", false];
    else if (n("needs")) out.jobs = [n("needs") > 1 ? `${n("needs")} need you` : "needs you", true];
    else if (n("failed")) out.jobs = [`${n("failed")} failed`, true];
    else if (n("running")) out.jobs = [`${n("running")} running`, true];
    else if (n("done")) out.jobs = [`${n("done")} done`, true];
    else out.jobs = ["on", true];
  }
  if (awake) {
    const picked = s?.awake?.apps?.length ?? 0;
    if (awake.error) out.awake = ["failed", false];
    else if (awake.held) out.awake = ["awake", true];
    else if (awake.battery) out.awake = ["on battery", false];
    else out.awake = picked ? [`${picked} app${picked > 1 ? "s" : ""}`, true] : ["off", false];
  }
  return out;
}

export function startSidebar({ invoke }) {
  let running = false;
  let again = false;
  async function refresh() {
    if (document.hidden) return;
    // one at a time, so an older answer never lands on a newer one
    if (running) return void (again = true);
    running = true;
    const get = (cmd) => invoke(cmd).catch(() => null);
    const [settings, apps, unread, awake, jobs, playing] = await Promise.all(["get_settings", "apps_state", "unread_by_app", "awake_state", "jobs_state", "now_playing_state"].map(get));
    for (const [page, [text, on]] of Object.entries(states({ settings, apps, unread, awake, jobs, playing }))) {
      const el = $(`.side a[data-page="${page}"] i`);
      if (!el) continue;
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle("on", on);
    }
    running = false;
    if (again) {
      again = false;
      refresh();
    }
  }
  const soon = () => setTimeout(refresh, 250);
  for (const type of ["change", "click"]) document.addEventListener(type, soon);
  addEventListener("focus", refresh);
  setInterval(refresh, 3000);
  refresh();
}
