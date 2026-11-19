<#
  Registers AfterGlow as a (sparse) package on THIS PC, so the notification
  connector can read Windows notifications. Run it once, in PowerShell
  started as administrator:

    powershell -ExecutionPolicy Bypass -File scripts\windows\register-package.ps1

  For an installed AfterGlow, point it at the install folder:

    ... register-package.ps1 -ExternalLocation "$env:LOCALAPPDATA\AfterGlow"

  What it does:
    1. makes a self-signed code-signing certificate "CN=AfterGlow Dev" in
       your user certificate store (or reuses it), and trusts it on this PC
       only (Local Machine > Trusted People, which needs administrator)
    2. packs scripts\windows\AppxManifest.xml plus a few icons into
       AfterGlow.msix (a package with no files of its own) and signs it
    3. registers it with -ExternalLocation = the folder with afterglow.exe
  Undo: scripts\windows\unregister-package.ps1.
  Needs the Windows SDK tools makeappx.exe and signtool.exe (they come with
  Visual Studio's C++ build tools "Windows SDK" component).
#>
param(
  # The folder holding afterglow.exe (default: the dev build)
  [string]$ExternalLocation = (Join-Path $PSScriptRoot "..\..\src-tauri\target\debug")
)
$ErrorActionPreference = "Stop"
$Subject = "CN=AfterGlow Dev"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run this in PowerShell started as administrator (it trusts the certificate for this PC)." }

$ExternalLocation = (Resolve-Path $ExternalLocation).Path
if (-not (Test-Path (Join-Path $ExternalLocation "afterglow.exe"))) {
  throw "No afterglow.exe in $ExternalLocation. Build it first (bun run tauri dev, or cargo build in src-tauri), or pass -ExternalLocation."
}

# The Windows SDK tools
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
$makeappx = $sdk | ForEach-Object { Join-Path $_.FullName "makeappx.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
$signtool = $sdk | ForEach-Object { Join-Path $_.FullName "signtool.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $makeappx -or -not $signtool) {
  throw "makeappx.exe / signtool.exe not found. Install the Windows SDK (Visual Studio Installer > Build Tools > Modify > Windows 11 SDK)."
}

# 1. The certificate
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Subject } | Select-Object -First 1
if (-not $cert) {
  Write-Host "Making a self-signed certificate $Subject"
  $cert = New-SelfSignedCertificate -Type Custom -Subject $Subject -KeyUsage DigitalSignature -FriendlyName "AfterGlow local package signing" `
    -CertStoreLocation Cert:\CurrentUser\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
}
$cer = Join-Path $env:TEMP "afterglow-dev.cer"
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
if (-not (Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) {
  Write-Host "Trusting it on this PC (Local Machine > Trusted People)"
  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
}

# 2. Pack and sign
$stage = Join-Path $env:TEMP "afterglow-package"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $stage "Assets") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "AppxManifest.xml") $stage
$icons = Join-Path $PSScriptRoot "..\..\src-tauri\icons"
foreach ($f in "StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png") { Copy-Item (Join-Path $icons $f) (Join-Path $stage "Assets") }
$msix = Join-Path $env:TEMP "AfterGlow.msix"
& $makeappx pack /d $stage /p $msix /nv /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }
& $signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix | Out-Null
if ($LASTEXITCODE -ne 0) { throw "signtool failed" }

# 3. Register
Get-AppxPackage -Name AfterGlow | Remove-AppxPackage -ErrorAction SilentlyContinue
Add-AppxPackage -Path $msix -ExternalLocation $ExternalLocation
Write-Host ""
Write-Host "Done: AfterGlow is registered as a package, pointing at $ExternalLocation"
Write-Host "Restart AfterGlow, then Settings > connectors > Windows notifications. Windows will ask once."
