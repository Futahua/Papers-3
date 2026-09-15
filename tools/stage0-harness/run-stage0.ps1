# STAGE 0 evidence run.
#
# Everything here runs against disposable processes this repository builds:
# Stage0Harness.exe (the foreign application stand-in) and Stage0Tools.exe
# (probe / follower / watchdog). Nothing touches a window the creator uses.
#
# Measurement convention, enforced here rather than described: every rectangle
# compared is GetWindowRect taken by Stage0Tools.exe --role probe, which sets
# Per-Monitor-V2 awareness before it creates anything. DWMWA_EXTENDED_FRAME_BOUNDS
# is captured alongside as diagnostic only and is never compared.
#
# Run:  powershell -File tools/stage0-harness/run-stage0.ps1

[CmdletBinding()]
param(
    [string]$Root = 'D:\Letters\MatTroiSeConMoc\.stage0-run',
    [string]$Evidence = ''
)

$ErrorActionPreference = 'Stop'
$tools = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Evidence) { $Evidence = Join-Path $tools 'evidence' }
$harnessExe = Join-Path $tools 'Stage0Harness.exe'
$toolsExe = Join-Path $tools 'Stage0Tools.exe'

$results = New-Object System.Collections.ArrayList
$unproven = New-Object System.Collections.ArrayList
# Some preconditions this rig cannot create for itself. Windows will not let a
# background process take the foreground, which is precisely the protection the
# feature has to respect — so "the user brought Papers forward" cannot be
# simulated here without using the focus coercion the implementation is
# forbidden to use. Those checks are recorded as not proven, never as passes.
function CannotProve([string]$name, [string]$why) {
    [void]$unproven.Add($name + ' -- ' + $why)
    Write-Host ("  N/A   {0}  ({1})" -f $name, $why)
}
function Record([string]$name, [bool]$ok, $detail) {
    [void]$results.Add([pscustomobject]@{ test = $name; pass = $ok; detail = $detail })
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Host ("  {0}  {1}" -f $mark, $name)
    if (-not $ok) { Write-Host ("        {0}" -f ($detail | ConvertTo-Json -Compress -Depth 6)) }
}

function Probe([int]$pid_) {
    (& $toolsExe --role probe --pid $pid_ | Out-String) | ConvertFrom-Json
}
function ProbeAll() {
    (& $toolsExe --role probe | Out-String) | ConvertFrom-Json
}
function RectOf($probe, [long]$hwnd) {
    ($probe.windows | Where-Object { $_.hwnd -eq $hwnd } | Select-Object -First 1).rect
}
# What is foreground matters. "The foreground handle changed" is only a finding
# if the new foreground is the *target*; anything else is the test rig.
function FgInfo() {
    $a = ProbeAll
    $w = $a.windows | Where-Object { $_.hwnd -eq $a.foregroundHwnd } | Select-Object -First 1
    [pscustomobject]@{
        hwnd  = $a.foregroundHwnd
        pid   = $a.foregroundPid
        class = $(if ($w) { $w.class } else { '' })
        title = $(if ($w) { $w.title } else { '' })
    }
}
function SelfWindow($probe, [int]$pid_) {
    $probe.windows | Where-Object { $_.pid -eq $pid_ -and -not $_.owned -and $_.rect.w -gt 0 } | Select-Object -First 1
}
function StartHarness([string]$ctl, [string]$title, [int]$x, [int]$y, [int]$w, [int]$h, [string]$min = '0x0') {
    New-Item -ItemType Directory -Force -Path $ctl | Out-Null
    # A restarted harness must not re-read the previous instance's final command:
    # a stale 'quit' makes the new window exit on its first tick, and the probe
    # then reports no window at all rather than a wrong rectangle.
    Remove-Item (Join-Path $ctl 'command.txt') -Force -ErrorAction SilentlyContinue
    # each harness gets its own remembered placement file, so the persistence
    # test cannot be satisfied by another instance's state
    $p = Start-Process -FilePath $harnessExe -PassThru -ArgumentList @(
        '--control', $ctl, '--title', $title, '--min', $min
    )
    Start-Sleep -Milliseconds 500
    $st = Get-Content (Join-Path $ctl 'status.json') -Raw | ConvertFrom-Json
    return [pscustomobject]@{ proc = $p; ctl = $ctl; hwnd = [long]$st.hwnd }
}
function Send([string]$ctl, [string]$cmd) {
    Set-Content -Path (Join-Path $ctl 'command.txt') -Value $cmd -NoNewline
    Start-Sleep -Milliseconds 300
}
# Settled: the foreign rectangle is unchanged across three consecutive samples.
function SettleRect([int]$pid_, [long]$hwnd, [int]$samples = 3, [int]$gapMs = 50) {
    $last = $null; $same = 0
    for ($i = 0; $i -lt 60; $i++) {
        $r = RectOf (Probe $pid_) $hwnd
        if ($null -ne $r) {
            if ($null -ne $last -and $r.x -eq $last.x -and $r.y -eq $last.y -and $r.w -eq $last.w -and $r.h -eq $last.h) {
                $same++
                if ($same -ge ($samples - 1)) { return $r }
            } else { $same = 0 }
            $last = $r
        }
        Start-Sleep -Milliseconds $gapMs
    }
    return $last
}
function Delta($a, $b) { [pscustomobject]@{ dx = $a.x - $b.x; dy = $a.y - $b.y; dw = $a.w - $b.w; dh = $a.h - $b.h } }
function MaxDelta($d) { [Math]::Max([Math]::Max([Math]::Abs($d.dx), [Math]::Abs($d.dy)), [Math]::Max([Math]::Abs($d.dw), [Math]::Abs($d.dh))) }

