### What's new

- **Jobs:** long work lights up when it's done (green), failed (red) or needs you (amber), and keeps the computer awake meanwhile. Connect Claude Code with one click, put `aglow` in front of a terminal command, or send it from a script. Settings → jobs.
- **Edge:** when windows hide your desktop, the edge of the screen shows what's waiting, in four looks. The tray icon can take its colour too. Settings → edge.
- **Themes** for Settings: light, dark and afterglow.
- **Settings:** a new sidebar that says what each feature is doing. Power is now called performance.
- **Local endpoint:** commands to pause and switch wallpapers, for a Stream Deck or a script.
- Even character rows on every wallpaper, and softer silk.

Edge and jobs are off until you switch them on.

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
