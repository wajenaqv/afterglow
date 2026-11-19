# Handover: test AfterGlow on macOS

For a Claude Code agent running **on the owner's Mac**. Read `CLAUDE.md` first: it has the decisions, the architecture and the owner's rules.

## Where things stand (2026-11-19)

- AfterGlow is a Tauri v2 (Rust + vanilla JS/Vite, Bun) app that puts ASCII live wallpapers behind the desktop icons and makes them react to app activity (signals → pulse / count / flash).
- On `main`: the wallpaper host, three wallpapers (jellyfish, big jellyfish, paws) with GPU (WebGL2) and CPU renderers, Settings, tray/menu bar, pause rules, signals + local endpoint (127.0.0.1:47811), connectors (Windows notifications, macOS Dock badges), accounts (Gmail, Outlook, Spotify via OAuth PKCE on port 47812), rules, rotation, save-a-still.
- Everything was built and tested on **Windows**. The macOS code has **only ever been compiled by CI** (macos-latest, green). It has never run. Expect bugs; that's what this pass is for.

macOS-specific code to suspect first:

| file | what | risk |
| --- | --- | --- |
| `src-tauri/src/platform/macos.rs` `attach` | puts each wall window at the desktop level (`setLevel:`, collection behaviour all Spaces + stationary, ignores mouse) via objc2 `msg_send` | window above/below the icons, missing on other Spaces, eats clicks |
| `platform/macos.rs` FFI | hand-declared CoreFoundation / CoreGraphics / IOKit / ApplicationServices functions (`unsafe extern "C"`) | a wrong signature or a missing `#[link]` = crash or garbage |
| `fullscreen_app_in_front`, `covered` | `CGWindowListCopyWindowInfo`, layer-0 windows of other apps, frames in points (divided by scale) | wrong coordinate space (CG is top-left origin, global points); Retina scale handling |
| `on_battery`, `low_power_mode` | IOKit power sources, `NSProcessInfo.isLowPowerModeEnabled` | |
| `dock_badges`, `accessibility_trusted` | Accessibility API: Dock pid → AX children → `AXList` → items' `AXStatusLabel` | needs Accessibility permission for the binary that runs (Terminal / the dev binary when using `tauri dev`) |
| `host.rs` | one wall window per monitor on macOS (Windows uses one spanning window) | positions on displays with negative origins / mixed Retina |
| `tray.rs` | template tray icon `icons/tray/mac/44x44.png`, accessory app (no Dock icon) | |
| `connectors/oauth.rs` | refresh tokens in the Keychain via `keyring` (apple-native) | Keychain prompts |

`do_not_disturb()` returns false on macOS by design (no public Focus API).

## Setup

The owner's Mac has Homebrew, Bun, fnm/Node, `gh` (logged in as `wajenaqv`, SSH). It may need:

```sh
xcode-select --install                 # if the Command Line Tools are missing
curl https://sh.rustup.rs -sSf | sh    # Rust stable, if `cargo` is missing (ask the owner first)
git clone git@github.com:wajenaqv/afterglow.git ~/Projects/afterglow
cd ~/Projects/afterglow && bun install
git checkout -b mac-fixes
```

Run with `bun run tauri dev` (in the background; its output is the app log, every line starts with `afterglow:`). Quit any other wallpaper app (Plash) first.

Alternative without building: the CI artifact `afterglow-macos-latest` (a `.dmg`, Apple Silicon) from the latest green run on main: `gh run list -R wajenaqv/afterglow -b main -L 1`, then `gh run download <id> -R wajenaqv/afterglow -n afterglow-macos-latest`. Unsigned: after copying to /Applications run `xattr -dr com.apple.quarantine /Applications/AfterGlow.app`.

## Test checklist

The owner has to look at the screen for most of these; ask them and record the answers. Use the log for the rest.

1. **Starts**: no crash; menu bar AG icon (template, adapts to light/dark); no Dock icon. Log shows `N monitor(s) ... -> N wallpaper window(s)`.
2. **Behind the icons**: jellies on every display, under the desktop icons and Finder windows, clicks on the desktop still reach Finder (select icons, right-click desktop).
3. **Spaces and fullscreen**: switch Spaces; the wallpaper is on each. Mission Control doesn't show the wall windows as app windows.
4. **Hover**: a jelly under the cursor flashes (cursor events come from Rust, `host.rs`).
5. **Pause rules** (log line `paused per monitor: [..]`): fullscreen app on one display pauses that display only; a maximized (zoomed) window covering a display pauses it; on battery (laptop, unplug) and Low Power Mode pause; tray Pause pauses everything.
6. **Settings…**: opens; previews render; switching wallpaper and options applies live; frame rate; Rendering GPU/CPU and the "running on" line; save a still writes a PNG to ~/Pictures/AfterGlow and "open folder" opens it; rotation (set 5 minutes to see one switch, or temporarily lower it locally, don't commit that).
7. **Signals**: menu bar → Try a signal → WhatsApp message (green pulse), 3 more waiting (more jellies), Flash. And `curl -X POST http://127.0.0.1:47811/signal -d '{"source":"build","kind":"new"}'`.
8. **Dock badges**: Settings → connectors → Dock badges on; macOS asks for Accessibility (System Settings → Privacy & Security → Accessibility; under `tauri dev` the entry may be Terminal/Ghostty or the `afterglow` binary). Status line shows what it sees. A new badge (message to the owner in WhatsApp / Messages / Mail) should pulse and raise the count; reading it should clear.
9. **Rules**: Settings → rules, add `whatsapp` → flash, check Try a signal does a flash.
10. **Accounts** (optional, only if the owner has registered apps; see README "Connect your apps"): sign in to Spotify, play a song, track changes pulse. Keychain prompts are expected.
11. **Quit**: the desktop is back to the normal wallpaper; no leftover windows.
12. **CPU**: Activity Monitor with the wallpaper visible, at GPU rendering: note % for AfterGlow + its WebKit processes. On Windows it's ~12% of one core for the big jellyfish at 15 fps on two monitors; covered/paused should be ~1%.

## Rules for this work

- Work on the `mac-fixes` branch. Commit fixes there with clear messages; push the branch; run CI with `gh workflow run build.yml -R wajenaqv/afterglow --ref mac-fixes` (push alone doesn't trigger it). **Don't merge into main** without the owner's OK.
- Keep Windows working: platform code goes behind `#[cfg(target_os = "macos")]` / in `platform/macos.rs`; CI builds both.
- Don't install software or change system settings without asking the owner. Permissions prompts (Accessibility, Keychain) are the owner's to click.
- Wallpapers must keep looking the same (see CLAUDE.md "Rules for wallpapers" and the design language). This pass is about the macOS host, not new features.
- Update `CLAUDE.md` ("What exists", phases) with what was verified on the Mac and what was fixed.

## Report back

A short list: each checklist item passed / failed / not tried, what was fixed (commits on `mac-fixes`), what's still broken, and CPU numbers.
