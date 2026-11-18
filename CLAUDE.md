# afterglow

Desktop app for Windows and macOS: live ASCII/glow wallpapers behind the desktop icons that react to activity in other apps (a WhatsApp message -> the jellyfish pulses green; many unread emails -> more jellies). It replaces Wallpaper Engine / Plash for the owner's own wallpapers and adds "sockets" (connectors) that drive them.

A separate project from heywajih.com (`~/Projects/heywajih`, which stays as it is): it takes its wallpaper renderers and design language as a starting point, then diverges. Never make heywajih depend on this repo or the other way round.

## Decisions (settled, don't re-open)

- Stack: **Rust + Tauri v2** for the app and native layer; **vanilla JS + Vite** (no framework) for wallpapers and UI. Bun as package manager and script runner. The owner is more fluent in Go; Rust was picked because Tauri's multi-window, tray and plugins are stable and Microsoft's `windows` crate makes WinRT (the notification listener) routine. Keep the Rust plain and readable: no clever generics or macros where a struct and a function will do.
- Platforms: Windows and macOS, both from v1.
- v1 is for the owner only: no paid code signing, no notarization, no auto-updater, no download page. The repo is public (`wajenaqv/afterglow`), MIT for everything (code and wallpapers). Lively Wallpaper (GPL) may be read for its approach, never copied.
- Everything runs locally. No server, no telemetry. Connectors keep metadata only (which app, counts, at most a sender name), never message content. Tokens live in the OS keychain; API client ids/secrets in `.env` (git-ignored, see `.env.example`).

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
  - Windows notifications: `UserNotificationListener` (WinRT, via the `windows` crate). Needs package identity, so the Windows build is an MSIX signed with a self-signed certificate the owner trusts locally (certs never committed). Covers WhatsApp, Slack, Teams, Discord, Outlook.
  - macOS Dock badges: Accessibility API (`AXUIElement`, read the Dock items' badge labels; the approach the app Doll uses). macOS has no public API to read other apps' notifications. A badge count going up = `app.new`, the count itself = `app.unread`. Needs Accessibility permission, which macOS ties to the code signature: sign dev builds with the owner's free Apple Development certificate so the permission survives rebuilds.
  - Gmail / Outlook: OAuth with a loopback redirect (no server), then poll or IMAP IDLE. Skip Gmail push (needs Pub/Sub). An unverified Google app is limited to 100 test users, fine for v1.
  - Spotify (now playing), OS state (Do Not Disturb/Focus, time of day, battery).
  - Local endpoint `POST localhost:<port>/signal` for scripts, Home Assistant, CI.
  - Never use unofficial WhatsApp clients (Baileys, whatsapp-web.js): against WhatsApp's terms, risk of a ban.

## Phases

1. Shell on both OSes: wallpaper window per monitor behind the icons, tray, start at login, pause rules, cursor forwarding.
2. The jellyfish adapted from heywajih with reactions built in; signal bus; a signal simulator (keys/dev panel to fire fake signals); local endpoint.
3. Windows notification listener + macOS Dock badges (WhatsApp works on both).
4. Gmail/Outlook, Spotify, OS signals.
5. Rule editor UI ("when [source] [signal], [wallpaper] does [reaction] in [colour]"), more wallpapers, rotation, PNG export.
Later: sync settings between machines; if ever public: signing, notarization, MSIX/Store, updater.

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

CI (`.github/workflows/build.yml`) builds on Windows and macOS on every push and pull request.

## Owner context

- Machines: a Windows PC (Git, gh over HTTPS, VS Code, Bun 1.4.4; Wallpaper Engine) and a Mac (Homebrew, Ghostty, VS Code, gh over SSH, Bun). GitHub user `wajenaqv`.
- Comfortable in Go; new to Rust: explain non-obvious Rust when changing it.
