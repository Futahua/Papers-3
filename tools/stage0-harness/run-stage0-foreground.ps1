# STAGE 0 foreground-authority test - the part that needs the creator.
#
# Windows will not let a background process take the foreground, so this rig
# cannot create "Papers is foreground" without the focus coercion the contract
# forbids. A person clicking a window is the honest stimulus.
#
# WHY THIS DOES NOT SAMPLE THE STATE FILE
#
# The first version waited for the foreground to match, slept 800 ms, then read
# zorder-state.json. That is invalid twice over: the file is rewritten every
# 250 ms, so the read describes a later instant than the click, and it cannot
# tell "the rule held" from "the rule was never exercised". It reported 3/6
# against a controller that was behaving correctly.
#
# The follower now writes a transcript (zorder-log.jsonl) recording every
# foreground change and every z-order write, with a write counter. The
# assertions below are about what happened between those recorded events, which
# is independent of when this script happens to look.
#
# What it proves, in order:
#   1. Papers foreground           -> authority claimed, writes resume, block rebuilt
#   2. unrelated app foreground    -> authority withheld, ZERO z-order writes
#   3. back to Papers              -> authority returns, writes resume
#
# The operator must HOLD each window forward for the stated time. The script
# says when each step is done; do not return to this chat before then.

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
function ZLog() {
    $p = Join-Path $zctl 'zorder-log.jsonl'
    if (-not (Test-Path $p)) { return @() }
    $out = New-Object System.Collections.ArrayList
    foreach ($line in (Get-Content $p)) {
        if ($line.Trim().Length -eq 0) { continue }
        try { [void]$out.Add(($line | ConvertFrom-Json)) } catch { }
    }
    return $out
}
function LastForegroundEvent() {
    $ev = @(ZLog | Where-Object { $_.event -eq 'foreground' })
    if ($ev.Count -eq 0) { return $null }
    return $ev[$ev.Count - 1]
}

function StartHarness([string]$ctl, [string]$title) {
    New-Item -ItemType Directory -Force -Path $ctl | Out-Null
    Remove-Item (Join-Path $ctl 'command.txt') -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $harnessExe -PassThru -ArgumentList @('--control', $ctl, '--title', $title)
    Start-Sleep -Milliseconds 700
    [pscustomobject]@{ proc = $p; ctl = $ctl; hwnd = [long](Get-Content (Join-Path $ctl 'status.json') -Raw | ConvertFrom-Json).hwnd }
}
function Send([string]$ctl, [string]$cmd) { Set-Content (Join-Path $ctl 'command.txt') -Value $cmd -NoNewline; Start-Sleep -Milliseconds 250 }

