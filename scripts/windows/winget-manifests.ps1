<#
  Writes AfterGlow's winget manifests for a PUBLISHED GitHub release, for the
  first submission to winget (later versions go automatically: see
  .github/workflows/winget.yml).

    powershell -ExecutionPolicy Bypass -File scripts\windows\winget-manifests.ps1 -Version 0.1.0

  It downloads the release's installer to get its SHA256 and writes
  winget\manifests\w\wajenaqv\AfterGlow\<version>\ (three .yaml files).
  Check them locally (needs winget's local manifests switched on once, as admin:
  winget settings --enable LocalManifestFiles):

    winget validate winget\manifests\w\wajenaqv\AfterGlow\<version>
    winget install --manifest winget\manifests\w\wajenaqv\AfterGlow\<version>

  Then submit: docs/releasing.md, "winget".
#>
param(
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$repo = "wajenaqv/afterglow"
$id = "wajenaqv.AfterGlow"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/tags/v$Version" -Headers @{ "User-Agent" = "afterglow-winget" }
$asset = $release.assets | Where-Object { $_.name -like "AfterGlow_*_x64-setup.exe" } | Select-Object -First 1
if (-not $asset) { throw "Release v$Version has no AfterGlow_*_x64-setup.exe (is it published?)" }

$tmp = Join-Path $env:TEMP $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $tmp -UseBasicParsing
$sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
Remove-Item $tmp
$date = ([datetime]$release.published_at).ToString("yyyy-MM-dd")

$dir = Join-Path $root "winget\manifests\w\wajenaqv\AfterGlow\$Version"
New-Item -ItemType Directory -Force $dir | Out-Null
$schema = "1.9.0"

$versionYaml = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: $schema
"@

$installerYaml = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
UpgradeBehavior: install
ReleaseDate: $date
Installers:
- Architecture: x64
  InstallerUrl: $($asset.browser_download_url)
  InstallerSha256: $sha
ManifestType: installer
ManifestVersion: $schema
"@

$localeYaml = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
PackageLocale: en-US
Publisher: Mohammad Wajih
PublisherUrl: https://github.com/wajenaqv
PublisherSupportUrl: https://github.com/$repo/issues
PackageName: AfterGlow
PackageUrl: https://github.com/$repo
License: MIT
LicenseUrl: https://github.com/$repo/blob/main/LICENSE
ShortDescription: Live ASCII wallpapers behind your desktop icons that glow when something happens.
Description: AfterGlow puts glowing text-art wallpapers (jellyfish, sakura, constellations, clocks and more) behind your desktop icons on every monitor. Your apps nudge them: a new message makes the wallpaper glow in that app's colour, then slowly fade. It pauses for fullscreen apps and games. Everything runs locally.
Tags:
- wallpaper
- live-wallpaper
- ascii
- desktop
- notifications
ReleaseNotesUrl: $($release.html_url)
ManifestType: defaultLocale
ManifestVersion: $schema
"@

$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $dir "$id.yaml"), $versionYaml.Replace("`r`n", "`n") + "`n", $utf8)
[IO.File]::WriteAllText((Join-Path $dir "$id.installer.yaml"), $installerYaml.Replace("`r`n", "`n") + "`n", $utf8)
[IO.File]::WriteAllText((Join-Path $dir "$id.locale.en-US.yaml"), $localeYaml.Replace("`r`n", "`n") + "`n", $utf8)
Write-Host "Wrote $dir"
Write-Host "  installer: $($asset.name)  SHA256 $sha"
