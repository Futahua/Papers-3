# STAGE 0 foreground-authority test — the part that needs the creator.
#
# Two of the three foreground transitions cannot be created by this rig, and the
# reason is a good one: Windows will not let a background process take the
# foreground. That is the protection this feature has to respect, so simulating
# it would mean using exactly the focus coercion §6 forbids. A person clicking a
# window is the honest stimulus.
#
# What it proves, in order:
#   1. Papers foreground            -> z-order authority, block established and repaired
#   2. an unrelated app foreground  -> authority withheld, NO z-order write at all
#   3. back to Papers               -> authority returns, block rebuilt
#
# Run it, then click the window it names. It waits 90 s per step and says what it
# is waiting for. Nothing here touches a window the creator uses.

[CmdletBinding()]
param([string]$Root = 'D:\Letters\MatTroiSeConMoc\.stage0-run-foreground')

$ErrorActionPreference = 'Stop'
$tools = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$harnessExe = Join-Path $tools 'Stage0Harness.exe'
$toolsExe = Join-Path $tools 'Stage0Tools.exe'

$results = New-Object System.Collections.ArrayList
function Record([string]$name, [bool]$ok, $detail) {
    [void]$results.Add([pscustomobject]@{ test = $name; pass = $ok; detail = $detail })
    Write-Host ("  {0}  {1}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name)
    if (-not $ok) { Write-Host ("        " + ($detail | ConvertTo-Json -Compress -Depth 6)) }
}
function ProbeAll() { (& $toolsExe --role probe | Out-String) | ConvertFrom-Json }
function ZOf([long]$hwnd) { ((ProbeAll).windows | Where-Object { $_.hwnd -eq $hwnd } | Select-Object -First 1).zIndex }
function ZState() {
    $p = Join-Path $zctl 'zorder-state.json'
    if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json } else { $null }
}
function StartHarness([string]$ctl, [string]$title, [int]$x, [int]$y, [int]$w, [int]$h) {
    New-Item -ItemType Directory -Force -Path $ctl | Out-Null
    Remove-Item (Join-Path $ctl 'command.txt') -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $harnessExe -PassThru -ArgumentList @('--control', $ctl, '--title', $title)
    Start-Sleep -Milliseconds 700
    [pscustomobject]@{ proc = $p; ctl = $ctl; hwnd = [long](Get-Content (Join-Path $ctl 'status.json') -Raw | ConvertFrom-Json).hwnd }
}
function Send([string]$ctl, [string]$cmd) { Set-Content (Join-Path $ctl 'command.txt') -Value $cmd -NoNewline; Start-Sleep -Milliseconds 250 }
function WaitForForeground([int]$pid_, [string]$what, [int]$timeoutSec = 90) {
    Write-Host "`n>>> CLICK the window titled `"$what`" — waiting up to $timeoutSec s..." -ForegroundColor Yellow
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $s = ZState
        if ($s -and $s.foregroundPid -eq $pid_) { Write-Host "    got it (foreground pid $pid_)" -ForegroundColor Green; return $true }
        Start-Sleep -Milliseconds 300
    }
    Write-Host "    timed out" -ForegroundColor Red
    return $false
}

Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "`n=== STAGE 0 foreground authority (assisted) ===" -ForegroundColor Cyan

$foreign = StartHarness "$Root\foreign" 'Stage 0 Harness' 60 60 620 400
$hostw = StartHarness "$Root\host" 'Papers Stand-in' 760 90 700 520
$zctl = "$Root\zorder"; New-Item -ItemType Directory -Force -Path $zctl | Out-Null
$zlease = "$Root\lease-zorder.json"
$zf = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList @(
    '--role', 'follower', '--lease', $zlease, '--control', $zctl, '--target', $foreign.hwnd, '--hostid', $hostw.hwnd)
Start-Sleep -Milliseconds 1000
Send $zctl 'place:70,70,600,380'
Send $zctl 'zorder:on'

# ── 1. Papers foreground ────────────────────────────────────────────────────
$ok1 = WaitForForeground $hostw.proc.Id 'Papers Stand-in'
if ($ok1) {
    Start-Sleep -Milliseconds 800
    Record 'with Papers foreground the controller claims z-order authority' ((ZState).zOrderAuthority -eq $true) (ZState)
    Send $hostw.ctl 'raise'
    Start-Sleep -Milliseconds 400
    $before = [pscustomobject]@{ host = (ZOf $hostw.hwnd); target = (ZOf $foreign.hwnd) }
    $repaired = $false
    for ($i = 0; $i -lt 25; $i++) { Start-Sleep -Milliseconds 150; if ((ZOf $foreign.hwnd) -lt (ZOf $hostw.hwnd)) { $repaired = $true; break } }
    Record 'and the adopted window is kept immediately above it' $repaired @{ brokenByFixture = $before; after = [pscustomobject]@{ host = (ZOf $hostw.hwnd); target = (ZOf $foreign.hwnd) } }
} else { Record 'with Papers foreground the controller claims z-order authority' $false @{ reason = 'foreground was never handed over' } }

# ── 2. an unrelated application foreground ──────────────────────────────────
$other = StartHarness "$Root\other" 'Unrelated Application' 1180 300 460 300
$ok2 = WaitForForeground $other.proc.Id 'Unrelated Application'
if ($ok2) {
    Start-Sleep -Milliseconds 800
    $s2 = ZState
    Record 'with an unrelated application foreground the controller withholds authority' ($s2.zOrderAuthority -eq $false) $s2
    Send $hostw.ctl 'raise'
    Start-Sleep -Milliseconds 400
    $broken = [pscustomobject]@{ host = (ZOf $hostw.hwnd); target = (ZOf $foreign.hwnd) }
    $held = $true
    for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 150; if ((ZOf $foreign.hwnd) -lt (ZOf $hostw.hwnd)) { $held = $false; break } }
    Record 'and it makes NO z-order write while that is true' $held @{
        brokenByFixture = $broken; heldForMs = 3000
        note = 'the adopted window was deliberately left below the host and never pulled back up'
    }
} else { Record 'with an unrelated application foreground the controller withholds authority' $false @{ reason = 'foreground was never handed over' } }