function Step([int]$n, [int]$of, [string]$window, [int]$holdSec) {
    Write-Host ""
    Write-Host ("  STEP {0} of {1}" -f $n, $of) -ForegroundColor Cyan
    Write-Host ("    Click the window titled `"{0}`"" -f $window) -ForegroundColor Yellow
    Write-Host ("    then KEEP YOUR HANDS OFF for about {0} seconds." -f $holdSec) -ForegroundColor Yellow
    Write-Host  "    Do not come back to this chat until it says STEP DONE." -ForegroundColor Yellow
}

# Wait until the transcript's most recent foreground event names this process and
# is at least holdMs old - i.e. the operator is genuinely holding it forward, not
# merely passing through. Returns that event, or $null on timeout.
function RequireHold([int]$pid_, [int]$holdMs, [int]$timeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $ev = LastForegroundEvent
        if ($null -ne $ev -and $ev.foregroundPid -eq $pid_) {
            $at = [datetime]::Parse($ev.at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
            $age = ((Get-Date).ToUniversalTime() - $at.ToUniversalTime()).TotalMilliseconds
            if ($age -ge $holdMs) { return $ev }
        }
        Start-Sleep -Milliseconds 100
    }
    return $null
}

function WritesSince([string]$atIso) {
    return @(ZLog | Where-Object { $_.event -eq 'write' -and ([string]$_.at).CompareTo($atIso) -ge 0 })
}

Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== STAGE 0 foreground authority (assisted) ===" -ForegroundColor Cyan
Write-Host "Three disposable windows, three clicks, hands off after each."

$foreign = StartHarness "$Root\foreign" 'Stage 0 Harness'
$hostw = StartHarness "$Root\host" 'Papers Stand-in'
$zctl = "$Root\zorder"; New-Item -ItemType Directory -Force -Path $zctl | Out-Null
$zlease = "$Root\lease-zorder.json"
$zf = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList @(
    '--role', 'follower', '--lease', $zlease, '--control', $zctl, '--target', $foreign.hwnd, '--hostid', $hostw.hwnd)
Start-Sleep -Milliseconds 1000
Send $zctl 'place:70,70,600,380'
Send $zctl 'zorder:on'
Start-Sleep -Milliseconds 400

# ---- 1. Papers foreground --------------------------------------------------
Step 1 3 'Papers Stand-in' 3
$e1 = RequireHold $hostw.proc.Id 1500
if ($null -eq $e1) {
    Record 'the Papers stand-in was foreground, held, and the controller claimed authority' $false @{ reason = 'foreground was never held on the Papers stand-in' }
} else {
    Record 'the Papers stand-in was foreground, held, and the controller claimed authority' ($e1.authority -eq $true) $e1
    # Break the block with our own fixture, then look for the controller's write
    # EVENT after that instant. The event is the assertion; the z-index sample
    # afterwards only corroborates the effect and needs no further hold.
    Send $hostw.ctl 'raise'
    $breakAt = (Get-Date).ToUniversalTime().ToString('o')
    $writeEv = $null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 150
        $w = WritesSince $breakAt
        if ($w.Count -gt 0) { $writeEv = $w[0]; break }
    }
    Record 'after the block was broken, the controller wrote z-order again' ($null -ne $writeEv) @{
        brokenAt = $breakAt; firstWriteAfter = $writeEv
    }
    $zNow = [pscustomobject]@{ host = (ZOf $hostw.hwnd); target = (ZOf $foreign.hwnd) }
    Record 'and the adopted window is above the host again (corroboration, single sample)' ($zNow.target -lt $zNow.host) $zNow
}
Write-Host "  STEP DONE" -ForegroundColor Green

# ---- 2. an unrelated application foreground --------------------------------
$other = StartHarness "$Root\other" 'Unrelated Application'
Step 2 3 'Unrelated Application' 4
$e2 = RequireHold $other.proc.Id 3000
if ($null -eq $e2) {
    Record 'the unrelated application was foreground, held, and authority was withheld' $false @{ reason = 'foreground was never held on the unrelated window' }
} else {
    Record 'the unrelated application was foreground, held, and authority was withheld' ($e2.authority -eq $false) $e2
    $after = WritesSince $e2.at
    $state = ZState
    Record 'and the controller made ZERO z-order writes for as long as it was held' (
        $after.Count -eq 0 -and $state.zOrderWrites -eq $e2.writes) @{
        writeEventsAfter = $after.Count
        writesAtHold = $e2.writes
        writesAtEndOfHold = $state.zOrderWrites
        heldForMs = 3000
    }
}
Write-Host "  STEP DONE" -ForegroundColor Green

# ---- 3. back to Papers -----------------------------------------------------
Step 3 3 'Papers Stand-in' 3
$e3 = RequireHold $hostw.proc.Id 1500
if ($null -eq $e3) {
    Record 'the Papers stand-in was foreground again and authority returned' $false @{ reason = 'foreground was never held on the Papers stand-in again' }
} else {
    Record 'the Papers stand-in was foreground again and authority returned' ($e3.authority -eq $true) $e3
    $resumed = $null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 150
        $w = WritesSince $e3.at
        if ($w.Count -gt 0) { $resumed = $w[0]; break }
    }
    Record 'and z-order writes resumed' ($null -ne $resumed) @{ firstWriteAfterAuthorityReturned = $resumed }
}
Write-Host "  STEP DONE" -ForegroundColor Green

Send $zctl 'release'
Start-Sleep -Milliseconds 500
Stop-Process -Id $zf.Id -Force -ErrorAction SilentlyContinue
Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$summary = [pscustomobject]@{
    run        = (Get-Date -Format 'yyyyMMdd-HHmmss')
    assisted   = $true
    stimulus   = 'the creator clicked and held the window the run named; no focus coercion was used'
    instrument = 'assertions are made against the follower z-order transcript, not against a sampled state file'
    tests      = $results
    passed     = @($results | Where-Object { $_.pass }).Count
    total      = $results.Count
}
$out = Join-Path $tools 'evidence'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'foreground-assisted.json')
Copy-Item (Join-Path $zctl 'zorder-log.jsonl') -Destination (Join-Path $out 'foreground-assisted-zorder-log.jsonl') -ErrorAction SilentlyContinue
Write-Host ""
Write-Host ("=== {0}/{1} ===" -f $summary.passed, $summary.total) -ForegroundColor $(if ($summary.passed -eq $summary.total) { 'Green' } else { 'Yellow' })
