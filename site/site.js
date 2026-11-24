// The download page: shows one system's steps and copies its command.
// Without JavaScript both systems' steps show.
const tabs = document.querySelectorAll(".tabs button");
function show(os) {
  for (const id of ["mac", "win"]) document.getElementById(id).hidden = id !== os;
  for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.os === os));
}
for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.os));
document.querySelector(".tabs").hidden = false;
const onMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
show(onMac ? "mac" : "win");

for (const button of document.querySelectorAll(".copy")) {
  button.hidden = false;
  const code = button.parentElement.querySelector("code");
  button.addEventListener("click", async () => {
    let text = "Copied";
    try {
      await navigator.clipboard.writeText(code.textContent);
    } catch {
      // Not allowed to copy: select it so the keyboard shortcut works.
      getSelection().selectAllChildren(code);
      text = onMac ? "Press ⌘C" : "Press Ctrl+C";
    }
    button.textContent = text;
    document.getElementById("said").textContent = text;
    setTimeout(() => { button.textContent = "Copy"; }, text === "Copied" ? 2000 : 5000);
  });
}

// The wordmark reacts to the pointer, like heywajih.com's logo: characters
// near it light up and move away a little, and small characters sparkle all
// around, on a grid twice as fine. It only runs while the pointer is near.
const art = document.querySelector(".art");
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const SPARK = "·.'`:+*-=";
  const FINE = 2; // spark cells per character, each way
  const BIRTH = 0.08, DEATH = 0.08; // chance per frame, next to the pointer
  const any = (s) => s[Math.floor(Math.random() * s.length)];
  const round = (v, step) => Math.round(v / step) * step;
  const rows = art.textContent.split("\n");
  const cols = Math.max(...rows.map((r) => r.length));

  // A grid of one-character boxes: parent gets a line per row
  function grid(parent, text) {
    return text.flatMap((row, y) => {
      const line = document.createElement("div");
      parent.append(line);
      return [...row].map((ch, x) => {
        const el = document.createElement("i");
        el.textContent = ch;
        line.append(el);
        return { el, ch, x: (x + 0.5) / row.length, y: (y + 0.5) / text.length, h: 0, off: "" };
      });
    });
  }
  art.textContent = "";
  const strokes = grid(art, rows.map((r) => r.padEnd(cols))).filter((c) => c.ch !== " ");
  [...art.children].forEach((line, y) => {
    const fade = Math.round((1 - y / (rows.length - 1)) * 100);
    line.style.setProperty("--base", `color-mix(in srgb, var(--logo-top) ${fade}%, var(--logo-bottom))`);
  });
  const layer = document.createElement("div");
  layer.className = "sparks";
  const sparks = grid(layer, Array.from({ length: rows.length * FINE }, () => " ".repeat(cols * FINE)));
  art.append(layer);
  art.classList.add("live");

  let mx = -1e4, my = -1e4, running = false;
  function draw() {
    const rect = art.getBoundingClientRect();
    const cw = rect.width / cols;
    const reach = Math.max(60, cw * 7);
    let busy = false;
    // how near the pointer a cell is: 0 (out of reach) to 1
    const near = (c) => {
      const dx = rect.left + c.x * rect.width - mx, dy = rect.top + c.y * rect.height - my;
      const dist = Math.hypot(dx, dy);
      const p = Math.max(0, 1 - dist / reach);
      if (p > 0) busy = true;
      return [p * p * (3 - 2 * p), dx, dy, dist];
    };
    const glow = (c, h) => {
      if (h !== c.h) c.el.style.setProperty("--h", (c.h = h));
    };
    for (const c of strokes) {
      const [p, dx, dy, dist] = near(c);
      const push = p > 0.02 && dist > 0 ? (p * cw * 0.9) / dist : 0;
      const off = push ? `translate(${round(dx * push, 0.5)}px,${round(dy * push, 0.5)}px)` : "";
      glow(c, round(p, 0.05));
      if (off !== c.off) c.el.style.transform = c.off = off;
    }
    for (const c of sparks) {
      const [p] = near(c);
      let ch = " ";
      if (p > 0.12) {
        if (c.ch !== " ") ch = Math.random() < DEATH ? " " : c.ch;
        else if (Math.random() < p * BIRTH) ch = any(SPARK);
      }
      glow(c, ch === " " ? 0 : round(p, 0.1));
      if (ch !== c.ch) c.el.textContent = c.ch = ch;
    }
    // nothing near: every cell is back to normal, so stop
    running = busy;
    if (busy) requestAnimationFrame(draw);
  }
  const point = (x, y) => {
    mx = x;
    my = y;
    if (running) return;
    running = true;
    requestAnimationFrame(draw);
  };
  const away = () => point(-1e4, -1e4);
  addEventListener("pointermove", (e) => point(e.clientX, e.clientY), { passive: true });
  addEventListener("pointerdown", (e) => point(e.clientX, e.clientY), { passive: true });
  addEventListener("pointerup", (e) => e.pointerType !== "mouse" && setTimeout(away, 400));
  addEventListener("pointercancel", away);
  document.documentElement.addEventListener("mouseleave", away);
}
