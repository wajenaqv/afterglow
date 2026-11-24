<#
  Builds AfterGlow's Microsoft Store package (.msix).

  For the Store (values from Partner Center → your app → Product identity):

    powershell -ExecutionPolicy Bypass -File scripts\windows\make-msix.ps1 `
      -Name "12345YourName.AfterGlow" -Publisher "CN=XXXXXXXX-XXXX-..." -PublisherDisplayName "Your Name"

  Upload the .msix in Partner Center; the Store signs it.

  To try the package on this PC first (no Store), build it with -Sign: it
  uses a test identity and the self-signed "CN=AfterGlow Dev" certificate
  that register-package.ps1 makes and trusts (run that once, as admin):

    powershell -ExecutionPolicy Bypass -File scripts\windows\make-msix.ps1 -Sign
    Add-AppxPackage src-tauri\target\msix\AfterGlow_<version>_x64.msix

  Remove the test install: Get-AppxPackage AfterGlow.LocalTest | Remove-AppxPackage

  Needs the Windows SDK tools makeappx.exe (and signtool.exe for -Sign).
#>
param(
  [string]$Name = "AfterGlow.LocalTest",
  [string]$Publisher = "CN=AfterGlow Dev",
  [string]$PublisherDisplayName = "Mohammad Wajih",
  # Sign with the local "CN=AfterGlow Dev" certificate (local testing only)
  [switch]$Sign,
  # Use the existing src-tauri\target\release\afterglow.exe
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$tauri = Join-Path $root "src-tauri"

# The Windows SDK tools
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
$makeappx = $sdk | ForEach-Object { Join-Path $_.FullName "makeappx.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
$signtool = $sdk | ForEach-Object { Join-Path $_.FullName "signtool.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found. Install the Windows SDK (Visual Studio Installer > Build Tools > Modify > Windows 11 SDK)." }

# The version: tauri.conf.json's x.y.z as x.y.z.0 (the Store needs the last part 0)
$conf = Get-Content (Join-Path $tauri "tauri.conf.json") -Raw | ConvertFrom-Json
$version = "$($conf.version).0"

# 1. Build the app (no installer: the package is the installer)
if (-not $SkipBuild) {
  Push-Location $root
  try {
    bun run tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
  } finally { Pop-Location }
}
$exe = Join-Path $tauri "target\release\afterglow.exe"
if (-not (Test-Path $exe)) { throw "No $exe. Build it first (or drop -SkipBuild)." }

# 2. Stage: the exe, the logos, the manifest with the identity filled in
$stage = Join-Path $tauri "target\msix\stage"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $stage "Assets") | Out-Null
Copy-Item $exe $stage
foreach ($f in "StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png") {
  Copy-Item (Join-Path $tauri "icons\$f") (Join-Path $stage "Assets")
}
$manifest = Get-Content (Join-Path $PSScriptRoot "store\AppxManifest.xml") -Raw
$manifest = $manifest.Replace("__NAME__", [Security.SecurityElement]::Escape($Name)).
  Replace("__PUBLISHER__", [Security.SecurityElement]::Escape($Publisher)).
  Replace("__PUBLISHER_DISPLAY__", [Security.SecurityElement]::Escape($PublisherDisplayName)).
  Replace("__VERSION__", $version)
[IO.File]::WriteAllText((Join-Path $stage "AppxManifest.xml"), $manifest, (New-Object Text.UTF8Encoding $false))

# 3. Pack
$msix = Join-Path $tauri "target\msix\AfterGlow_$($conf.version)_x64.msix"
& $makeappx pack /d $stage /p $msix /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx failed (run it by hand for the details: makeappx pack /d `"$stage`" /p `"$msix`" /o)" }

# 4. Sign (local test only; the Store signs its own)
if ($Sign) {
  if (-not $signtool) { throw "signtool.exe not found (Windows SDK)." }
  $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Publisher } | Select-Object -First 1
  if (-not $cert) { throw "No certificate $Publisher in your store. Run register-package.ps1 once (as admin) to make and trust it." }
  & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
}

Write-Host ""
Write-Host "Built $msix"
Write-Host "  identity: $Name, $Publisher, version $version"
