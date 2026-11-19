<#
  Undoes register-package.ps1: removes the AfterGlow package registration
  and the "CN=AfterGlow Dev" certificate from both stores. Run in
  PowerShell started as administrator:

    powershell -ExecutionPolicy Bypass -File scripts\windows\unregister-package.ps1
#>
$ErrorActionPreference = "Continue"
Get-AppxPackage -Name AfterGlow | Remove-AppxPackage
foreach ($store in "Cert:\CurrentUser\My", "Cert:\LocalMachine\TrustedPeople") {
  Get-ChildItem $store | Where-Object { $_.Subject -eq "CN=AfterGlow Dev" } | Remove-Item
}
Write-Host "AfterGlow's package registration and certificate are removed."
