# AfterGlow for Windows: installs (or updates) the latest release.
#
#   irm https://raw.githubusercontent.com/wajenaqv/afterglow/main/install.ps1 | iex
#
# What it does: asks GitHub for the latest release, downloads its installer
# (AfterGlow_<version>_x64-setup.exe), runs it silently for your user only
# (no admin), and starts AfterGlow. Nothing else.
#
# Why a script: AfterGlow is a hobby project and its installer isn't
# code-signed, so an installer downloaded in a browser gets the "Windows
# protected your PC" warning. A file downloaded by PowerShell isn't marked as
# coming from the internet, so it just runs. (Same idea as install.sh on macOS.)

& {
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue"   # Windows PowerShell downloads crawl with the progress bar
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = "wajenaqv/afterglow"

  Write-Host "Finding the latest AfterGlow release..."
  $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "afterglow-installer" }
  $asset = $release.assets | Where-Object { $_.name -like "AfterGlow_*_x64-setup.exe" } | Select-Object -First 1
  if (-not $asset) { throw "Couldn't find a Windows installer on https://github.com/$repo/releases/latest" }

  $setup = Join-Path $env:TEMP $asset.name
  Write-Host "Downloading $($asset.name)..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $setup -UseBasicParsing -Headers @{ "User-Agent" = "afterglow-installer" }

  # Updating: stop the running copy so its files can be replaced. The new one
  # puts the wallpaper back behind the icons as soon as it starts.
  $running = Get-Process afterglow -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host "Closing the running AfterGlow..."
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
  }

  Write-Host "Installing (for your user, no admin)..."
  $p = Start-Process $setup -ArgumentList "/S" -Wait -PassThru
  Remove-Item $setup -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0) { throw "The installer stopped with code $($p.ExitCode)." }

  $exe = Join-Path $env:LOCALAPPDATA "AfterGlow\afterglow.exe"
  if (-not (Test-Path $exe)) { throw "Installed, but $exe isn't there." }
  Write-Host "Starting AfterGlow (it lives in the tray, by the clock)."
  Start-Process $exe
  Write-Host ""
  Write-Host "Done. Quit any other live wallpaper app (Wallpaper Engine, Lively) or it will cover AfterGlow."
}
