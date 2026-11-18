# afterglow

Live ASCII wallpapers for Windows and macOS that glow when something happens.

A WhatsApp message arrives and a jellyfish pulses green, then slowly fades. Your inbox fills up and more jellies drift in. Afterglow puts glowing text-art wallpapers behind your desktop icons and lets your apps nudge them, so you can tell at a glance that something is waiting, without a single popup.

> **Status:** early. The app scaffold exists; the wallpaper host, the first wallpapers and the connectors are being built.

## Download

**Windows:** grab `Afterglow_<version>_x64-setup.exe` from the [latest release](https://github.com/wajenaqv/afterglow/releases/latest) and run it. It installs for your user only, no admin needed.

The installer isn't code-signed yet, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**.

**macOS:** build from source for now (see below).

## How it works

```
connectors ──► signal bus ──► wallpaper
notifications       { type: "app.new",    source: "whatsapp" }   →  pulse green
dock badges         { type: "app.unread", source: "mail", n: 14 } →  more jellies
gmail · spotify · your own scripts (POST localhost:<port>/signal)
```

- **Wallpaper host.** A window per monitor behind the desktop icons (WorkerW on Windows, a desktop-level window on macOS), paused when a fullscreen app or game is in front, or on battery.
- **Signals.** Connectors turn activity into two kinds of signal: `app.new` (something just happened) and `app.unread(n)` (how much is waiting). Wallpapers declare reactions such as `pulse(colour)`, `count(n)` and `flash`; rules map one to the other.
- **Connectors.** Windows notifications (WhatsApp, Slack, Teams, …), macOS Dock badge counts, Gmail and Outlook unread counts, Spotify, OS state (Do Not Disturb, time of day), and a local endpoint for anything else. Everything runs on your machine; there is no server, and message content is never read or stored, only which app and how many.

## Build from source

Prerequisites: [Bun](https://bun.sh), [Rust](https://rustup.rs) (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (Windows: Microsoft C++ Build Tools and WebView2; macOS: Xcode Command Line Tools).

```sh
bun install
bun run tauri dev      # run with hot reload
bun run tauri build    # build an installer / app bundle
```

Connectors that need API keys read them from `.env`; copy `.env.example` and fill in only the ones you use.

## Built with

[Tauri v2](https://tauri.app) (Rust) for the app, plain JavaScript and [Vite](https://vite.dev) for the wallpapers and settings.

## License

[MIT](LICENSE)
