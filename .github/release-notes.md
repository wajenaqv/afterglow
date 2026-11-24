### What's new

- **Apps:** Settings lists every app AfterGlow hears from, each allowed or blocked, with a step-by-step guide for every connection. Your old rules are converted; noisy ones such as OneDrive and Windows Security start blocked unless you had changed them. A rule for "every app" is kept only if it said "nothing".
- **Do Not Disturb:** messages are held and shown when it ends, instead of being dropped.
- **Power:** see why each monitor is paused, what draws it and how much CPU AfterGlow uses, and choose how long OLED care waits.
- **Clock:** 15 new styles, colours taken from the wallpaper that's showing, and a colour of your own.
- **Activity:** plain words, and a replayed message is no longer counted twice.

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
