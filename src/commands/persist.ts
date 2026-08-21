import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isSea } from "node:sea";

export interface PersistOptions {
  tenant: string;
  clientId?: string;
  host?: string;
  baseline?: string;
}

// Fixed for now — one persisted instance per machine. Same name doubles as
// the Windows Scheduled Task name, the firewall rule display name, and the
// Linux systemd unit name.
const NAME = "intuneatlas";
const PORT = 7878;

/** How to relaunch this exact running process — the packaged exe is its own executable; dev/npm mode needs `node <cli.js>`. Reused so the registered task/unit works identically either way. */
function selfCommand(): { command: string; args: string[] } {
  if (isSea()) {
    return { command: process.execPath, args: [] };
  }
  return { command: process.execPath, args: [process.argv[1]] };
}

function uiArgs(options: PersistOptions): string[] {
  const args = ["ui", "--host", options.host ?? "0.0.0.0", "--tenant", options.tenant];
  if (options.clientId) args.push("--client-id", options.clientId);
  if (options.baseline) args.push("--baseline", options.baseline);
  return args;
}

export async function installPersistent(options: PersistOptions): Promise<void> {
  if (!options.tenant) {
    throw new Error("--persist needs --tenant explicitly — there's nobody around to answer for it later, at boot.");
  }
  // The saved-client-ID prompt/store (see resolveClientId) lives under your
  // own home directory — the persisted service runs as SYSTEM/root, a
  // different home entirely, so it can't see it. Same reasoning as --tenant
  // above: nothing interactive to fall back on at boot.
  if (!options.clientId) {
    throw new Error("--persist needs --client-id explicitly — the background service runs as SYSTEM/root, so it can't read your own saved one.");
  }

  if (process.platform === "win32") {
    installWindows(options);
  } else if (process.platform === "linux") {
    installLinux(options);
  } else {
    throw new Error(`--persist isn't supported on ${process.platform} yet — only Windows and Linux so far.`);
  }
}

export async function uninstallPersistent(): Promise<void> {
  if (process.platform === "win32") {
    uninstallWindows();
  } else if (process.platform === "linux") {
    uninstallLinux();
  } else {
    throw new Error(`--stop isn't supported on ${process.platform} yet — only Windows and Linux so far.`);
  }
}

/* -------------------------------------------------------------- windows --- */
// Scheduled Task, not a real Windows Service — a plain console exe can't
// speak the Service Control Manager protocol without a native addon (breaks
// SEA's single-file distribution) or a third-party wrapper (another
// unsigned binary to trust on top of the SmartScreen prompt this project
// already has to explain once). A Task triggered at startup, running as
// SYSTEM, gets the same outcome — starts before login, restarts on
// failure — using only what every modern Windows already ships.

function assertWindowsAdmin(): void {
  const check = `
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }
  `;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", check], { stdio: "ignore" });
  } catch {
    throw new Error("--persist needs an elevated (Administrator) terminal — a SYSTEM-run task and a firewall rule both need it.");
  }
}

