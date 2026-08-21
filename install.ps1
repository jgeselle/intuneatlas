# intuneatlas installer — downloads the latest standalone Windows release
# and puts it on your PATH. No Node.js required.
#
# Usage:  irm https://intuneatlas.com/install.ps1 | iex

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

$version = (& "$exeDir\intuneatlas.exe" --version).Trim()

Write-Host ""
Write-Host "  IntuneAtlas" -ForegroundColor White -NoNewline
Write-Host "  v$version" -ForegroundColor DarkGray
Write-Host "  --------------------------------" -ForegroundColor DarkGray
Write-Host "  Installed to " -ForegroundColor Gray -NoNewline
Write-Host "$exeDir" -ForegroundColor White
Write-Host ""
Write-Host "  Next:" -ForegroundColor White
Write-Host "    intuneatlas ui --tenant <your-tenant>.onmicrosoft.com" -ForegroundColor Gray
Write-Host ""
Write-Host "  Shared instance that survives reboots (elevated terminal):" -ForegroundColor Gray
Write-Host "    intuneatlas ui --persist --host 0.0.0.0 --tenant <your-tenant>.onmicrosoft.com" -ForegroundColor Gray
Write-Host "    intuneatlas ui --stop" -ForegroundColor Gray -NoNewline
Write-Host "   (to remove it)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Docs: " -ForegroundColor Gray -NoNewline
Write-Host "https://intuneatlas.com/docs" -ForegroundColor White
Write-Host ""
