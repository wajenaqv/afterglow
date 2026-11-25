// The reactions most wallpapers share, tracked in one place: waiting apps that
// keep their place while others come and go, messages that fade over their
// afterglow, and the flash. Times are real seconds, so a reaction fades at
// reduced motion too. Colours come out as 0..1.
//
//   const apps = trackApps({ onSeen: (app) => ... });
//   apps.waiting   [{ source, colour, i, born }]  i = its place, 0 1 2 ...
//   apps.messages  [{ source, colour, t0, tau, i }]  i = the app's place if it's
//                  waiting, else 8 and up
//   apps.flash()   0..1
//   apps.lit(app)  how far a waiting app has lit up, breathing
//   apps.glow(msg) how much of a message is left

import { onReaction } from "./common.js";

export const now = () => performance.now() / 1000;
const bytes = (c) => c.map((v) => v / 255);

export function trackApps({ onSeen = () => {}, keep = 4 } = {}) {
  let flashAt = -1e9, spot = 0;
  const apps = {
    waiting: [],
    messages: [],
    flash: () => Math.exp(-Math.max(0, now() - flashAt) / 0.7),
    lit(a) {
      const s = now() - a.born, t = Math.min(1, s / 1.2);
      return t * t * (3 - 2 * t) * (0.86 + 0.14 * Math.sin((s * 2 * Math.PI) / 5));
    },
    glow(m) {
      const s = now() - m.t0;
      return Math.min(1, s / 0.5) * Math.exp(-((s / m.tau) ** 1.5));
    },
    // drop the messages that have faded (each frame)
    tidy() {
      apps.messages = apps.messages.filter((m) => now() - m.t0 < m.tau * 3);
    },
  };
  onReaction((r) => {
    if (r.type === "pulse" && Array.isArray(r.colour)) {
      const w = apps.waiting.find((l) => l.source === r.source);
      apps.messages.push({ source: r.source, colour: bytes(r.colour), t0: now(), tau: Math.max(2, r.afterglow ?? 6), i: w ? w.i : 8 + (spot++ % 5) });
      if (apps.messages.length > keep) apps.messages.shift();
    } else if (r.type === "flash") flashAt = now();
    else if (r.type === "lanterns") {
      const next = (Array.isArray(r.items) ? r.items : []).filter((l) => Array.isArray(l.colour)).slice(0, 8);
      for (const a of apps.waiting) if (!next.some((n) => n.source === a.source)) onSeen(a);
      const kept = next.map((n) => apps.waiting.find((a) => a.source === n.source));
      const taken = new Set(kept.filter(Boolean).map((a) => a.i));
      apps.waiting = next.map((n, k) => {
        let i = kept[k]?.i;
        if (i == null) {
          for (i = 0; taken.has(i); ) i++;
          taken.add(i);
        }
        return { source: n.source, colour: bytes(n.colour), i, born: kept[k]?.born ?? now() };
      });
    }
  });
  return apps;
}