function installWindows(options: PersistOptions): void {
  assertWindowsAdmin();

  const { command, args } = selfCommand();
  const fullArgs = [...args, ...uiArgs(options)];
  // Each token double-quoted, the way Windows' own command-line parsing
  // expects — so a value with an embedded space (a --baseline path, say)
  // survives being re-split back into arguments.
  const quotedLine = [command, ...fullArgs].map((a) => `"${a.replace(/"/g, '""')}"`).join(" ");
  const host = options.host ?? "0.0.0.0";
  const loopback = host === "127.0.0.1" || host === "localhost";

  // Register-ScheduledTask has no native way to capture stdout/stderr — a
  // task that's crash-looping is otherwise completely invisible (this bit
  // a real run: the task showed "Queued", the app ran fine started by hand,
  // and there was nothing to look at to explain the difference). A tiny
  // batch wrapper redirects both streams to a log file — written directly
  // here rather than assembled inline in the PowerShell script, to avoid
  // nesting cmd.exe's own quote-parsing rules inside a PowerShell string.
  const runDir = "C:\\ProgramData\\intuneatlas";
  const logPath = `${runDir}\\service.log`;
  const wrapperPath = `${runDir}\\run.cmd`;
  mkdirSync(runDir, { recursive: true });
  writeFileSync(wrapperPath, `@echo off\r\ncd /d "${runDir}"\r\n${quotedLine} >> "${logPath}" 2>&1\r\n`, "utf8");

  const script = `
    $ErrorActionPreference = "Stop"
    $name = "${NAME}"

    ${
      loopback
        ? ""
        : `
    Write-Host "Opening inbound firewall rule for TCP ${PORT}..."
    Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow | Out-Null
    `
    }

    Write-Host "Registering scheduled task '$name'..."
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "${wrapperPath}"' -WorkingDirectory "${runDir}"
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet \`
        -RestartCount 999 \`
        -RestartInterval (New-TimeSpan -Minutes 1) \`
        -StartWhenAvailable \`
        -DontStopOnIdleEnd \`
        -AllowStartIfOnBatteries \`
        -DontStopIfGoingOnBatteries \`
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings \`
        -Description "intuneatlas ui, persistent instance — starts at boot, restarts on failure." | Out-Null

    Write-Host "Starting it now (won't wait for a reboot to confirm it works)..."
    Start-ScheduledTask -TaskName $name
    Start-Sleep -Seconds 3
    Write-Host "Task state: $((Get-ScheduledTask -TaskName $name).State)"
    Write-Host ""
    Write-Host "On this machine:  http://localhost:${PORT}"
    Write-Host "Elsewhere:        http://<this machine's real address>:${PORT}"
    Write-Host "Log file:         ${logPath}"
    Write-Host "Stop it with:     intuneatlas ui --stop"
  `;

  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "inherit" });
}

function uninstallWindows(): void {
  assertWindowsAdmin();
  const script = `
    $ErrorActionPreference = "Stop"
    $name = "${NAME}"
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    Write-Host "Stopped and removed."
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "inherit" });
}

/* ---------------------------------------------------------------- linux --- */
// systemd system unit, running as root — Linux's equivalent of "starts at
// boot, no login required, restarts on crash." Unlike Windows Firewall,
// Linux's firewall landscape (ufw/firewalld/iptables/none) is too
// fragmented to safely automate, so this just prints a reminder instead of
// guessing at one.

const UNIT_PATH = `/etc/systemd/system/${NAME}.service`;

function assertLinuxRoot(): void {
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error("--persist needs root — a systemd system unit and (if not loopback) opening a firewall port both need it. Try again with sudo.");
  }
}

function installLinux(options: PersistOptions): void {
  assertLinuxRoot();

  const { command, args } = selfCommand();
  const fullArgs = [...args, ...uiArgs(options)];
  const execStart = [command, ...fullArgs].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  const host = options.host ?? "0.0.0.0";
  const loopback = host === "127.0.0.1" || host === "localhost";

  const unit = `[Unit]
Description=intuneatlas ui, persistent instance
After=network.target

[Service]
ExecStart=${execStart}
Restart=on-failure
RestartSec=30
User=root

[Install]
WantedBy=multi-user.target
`;

  console.log(`Writing ${UNIT_PATH}...`);
  writeFileSync(UNIT_PATH, unit, "utf8");

  console.log("Reloading systemd and starting it now...");
  execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["enable", "--now", NAME], { stdio: "inherit" });

  console.log("");
  console.log(`Status:           systemctl status ${NAME}`);
  console.log(`Logs:             journalctl -u ${NAME} -f`);
  console.log(`On this machine:  http://localhost:${PORT}`);
  console.log(`Elsewhere:        http://<this machine's real address>:${PORT}`);
  console.log("Stop it with:     intuneatlas ui --stop");
  if (!loopback) {
    console.log(`Reminder: open TCP ${PORT} in your firewall if one's active (ufw, firewalld, ...) — not done automatically here.`);
  }
}

function uninstallLinux(): void {
  assertLinuxRoot();
  try {
    execFileSync("systemctl", ["disable", "--now", NAME], { stdio: "inherit" });
  } catch {
    // Wasn't running/registered — fine, still clean up the unit file below.
  }
  if (existsSync(UNIT_PATH)) unlinkSync(UNIT_PATH);
  execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
  console.log("Stopped and removed.");
}
