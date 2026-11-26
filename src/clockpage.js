// Settings → clock (extras.rs set_clock, src/wallpapers/hoverclock.js): the
// styles on the left; on the right, staying in view, the showing wallpaper with
// the clock on it, and the choices. Everything is saved as you click it.
// The preview wallpaper only exists while this page is open, and only runs
// while the window is in front.

import { hoverClock } from "./wallpapers/hoverclock.js";
import { clockGrid, STYLES, validStyle, weightOf } from "./wallpapers/clockstyles.js";
import { brandColours, clockColours, paintGrid, wallColours } from "./wallpapers/clockcolours.js";
import { queryFor } from "./wallpapers/catalog.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// The tabs over the styles. Every style must be in one of them.
const GROUPS = {
  all: STYLES,
  lettering: ["text", "slant", "big", "doom", "lean", "isometric", "words"],
  digital: ["lcd", "heywajih", "extruded", "hatch", "rain"],
  objects: ["flip-dot", "split-flap", "circuit", "constellation", "dial", "binary", "bars"],
};
const SWATCHES = ["#ffffff", "#33ff99", "#58a6ff", "#8f7bff", "#ff5fa2", "#ff5a4f", "#ffb454"];
// The preview is this many CSS px of screen, scaled to fit its box
const SCREEN = { x: 0, y: 0, w: 1120, h: 630 };
const DEFAULTS = { on: true, always: false, style: "slant", corner: "top-right", colour: "wallpaper", fill: "gradient", size: "medium", hours: "auto" };
const fade = ([a, b]) => `linear-gradient(rgb(${a.join(",")}), rgb(${b.join(",")}))`;

/** settings(): main.js's { wallpaper, options }; taken(): the now-playing card's
 * corner, which the clock can't have. Returns { show(saved clock), corner() } */
