# Handover: lag fix, to verify on Windows

For the agent on the owner's Windows PC. Written 2026-11-24 from a session on the owner's Mac
(MacBook Air M5, macOS 26.6, 60 Hz assumed, one 3840x2486 display). Read `CLAUDE.md` first.

The changes are on the branch `fix/compositing-lag`, based on `24825bc` (`origin/main` on 2026-11-24).

## Your task

1. Check out `fix/compositing-lag` and build it.
2. Check that the shared frame loop works on Windows (the risks below), and fix what doesn't.
3. Report back. Ask the owner before committing, pushing, releasing or replacing their installed app.

## The problem and the evidence

The owner's Mac lagged with AfterGlow running, worst when using its menu bar menu.

- **Wallpaper cost.** Each frame loop called `requestAnimationFrame` on every refresh and skipped the frames
  it didn't need. At 15 fps this cost far more GPU power than sleeping on a timer. One request
  per frame, asked just before it was due, was still dear (about 410 mW against 267 mW). Why macOS
  charges this much for it was not established.
- **Menu.** While the owner used AfterGlow's menu, requests to macOS's window server took up to 926 ms
  (normally about 1 ms). Other apps' menus stalled too, less: mostly 60-330 ms, one 568 ms, with AfterGlow quit.

GPU power added by AfterGlow on the Mac (above about 160 mW with it quit), GPU renderer, one or two 8 s runs each:

| Wallpaper | Before | After |
|---|---|---|
| Big jellyfish, 15 fps | 342 mW | 105 mW |
| Big jellyfish, 30 fps | 417 mW | 232 mW |
| Sakura, 15 fps | 234-334 mW | 110 mW |
| Sakura, 30 fps | 374 mW | 146 mW |

The CPU renderer at 30 fps did not improve (492 -> 494 mW, whole Mac). None of this was measured on Windows.

## What changed

| File | Change | Affects Windows? |
|---|---|---|
| `src/wallpapers/common.js` | New `paceFrames(fps, draw)`: measures the refresh for 60 animation frames, then draws from `setTimeout`, aimed mid-refresh, re-aligned every 10 s; stops while paused | **Yes** |
| `jellyfish.js`, `nightscene.js`, `startrails.js`, `heyclock.js` | Use `paceFrames` instead of their own loops. `nightscene.js` covers most of the other wallpapers | **Yes** |
| `src/main.js` | Settings previews run only when on screen and the window has focus | **Yes** |
| `src-tauri/src/host.rs` | `menu_busy` / `menu_turn`: wallpapers hold while the menu is open and 0.9 s after it closes. `apply_pause` sends `flags OR menu_busy`, but keeps the menu out of `last_paused` so messages aren't treated as missed | Compiles there; only macOS sets `menu_busy` |
| `src-tauri/src/platform/macos.rs` | `watch_menus` (menu open/close notifications) | No |

## What was verified, and what wasn't

- macOS: the release build succeeds and the 4 Rust tests pass on the final code; none cover these changes.
- macOS: the owner confirmed smooth motion and a faster menu. The menu was not re-measured after the fix.
- **Not done:** any Windows build or run; `tools/compare.html`; the preview change in the real app.

## Windows risks to check (reasoned from the code, not observed)

1. **Timer accuracy.** Windows timers can be coarser (up to about 15.6 ms). The mid-refresh aim only tolerates
   about +/-8 ms at 60 Hz and +/-3.5 ms at 144 Hz. Late timers show as judder. Log draw intervals over a
   minute: they should be the same whole number of refreshes.
2. **Throttling.** Chromium can slow timers to 1 per second in pages it thinks are hidden or occluded, and the
   wallpaper sits behind the icons. Check the frame rate holds with the desktop visible, after several
   minutes, and after lock/unlock and sleep/wake.
3. **Two monitors with different refresh rates.** One window can span both; `paceFrames` measures one rate.
4. **Pause and resume.** Tray Pause, a fullscreen game, covered desktop, battery: stops, then resumes cleanly,
   including when toggled quickly (no double speed: that would mean two loops).
5. **Settings previews.** They freeze when Settings loses focus; check they resume, switching tabs works, and
   none stays blank (a page paused before its first frame may be).
6. **Warnings.** `menu_turn` is only read in macOS code, so Windows may warn that it's never read. If it does,
   gate it to macOS.

If timers judder or throttle on Windows, a likely answer is the old `requestAnimationFrame` loop on Windows and the
timer on macOS, inside `paceFrames` so the wallpapers don't change. Measure the old build first: the saving may
be macOS-only.

## Steps

In the repo, with a clean working tree:

```bash
git fetch origin
git switch fix/compositing-lag
bun install
cargo test --manifest-path src-tauri/Cargo.toml --lib
bun run tauri build
```

Then:

- Compare before and after in the same conditions: GPU renderer, 15 and 30 fps, big jellyfish and Sakura,
  Settings closed. Compare power or clocks if you can: GPU "busy %" misled us on the Mac, because the GPU
  lowers its clock under light load.
- Run `tools/compare.html` (`bun run dev`).
- Quit Wallpaper Engine first: it draws in the same place. Don't replace the owner's settings; restore them
  if you change them.
- **Ask before any test that shows on the desktop.** On the Mac, full-screen test pages and freezing
  AfterGlow's processes disrupted the owner's desktop, and WebKit killed AfterGlow's GPU process.

## Open

- Sakura's page still uses about 15% of a core at 15 fps (Mac): its per-frame layout on the CPU.
- The CPU renderer at 30 fps is unchanged.
- Star trails has no valid "before" figure.
- `src/wallpapers/clock.js` still uses animation frames for its one-second scramble (short-lived, left alone).
- The old pacing notes in `CLAUDE.md` don't describe `paceFrames` yet.