# ── 3. back to Papers ───────────────────────────────────────────────────────
$ok3 = WaitForForeground $hostw.proc.Id 'Papers Stand-in'
if ($ok3) {
    Start-Sleep -Milliseconds 800
    Record 'when Papers is foreground again, authority returns' ((ZState).zOrderAuthority -eq $true) (ZState)
    Send $hostw.ctl 'raise'
    Start-Sleep -Milliseconds 400
    $rebuilt = $false
    for ($i = 0; $i -lt 25; $i++) { Start-Sleep -Milliseconds 150; if ((ZOf $foreign.hwnd) -lt (ZOf $hostw.hwnd)) { $rebuilt = $true; break } }
    Record 'and the contiguous block is rebuilt' $rebuilt @{ host = (ZOf $hostw.hwnd); target = (ZOf $foreign.hwnd) }
} else { Record 'when Papers is foreground again, authority returns' $false @{ reason = 'foreground was never handed over' } }

Send $zctl 'release'
Start-Sleep -Milliseconds 500
Stop-Process -Id $zf.Id -Force -ErrorAction SilentlyContinue
Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$summary = [pscustomobject]@{
    run = (Get-Date -Format 'yyyyMMdd-HHmmss')
    assisted = $true
    stimulus = 'the creator clicked the window the run named; no focus coercion was used'
    tests = $results
    passed = @($results | Where-Object { $_.pass }).Count
    total = $results.Count
}
$out = Join-Path $tools 'evidence'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'foreground-assisted.json')
Write-Host ("`n=== {0}/{1} ===" -f $summary.passed, $summary.total) -ForegroundColor $(if ($summary.passed -eq $summary.total) { 'Green' } else { 'Yellow' })
