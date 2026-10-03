# Installs the Apers phone connector on this machine and makes it start at logon.
#
#   powershell -ExecutionPolicy Bypass -File install-connector.ps1
#
# What it does (all local, reversible):
#   1. venv at   %USERPROFILE%\.hermes\mesh\venv   (created from the hermes-agent venv python)
#   2. code at   %USERPROFILE%\.hermes\mesh\companion\   (copied from this folder)
#   3. startup   "Hermes Connector.lnk" in the user's shell:startup folder
#      (pythonw, silent). The venv and code live under %USERPROFILE%\.hermes\mesh,
#      but the connector LOGS under the Hermes home it resolves at run time —
#      <HERMES_HOME>\mesh\connector.log — which is often somewhere else entirely.
#   4. firewall  inbound allow rules for the venv python (TCP 51379, UDP 48856),
#      private profile only — skipped without admin (Windows will prompt once instead).
#   5. starts the connector now.
#
# Uninstall: delete the .lnk, kill pythonw, delete %USERPROFILE%\.hermes\mesh\{venv,companion}.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find the hermes-agent python on THIS machine. A hardcoded path is correct on
# exactly one computer and wrong everywhere else, which is the same defect D-016
# fixed in Papers itself.
#
# The registry is read before $env:HERMES_HOME for the reason apers_connector.py
# does the same: a process inherits its environment at start, so a shell opened
# before Hermes moved still hands out the old value. A candidate only counts if
# it is a real Hermes home, identified by config.yaml.
function Get-HermesHome {
    $candidates = @(
        (Get-ItemProperty -Path 'HKCU:\Environment' -Name HERMES_HOME -ErrorAction SilentlyContinue).HERMES_HOME
        $env:HERMES_HOME
        (Join-Path $env:USERPROFILE '.hermes')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'config.yaml'))) { return $c }
    }
    return $null
}

$hermesHome = Get-HermesHome
if (-not $hermesHome) {
    throw "Could not find a Hermes home (a folder containing config.yaml). Set HERMES_HOME and reopen this window."
}

$hermesPython = Join-Path $hermesHome 'hermes-agent\venv\Scripts\python.exe'
if (-not (Test-Path $hermesPython)) {
    throw "hermes-agent python not found under $hermesHome : $hermesPython"
}
Write-Host "==> using hermes-agent python from $hermesHome"

$meshDir   = Join-Path $env:USERPROFILE '.hermes\mesh'
$venvDir   = Join-Path $meshDir 'venv'
$codeDir   = Join-Path $meshDir 'companion'
New-Item -ItemType Directory -Force $meshDir | Out-Null

if (-not (Test-Path (Join-Path $venvDir 'Scripts\python.exe'))) {
    Write-Host "==> creating venv $venvDir"
    & $hermesPython -m venv $venvDir
}
$venvPy  = Join-Path $venvDir 'Scripts\python.exe'
$venvPyW = Join-Path $venvDir 'Scripts\pythonw.exe'

Write-Host '==> installing dependencies (PyNaCl, zeroconf, qrcode, pillow)'
& $venvPy -m pip install --quiet --disable-pip-version-check PyNaCl zeroconf qrcode pillow

Write-Host "==> copying connector code to $codeDir"
New-Item -ItemType Directory -Force $codeDir | Out-Null
Copy-Item (Join-Path $here '*.py') $codeDir -Force
Copy-Item (Join-Path $here 'LICENSE') $codeDir -Force

# Startup shortcut (per-user, no admin needed)
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Hermes Connector.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $venvPyW
$lnk.Arguments = '"' + (Join-Path $codeDir 'apers_connector.py') + '"'
$lnk.WorkingDirectory = $codeDir
$lnk.Description = 'Hermes phone connector (Run on Computer) — starts silently at logon'
$lnk.Save()
Write-Host "==> logon autostart: $lnkPath"

# Firewall rules — REQUIRED so the phone (a different device on the LAN) can reach
# the connector. Loopback isn't enough. Scope = Any profile because home Wi-Fi is
# often categorised Public. Needs admin: self-elevate JUST this step with one UAC
# click (nothing else in the install needs admin).
$fwCmd = @"
`$ErrorActionPreference='SilentlyContinue'
foreach (`$n in 'Hermes Connector mesh tcp','Hermes Connector discovery udp','Hermes Connector py','Hermes Connector pyw') {
  Get-NetFirewallRule -DisplayName `$n -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}
New-NetFirewallRule -DisplayName 'Hermes Connector mesh tcp'      -Direction Inbound -Action Allow -Protocol TCP -LocalPort 51379 -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Hermes Connector discovery udp' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 48856 -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Hermes Connector py'  -Direction Inbound -Action Allow -Program '$venvPy'  -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Hermes Connector pyw' -Direction Inbound -Action Allow -Program '$venvPyW' -Profile Any | Out-Null
"@
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
try {
    if ($isAdmin) {
        Invoke-Expression $fwCmd
    } else {
        Write-Host '==> adding firewall rules (approve the one Windows UAC prompt)…'
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fwCmd))
        Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -EncodedCommand $enc"
    }
    Write-Host '==> firewall rules added (Any profile)'
} catch {
    Write-Host "==> firewall step skipped ($($_.Exception.Message)). The phone may not reach this PC until you allow Python through Windows Firewall (private+public)."
}

Write-Host '==> starting connector now'
Start-Process -FilePath $venvPyW -ArgumentList ('"' + (Join-Path $codeDir 'apers_connector.py') + '"') -WorkingDirectory $codeDir
Start-Sleep -Seconds 3

# The connector logs under the home IT resolves, which is not necessarily
# %USERPROFILE%\.hermes — the venv and code live there, but the log follows the
# real Hermes home. Reading $meshDir here ended a perfectly successful install
# with a red PathNotFound, the last place the old assumption survived.
$connectorLog = Join-Path $hermesHome 'mesh\connector.log'
if (-not (Test-Path $connectorLog)) { $connectorLog = Join-Path $meshDir 'connector.log' }
if (Test-Path $connectorLog) {
    Write-Host "==> connector log: $connectorLog"
    Get-Content $connectorLog -Tail 8
} else {
    Write-Host "==> connector started; no log yet at $connectorLog (give it a moment, then check that path)"
}
