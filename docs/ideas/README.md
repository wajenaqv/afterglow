# Ideas (to do)

Saved for later by the owner (2026-11-21). Nothing here is built yet. Open the `.html` mockups in a browser.

## 1. CRT afterglow effects

Mockup: [crt-afterglow-effects.html](crt-afterglow-effects.html) (animated recreations of real CRT effects; no good photos were found).

| effect | in AfterGlow |
| --- | --- |
| Radar phosphor (P7): a blue-white flash, then a long yellow afterglow | a pulse that flashes blue-white and cools into the app's colour (the literal origin of the name) |
| Oscilloscope trail: a moving dot leaves a fading line | an optional setting that leaves faint trails behind moving things |
| Switching off: the picture collapses to a line, then a dot that fades | pausing or quitting collapses the wallpaper the same way |
| Burn-in ghost: an old image stays faintly visible | a jelly marked seen leaves a faint ghost for a minute; the clock keeps the last minute faintly behind the new one |
| Scanlines and bloom | an optional CRT overlay for the wallpapers |

Sources: [two-colour, two-persistence radar display (US3114907A)](https://www.google.ca/patents/US3114907), [CAA report on radar display phosphors](https://rosap.ntl.bts.gov/view/dot/81457/dot_81457_DS1.pdf), [phosphor persistence on oscilloscopes](https://industrialmonitordirect.com/blogs/knowledgebase/cro-phosphor-persistence-normal-vs-problematic-oscilloscope-fade), [oscilloscope types](https://en.wikipedia.com/wiki/Oscilloscope_types), [CRT high-voltage discharge at switch-off (US5671016A)](https://patents.google.com/patent/US5671016), [TV repair FAQ on switch-off afterglow](https://repairfaq.org/samnew/tvfaq/tvslolatva.htm).

## 2. Apps page, reworked

Mockup: [apps-page-terminal-mockup.html](apps-page-terminal-mockup.html).

The apps page has grown complex (connectors, accounts, guides, rules and the simulator in one place). Proposal:

- One row per app (WhatsApp, Slack, Steam, Gmail, Spotify, …) with a checkbox and a live status, instead of separate connector and rule sections. Users think in apps, not in "Windows notifications" or "accounts".
- Apps that need setup get a **[ connect ]** button that walks through the guide one step at a time (back / done, next).
- Apps seen in Windows notifications (or macOS Dock badges) are offered automatically with **[ add ]**.
- What an app does (pulse / flash / nothing, colour, counts as waiting) sits under a small "customize" line per app.
- The simulator and the local endpoint move to about (or an "advanced" area).

## 3. Terminal look in Settings (no typing)

Same mockup. Bring heywajih's terminal feel back into the Settings window:

- faint scanlines and a vignette over the window (like heywajih's `body::before/::after`);
- the sidebar drawn as a folder tree (`~/afterglow/ ├─ wallpaper …`);
- controls drawn as text: `[x]` / `[ ]` checkboxes, `(•)` radios, `< value >` cyclers, `[ button ]` buttons;
- a vim-style status bar along the bottom (page, apps on, waiting, wallpaper, fps, renderer);
- the prompt line at the top shows the "command" for what you change (`$ afterglow clock --style slant --corner top-right`);
- optionally a very short boot sequence (`[ OK ] …`) the first time Settings opens, skippable.
