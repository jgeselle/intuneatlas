# intuneatlas installer — downloads the latest standalone Windows release
# and puts it on your PATH. No Node.js required.
#
# Usage:  irm https://intuneatlas.com/install.ps1 | iex
# (until that's actually hosted, run this file directly: .\install.ps1)
#
# UNTESTED — this needs a real Windows machine to verify; written carefully
# but treat the first run as the first real test, same as the release
# workflow that builds what this installs.

$ErrorActionPreference = "Stop"

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
Write-Host "Done. Open a new terminal (so the PATH change takes effect there too), then run: intuneatlas ui"
Write-Host "First run will show a Windows SmartScreen warning (unsigned binary) — click 'More info' then 'Run anyway'."
