# intuneatlas shared-instance installer — downloads the latest standalone
# Windows release and registers it as a Scheduled Task that starts at boot
# (no login required) and restarts itself if it crashes. For a --host-exposed
# team deployment on a dedicated machine/VM; for solo use on your own laptop,
# use install.ps1 instead.
#
# Usage (run as Administrator):
#   $params = @{ Tenant = "contoso.onmicrosoft.com" }
#   irm https://intuneatlas.com/install-service.ps1 -OutFile install-service.ps1
#   .\install-service.ps1 @params
#
# Why a Scheduled Task and not a real Windows Service: a plain console exe
# like intuneatlas.exe doesn't speak the Service Control Manager protocol
# (StartServiceCtrlDispatcher) — pointing `sc.exe create` straight at it
# fails ("Error 1053"). The usual fix is a wrapper like NSSM or WinSW, but
# that means downloading and trusting a THIRD unsigned executable on top of
# the SmartScreen friction this project already has to explain once. A
# Scheduled Task triggered at startup, running as SYSTEM, does the same job
# (starts before login, restarts on failure) with nothing extra to download —
# every modern Windows already ships the ScheduledTasks module this uses.
#
# You still need to register this machine's real reachable address as a
# redirect URI on the Entra app registration used for sign-in — see
# NEXT_STEPS.txt in the repo. This script only makes the process survive
# reboots; it doesn't change anything about how sign-in works.
#
# UNTESTED — this needs a real Windows machine to verify. The ScheduledTasks
# module this depends on doesn't exist outside Windows, so unlike
# install.ps1 (whose download/extract logic could at least run for real),
# none of this could be exercised at all before now — treat the first run
# as the first real test.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Tenant,

    [string]$ClientId,

    [string]$HostAddress = "0.0.0.0",

    [string]$TaskName = "IntuneAtlas",

    [int]$Port = 7878
)

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This needs to run as Administrator — a Scheduled Task running as SYSTEM and a firewall rule both need it."
    exit 1
}

# Same slow-download issue install.ps1 hit for real: Invoke-WebRequest's
# default progress-bar rendering is dramatically slower for anything but
# tiny files, and the release zip bundles a full Node binary.
$ProgressPreference = "SilentlyContinue"

$repo = "jgeselle/intuneatlas"
$installDir = "$env:ProgramData\intuneatlas"
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
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Write-Host "Extracting to $installDir..."
Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
Remove-Item $zipPath

# ProgramData rather than a user's LOCALAPPDATA — this runs as SYSTEM, under
# its own profile, independent of whichever admin happened to install it.
# Its storage (scans, cached sign-ins) lives under SYSTEM's profile too,
# separate from anyone running `intuneatlas ui` interactively on this same
# machine under their own account — expected, not a bug.
$exePath = "$installDir\intuneatlas.exe"

Write-Host "Opening inbound firewall rule for TCP $Port..."
Remove-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null

$arguments = "ui --host $HostAddress --tenant `"$Tenant`""
if ($ClientId) {
    $arguments += " --client-id `"$ClientId`""
}

Write-Host "Registering scheduled task '$TaskName'..."
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $exePath -Argument $arguments -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit ([TimeSpan]::Zero) # no default 3-day kill — this needs to run indefinitely

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description "intuneatlas ui, shared instance — starts at boot, restarts on failure." | Out-Null

Write-Host "Starting it now (won't wait for a reboot to confirm it works)..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "Task state: $($task.State)"

Write-Host ""
Write-Host "Should be reachable shortly at http://<this-machine's-address>:$Port"
Write-Host "Status:      Get-ScheduledTask -TaskName $TaskName"
Write-Host "Stop it:     Stop-ScheduledTask -TaskName $TaskName"
Write-Host "Remove it:   Unregister-ScheduledTask -TaskName $TaskName; Remove-NetFirewallRule -DisplayName $TaskName"
Write-Host ""
Write-Host "Reminder: sign-in needs this machine's real reachable address registered as a redirect URI on the Entra app registration — see NEXT_STEPS.txt."
