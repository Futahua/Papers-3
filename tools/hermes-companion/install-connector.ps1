# Installs the Apers phone connector on this machine and makes it start at logon.
#
#   powershell -ExecutionPolicy Bypass -File install-connector.ps1
#
# What it does (all local, reversible):
#   1. venv at   %USERPROFILE%\.hermes\mesh\venv   (created from the hermes-agent venv python)
#   2. code at   %USERPROFILE%\.hermes\mesh\companion\   (copied from this folder)
#   3. startup   "Hermes Connector.lnk" in the user's shell:startup folder
#      (pythonw, silent, logs to %USERPROFILE%\.hermes\mesh\connector.log)
#   4. firewall  inbound allow rules for the venv python (TCP 51379, UDP 48856),
#      private profile only — skipped without admin (Windows will prompt once instead).
#   5. starts the connector now.
#
# Uninstall: delete the .lnk, kill pythonw, delete %USERPROFILE%\.hermes\mesh\{venv,companion}.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$hermesPython = 'D:\LapSlop brotherhood\Programs\Assistant\HermesAI\.hermes\hermes-agent\venv\Scripts\python.exe'
if (-not (Test-Path $hermesPython)) { throw "hermes-agent python not found: $hermesPython" }

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

# Firewall rules (best effort; needs admin)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    foreach ($r in @(
        @{Name='Hermes Connector (mesh tcp)'; Proto='TCP'; Port=51379},
        @{Name='Hermes Connector (discovery udp)'; Proto='UDP'; Port=48856})) {
        netsh advfirewall firewall delete rule name="$($r.Name)" | Out-Null
        netsh advfirewall firewall add rule name="$($r.Name)" dir=in action=allow `
            program="$venvPy" protocol=$($r.Proto) localport=$($r.Port) profile=private | Out-Null
        netsh advfirewall firewall add rule name="$($r.Name) w" dir=in action=allow `
            program="$venvPyW" protocol=$($r.Proto) localport=$($r.Port) profile=private | Out-Null
    }
    Write-Host '==> firewall rules added (private profile)'
} else {
    Write-Host '==> no admin: skipped firewall rules (allow the one-time Windows prompt instead)'
}

Write-Host '==> starting connector now'
Start-Process -FilePath $venvPyW -ArgumentList ('"' + (Join-Path $codeDir 'apers_connector.py') + '"') -WorkingDirectory $codeDir
Start-Sleep -Seconds 3
Get-Content (Join-Path $meshDir 'connector.log') -Tail 8