export function startClock({ invoke, settings, taken = () => null }) {
  const page = $("#page-clock");
  const note = $("#clock-note");
  const frame = $("#clock-screen iframe");
  const face = $("#clock-screen .face");
  let cfg = { ...DEFAULTS };
  let group = "all";
  let clock = null;
  let hue = null; // the big jellyfish's, once the preview says it

  const show = () => (!cfg.on ? "never" : cfg.always ? "always" : "hover");
  // what's showing; the clock wallpaper hides the corner clock, so then the
  // preview is a plain black screen
  const wall = () => {
    const { wallpaper, options } = settings();
    return { wall: wallpaper, tint: options?.[wallpaper]?.tint ?? "", options: options?.[wallpaper] ?? {} };
  };
  // the clock wallpaper has no colours to match: the usual ones
  const matched = () => {
    const w = wall();
    return w.wall === "clock" ? { wall: "jellyfish", tint: "" } : w;
  };

  // ---- made once ----
  for (const id of STYLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "clock-style";
    b.dataset.style = id;
    b.innerHTML = `<span class="art"><pre></pre></span><span class="name"></span>`;
    $(".name", b).textContent = id;
    // every style fits the same tile
    const cells = clockGrid(id, "4:43", new Date(2026, 0, 1, 16, 43, 25).getTime());
    $("pre", b).style.fontSize = `${Math.min(88 / (cells[0].length * 0.6), 54 / (cells.length * 1.05), 30)}px`;
    $("pre", b).style.fontWeight = weightOf(id);
    $("#clock-styles").append(b);
  }
  $("#clock-tabs").innerHTML = Object.keys(GROUPS).map((g) => `<button type="button" data-group="${g}">${g}</button>`).join("");
  $("#clock-swatches").innerHTML = SWATCHES.map((c) => `<button type="button" class="swatch" data-set="colour" data-v="${c}" style="--c: ${c}" aria-label="colour ${c}"></button>`).join("");
  $("#clock-brand").style.background = fade(brandColours());
  const own = $("#clock-own");

  // ---- drawing ----
  function paint() {
    const w = matched();
    const colours = clockColours(cfg.colour, w.wall, w.tint, hue);
    const picked = cfg.colour.startsWith("#");
    for (const b of $$("[data-set]", page)) b.setAttribute("aria-pressed", String((b.dataset.set === "show" ? show() : cfg[b.dataset.set]) === b.dataset.v));
    // the now-playing card's corner is taken
    for (const b of $$('[data-set="corner"]', page)) {
      const theirs = b.dataset.v === taken();
      b.disabled = theirs;
      b.title = theirs ? "now playing is here" : b.dataset.v.replace("-", " ");
    }
    for (const b of $$("[data-group]", page)) b.setAttribute("aria-pressed", String(b.dataset.group === group));
    for (const b of $$(".clock-style", page)) {
      b.setAttribute("aria-pressed", String(b.dataset.style === cfg.style));
      b.hidden = !GROUPS[group].includes(b.dataset.style);
      paintGrid($("pre", b), clockGrid(b.dataset.style, "4:43", new Date(2026, 0, 1, 16, 43, 25).getTime()), colours, cfg.fill === "solid");
    }
    $("#clock-match").style.background = fade(wallColours(w.wall, w.tint, hue));
    if (picked) own.value = cfg.colour;
    $("#clock-picked").style.background = own.value;
    $("#clock-pick").setAttribute("aria-pressed", String(picked));
    // the same row: gradient or solid, or the colours to pick from
    $("#clock-fill").hidden = picked;
    $("#clock-picks").hidden = !picked;
    $("#clock-fill-label").textContent = picked ? "pick" : "fill";
    const off = show() === "never";
    $("#clock-choices").inert = off;
    $("#clock-choices").classList.toggle("off", off);
    $("#clock-tip").textContent = off ? "the clock is off" : "you can also click a corner here to move it";
    $("#clock-hidden").hidden = wall().wall !== "clock" || off;
    clock ??= hoverClock([SCREEN], {}, w, face);
    clock.configure({ ...cfg, on: true, always: true });
    clock.setWall(w);
    clock.setHue(0, hue);
  }

  // ---- the preview wallpaper ----
  function load() {
    const w = wall();
    const q = queryFor(w.options);
    const want = page.hidden || w.wall === "clock" ? "about:blank" : `/wallpapers/${w.wall}.html?hover=0&fps=15${q ? `&${q}` : ""}`;
    if (frame.getAttribute("src") === want) return;
    hue = null;
    frame.src = want;
  }
  const tell = () => frame.contentWindow?.postMessage({ type: "paused", value: document.hidden || !document.hasFocus() }, location.origin);
  frame.addEventListener("load", () => {
    tell();
    const said = frame.contentDocument?.documentElement.dataset.hue;
    hue = said === undefined ? null : Number(said);
    if (!page.hidden) paint();
  });
  for (const type of ["focus", "blur"]) addEventListener(type, tell);
  document.addEventListener("visibilitychange", tell);
  new ResizeObserver(([e]) => $("#clock-screen").style.setProperty("--k", String(e.contentRect.width / SCREEN.w))).observe($("#clock-screen"));
  document.addEventListener("page-shown", () => {
    load();
    if (!page.hidden) paint();
  });

  // ---- choosing ----
  let saved = { ...cfg };
  function change(next) {
    cfg = { ...cfg, ...next };
    paint();
    const sent = cfg;
    invoke("set_clock", { clock: sent })
      .then(() => {
        saved = sent;
        note.textContent = "";
      })
      .catch((e) => {
        cfg = { ...saved };
        paint();
        note.textContent = `not saved: ${e}`;
      });
  }
  page.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.group) {
      group = b.dataset.group;
      paint();
    } else if (b.dataset.style) change({ style: b.dataset.style });
    else if (b.dataset.set === "show") change({ on: b.dataset.v !== "never", always: b.dataset.v === "always" });
    else if (b.dataset.set) change({ [b.dataset.set]: b.dataset.v });
  });
  $("#clock-pick").addEventListener("click", () => change({ colour: own.value }));
  // live while you choose, saved once you have
  own.addEventListener("input", () => {
    cfg = { ...cfg, colour: own.value };
    paint();
  });
  own.addEventListener("change", () => change({ colour: own.value }));

  return {
    corner: () => cfg.corner,
    show(c = {}) {
      cfg = { ...DEFAULTS, ...c, style: validStyle(c.style) }; // an unknown style falls back to slant
      saved = { ...cfg };
      load();
      if (!page.hidden) paint();
    },
  };
}