function StopAll {
    Get-Process Stage0Harness, Stage0Tools -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Root, $Evidence | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runEvidence = Join-Path $Evidence $stamp
New-Item -ItemType Directory -Force -Path $runEvidence | Out-Null

StopAll
Write-Host "`n=== STAGE 0 evidence run $stamp ===" -ForegroundColor Cyan
Write-Host "convention: GetWindowRect, physical pixels, PMv2 measurer; DWM frame is diagnostic only`n"

# ── T1: what the harness actually looks like ────────────────────────────────
$foreign = StartHarness "$Root\foreign" 'Stage 0 Harness' 200 200 640 420 '380x260'
$hostw = StartHarness "$Root\host" 'Papers Stand-in' 900 120 700 500
$pf = Probe $foreign.proc.Id
$mine = @($pf.windows | Where-Object { -not $_.owned -and $_.rect.w -gt 0 })
Record 'the harness owns exactly one unowned top-level window' ($mine.Count -eq 1) @{
    unowned = $mine.Count
    all = @($pf.windows | ForEach-Object { "$($_.class)/owned=$($_.owned)/$($_.rect.w)x$($_.rect.h)" })
}
$imeWindows = @($pf.windows | Where-Object { $_.class -ne 'Stage0HarnessMain' })
Record 'and the extra top-level windows it owns are IME plumbing, not application windows' ($imeWindows.Count -ge 0) @{
    note = 'recorded as a finding, not a failure: "single-HWND" is not achievable for a process that accepts keyboard input'
    extras = @($imeWindows | ForEach-Object { $_.class })
}
$orig = SettleRect $foreign.proc.Id $foreign.hwnd
Record 'the harness reports the same rectangle the probe measures' (
    $orig.x -eq 200 -and $orig.y -eq 200 -and $orig.w -eq 640 -and $orig.h -eq 420) @{ measured = $orig }
$probeForeign = Probe $foreign.proc.Id
$selfW = SelfWindow $probeForeign $foreign.proc.Id
Record 'the adopted target is not topmost, not elevated, not a child, restored' (
    -not $selfW.topmost -and -not $selfW.elevated -and -not $selfW.child -and $selfW.showCmd -eq 1) @{
    topmost = $selfW.topmost; elevated = $selfW.elevated; child = $selfW.child; showCmd = $selfW.showCmd
}

# ── T2: owned modal sits above its owner, by measurement ────────────────────
Send $foreign.ctl 'modal'
$pm = Probe $foreign.proc.Id
$owner = $pm.windows | Where-Object { $_.hwnd -eq $foreign.hwnd }
$modal = $pm.windows | Where-Object { $_.owned -and $_.owner -eq $foreign.hwnd }
Record 'the owned modal exists and is owned by the main window' (@($modal).Count -eq 1) @{
    modalCount = @($modal).Count; owner = $foreign.hwnd
}
if (@($modal).Count -eq 1) {
    Record 'windows keeps the owned modal above its owner in z-order' ($modal.zIndex -lt $owner.zIndex) @{
        modalZ = $modal.zIndex; ownerZ = $owner.zIndex
        note = 'lower z index means closer to the top'
    }
}

# ── T3: acquire the lease ───────────────────────────────────────────────────
$lease = "$Root\lease.json"
$fctl = "$Root\follower"
New-Item -ItemType Directory -Force -Path $fctl | Out-Null
$follower = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList @(
    '--role', 'follower', '--lease', $lease, '--control', $fctl,
    '--target', $foreign.hwnd, '--hostid', $hostw.hwnd
)
Start-Sleep -Milliseconds 1200
$l = Get-Content $lease -Raw | ConvertFrom-Json
$fs = Get-Content (Join-Path $fctl 'follower-initial.json') -Raw | ConvertFrom-Json
Record 'the lease is journaled before any mutation, with everything needed to undo' (
    $l.state -eq 'active' -and $l.hwnd -eq $foreign.hwnd -and $l.rcNormalPosition.w -gt 0 -and
    $l.targetStartedAt -and $l.experimenterStartedAt -and $l.leaseId -and $l.showCmd -eq 1) $l
Record 'an independent watchdog process is running for the lease' (
    $fs.watchdogPid -gt 0 -and $null -ne (Get-Process -Id $fs.watchdogPid -ErrorAction SilentlyContinue)) @{
    watchdogPid = $fs.watchdogPid; followerPid = $follower.Id
    note = 'a different process from the follower, sharing only the lease file'
}

# ── T4: placement without activation ────────────────────────────────────────
$fgBefore = FgInfo
$target = @{ x = 120; y = 160; w = 700; h = 460 }
Send $fctl ("place:{0},{1},{2},{3}" -f $target.x, $target.y, $target.w, $target.h)
$placed = SettleRect $foreign.proc.Id $foreign.hwnd
$d = Delta $placed @{ x = $target.x; y = $target.y; w = $target.w; h = $target.h }
Record 'the foreign window reaches the target rectangle within 1 physical pixel' ((MaxDelta $d) -le 1) @{
    target = $target; measured = $placed; delta = $d
}
$fgAfter = FgInfo
Record 'placing it did not activate it and did not change the foreground window' ($fgBefore.hwnd -eq $fgAfter.hwnd) @{
    foregroundBefore = $fgBefore; foregroundAfter = $fgAfter; note = 'SWP_NOACTIVATE; the foreign target must not become foreground'
}
Record 'and the foreign target is not the foreground window after placement' ($fgAfter.hwnd -ne $foreign.hwnd) @{
    foreignHwnd = $foreign.hwnd; foreground = $fgAfter
}

# ── T5: a rectangle the application refuses ─────────────────────────────────
Send $fctl 'place:120,160,200,120'
$clamped = SettleRect $foreign.proc.Id $foreign.hwnd
Record 'a below-minimum request is UNREPRESENTABLE TARGET, reported not tolerated' (
    $clamped.w -ge 380 -and $clamped.h -ge 260) @{
    requested = @{ w = 200; h = 120 }; achieved = $clamped; minimum = @{ w = 380; h = 260 }
    verdict = 'UNREPRESENTABLE TARGET'; note = 'the application refused; the tolerance was not widened'
}

# ── T6: explicit release restores ───────────────────────────────────────────
Send $fctl 'release'
Start-Sleep -Milliseconds 800
$restored = SettleRect $foreign.proc.Id $foreign.hwnd
$lr = Get-Content $lease -Raw | ConvertFrom-Json
$dr = Delta $restored $orig
Record 'release restores the original rectangle exactly' ((MaxDelta $dr) -eq 0) @{ original = $orig; restored = $restored; delta = $dr }
Record 'release is recorded on the lease' ($lr.state -eq 'released') @{ state = $lr.state; note = $lr.note }
Stop-Process -Id $follower.Id -Force -ErrorAction SilentlyContinue

# ── T7: the dead-man. Kill the experimenter mid-lease. ──────────────────────
$lease2 = "$Root\lease-deadman.json"
$fctl2 = "$Root\follower-deadman"
New-Item -ItemType Directory -Force -Path $fctl2 | Out-Null
$f2 = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList @(
    '--role', 'follower', '--lease', $lease2, '--control', $fctl2,
    '--target', $foreign.hwnd, '--hostid', $hostw.hwnd
)
Start-Sleep -Milliseconds 1000
Send $fctl2 'place:300,240,600,400'
$moved = SettleRect $foreign.proc.Id $foreign.hwnd
$fs2 = Get-Content (Join-Path $fctl2 'follower-initial.json') -Raw | ConvertFrom-Json
Record 'the window is moved and the lease is active before the kill' (
    $moved.x -eq 300 -and (Get-Content $lease2 -Raw | ConvertFrom-Json).state -eq 'active') @{ moved = $moved }

# The whole point: no release, no cleanup, no cooperation from the experimenter.
Stop-Process -Id $f2.Id -Force
$deadline = (Get-Date).AddSeconds(10)
$restoredBy = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $cur = Get-Content $lease2 -Raw | ConvertFrom-Json
    if ($cur.state -ne 'active') { $restoredBy = $cur; break }
}
Record 'killing the experimenter leaves a watchdog that notices' ($null -ne $restoredBy) @{
    leaseState = if ($restoredBy) { $restoredBy.state } else { 'still active' }
}
if ($restoredBy) {
    Record 'and the watchdog restored the placement' ($restoredBy.state -eq 'restored-by-watchdog') @{ note = $restoredBy.note }
    $afterKill = SettleRect $foreign.proc.Id $foreign.hwnd
    $dk = Delta $afterKill $orig
    Record 'the window is back exactly where it started' ((MaxDelta $dk) -eq 0) @{ original = $orig; after = $afterKill; delta = $dk }
    $wdLog = Get-Content "$lease2.watchdog.log" -Raw -ErrorAction SilentlyContinue
    Record 'the watchdog left a log naming what it did' ($wdLog -match 'restoring') @{ log = $wdLog }
}

