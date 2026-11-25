// Settings → performance: is each monitor's wallpaper running, and if not, why;
// the Pause switch; the rules that pause it; frame rate, OLED care and
// rendering. Refreshed every 2 s while the page is open (host.rs power_state).

const $ = (sel, root = document) => root.querySelector(sel);
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};

const WHY = {
  "": "running",
  you: "paused by you",
  fullscreen: "paused: an app is fullscreen",
  battery: "paused: on battery or saving power",
  covered: "paused: windows hide it",
  resting: "resting: OLED care, you were away",
};

/** Returns { refresh, last() }: last() is the latest power_state, or null */
export function startPower({ invoke, inApp }) {
  const page = $("#page-performance");
  const note = $("#power-note");
  let state = null;

  $("#pause-now").addEventListener("click", () =>
    invoke("set_paused", { on: !state?.paused })
      .then(refresh)
      .catch((e) => setText(note, String(e))),
  );

  function paint() {
    const list = $("#power-screens");
    while (list.children.length < state.screens.length) list.append(document.createElement("div"));
    while (list.children.length > state.screens.length) list.lastChild.remove();
    state.screens.forEach((s, i) => {
      const name = state.screens.length > 1 ? `monitor ${i + 1} (${s.w}x${s.h}): ` : "";
      const row = list.children[i];
      setText(row, `${s.reason ? "○" : "●"} ${name}${WHY[s.reason] ?? "paused"}`);
      row.classList.toggle("dim", !!s.reason);
    });
    setText($("#pause-now"), state.paused ? "resume" : "pause");
    const cpu = $("#power-cpu");
    cpu.hidden = state.cpu == null;
    if (state.cpu != null) setText(cpu, `using ${state.cpu < 0.1 ? "under 0.1" : state.cpu.toFixed(1)}% of this computer's CPU, this window included`);
    $("#battery-rule").hidden = !state.has_battery;
    $("#awake-battery-row").hidden = !state.has_battery;
    setText($("#battery-also"), state.os === "macos" ? "and in Low Power Mode" : "");
    // what really draws each monitor, as the wallpapers report it
    const kinds = state.screens.map((s, i) => [i, s.renderer]).filter(([, r]) => r);
    const same = kinds.length && kinds.every(([, r]) => r === kinds[0][1]);
    const word = (r) => (r === "gpu" ? "GPU" : "CPU");
    setText($("#running"), !kinds.length ? "nothing that needs a renderer" : same ? word(kinds[0][1]) : kinds.map(([i, r]) => `monitor ${i + 1} ${word(r)}`).join(", "));
    $("#running").className = kinds.some(([, r]) => r === "gpu") ? "on" : "";
  }

  async function refresh(always = false) {
    if (page.hidden && always !== true) return;
    try {
      state = await invoke("power_state");
      document.documentElement.dataset.os = state.os;
      paint();
    } catch (e) {
      if (inApp) setText(note, String(e));
    }
  }
  setInterval(refresh, 2000);
  document.addEventListener("page-shown", () => refresh());
  refresh(true); // the operating system decides what other pages show
  return { refresh, last: () => state };
}

/** Run a change; if it fails, put the control back and say why */
export function attempt(promise, undo, note) {
  return promise.then(
    (v) => {
      if (note) setText(note, "");
      return v;
    },
    (e) => {
      undo();
      if (note) setText(note, `not saved: ${e}`);
    },
  );
}
