# Plan: new wallpapers without an app release

Status: **planned, nothing built** (2026-11-25). Anything marked *test* is an assumption to prove in step 1.

## Goal

New wallpapers, and fixes to existing ones, reach everyone without a new version of AfterGlow. The app, Settings and connectors still need a release. No server, no cost, no telemetry.

The app that can do this has to go out as a normal release first. Older copies never see packs.

## How it works

1. A **pack** holds every wallpaper page, the shared renderers and the catalog: one file, signed. Always the whole set, so shared code matches.
2. It sits on the GitHub Pages site, next to a small index.
3. The app asks for the index 30 s after starting and then daily, downloads a newer pack, checks its signature and keeps it in the settings folder.
4. New wallpapers show in Settings and the tray, marked **new**. The wallpaper in use changes only when it's next loaded; nothing is switched for you.
5. Every install still carries a built-in set. It's used offline, before the first download, and when a pack fails.

```
site/packs/latest.json    { version, api, url, signature }
site/packs/<hash>.json    the pack
```

A pack is JSON: `{ version, api, catalog, files: { "wallpapers/jellyfish.html": "<base64>", ... } }`. The app keeps the files in memory and never unpacks them to disk, so a bad path can't write anywhere. The signature covers the whole pack, `version` and `api` included, so the index can't lie about them.

- `version`: a whole number that only goes up. The app refuses a lower one.
- `api`: the contract between app and wallpapers (the messages below). A pack that needs a newer `api` than the app has is ignored until the app is updated. Pages keeps the newest pack for each `api`, so older apps don't lose theirs.

## Safety

Today a wallpaper shares the app's origin, its window has `core:default`, and it could call every Tauri command. That's fine for code that ships with the app, not for code that arrives later. Signing proves who sent it; the lockdown limits what it can do if the key leaks or a wallpaper has a bug.

- **Opaque frames.** Wallpapers run in `<iframe sandbox="allow-scripts">`, without `allow-same-origin`. They can't reach the host page, its storage or its DOM.
- **No Tauri commands.** Serving the files from our own protocol is *not* enough: Tauri counts pages of any registered custom protocol as local (`is_local_url` in tauri 2.12). *Test* that a sandboxed frame can't call a command on WebView2 and on WKWebView, whether Tauri's scripts are injected into it, and whether it can get Tauri's invoke key. If it can, the commands must check which page is calling.
- **No network.** The protocol sends a Content-Security-Policy: scripts, styles and fonts from the pack only, `connect-src 'none'`. The local endpoint already refuses requests with an Origin header; *test* that a sandboxed frame's requests carry one.
- **Messages only.** In: cursor, paused, reaction. Out: `seen` (checked against the current lanterns), `reacted`, `renderer`, `hue`, `still`, `ready`. The host accepts a message only from a frame it made (`e.source`), and checks type and size.
- **Own key.** Packs have their own signing key, not the app update key. Public half in the app, private half a repo secret and in the owner's password manager.
- **Built-in wallpapers run the same way**, so there's one path to maintain.

## What changes in the code

| Today | Becomes |
|---|---|
| `WALLPAPERS` in settings.rs, used by the tray, rotation and validation | a list read from the catalog |
| `catalog.js` bundled into Settings | `catalog` in the pack: plain data (names, tags, details, options, reactions), shown as text, never as HTML |
| host.js and common.js check `location.origin` | `e.source` checks; an opaque origin is `"null"`, so messages to a frame use `"*"` |
| host.js reads `data-renderer` and `data-hue` from the frame's document | the frame reports both by message |
| clockpage.js reads `data-hue` the same way | the same message |
| Settings previews and stills load `/wallpapers/...` | load from the pack's protocol, sandboxed; stills come back by message |
| `palettes.js`, bundled, gives the clock its colours | the catalog carries each wallpaper's colours, so a new one matches too |
| fonts and modules load same-origin | the protocol allows cross-origin loads (opaque frames need it) |

A saved wallpaper that's missing from the current set falls back to the jellyfish without being overwritten in settings.json.

## When a pack is bad

- A wallpaper posts `ready` after its first frame. If it hasn't within 10 s while not paused, the app shows the built-in version of it, or the jellyfish if there is none, and marks that wallpaper as failed for this pack version.
- The previous pack is kept. If the app fails to start with a pack twice in a row, it goes back to the previous one, then to the built-in set.
- To withdraw a pack: publish the old contents with a higher `version`.
- **Test channel:** `packs/test.json`, read only when a setting in settings.json says so (the owner's PC and Mac). A pack goes there first, then is promoted without rebuilding.

## Steps

Each step lands on its own and leaves the app working.

1. **Prototype the frame** (branch, nothing ships). One GPU wallpaper and one canvas wallpaper, sandboxed, from a custom protocol, on Windows and macOS.
   - Commands and network are blocked; WebGL2, fonts and modules work.
   - Frame rate is unchanged.
   - Memory: Chromium may give sandboxed frames their own process, and host.js counts on frames sharing one (about 10-20 MB a monitor). Measure with two monitors.
   - **Stop here if** commands can't be blocked, or a second monitor costs about 100 MB more. Then packs could still work with signing only, which the owner would have to accept knowingly.
2. **Lock down the built-in wallpapers.** Messages instead of DOM access; previews, stills, hover clock, OLED care and renderer reporting moved over. Nothing visible changes.
3. **Catalog as data.** Tray, rotation, validation, Settings and clock colours read it. Still built in.
4. **Packs.** `scripts/pack.js` builds and signs one; `packs.rs` checks, downloads, verifies, keeps and falls back. Settings → general: "get new wallpapers" (on by default, separate from app updates) and the pack version.
5. **Publishing.** A workflow run by hand builds the pack for the test channel, and a second one promotes it. `site.yml` must keep the published packs when it deploys. Document in releasing.md.
6. **Release** the app, then publish one wallpaper as the first pack.

Step 1 decides whether the rest is worth doing.

## Checks before the first pack

- A changed byte, a wrong key, a lower `version` and a newer `api` are all refused.
- Offline, half-finished download, full disk: the built-in set shows.
- A wallpaper that throws, or never draws: fallback within 10 s, on both systems.
- Every wallpaper still passes `tools/compare.html`; hover, pause, lanterns, stills and previews work.
- CPU and memory against the release before it.

## Open questions

- **Privacy wording:** the README and site need a line that AfterGlow also checks for new wallpapers. The check sends nothing about the user, but like any download it shows the host an IP address.
- **Microsoft Store (parked):** check its rules on apps that download code before sending this there.
- **Tray menu:** it lists every wallpaper. A growing catalog needs a shorter list, such as favourites.
- **Picking wallpapers:** everyone gets the whole set. Per-wallpaper downloads only if the pack grows past a few MB.