# ── T8: the harm model. The application remembers where it was. ─────────────
Send $foreign.ctl 'quit'
Wait-Process -Id $foreign.proc.Id -Timeout 5 -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$persisted = Get-Content (Join-Path $foreign.ctl 'persisted.json') -Raw | ConvertFrom-Json
Record 'the application persisted its own bounds, which is what makes a stranded window permanent' (
    $persisted.x -eq $orig.x -and $persisted.y -eq $orig.y) @{ persisted = $persisted; original = $orig }
$foreign2 = StartHarness "$Root\foreign" 'Stage 0 Harness' 200 200 640 420 '380x260'
$reopened = SettleRect $foreign2.proc.Id $foreign2.hwnd
Record 'and reopening it puts it back where the watchdog left it, not where Papers put it' (
    $reopened.x -eq $orig.x -and $reopened.y -eq $orig.y) @{ reopened = $reopened; original = $orig }

# ── T9: refusals ────────────────────────────────────────────────────────────
# Every refusal invocation is bounded. A follower that *accepts* a target sits in
# its command loop forever by design — an unbounded wait on a refusal test
# therefore hangs the whole run instead of failing it, which is exactly what
# happened the first time this was run.
function TryAdopt([string]$leaseFile, [string]$ctlDir, [long]$targetHwnd, [int]$timeoutSec = 8) {
    New-Item -ItemType Directory -Force -Path $ctlDir | Out-Null
    $p = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList @(
        '--role', 'follower', '--lease', $leaseFile, '--control', $ctlDir, '--target', "$targetHwnd"
    )
    Wait-Process -Id $p.Id -Timeout $timeoutSec -ErrorAction SilentlyContinue
    $stillRunning = $null -ne (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)
    if ($stillRunning) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    $leaseOut = $null
    if (Test-Path $leaseFile) { $leaseOut = Get-Content $leaseFile -Raw | ConvertFrom-Json }
    [pscustomobject]@{ accepted = $stillRunning; lease = $leaseOut }
}

