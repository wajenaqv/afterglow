// Settings → edge (edge.rs set_edge, try_edge): on or off, the four looks as
// live previews, side, strength, and the tray icon's colour. Saved as you
// click. The previews only draw while this page is open and in front.

import { edgeLights } from "./wallpapers/edgelight.js";
import { attempt } from "./powerpage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const DEFAULTS = { on: false, look: "thread", side: "bottom", strength: "soft", tray: false };
// sample apps (WhatsApp's and Slack's own colours, apps.rs)
const SAMPLE = [
  { source: "whatsapp", colour: [37, 211, 102] },
  { source: "slack", colour: [224, 30, 90] },
];

/** Returns { show(saved) } */
export function startEdge({ invoke }) {
  const page = $("#page-edge");
  const note = $("#edge-note");
  let cfg = { ...DEFAULTS };
  let changedAt = -Infinity;
  const previews = $$(".edge-look", page).map((b) => ({ look: b.dataset.v, lights: edgeLights($("canvas", b), { scale: 0.6 }) }));
  if (/Mac/.test(navigator.userAgent)) $("#edge-tray-label").textContent = "colour the menu bar icon too";

  function paint() {
    $("#edge-on").checked = cfg.on;
    $("#edge-tray").checked = cfg.tray;
    for (const b of $$("[data-set]", page)) b.setAttribute("aria-pressed", String(cfg[b.dataset.set] === b.dataset.v));
    $("#edge-choices").classList.toggle("off", !cfg.on);
    for (const p of previews) p.lights.set({ items: SAMPLE, shown: true, look: p.look, side: "bottom", strength: cfg.strength }); // the side stays the bottom: the tiles are wide
  }
  const live = () => previews.forEach((p) => p.lights.running(!page.hidden && !document.hidden && document.hasFocus()));

  function change(next) {
    changedAt = performance.now();
    const before = cfg;
    cfg = { ...cfg, ...next };
    paint();
    attempt(invoke("set_edge", { edge: cfg }), () => ((cfg = before), paint()), note);
  }
  $("#edge-on").addEventListener("change", (e) => change({ on: e.target.checked }));
  $("#edge-tray").addEventListener("change", (e) => change({ tray: e.target.checked }));
  page.addEventListener("click", (e) => {
    const b = e.target.closest("[data-set]");
    if (!b) return;
    // picking a look means you want it
    change({ [b.dataset.set]: b.dataset.v, ...(b.dataset.set === "look" ? { on: true } : {}) });
  });
  $("#edge-try").addEventListener("click", () => attempt(invoke("try_edge"), () => {}, note));
  for (const type of ["focus", "blur"]) addEventListener(type, live);
  document.addEventListener("visibilitychange", live);
  document.addEventListener("page-shown", live);

  return {
    show(saved) {
      // coming to the front reloads settings: not over a change just made
      if (performance.now() - changedAt < 1000) return;
      cfg = { ...DEFAULTS, ...(saved ?? {}) };
      paint();
      live();
    },
  };
}
