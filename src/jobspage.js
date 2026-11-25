// Settings → jobs (jobs.rs, claude.rs): what's running, what connects to it
// (Claude Code, a terminal helper, any script) and what it does.
// Refreshed every 2 s while the page is open.

import { esc } from "./appspage.js";
import { attempt } from "./powerpage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const DEFAULTS = { on: false, awake: true, after: 30 };
const WORDS = { running: "● running", needs: "◆ needs you", done: "✓ done", failed: "× failed" };
const CLAUDE = {
  on: "connected",
  off: "not connected",
  missing: "Claude Code isn't on this computer",
  unreadable: "its settings file can't be read, so AfterGlow leaves it alone",
};
const span = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`);

// aglow <command>: run it, and say how it ended. Only the program's name is
// sent. (Not "glow": that's a popular Markdown reader.)
export const HELPERS = {
  powershell: `function aglow {
  $id = [guid]::NewGuid().ToString('N'); $name = Split-Path "$($args[0])" -Leaf
  $say = { param($s) try { $null = Invoke-RestMethod http://127.0.0.1:47811/job -Method Post -TimeoutSec 2 -Body (@{ id = $id; name = $name; state = $s } | ConvertTo-Json -Compress) } catch {} }
  $cmd = $args[0]; $rest = @($args | Select-Object -Skip 1); $end = 'failed'
  & $say start
  try { $global:LASTEXITCODE = 0; & $cmd @rest; if ($? -and $LASTEXITCODE -eq 0) { $end = 'done' } } finally { & $say $end }
}`,
  sh: `aglow() (
  id="$$-$(date +%s)"; name=$(basename "$1" | tr -cd 'A-Za-z0-9._-')
  say() { curl -s -m 2 -o /dev/null -d "{\\"id\\":\\"$id\\",\\"name\\":\\"$name\\",\\"state\\":\\"$1\\"}" http://127.0.0.1:47811/job; }
  trap : INT
  say start; "$@"; code=$?
  if [ $code -eq 0 ]; then say done; else say failed; fi
  exit $code
)`,
};

/** Returns { show(saved) } */
export function startJobs({ invoke, inApp }) {
  const page = $("#page-jobs");
  const note = $("#jobs-note");
  const helper = /Mac/.test(navigator.userAgent) ? HELPERS.sh : HELPERS.powershell;
  let cfg = { ...DEFAULTS };
  let claude = "off";
  let changedAt = -Infinity;
  let drawn = "";
  $("#jobs-helper").textContent = helper;
  $("#jobs-where").textContent = /Mac/.test(navigator.userAgent) ? "to ~/.zshrc" : "to your PowerShell profile (notepad $PROFILE)";

  function paint() {
    $("#jobs-on").checked = cfg.on;
    $("#jobs-awake").checked = cfg.awake;
    $("#jobs-after").value = String(cfg.after);
    $("#jobs-more").hidden = !cfg.on;
  }
  function change(next) {
    changedAt = performance.now();
    const before = cfg;
    cfg = { ...cfg, ...next };
    paint();
    attempt(invoke("set_jobs", { jobs: cfg }), () => ((cfg = before), paint()), note).then(refresh);
  }
  $("#jobs-on").addEventListener("change", (e) => change({ on: e.target.checked }));
  $("#jobs-awake").addEventListener("change", (e) => change({ awake: e.target.checked }));
  $("#jobs-after").addEventListener("change", (e) => change({ after: Number(e.target.value) }));
  for (const b of page.querySelectorAll("[data-try]")) b.addEventListener("click", () => attempt(invoke("try_job", { state: b.dataset.try }), () => {}, note).then(refresh));
  $("#jobs-claude").addEventListener("click", () => attempt(invoke("connect_claude", { on: claude !== "on" }), () => {}, note).then(refresh));
  $("#jobs-copy").addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(helper);
    e.target.textContent = "copied";
    setTimeout(() => (e.target.textContent = "copy"), 1500);
  });
  $("#jobs-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-job]");
    if (b) attempt(invoke("forget_job", { id: b.dataset.job }), () => {}, note).then(refresh);
  });

  async function refresh() {
    if (page.hidden) return;
    try {
      const s = await invoke("jobs_state");
      claude = s.claude;
      $("#jobs-claude-state").textContent = CLAUDE[claude];
      const button = $("#jobs-claude");
      button.hidden = claude === "missing" || claude === "unreadable";
      const word = claude === "on" ? "disconnect" : "connect";
      if (button.textContent !== word) button.textContent = word;
      const html = s.jobs.map((j) => `<div class="awake-row"><span>${esc(j.name)}</span><span class="dim">${WORDS[j.state]}, ${span(j.secs)}</span><button type="button" data-job="${esc(j.id)}" aria-label="forget ${esc(j.name)}">forget</button></div>`).join("");
      // (only when it changed, so a button doesn't vanish under the cursor)
      if (html !== drawn) $("#jobs-list").innerHTML = drawn = html;
      $("#jobs-none").hidden = s.jobs.length > 0;
    } catch (e) {
      if (inApp) note.textContent = String(e);
    }
  }
  setInterval(refresh, 2000);
  document.addEventListener("page-shown", refresh);

  return {
    show(saved) {
      if (performance.now() - changedAt < 1000) return;
      cfg = { ...DEFAULTS, ...(saved ?? {}) };
      paint();
      refresh();
    },
  };
}
