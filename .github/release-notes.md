### What's new

- **Now playing:** what's playing, in a corner of the wallpaper. The cover is drawn in coloured characters, with the title, artist and a progress bar. Show it on hover, always, or for a moment when the song changes. Rest the cursor on the cover to pause or play. It works with any player on Windows, browsers included, and with Spotify and Music on macOS (macOS asks once to let AfterGlow see them). Off by default: Settings → now playing.
- **macOS, two screens:** a second screen with a different sharpness from the main one (a MacBook with an ordinary monitor) now gets its wallpaper, and hover works on it.
- **macOS, fullscreen apps:** a fullscreen app pauses only the screen it's on. The other screen keeps going.

On 0.1.1 or older, run the install line below one more time. After that it updates from its menu.

**[afterglow.heywajih.com](https://afterglow.heywajih.com)** has the install lines with a Copy button.

### Windows

Easiest: paste this into PowerShell. It downloads the installer below, installs AfterGlow for your user only (no admin) and starts it.

```powershell
irm https://raw.githubusercontent.com/wajenaqv/afterglow/main/install.ps1 | iex
```

Or download `AfterGlow_*_x64-setup.exe` below and run it. It isn't code-signed, so Windows shows "Windows protected your PC": click **More info**, then **Run anyway**.

### macOS (Apple Silicon and Intel)

Easiest: paste this into Terminal. It downloads the `.dmg` below, puts AfterGlow in Applications and opens it.

```sh
curl -fsSL https://raw.githubusercontent.com/wajenaqv/afterglow/main/install.sh | sh
```

Or download `AfterGlow_*_universal.dmg` below and drag AfterGlow to Applications. It isn't notarized by Apple, so the first time macOS says it can't check it: open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.

Want it to react to Dock badges? Switch them on in Settings → apps; macOS will ask for permission.

Quit any other live wallpaper app first, or it will cover AfterGlow.
