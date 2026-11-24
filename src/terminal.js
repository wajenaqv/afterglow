// The terminal look of the Settings window (no typing, only the feel):
//   - every <select> becomes a "< value >" cycler (the arrows step through
//     the choices; the select itself still opens and works with the keys)
//   - the prompt line types out the "command" for whatever you change
//     ($ afterglow clock --corner top-right)
//   - a vim-style status bar along the bottom
//   - a short boot sequence when the window first opens (skippable, off in
//     about, never with reduced motion)
// Checkboxes, radios and buttons are drawn as [x], (•) and [ button ] in
// terminal.css; the native controls stay underneath, so nothing else changes.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const slug = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/g, "-")
    .replace(/^-|-$/g, "");

// ---- "< value >" cyclers ----
// The arrows are spans, not buttons: inside a <label>, a button would become
// the label's control and clicking the label's text would step backwards.
function cycler(sel) {
  if (sel.closest(".cyc")) return;
  const wrap = document.createElement("span");
  wrap.className = "cyc";
  const arrow = (text, step) => {
    const a = document.createElement("span");
    a.className = "cyc-b";
    a.textContent = text;
    a.setAttribute("aria-hidden", "true");
    a.addEventListener("click", (e) => {
      e.preventDefault(); // don't let the label pass the click on
      const opts = [...sel.options];
      const n = opts.length;
      if (sel.disabled || !n) return;
      let i = sel.selectedIndex;
      for (let k = 0; k < n; k++) {
        i = (i + step + n) % n;
        if (!opts[i].hidden && !opts[i].disabled) break;
      }
      if (i === sel.selectedIndex) return;
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return a;
  };
  sel.replaceWith(wrap);
  wrap.append(arrow("<", -1), sel, arrow(">", 1));
}
function cyclers(root = document) {
  $$("select", root).forEach(cycler);
}

// ---- the prompt line: the command for each change ----
const cmdEl = () => $("#cmd");
let typing = 0;
export function say(text) {
  const el = cmdEl();
  if (!el) return;
  const run = ++typing;
  if (REDUCED) return void (el.textContent = text);
  let i = 0;
  el.textContent = "";
  const step = () => {
    if (run !== typing) return;
    i += 2;
    el.textContent = text.slice(0, i);
    if (i < text.length) setTimeout(step, 14);
  };
  step();
}

const page = () => location.hash.slice(1) || "wallpaper";
// a control's flag: its data-pause, name or id (without the page's own
// prefix), else its label's first words
function flagOf(el) {
  let key = el.dataset.pause ?? el.name ?? el.id ?? "";
  if (!key) {
    const label = el.closest("label");
    key = label?.querySelector(".dim")?.textContent ?? label?.textContent ?? el.getAttribute("aria-label") ?? "";
    key = key.split(/\s+/).slice(0, 3).join(" ");
  }
  key = slug(key.replace(/_/g, "-"));
  const p = page();
  if (key.startsWith(p + "-") && key !== p + "-on") key = key.slice(p.length + 1);
  return key;
}
function commandFor(el) {
  const p = page();
  const card = el.closest(".card, .wall-detail")?.querySelector("h3")?.textContent;
  const app = el.closest(".connector")?.dataset.id ?? el.closest("tr")?.querySelector(".src, .name")?.textContent;
  const where = [p, card && slug(card), !card && app && slug(app)].filter(Boolean).join(" ");
  if (el.matches("select")) {
    const opt = el.selectedOptions[0];
    return `${where} --${flagOf(el)} ${slug(opt?.value || opt?.textContent || "default") || "default"}`;
  }
  if (el.type === "checkbox") {
    const val = el.value && el.value !== "on" ? el.value : flagOf(el);
    if (el.closest(".connector") && !el.closest(".account")) return `${p} ${el.checked ? "enable" : "disable"} ${slug(app)}`;
    return `${where} --${el.checked ? "" : "no-"}${slug(val)}`;
  }
  if (el.type === "radio") return `${where} --${flagOf(el)} ${slug(el.value)}`;
  if (el.type === "color") return `${where} --colour ${el.value}`;
  // typed values (keys, ids) are never echoed
  return `${where} --${flagOf(el) || "value"} '…'`;
}
function buttonCommand(b) {
  const p = page();
  if (b.dataset.style) return `${p} --style ${b.dataset.style}`;
  const card = b.closest(".card, .wall-detail")?.querySelector("h3")?.textContent;
  if (card && b.matches(".use")) return `${p} use ${slug(card)}`;
  if (card && b.matches(".still")) return `${p} still ${slug(card)} > ~/Pictures/AfterGlow/`;
  const app = b.closest(".connector")?.dataset.id;
  return [p, app, slug(b.textContent) || "run"].filter(Boolean).join(" ");
}

// ---- the status bar ----
let statusOf = () => ({});
let invokeFn = async () => ({});
let apps = { on: 0, waiting: 0 };
async function pollApps() {
  if (document.hidden) return;
  try {
    const list = await invokeFn("connectors_state");
    const waiting = await invokeFn("unread_by_app");
    apps = { on: list.filter((c) => c.on).length, waiting: Object.values(waiting ?? {}).reduce((a, b) => a + (Number(b) || 0), 0) };
  } catch {}
  paintStatus();
}
export function paintStatus() {
  const bar = $("#status");
  if (!bar) return;
  const s = statusOf();
  const left = `-- ${page().toUpperCase()} --`;
  const mid = `${apps.on} app${apps.on === 1 ? "" : "s"} on · ${apps.waiting ? `${apps.waiting} waiting` : "nothing waiting"}`;
  const right = [s.wallpaper, s.tint, s.fps && `${s.fps}fps`, s.gpu === undefined ? "" : s.gpu ? "gpu" : "cpu"].filter(Boolean).join(" · ");
  $(".st-mode", bar).textContent = left;
  $(".st-apps", bar).textContent = mid;
  $(".st-wall", bar).textContent = right;
}

// ---- boot lines ----
const BOOT_KEY = "afterglow:boot";
export const bootOn = () => {
  try {
    return localStorage.getItem(BOOT_KEY) !== "off";
  } catch {
    return true;
  }
};
export function setBoot(on) {
  try {
    localStorage.setItem(BOOT_KEY, on ? "on" : "off");
  } catch {}
}
function boot(lines) {
  if (REDUCED || !bootOn()) return;
  const el = document.createElement("div");
  el.className = "boot";
  el.setAttribute("aria-hidden", "true");
  document.body.append(el);
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
    removeEventListener("keydown", end, true);
  };
  el.addEventListener("click", end);
  addEventListener("keydown", end, true);
  const all = ["afterglow settings", ...lines.map((l) => `[ OK ] ${l}`)];
  all.forEach((line, i) =>
    setTimeout(() => {
      if (done) return;
      const p = document.createElement("div");
      if (line.startsWith("[ OK ]")) p.innerHTML = `<span class="ok">[ OK ]</span> `;
      p.append(line.replace("[ OK ] ", "").replace(/^afterglow settings$/, "$ afterglow settings"));
      el.append(p);
    }, 90 + i * 95),
  );
  setTimeout(end, 90 + all.length * 95 + 450);
}

// ---- start ----
export function startTerminal({ invoke, status, bootLines }) {
  invokeFn = invoke;
  statusOf = status;
  cyclers();
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) n.matches("select") ? cycler(n) : cyclers(n);
  }).observe(document.body, { childList: true, subtree: true });

  const main = $("main");
  main.addEventListener("change", (e) => {
    if (e.target.matches("input, select")) say(commandFor(e.target));
    paintStatus();
  });
  main.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && !b.disabled) say(buttonCommand(b));
  });
  addEventListener("hashchange", () => {
    say(page());
    paintStatus();
  });
  pollApps();
  setInterval(pollApps, 3000);
  boot(bootLines());
}
