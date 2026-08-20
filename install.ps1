# intuneatlas installer — downloads the latest standalone Windows release,
# puts it on your PATH, then prompts for a tenant and launches `ui`. No
# Node.js required.
#
# Usage:  irm https://intuneatlas.com/install.ps1 | iex
#
# UNTESTED — this needs a real Windows machine to verify; written carefully
# but treat the first run as the first real test, same as the release
# workflow that builds what this installs.

$ErrorActionPreference = "Stop"
# Invoke-WebRequest's default progress-bar rendering is dramatically slower
# for anything but tiny files — a well-known PowerShell issue, especially
# on Windows PowerShell 5.1. The release zip bundles a full Node binary
# (tens of MB), squarely in the range where this bites hard.
$ProgressPreference = "SilentlyContinue"

$repo = "jgeselle/intuneatlas"
$installDir = "$env:LOCALAPPDATA\Programs\intuneatlas"
$zipPath = "$env:TEMP\intuneatlas-windows.zip"

Write-Host "Fetching the latest release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -eq "intuneatlas-windows.zip" }
if (-not $asset) {
    Write-Error "Couldn't find intuneatlas-windows.zip in the latest release ($($release.tag_name))."
    exit 1
}

Write-Host "Downloading $($release.tag_name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath

if (Test-Path $installDir) {
    Write-Host "Removing previous install..."
    Remove-Item -Recurse -Force $installDir
}
New-Item -ItemType Directory -Force -Path (Split-Path $installDir) | Out-Null

Write-Host "Extracting to $installDir..."
Expand-Archive -Path $zipPath -DestinationPath (Split-Path $installDir) -Force
Remove-Item $zipPath

$exeDir = "$installDir"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$exeDir*") {
    Write-Host "Adding $exeDir to your user PATH..."
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$exeDir", "User")
    # So the check below works without opening a new shell.
    $env:Path = "$env:Path;$exeDir"
}

Write-Host ""
Write-Host "Installed. Verifying..."
& "$exeDir\intuneatlas.exe" --version

Write-Host ""
$tenant = Read-Host "Tenant to sign in to (e.g. contoso.onmicrosoft.com) — leave blank to skip for now"
Write-Host ""
Write-Host "First run will show a Windows SmartScreen warning (unsigned binary) — click 'More info' then 'Run anyway'."
Write-Host ""
Write-Host "Starting the app now. To start it again later (new terminal, no need to reinstall): intuneatlas ui"
Write-Host "Close this window, or Ctrl+C, whenever you're done — that stops the local server."

if ($tenant) {
    & "$exeDir\intuneatlas.exe" ui --tenant $tenant
} else {
    & "$exeDir\intuneatlas.exe" ui
}

Write-Host ""
Write-Host "Stopped. Start it again anytime with: intuneatlas ui"
