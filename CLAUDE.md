# AfterGlow

Desktop app for Windows and macOS: live ASCII/glow wallpapers behind the desktop icons that react to activity in other apps (a WhatsApp message -> the jellyfish pulses green; many unread emails -> more jellies). It replaces Wallpaper Engine / Plash for the owner's own wallpapers and adds "sockets" (connectors) that drive them.

A separate project from heywajih.com (`~/Projects/heywajih`, which stays as it is): it takes its wallpaper renderers and design language as a starting point, then diverges. Never make heywajih depend on this repo or the other way round.

## Decisions (settled, don't re-open)

- Stack: **Rust + Tauri v2** for the app and native layer; **vanilla JS + Vite** (no framework) for wallpapers and UI. Bun as package manager and script runner. The owner is more fluent in Go; Rust was picked because Tauri's multi-window, tray and plugins are stable and Microsoft's `windows` crate makes WinRT (the notification listener) routine. Keep the Rust plain and readable: no clever generics or macros where a struct and a function will do.
- Platforms: Windows and macOS, both from v1.
- Windows users get a downloadable installer `.exe` (see Distribution). macOS is build-from-source for now (no Apple Developer account yet). The repo is public (`wajenaqv/afterglow`), MIT for everything (code and wallpapers). Lively Wallpaper (GPL) may be read for its approach, never copied.
- Everything runs locally. No server, no telemetry. Connectors keep metadata only (which app, counts, at most a sender name), never message content. Tokens live in the OS keychain; API client ids/secrets in `.env` (git-ignored, see `.env.example`).

## Brand