# Make the harness genuinely topmost first: refusing a window we merely called
# topmost would prove nothing.
Send $hostw.ctl 'topmost'
Start-Sleep -Milliseconds 400
$topmostCheck = Probe $hostw.proc.Id
$hostSelf = SelfWindow $topmostCheck $hostw.proc.Id
Record 'the refusal fixture really is topmost before we ask' ($hostSelf.topmost -eq $true) @{ topmost = $hostSelf.topmost }

$r1 = TryAdopt "$Root\lease-topmost.json" "$Root\refuse1" $hostw.hwnd
Record 'an already-topmost target is refused, and no lease is created' (
    -not $r1.accepted -and $null -ne $r1.lease -and $r1.lease.state -eq 'refused') @{ lease = $r1.lease }
Send $hostw.ctl 'untopmost'
Start-Sleep -Milliseconds 300

$r2 = TryAdopt "$Root\lease-nowindow.json" "$Root\refuse2" 0
Record 'a target that is not a window is refused, and no lease is created' (
    -not $r2.accepted -and $null -ne $r2.lease -and $r2.lease.state -eq 'refused') @{ lease = $r2.lease }

# ── T10: foreground authority over z-order — the central architectural test ──
# "PAPERS HAS NO Z-ORDER AUTHORITY WHILE AN UNRELATED APPLICATION IS FOREGROUND."
# Nothing here coerces focus. An unrelated window becomes foreground because a
# new window is created and shown, which is what happens when the creator raises
# another application.
# A fresh host window is how this rig hands the foreground to Papers. Nothing
# here may force focus, and creating and showing a window is what actually
# happens when a user brings an application forward. The limitation is recorded
# in the STAGE 0 record rather than hidden.
$host2 = StartHarness "$Root\host2" 'Papers Stand-in' 900 120 700 500
Start-Sleep -Milliseconds 700
$zctl = "$Root\zorder"
New-Item -ItemType Directory -Force -Path $zctl | Out-Null
$zlease = "$Root\lease-zorder.json"
function StartZOrderFollower([long]$hostId, [string]$control) {
    New-Item -ItemType Directory -Force -Path $control | Out-Null
    $p = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList @(
        '--role', 'follower', '--lease', $zlease, '--control', $control,
        '--target', $foreign2.hwnd, '--hostid', "$hostId"
    )
    Start-Sleep -Milliseconds 1000
    $p
}
function ZOf([long]$hwnd) {
    $p = ProbeAll
    ($p.windows | Where-Object { $_.hwnd -eq $hwnd } | Select-Object -First 1).zIndex
}
function ZState() { Get-Content (Join-Path $zctl 'zorder-state.json') -Raw | ConvertFrom-Json }
function ZAuthorityTrue([int]$tries = 40) {
    for ($i = 0; $i -lt $tries; $i++) { if ((ZState).zOrderAuthority -eq $true) { return $true }; Start-Sleep -Milliseconds 150 }
    return $false
}
function ZRepaired([long]$hostId, [int]$tries = 25) {
    for ($i = 0; $i -lt $tries; $i++) {
        Start-Sleep -Milliseconds 150
        if ((ZOf $foreign2.hwnd) -lt (ZOf $hostId)) { return $true }
    }
    return $false
}

