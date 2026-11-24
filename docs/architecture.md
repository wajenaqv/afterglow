# Architecture

AfterGlow is a Tauri v2 app: Rust for the windows, tray and connectors, vanilla JS (Vite) for the wallpapers and Settings. Each file says more at the top.

```
src-tauri/src/
  host.rs        wallpaper windows behind the icons; cursor, pause and monitor loops
  platform/      the per-OS part (WorkerW on Windows, desktop window level on macOS)
  signals.rs     signals in, reactions out to the wallpapers
  apps.rs        the apps heard from: allowed or blocked, what each one does
  connectors/    watchers that turn other apps' activity into signals
  awake.rs       keeps the computer awake, by hand or while chosen apps run
  endpoint.rs    the local endpoint (POST 127.0.0.1:47811/signal)
  settings.rs    saved choices; tray.rs, extras.rs, updates.rs, logfile.rs
src/
  main.js        the Settings window (index.html), terminal.js its look
  wallpapers/    one file per wallpaper, plus the shared renderers
wallpapers/      one page per wallpaper; host.html frames one per monitor
```

## From a message to a glow

A connector reports how many messages each app has waiting. `signals.rs` turns a change into a signal (`new`, `unread`, `clear`, `flash`), applies what the user chose for that app (`apps.rs`: allowed or blocked, pulse or flash, colour), and sends a reaction to every wallpaper:

- `pulse`: a gentle brightening in the app's colour that fades (its afterglow)
- `count`: how many messages are waiting in all
- `lanterns`: the apps with something waiting; resting the cursor on one marks it seen
- `flash`: the whole scene brightens

Reactions that arrive while nobody is watching are held and replayed. AfterGlow keeps which app and how many, never message content. Sign-in tokens stay in the OS keychain.

## Wallpapers

- A wallpaper has a GPU renderer (WebGL2) and a CPU one (canvas 2D) that look the same, picked in Settings, with the CPU as the fallback. The clock's text styles and star trails are exceptions with one renderer. `tools/compare.html` shows both side by side.
- It stops requesting frames while paused (`common.js`), takes `?fps`, respects `prefers-reduced-motion` and looks complete without the cursor.
- Windows behind the icons get no mouse events, so the app polls the cursor and forwards it.
- Add one in `wallpapers/<id>.html`, `src/wallpapers/catalog.js`, `WALLPAPERS` in `settings.rs` and the inputs in `vite.config.js`.

## Conventions

- Colours come from the tokens in `src/brand.css`; let the browser resolve them, never parse them as hex.
- Ligatures stay off on character grids.
- Keep the Rust plain: a struct and a function before a generic or a macro.

## Icons

`bun scripts/icon.js` draws the SVGs in `assets/icon/`. Then:

```sh
bun run tauri icon assets/icon/app.svg
bun scripts/icon-ico.js
bun run tauri icon assets/icon/tray.svg -o src-tauri/icons/tray/win --png 32
swift scripts/macos/svg-to-png.swift assets/icon/tray-mac.svg src-tauri/icons/tray/mac/tray.png   # on a Mac
```

Delete the generated `src-tauri/icons/android` and `ios`.