- Name: **AfterGlow** (capital A and G) wherever people read it: window titles, installer, tray, README, release names. Lowercase `afterglow` only for technical ids: repo, package and crate names, `com.wajenaqv.afterglow`, file paths. "afterglow" (lowercase, common noun) is also the word for how long a reaction lingers.
- Colours: heywajih.com's default CRT green theme is the brand. Tokens in `src/style.css` `:root`, same names and roles as heywajih: `--bg #000000`, `--fg #33ff99`, `--dim #4d8f6e`, `--accent #7dffc0`, `--bright #ffffff`, `--glow 51,255,153` at `--glow-a 0.45`, `--logo-top #ffffff` -> `--logo-bottom #33ff99`. Never hard-code a colour outside that block.
- Where: everything that is AfterGlow itself (app windows, settings, tray, wordmark, icon, README art, release pages) uses the brand palette. Wallpapers keep their own palettes (the jellyfish's natural palette is the owner's favourite) and also offer the brand green; reactions default to brand green unless a rule picks another colour.
- Font: JetBrains Mono, ligatures off on character grids. The look is heywajih's terminal: black, green text with a soft glow.
- Logo (owner's choice): an ASCII "AG" in figlet's Slant font, the README banner's style. `scripts/icon.js` draws the figlet art as vector strokes (`_` bottom edge, `/` `\` corner to corner, `|` down the middle), so it's crisp at any size and needs no font: `assets/icon/app.svg` (black rounded square, AG fading white to green, soft glow), `tray.svg` (Windows tray: bold green AG on a black plate, readable on light and dark taskbars), `tray-mac.svg` (black AG, used as a macOS template image). Regenerate: `bun scripts/icon.js && bun run tauri icon assets/icon/app.svg && bun run tauri icon assets/icon/tray.svg -o src-tauri/icons/tray/win --png 32 && bun run tauri icon assets/icon/tray-mac.svg -o src-tauri/icons/tray/mac --png 44`, then delete `src-tauri/icons/android` and `ios` (not targets). tray.rs embeds the tray PNGs.

## Architecture (planned)

```
src-tauri/          Rust: wallpaper windows, tray, settings, signal bus, connectors
  wallpaper host    one window per monitor behind the icons
  bus               signals in, rules, reactions out (Tauri events to the wallpaper webviews)
  connectors        notifications (Win), dock badges (mac), gmail, outlook, spotify, os, local endpoint
src/                JS: wallpapers, shared renderers, settings/picker/rule editor UI
```

- **Wallpaper windows.** Windows: send Progman `0x052C` to spawn a `WorkerW`, parent our window under it (Windows 11 24H2 changed this layout: test on the owner's build). macOS: borderless window at desktop level (`kCGDesktopWindowLevel`), ignores mouse events, joins all Spaces, one per screen; follow screens being plugged/unplugged.
- **Cursor forwarding.** Windows behind the icons get no mouse events, so the app polls the cursor (Windows `GetCursorPos`, macOS `NSEvent.mouseLocation`, no permission needed) and sends it to the wallpaper, so hover effects still work. Every wallpaper must still look complete with no cursor.
- **Pause** when a fullscreen app/game is in front (the owner plays Overwatch and CS2 daily), on battery, and in Low Power Mode on macOS.
- **Signals.** Two normalized types every platform can produce: `app.new { source }` (pulse/flash) and `app.unread { source, n }` (counts). Wallpapers declare their reactions (`pulse(colour)`, `count(n)`, `flash`); rules map source + signal -> wallpaper reaction + colour. How long a reaction lingers is called its `afterglow`.
- **Connectors.**
  - Windows notifications: `UserNotificationListener` (WinRT, via the `windows` crate). Covers WhatsApp, Slack, Teams, Discord, Outlook. Needs package identity, which a plain NSIS `.exe` install doesn't have: either a sparse package (package with external location) registered by the installer, or an MSIX. Both must be signed with a certificate the user's PC trusts, so for public users this connector depends on real code signing (see Distribution). Until then it works only on the owner's PC (self-signed certificate trusted locally, never committed), and public users get the other connectors.
  - macOS Dock badges: Accessibility API (`AXUIElement`, read the Dock items' badge labels; the approach the app Doll uses). macOS has no public API to read other apps' notifications. A badge count going up = `app.new`, the count itself = `app.unread`. Needs Accessibility permission, which macOS ties to the code signature: sign dev builds with the owner's free Apple Development certificate so the permission survives rebuilds.
  - Gmail / Outlook: OAuth with a loopback redirect (no server), then poll or IMAP IDLE. Skip Gmail push (needs Pub/Sub). An unverified Google app is limited to 100 test users you add by hand; public users need the app verified by Google (needs a privacy policy page). The desktop OAuth client id ships inside the app (normal for desktop apps; Google treats it as public), so it's set at build time from a CI secret, not committed.
  - Spotify (now playing), OS state (Do Not Disturb/Focus, time of day, battery).
  - Local endpoint `POST localhost:<port>/signal` for scripts, Home Assistant, CI.
  - Never use unofficial WhatsApp clients (Baileys, whatsapp-web.js): against WhatsApp's terms, risk of a ban.

## What exists (phase 1 done on Windows, merged 2026-11-18)

- `src-tauri/src/host.rs`: borderless webview windows behind the icons (labels `wall-<generation>-<n>`, fresh labels on every rebuild), each loading `wallpapers/host.html`, which puts one same-origin frame per monitor showing the wallpaper (layout passed in `window.__AFTERGLOW__` by an initialization script). On Windows with every monitor at the same scale, ONE window spans all monitors; otherwise (mixed scales, macOS) one window per monitor; threads for the cursor (33 ms, `app.cursor_position()` -> `cursor` event `{x, y}` in CSS px or `null`, sent only to the window under the cursor), pause (2 s: tray Pause, fullscreen app, battery -> `paused` event to every wall, re-sent each tick so new windows catch up) and monitors (3 s: rebuild when the layout changes, on the main thread).
- `src-tauri/src/platform/windows.rs`: Progman `0x052C`, WorkerW lookup (pre-24H2 sibling of `SHELLDLL_DefView`, else child of Progman), `SetParent`, child coords relative to the virtual screen, `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`; `restore_desktop()` re-applies the current wallpaper on quit; fullscreen = `SHQueryUserNotificationState` busy/D3D/presentation; battery = `GetSystemPowerStatus`.
- `src-tauri/src/platform/macos.rs`: `setLevel:` desktop level, `setCollectionBehavior:` all Spaces + stationary + ignores cycle, `setIgnoresMouseEvents:`. Fullscreen and battery detection are TODO (return false).
- `src-tauri/src/tray.rs`: Pause, Pause when an app is fullscreen, Pause on battery, Start at login (autostart plugin), Settings… (the hidden `main` window), Quit. macOS runs as an accessory app (menu bar only, no Dock icon). Single-instance plugin: a second launch opens Settings.
- The settings window (`index.html`, label `main`) is created by `tray::show_settings` when opened and destroyed when closed (a hidden webview costs ~100 MB). `RunEvent::ExitRequested` with no exit code is prevented, so closing windows never quits; only Quit does.
- Tested by the owner on Windows (2026-11-18): behind the icons on both monitors, hover, tray Pause, fullscreen pause, Quit restoring the wallpaper. Other live wallpaper apps (Wallpaper Engine, Lively) draw in the same WorkerW and cover AfterGlow: quit them first.
- `src/wallpapers/common.js` + `jellyfish.js`: ported from heywajih (look unchanged). In the app, cursor and pause come from the window-scoped Tauri events; in a browser, DOM pointer events and never paused. A paused wallpaper stops requesting frames (`isPaused`/`whenResumed`). JetBrains Mono is bundled (`@fontsource`), so wallpapers work offline. Brand tokens live in `src/brand.css`, shared by the app window and wallpapers.
- `tools/record.html` (dev only, `bun run dev`): records the README's jellyfish card GIF and saves it to `assets/readme/jellyfish.gif` through a dev-only Vite endpoint (`vite.config.js`, fixed file names only). `scripts/readme-art.js` makes the banner.
- Memory (owner's PC, 2560x1440 + 1080x1920 portrait, both 100%, dev build, jellyfish on both): ~430 MB private total, ~116% of one core. Hidden Settings window removed (-100 MB, it's created on demand now); one window for both monitors (-20 MB). Tried and dropped: WebView2 `--force-gpu-mem-available-mb` / `--js-flags` (no effect), CPU canvas `willReadFrequently` (+90 MB). What's left is WebView2's GPU process (~200 MB) and the renderer with both scenes (~165 MB); the real fix would be a native Rust renderer.
- Not yet: settings UI and choosing a wallpaper, persisting tray choices (they reset on restart), macOS pause rules, Low Power Mode.

## Phases

Owner's priority (2026-11-18): get the basic app working (several wallpapers you can pick, remembered) before signals and connectors.

1. Done on Windows: shell, wallpaper windows behind the icons, tray, start at login, pause rules, cursor forwarding. macOS compiles but is untested.
2. Done on Windows: a basic app. Paws and big jellyfish ported; Settings with a wallpaper picker (live previews, per-wallpaper options) and a frame-rate setting (30/20/15 fps); switching applies live; choices remembered; Wallpaper and Frame rate submenus in the tray; the AG logo as app and tray icon; per-monitor pause while app windows hide the desktop (Windows). Still open: run it on the owner's Mac and add the macOS pause rules (fullscreen, battery, covered).
3. Next (owner, 2026-11-18): a GPU renderer (WebGL2) for the jellyfish, then the paws, to cut the cost of a visible wallpaper towards ~1% of the CPU. The GPU computes the light (bell/arm/tentacle samples generated in shaders, additive blending into a cell-sized float texture), blurs it and picks each cell's glyph from a pre-rendered glyph atlas; the CPU only sends per-jelly numbers (position, pulse, colour) each frame. Must look the same as the CPU renderer (check with tools/compare.html); keep the CPU renderer as the fallback without WebGL2. Baseline to beat (owner's PC, two monitors, visible, 30 fps): ~86% of one core.
4. Reactions and the signal bus: jellyfish `pulse(colour)`, `count(n)`, `flash`; paws reactions; a signal simulator; the local endpoint.
5. Windows notification listener + macOS Dock badges (WhatsApp works on both).
6. Gmail/Outlook, Spotify, OS signals.
7. Rule editor UI ("when [source] [signal], [wallpaper] does [reaction] in [colour]"), more wallpapers, rotation, PNG export.
Later: sync settings between machines; code signing (Windows), Apple notarization and a macOS download, in-app updates.

## Distribution

- Windows: `.github/workflows/release.yml` runs on a `v*` tag, builds the NSIS installer (`AfterGlow_<version>_x64-setup.exe`, per-user install, no admin) with `tauri-action`, and attaches it to a **draft** GitHub Release that the owner reviews and publishes. Bump `version` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together before tagging.
- Unsigned for now: SmartScreen shows "Windows protected your PC" (More info -> Run anyway); the release notes and README say so.
- Signing options when it's time: Azure Trusted Signing (cheapest, monthly fee; check eligibility for individuals in the owner's country) or an OV code-signing certificate (yearly). Signing also unlocks the notification connector for public users (package identity, above). SmartScreen reputation still builds up over downloads.
- In-app updates: Tauri's updater plugin with its own (free) update-signing key, serving `latest.json` from GitHub Releases. Not set up yet; the private key would be a repo secret, never committed.

## Design language (from heywajih, keep it)

- One bold subject on black, few colours, slow motion, transparency and glow. Scenes sit offset with dark space around them; keep the left fifth clear for desktop icons when a scene is placed.
- Not too much light: tight halos, no bleed. Light adds up per cell, is tone-mapped, and the glyph comes from a brightness ramp; fading light ends in scattered dither specks, never a hard outline.
- Wallpapers are beautiful still renders, not interactive scenes: no dragging or auto-turning. Hover effects are small extras, one per wallpaper.
- Reactions follow the same rules: a pulse is a gentle brightening that fades (an afterglow), not a flash bang, popup or text.
- What failed on heywajih (don't repeat): busy many-object scenes (bedroom, window nap, keyboard cat), skylines in ASCII, a date palm (fine greens/browns never got pretty), hand-drawn rings for the black hole, solid fills that wash pastels out.
- Received best: the jellyfish (natural palette is the owner's favourite) and the clock.

## Technical rules carried over

- Never parse theme colour variables as hex (minifiers turn `#000000` into `#000`); let the browser resolve colours.
- Even frame pacing: 30 fps as a whole number of screen refreshes on a fixed-step deadline (a plain 24 fps timer judders 3:2 at 60 Hz).
- Ligatures off on character grids (JetBrains Mono merges `!=`, `==`, `|=`).
- Respect `prefers-reduced-motion`.
- Test the release build (`bun run tauri build`), not only dev.

## Commands

- `bun install`
- `bun run tauri dev` (Vite on localhost:5173 plus the app window)
- `bun run tauri build`
- `bun run dev` / `bun run build`: the web side only

CI (`.github/workflows/build.yml`) builds on Windows and macOS on every push and pull request. Releases: `.github/workflows/release.yml` (see Distribution).

## Owner context

- Machines: a Windows PC (Git, gh over HTTPS, VS Code, Bun 1.4.4; Wallpaper Engine) and a Mac (Homebrew, Ghostty, VS Code, gh over SSH, Bun). GitHub user `wajenaqv`.
- Comfortable in Go; new to Rust: explain non-obvious Rust when changing it.
