<p align="center">
  <img src="assets/readme/banner.svg" alt="AfterGlow: live ASCII wallpapers that glow when something happens" width="100%">
</p>

<p align="center">
  <a href="https://github.com/wajenaqv/afterglow/actions/workflows/build.yml"><img alt="build" src="https://img.shields.io/github/actions/workflow/status/wajenaqv/afterglow/build.yml?branch=main&style=flat-square&label=build&labelColor=000000&color=33ff99"></a>
  <img alt="Windows | macOS" src="https://img.shields.io/badge/windows%20%7C%20macos-33ff99?style=flat-square&labelColor=000000&label=runs%20on">
  <img alt="Tauri v2" src="https://img.shields.io/badge/tauri%20v2-7dffc0?style=flat-square&labelColor=000000&label=built%20with">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/MIT-4d8f6e?style=flat-square&labelColor=000000&label=license"></a>
</p>

<p align="center">
  <b><a href="#-download">Download</a></b> ·
  <a href="#-what-it-does">What it does</a> ·
  <a href="#-how-it-works">How it works</a> ·
  <a href="#-roadmap">Roadmap</a> ·
  <a href="#-build-from-source">Build</a>
</p>

<br>

Your desktop, quietly aware. **AfterGlow** puts glowing text-art wallpapers behind your desktop icons and lets your apps nudge them. A message arrives and a jellyfish pulses green, then slowly fades: an afterglow. No popups, no badges, no sounds. You just *see* that something is waiting.

<p align="center">
  <img src="assets/readme/jellyfish.gif" alt="Three glowing ASCII jellyfish in the cool palette, pulsing and drifting" width="100%">
</p>

## ✦ What it does

| when… | your wallpaper… |
| --- | --- |
| a WhatsApp message arrives | the jellyfish pulses green, then fades |
| your inbox fills up | more jellies drift in, one for every few unread |
| Slack or Teams pings you | a pulse in that app's colour |
| a song is playing on Spotify | breathes along, tinted by the cover |
| Do Not Disturb is on | everything slows down and dims |
| you launch a fullscreen game | it pauses. Zero CPU while you play |

You decide which app does what: *when* `source` *does* `signal`, *the wallpaper does* `reaction` *in* `colour`.

