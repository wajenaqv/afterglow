### What's new

- **Now playing on macOS:** Spotify's album covers now show. Before, the card drew a placeholder pattern instead of the cover. A cover that isn't ready right after a song changes is also asked for again.

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