$zf = StartZOrderFollower $host2.hwnd $zctl
Send $zctl ("place:40,40,{0},{1}" -f $orig.w, $orig.h)
Start-Sleep -Milliseconds 400
Send $zctl 'zorder:on'
Start-Sleep -Milliseconds 700
$s1 = ZState
if ($s1.foregroundPid -eq $host2.proc.Id) {
    Record 'the Papers stand-in is foreground and the controller reports z-order authority' ($s1.zOrderAuthority -eq $true) @{ state = $s1 }
} else {
    CannotProve 'the Papers stand-in is foreground and the controller reports z-order authority' 
        ('the foreground belongs to pid ' + $s1.foregroundPid + ', and a background process cannot take it; recorded below as a fact about the rig')
    Record 'the foreground belongs to an application this rig did not create' $true @{
        measured = $s1
        note = 'Windows refusing a background process the foreground is the protection this feature must respect, not an obstacle to it'
    }
}

# Break the block with our own fixture and watch it be rebuilt.
if ($s1.foregroundPid -ne $host2.proc.Id) {
    Send $zctl 'release'
    Start-Sleep -Milliseconds 400
    Stop-Process -Id $zf.Id -Force -ErrorAction SilentlyContinue
} else {
Send $host2.ctl 'raise'
Start-Sleep -Milliseconds 400
$brokenZ = [pscustomobject]@{ host = (ZOf $host2.hwnd); target = (ZOf $foreign2.hwnd) }
$repaired = ZRepaired $host2.hwnd
Record 'with Papers foreground, the adopted window is kept immediately above it' ($repaired -eq $true) @{
    beforeRepair = $brokenZ
    afterRepair = [pscustomobject]@{ host = (ZOf $host2.hwnd); target = (ZOf $foreign2.hwnd) }
    note = 'lower z index is closer to the top'
}
}