> [!TIP]
> Early days: this is where AfterGlow is headed. See the [roadmap](#-roadmap) for what works today.

## ↓ Download

**Windows**: grab `AfterGlow_<version>_x64-setup.exe` from the [latest release](https://github.com/wajenaqv/afterglow/releases/latest) and run it. It installs just for you, no admin needed.

> [!NOTE]
> The installer isn't code-signed yet, so Windows may say *"Windows protected your PC"*. Click **More info → Run anyway**.

**macOS**: build from source for now ([below](#-build-from-source)). A signed download comes later.

> [!IMPORTANT]
> Quit any other live wallpaper app (Wallpaper Engine, Lively) first: they draw in the same place behind your icons and will cover AfterGlow.

## ◉ How it works

```text
  connectors              signal bus                 wallpaper
 ─────────────          ──────────────           ─────────────────
  notifications  ──►    app.new                ──►   pulse(#33ff99)
  dock badges    ──►    app.unread  n=14       ──►   count(14)
  gmail · spotify ──►   rules: source → reaction ──► flash, dim, breathe
  your scripts   ──►    POST localhost:<port>/signal
```

- **A wallpaper host.** The wallpaper on every monitor, behind the desktop icons, with hover effects. It pauses for fullscreen apps and games, and on battery. Pause and start at login live in the tray.
- **Two signals.** Every connector boils activity down to `app.new` (something just happened) and `app.unread(n)` (how much is waiting).
- **Reactions.** Each wallpaper says what it can do (`pulse`, `count`, `flash`, …) and you choose how signals map onto them.
- **Connectors.** Windows notifications (WhatsApp, Slack, Teams, Discord), macOS Dock badges, Gmail and Outlook, Spotify, Do Not Disturb, time of day, and a local endpoint for anything else: scripts, Home Assistant, CI.

### Send signals from your own scripts

While AfterGlow runs, it listens on your own computer (nothing outside can reach it):

```sh
curl -X POST http://127.0.0.1:47811/signal -d '{"source":"build","kind":"new"}'
```

| field | |
| --- | --- |
| `source` | a name: `whatsapp`, `gmail`, `build`, … (known apps pulse in their own colour) |
| `kind` | `new` (something happened: a pulse), `unread` (how many are waiting, with `count`), `clear`, `flash` |
| `count` | for `unread` |
| `colour` | optional `#rrggbb` for the pulse |
| `afterglow` | optional seconds the pulse takes to fade (default 4) |

Requests from web pages are refused, so a website can't set your wallpaper off. To try the reactions without writing anything, use **Try a signal** in the tray menu.

### Connect your apps

Switch connectors on in **Settings → connectors**:

- **Windows notifications**: any app that shows Windows notifications (WhatsApp, Slack, Teams, Discord, …). Windows asks once to allow notification access.
- **Dock badges** (macOS): the red counts on Dock icons. macOS asks for Accessibility access (System Settings → Privacy & Security → Accessibility).
- **Gmail, Outlook, Spotify**: AfterGlow has no shared server or app keys, so you register your own (free) app and paste its client ID into Settings, then **sign in**. Use this redirect URI:

| account | where to register | redirect URI | access |
| --- | --- | --- | --- |
| Gmail | [Google Cloud Console](https://console.cloud.google.com/apis/credentials): enable the Gmail API, OAuth client of type *Desktop app* (paste its client secret too) | `http://127.0.0.1:47812/callback` | `gmail.labels` (counts only) |
| Outlook | [Microsoft Entra app registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps): account type *any organizational directory and personal Microsoft accounts*, platform *Mobile and desktop applications* | `http://localhost:47812/callback` | `Mail.ReadBasic` |
| Spotify | [Spotify developer dashboard](https://developer.spotify.com/dashboard) | `http://127.0.0.1:47812/callback` | `user-read-currently-playing` |

Sign-in tokens are kept in Windows Credential Manager or the macOS Keychain.

**Rules** (Settings → connectors → rules) change what an app does: pulse, flash or nothing on a new message, a colour of your own, and whether its count brings in more jellies. **Do Not Disturb** quiets pulses and flashes on Windows (tray → Quiet during Do Not Disturb). **Rotation** and **save a still** (a PNG at your screen's size, into Pictures/AfterGlow) are in Settings → wallpaper.

## ⚿ Private by design

- Everything runs on your machine. There is no server and no telemetry.
- AfterGlow never reads message content, only *which app* and *how many*.
- Sign-in tokens stay in your OS keychain.

## ▤ Roadmap

- [x] App scaffold, CI on Windows and macOS, Windows installer releases
- [x] Wallpaper host on Windows: behind the icons, every monitor, pause rules, hover effects
- [ ] Wallpaper host tested on macOS, with its pause rules
- [x] The jellyfish wallpaper
- [x] More wallpapers (big jellyfish, cat paws) and a Settings window to pick one, remembered across restarts
- [x] Pauses a monitor's wallpaper while windows cover it (Windows), and a frame-rate setting
- [x] GPU rendering (with a CPU fallback and a choice in Settings): a visible wallpaper costs under 1% of the CPU
- [x] Reactions (pulse, count, flash), a signal simulator, and a local endpoint for your scripts
- [x] Windows notifications and macOS Dock badges (WhatsApp works)
- [x] Gmail / Outlook, Spotify, Do Not Disturb
- [x] Rules per app, wallpaper rotation, saving a still as a PNG
- [ ] More wallpapers
- [ ] Signed installers and a macOS download

## ⌘ Build from source

You need [Bun](https://bun.sh), [Rust](https://rustup.rs) (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (Windows: Microsoft C++ Build Tools and WebView2; macOS: Xcode Command Line Tools).

```sh
bun install
bun run tauri dev      # run with hot reload
bun run tauri build    # build an installer / app bundle
```

On a Mac, the app from a CI run or your own build isn't notarized: after copying it to Applications, run `xattr -dr com.apple.quarantine /Applications/AfterGlow.app` once, or macOS says it's damaged.

<br>

<p align="center">
  <sub>Wears the colours of <a href="https://heywajih.com">heywajih.com</a> · built with <a href="https://tauri.app">Tauri</a> · <a href="LICENSE">MIT</a></sub>
</p>
