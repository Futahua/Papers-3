# STAGE 0 instrument self-test. No human needed, no real window involved.
#
# The assisted run's assertions are only worth anything if the recording
# instrument works: if the write counter never moves, "the controller made no
# z-order write" passes for the wrong reason and the assisted run proves nothing.
#
# So this proves the counter discriminates, against disposable fixtures only:
#
#   control  - a follower with the real foreground rule, unrelated app in front
#              -> zero write events, counter stays at zero
#   subject  - a follower with the self-test authority override
#              -> write events appear, counter climbs, the fixture is re-stacked
#
# The override exists only in this disposable fixture binary and is never
# reachable from Papers. It is what makes the control case meaningful: without
# it, both cases would read zero and the zeros would mean nothing.

[CmdletBinding()]
param([string]$Root = 'D:\Letters\MatTroiSeConMoc\.stage0-run-instrument')

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
function ZLog([string]$ctl) {
    $p = Join-Path $ctl 'zorder-log.jsonl'
    if (-not (Test-Path $p)) { return @() }
    $out = New-Object System.Collections.ArrayList
    foreach ($line in (Get-Content $p)) {
        if ($line.Trim().Length -eq 0) { continue }
        try { [void]$out.Add(($line | ConvertFrom-Json)) } catch { }
    }
    return $out
}
function ZState([string]$ctl) {
    $p = Join-Path $ctl 'zorder-state.json'
    if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json } else { $null }
}
function StartHarness([string]$ctl, [string]$title) {
    New-Item -ItemType Directory -Force -Path $ctl | Out-Null
    Remove-Item (Join-Path $ctl 'command.txt') -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $harnessExe -PassThru -ArgumentList @('--control', $ctl, '--title', $title)
    Start-Sleep -Milliseconds 700
    [pscustomobject]@{ proc = $p; ctl = $ctl; hwnd = [long](Get-Content (Join-Path $ctl 'status.json') -Raw | ConvertFrom-Json).hwnd }
}
function Send([string]$ctl, [string]$cmd) { Set-Content (Join-Path $ctl 'command.txt') -Value $cmd -NoNewline; Start-Sleep -Milliseconds 250 }

function Round([string]$name, [bool]$force) {
    $ctl = Join-Path $Root $name
    $lease = Join-Path $Root "$name-lease.json"
    New-Item -ItemType Directory -Force -Path $ctl | Out-Null
    $foreign = StartHarness (Join-Path $ctl 'foreign') "Stage 0 Harness ($name)"
    $hostw = StartHarness (Join-Path $ctl 'host') "Papers Stand-in ($name)"
    # A third window, created last, is what stands in for "an unrelated
    # application is foreground". Without it the host fixture itself holds the
    # foreground - Windows hands a newly shown window the focus when nothing else
    # is using the machine - and the real rule then grants authority correctly,
    # which is not the case under test.
    $other = StartHarness (Join-Path $ctl 'other') "Unrelated Application ($name)"
    $fargs = @('--role', 'follower', '--lease', $lease, '--control', $ctl,
        '--target', $foreign.hwnd, '--hostid', $hostw.hwnd)
    if ($force) { $fargs += '--selftest-force-authority' }
    $f = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList $fargs
    Start-Sleep -Milliseconds 900
    Send $ctl 'place:80,80,560,360'
    Send $ctl 'zorder:on'

    # Measure from the moment the transcript shows an unrelated application in
    # front, so the window under measurement is one where the rule applies.
    $lastUnrelated = $null
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 150
        $fg = @(ZLog $ctl | Where-Object { $_.event -eq 'foreground' })
        $u = @($fg | Where-Object { $_.foregroundPid -ne $_.hostPid })
        if ($u.Count -gt 0) { $lastUnrelated = $u[$u.Count - 1]; break }
    }
    Start-Sleep -Milliseconds 2000

    $log = @(ZLog $ctl)
    $fgEvents = @($log | Where-Object { $_.event -eq 'foreground' })
    if ($null -eq $lastUnrelated) {
        $writes = @()
    } else {
        $writes = @($log | Where-Object { $_.event -eq 'write' -and ([string]$_.at).CompareTo([string]$lastUnrelated.at) -ge 0 })
    }
    $state = ZState $ctl
    $zAfter = [pscustomobject]@{ host = (ZOf $hostw.hwnd); target = (ZOf $foreign.hwnd) }
    Send $ctl 'release'
    Start-Sleep -Milliseconds 300
    Stop-Process -Id $f.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $foreign.proc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $hostw.proc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $other.proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    [pscustomobject]@{
        name = $name; forced = $force; writeEvents = $writes.Count
        unrelatedForegroundObserved = ($null -ne $lastUnrelated)
        lastUnrelatedAt = $(if ($lastUnrelated) { $lastUnrelated.at } else { $null })
        writeCounter = $state.zOrderWrites; foregroundEvents = $fgEvents.Count
        authority = $state.zOrderAuthority; zAfter = $zAfter
        firstWrite = $(if ($writes.Count -gt 0) { $writes[0] } else { $null })
    }
}
Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== STAGE 0 instrument self-test (no human, no real window) ===" -ForegroundColor Cyan
Write-Host "Does the z-order recorder discriminate, or does it always read zero?"

$control = Round 'control' $false
$subject = Round 'subject' $true

Record 'the control case records a foreground event, so the transcript is live' (
    $control.foregroundEvents -ge 1) $control
Record 'and with the real rule in force it records ZERO z-order writes' (
    $control.writeEvents -eq 0 -and $control.writeCounter -eq 0) $control
Record 'and authority is withheld in the control case' ($control.authority -eq $false) $control
Record 'the subject case records z-order write events' ($subject.writeEvents -ge 1) $subject
Record 'and its write counter climbs' ($subject.writeCounter -ge 1) $subject
Record 'and the counter is not simply always-on: control 0, subject > 0' (
    $control.writeCounter -eq 0 -and $subject.writeCounter -gt 0) @{
    control = $control.writeCounter; subject = $subject.writeCounter
}
Record 'and the write event carries the counters the runner asserts on' (
    $null -ne $subject.firstWrite -and $null -ne $subject.firstWrite.writes -and
    $null -ne $subject.firstWrite.at -and $null -ne $subject.firstWrite.event) $subject.firstWrite
Record 'and the re-stack actually happened: the adopted fixture ends above the host' (
    $subject.zAfter.target -lt $subject.zAfter.host) $subject.zAfter

Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$summary = [pscustomobject]@{
    run = (Get-Date -Format 'yyyyMMdd-HHmmss')
    kind = 'instrument self-test'
    note = 'the self-test authority override lives only in the disposable fixture binary; Papers never spawns it'
    tests = $results
    passed = @($results | Where-Object { $_.pass }).Count
    total = $results.Count
}
$out = Join-Path $tools 'evidence'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'instrument-selftest.json')
Write-Host ""
Write-Host ("=== {0}/{1} ===" -f $summary.passed, $summary.total) -ForegroundColor $(if ($summary.passed -eq $summary.total) { 'Green' } else { 'Yellow' })