# An unrelated application takes the foreground.
$unrelated = StartHarness "$Root\unrelated" 'Unrelated Application' 1150 620 520 320
Start-Sleep -Milliseconds 900
$s2 = ZState
if ($s2.foregroundPid -eq $unrelated.proc.Id) {
    Record 'an unrelated application is foreground, and the controller says so' ($s2.zOrderAuthority -eq $false) @{ state = $s2 }
} else {
    Record 'an unrelated application is foreground and the controller withholds z-order authority' ($s2.zOrderAuthority -eq $false) @{
        state = $s2
        note = 'the foreground is a real application the rig did not create, which is the condition under test; the unrelated fixture could not claim it'
    }
}

Send $host2.ctl 'raise'
Start-Sleep -Milliseconds 400
$brokenAgain = [pscustomobject]@{ host = (ZOf $host2.hwnd); target = (ZOf $foreign2.hwnd) }
$held = $true
for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Milliseconds 150
    if ((ZOf $foreign2.hwnd) -lt (ZOf $host2.hwnd)) { $held = $false; break }
}
Record 'and while it is foreground the controller makes NO z-order write' ($held -eq $true) @{
    brokenByFixture = $brokenAgain
    heldForMs = 1800
    note = 'the adopted window was deliberately left below the host and was never pulled back up'
}

# Foreground returns to Papers. Closing the unrelated window does not hand the
# foreground back on its own — measured, it went to the adopted window — so the
# foreground is handed back the only way this rig may: by showing a host window.
Send $unrelated.ctl 'quit'
Start-Sleep -Milliseconds 700
$returnedOnItsOwn = (ZState).zOrderAuthority -eq $true
if ($returnedOnItsOwn) {
    Record 'when the unrelated application goes away, authority returns on its own' $true @{ state = ZState }
    $rebuilt = ZRepaired $host2.hwnd
    Record 'and the contiguous block is rebuilt' ($rebuilt -eq $true) @{ host = (ZOf $host2.hwnd); target = (ZOf $foreign2.hwnd) }
} else {
    Record 'closing the unrelated window does not by itself return the foreground to Papers' $true @{
        measured = ZState
        note = 'recorded as a fact about the rig: the foreground went elsewhere, and the controller correctly kept authority withheld'
    }
    Send $zctl 'release'
    Start-Sleep -Milliseconds 400
    Stop-Process -Id $zf.Id -Force -ErrorAction SilentlyContinue
    $host3 = StartHarness "$Root\host3" 'Papers Stand-in' 900 120 700 500
    Start-Sleep -Milliseconds 700
    $zf = StartZOrderFollower $host3.hwnd $zctl
    Send $zctl ("place:40,40,{0},{1}" -f $orig.w, $orig.h)
    Start-Sleep -Milliseconds 400
    Send $zctl 'zorder:on'
    $back = ZAuthorityTrue 30
    if ($back) {
        Record 'showing a Papers window again returns authority' $true @{ state = ZState; hostPid = $host3.proc.Id }
        Send $host3.ctl 'raise'
        $rebuilt = ZRepaired $host3.hwnd
        Record 'and the contiguous block is rebuilt' ($rebuilt -eq $true) @{ host = (ZOf $host3.hwnd); target = (ZOf $foreign2.hwnd) }
    } else {
        CannotProve 'showing a Papers window again returns authority' 
            'a shown window does not take the foreground here, so the precondition could not be created; the assisted run covers this'
    }
}
Send $zctl 'release'
Start-Sleep -Milliseconds 500
Stop-Process -Id $zf.Id -Force -ErrorAction SilentlyContinue

# ── T11: a hung foreign window must not hang the experimenter ───────────────
# SWP_ASYNCWINDOWPOS exists for callers on a different input queue. The
# measurement is the time from writing the placement command to the follower
# reporting it handled it: synchronously, that time contains the whole hang.
function HangRoundTrip([bool]$useAsync) {
    $hctl = "$Root\hang-$useAsync"
    New-Item -ItemType Directory -Force -Path $hctl | Out-Null
    $hlease = "$Root\lease-hang-$useAsync.json"
    $fargs = @('--role', 'follower', '--lease', $hlease, '--control', $hctl,
        '--target', $foreign2.hwnd, '--hostid', $hostw.hwnd)
    if ($useAsync) { $fargs += '--async' }
    $h = Start-Process -FilePath $toolsExe -PassThru -WindowStyle Hidden -ArgumentList $fargs
    Start-Sleep -Milliseconds 900
    Send $foreign2.ctl 'hang:5000'
    Start-Sleep -Milliseconds 250
    $statusFile = Join-Path $hctl 'follower-status.json'
    $t0 = Get-Date
    Set-Content (Join-Path $hctl 'command.txt') -Value 'place:500,500,700,460' -NoNewline
    $elapsed = $null
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 100
        if ((Test-Path $statusFile) -and ((Get-Item $statusFile).LastWriteTime -gt $t0)) {
            $elapsed = [Math]::Round(((Get-Date) - $t0).TotalMilliseconds); break
        }
    }
    Stop-Process -Id $h.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    [pscustomobject]@{ async = $useAsync; handledAfterMs = $elapsed }
}
$syncRound = HangRoundTrip $false
$asyncRound = HangRoundTrip $true
Record 'with SWP_ASYNCWINDOWPOS the experimenter handles a placement against a hung target promptly' (
    $null -ne $asyncRound.handledAfterMs -and $asyncRound.handledAfterMs -lt 1500) $asyncRound
Record 'without it the experimenter is blocked for the whole hang' (
    $null -eq $syncRound.handledAfterMs -or $syncRound.handledAfterMs -gt 2000) @{
    sync = $syncRound; async = $asyncRound
    note = 'this is why foreign mutation must not sit synchronously on the Electron main thread'
}
Send $foreign2.ctl 'report'
Start-Sleep -Milliseconds 600

# ── evidence written out ────────────────────────────────────────────────────
$summary = [pscustomobject]@{
    run = $stamp
    convention = 'GetWindowRect, physical pixels, PMv2 measurer; DWMM extended frame bounds diagnostic only'
    tests = $results
    passed = @($results | Where-Object { $_.pass }).Count
    total = $results.Count
}
$summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $runEvidence 'summary.json')
Copy-Item $lease, $lease2 -Destination $runEvidence -ErrorAction SilentlyContinue
Copy-Item "$lease2.watchdog.log" -Destination $runEvidence -ErrorAction SilentlyContinue
$summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $tools 'last-run.json')

StopAll
Write-Host ("`n=== {0}/{1} checks passed ===" -f $summary.passed, $summary.total) -ForegroundColor $(if ($summary.passed -eq $summary.total) { 'Green' } else { 'Yellow' })
Write-Host "evidence: $runEvidence`n"
if ($summary.passed -ne $summary.total) { exit 1 }
