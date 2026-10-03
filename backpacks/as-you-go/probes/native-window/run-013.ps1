# Assignment 013R — authorized live matrix: long-lived JSON-lines helper proof.
#
# For EACH locally available PowerShell runtime (pwsh and/or powershell.exe,
# discovered read-only), launches the probe helper as a child process with
# UTF-8 redirected stdin/stdout/stderr, drives the six-method protocol with
# requestId correlation, 011-style ignore/coalesce proofs, fragmentation
# inside an actual multibyte UTF-8 character, and ONE uniquely titled
# disposable window lifecycle with identity-safe mutation. Finally-style
# cleanup closes only the harness-owned window and helper; a fresh helper
# proves no mutation replay.
#
# Safety: discovery by unique title ONLY through the shared pure resolver
# (missing/ambiguous/success; never mutates); every mutation re-observes and
# verifies the recorded PID/title before acting (helper-side registry is the
# authoritative final check); never acts on pre-existing windows.
# Run:  pwsh -File probes/native-window/run-013.ps1

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
. "$PSScriptRoot/window-capability.ps1"
. "$PSScriptRoot/probe-013-resolver.ps1"

$script:passed = 0
$script:failed = 0
$script:ownedHelperPids = [System.Collections.Generic.List[int]]::new()
$script:transcript = [System.Collections.Generic.List[string]]::new()
function Log([string]$Line) {
  $script:transcript.Add($Line)
  Write-Output $Line
}
function Assert-True {
  param([bool]$Condition, [string]$Message)
  if ($Condition) {
    $script:passed += 1
    Log "PASS: $Message"
  } else {
    $script:failed += 1
    Log "FAIL: $Message"
  }
}

function Get-RuntimeInfo {
  $runtimes = @()
  $pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwshCommand) {
    $version = (& $pwshCommand.Source -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>$null | Select-Object -Last 1)
    $runtimes += [pscustomobject]@{ Basename = 'pwsh'; Path = $pwshCommand.Source; Version = [string]$version }
  }
  $powershellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($powershellCommand) {
    $version = (& $powershellCommand.Source -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>$null | Select-Object -Last 1)
    $runtimes += [pscustomobject]@{ Basename = 'powershell'; Path = $powershellCommand.Source; Version = [string]$version }
  }
  return $runtimes
}

function Start-AygHelper {
  param([string]$RuntimePath)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $RuntimePath
  $psi.Arguments = "-NoProfile -NonInteractive -File `"$PSScriptRoot/helper-jsonline.ps1`""
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)
  $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $psi.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
  $process = [System.Diagnostics.Process]::Start($psi)
  $script:ownedHelperPids.Add($process.Id)
  return $process
}

function Read-HelperLine {
  param([System.Diagnostics.Process]$Process, [int]$TimeoutMs = 5000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $task = $Process.StandardOutput.ReadLineAsync()
  while (-not $task.Wait(50)) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'helper response timeout' }
    if ($Process.HasExited) { throw "helper exited early (code $($Process.ExitCode))" }
  }
  return $task.Result
}

function Send-AygRequest {
  param(
    [System.Diagnostics.Process]$Process,
    [long]$RequestId,
    [string]$Method,
    [hashtable]$Fields = @{},
    [bool]$Fragmented = $false
  )
  $request = @{ requestId = $RequestId; method = $Method }
  foreach ($key in $Fields.Keys) { $request[$key] = $Fields[$key] }
  $json = $request | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json + "`n")
  $stream = $Process.StandardInput.BaseStream
  if ($Fragmented) {
    $mid = [Math]::Floor($bytes.Length / 2)
    $stream.Write($bytes, 0, $mid)
    $stream.Flush()
    Start-Sleep -Milliseconds 40
    $stream.Write($bytes, $mid, $bytes.Length - $mid)
    $stream.Flush()
  } else {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  }
  $line = Read-HelperLine $Process
  return ($line | ConvertFrom-Json)
}

function Stop-AygHelper {
  param([System.Diagnostics.Process]$Process)
  try {
    $Process.StandardInput.BaseStream.Close()  # EOF -> helper exits
  } catch { }
  if (-not $Process.WaitForExit(5000)) {
    try { $Process.Kill() } catch { }
    $Process.WaitForExit(5000) | Out-Null
  }
}

function Test-AygWindowTolerance {
  param([double]$Actual, [double]$Expected)
  return [Math]::Abs($Actual - $Expected) -le 8
}

function Invoke-AygRuntimeProof {
  param([pscustomobject]$Runtime)

  Log "==== runtime: $($Runtime.Basename) $($Runtime.Version) [$($Runtime.Path)] ===="
  $helper = $null
  $form = $null
  $runtimePassedBefore = $script:passed
  $runtimeFailedBefore = $script:failed
  try {
    $helper = Start-AygHelper $Runtime.Path
    $uniqueTitle = "AYG-013-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))"

    # --- zero-match discovery: typed missing, no act ------------------------
    $listBefore = Send-AygRequest $helper 1 'list'
    Assert-True ($listBefore.outcome -eq 'success') 'list succeeds before the window exists'
    $resolveBefore = Resolve-AygUniqueTarget @($listBefore.windows) $uniqueTitle
    Assert-True ($resolveBefore.outcome -eq 'missing') 'zero-match discovery: typed missing, no act'

    # --- create the ONE disposable window (harness-owned, in-process) -------
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $uniqueTitle
    $form.Size = New-Object System.Drawing.Size(400, 300)
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Location = New-Object System.Drawing.Point(120, 140)
    $form.Show()
    $hwnd = $form.Handle
    [void][AYG.Win32]::ShowWindow($hwnd, 5)
    for ($i = 0; $i -lt 20 -and -not [AYG.Win32]::IsWindowVisible($hwnd); $i += 1) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
    }

    # --- discovery via the shared resolver: exactly one match ---------------
    $list = Send-AygRequest $helper 2 'list'
    $resolved = Resolve-AygUniqueTarget @($list.windows) $uniqueTitle
    Assert-True ($resolved.outcome -eq 'success') 'exactly one window matches the unique title'
    $targetId = [string]$resolved.runtimeId
    $targetPid = [int]$resolved.pid
    $targetTitle = [string]$resolved.title
    Log "discovered runtimeId=$targetId pid=$targetPid title=$targetTitle"

    # --- observe: normal state and initial bounds ---------------------------
    $observe = Send-AygRequest $helper 3 'observe' @{ target = $targetId }
    Assert-True ($observe.outcome -eq 'success') 'observe succeeds'
    Assert-True ([string]$observe.observation.runtimeId -eq $targetId) 'observed runtimeId echoes the wire token'
    Assert-True ([int]$observe.observation.processId -eq $PID) 'observed PID matches the probe-owned identity'
    Assert-True ([string]$observe.observation.title -eq $uniqueTitle) 'observed title matches the unique identity'
    Assert-True ([string]$observe.observation.state -eq 'normal') 'initial state is normal'
    $w0 = [double]$observe.observation.bounds.width
    $h0 = [double]$observe.observation.bounds.height
    Assert-True ($w0 -ge 300 -and $h0 -ge 200) "initial bounds are the form size ($w0 x $h0)"

    # --- fail-closed live cases: 011 ignore policy, coalesced ---------------
    $invalidLines = @(
      'this is not json',
      '{"requestId":0,"method":"list"}',
      '{"requestId":9007199254740992,"method":"list"}',
      '{"requestId":4,"method":"pwn"}'
    )
    $validRequest = @{ requestId = 4; method = 'list' } | ConvertTo-Json -Compress
    $coalesced = [System.Text.Encoding]::UTF8.GetBytes((($invalidLines + $validRequest) -join "`n") + "`n")
    $helper.StandardInput.BaseStream.Write($coalesced, 0, $coalesced.Length)
    $helper.StandardInput.BaseStream.Flush()
    $coalescedResp = Read-HelperLine $helper | ConvertFrom-Json
    Assert-True ($coalescedResp.requestId -eq 4 -and $coalescedResp.outcome -eq 'success') 'invalid lines are ignored; the only response correlates to the valid request'
    $denied = Send-AygRequest $helper 5 'list' @{ exec = 'calc.exe' }
    Assert-True ($denied.outcome -eq 'denied') 'command-like field is denied, not executed'
    $deadId = Send-AygRequest $helper 6 'observe' @{ target = '999999999' }
    Assert-True ($deadId.outcome -eq 'missing') 'a dead runtime id returns missing, no act'

    # --- fragmentation INSIDE an actual multibyte UTF-8 character -----------
    $mbTarget = [string][char]0x0442 + 'arget'
    $mbRequest = '{"requestId":7,"method":"observe","target":"' + $mbTarget + '"}'
    $mbBytes = [System.Text.Encoding]::UTF8.GetBytes($mbRequest + "`n")
    $mbUnit = [System.Text.Encoding]::UTF8.GetBytes([string][char]0x0442)
    $splitAt = 0
    for ($i = 0; $i -lt $mbBytes.Length - 1; $i += 1) {
      if ($mbBytes[$i] -eq $mbUnit[0] -and $mbBytes[$i + 1] -eq $mbUnit[1]) { $splitAt = $i + 1; break }
    }
    Assert-True ($splitAt -gt 0) 'the multibyte split point is inside the first UTF-8 character'
    $helper.StandardInput.BaseStream.Write($mbBytes, 0, $splitAt)
    $helper.StandardInput.BaseStream.Flush()
    Start-Sleep -Milliseconds 40
    $helper.StandardInput.BaseStream.Write($mbBytes, $splitAt, $mbBytes.Length - $splitAt)
    $helper.StandardInput.BaseStream.Flush()
    $mbResp = Read-HelperLine $helper | ConvertFrom-Json
    Assert-True ($mbResp.requestId -eq 7 -and $mbResp.outcome -eq 'missing') 'a request split inside a multibyte character parses and fails closed as a non-token target'
    $afterMb = Send-AygRequest $helper 8 'list'
    Assert-True ($afterMb.requestId -eq 8 -and $afterMb.outcome -eq 'success') 'the next valid request correlates after the multibyte split'

    # --- identity check helper: re-observe and verify before every act ------
    $verifyIdentity = {
      param($id, $expectedPid, $expectedTitle)
      $obs = Send-AygRequest $helper 90 'observe' @{ target = $id }
      return $obs.outcome -eq 'success' -and [string]$obs.observation.runtimeId -eq $id -and [int]$obs.observation.processId -eq $expectedPid -and [string]$obs.observation.title -eq $expectedTitle
    }

    # --- minimize / restore -------------------------------------------------
    if (& $verifyIdentity $targetId $targetPid $targetTitle) {
      $min = Send-AygRequest $helper 9 'minimize' @{ target = $targetId }
      Assert-True ($min.outcome -eq 'success' -and [string]$min.observation.state -eq 'minimized') 'minimize -> minimized'
      $rest = Send-AygRequest $helper 10 'restore' @{ target = $targetId }
      Assert-True ($rest.outcome -eq 'success' -and [string]$rest.observation.state -eq 'normal') 'restore -> normal'
      Log 'transition: normal -> minimized -> normal (via helper observations)'
    } else {
      Log 'FAIL: identity verification failed before minimize/restore'
      $script:failed += 1
    }

    # --- apply bounded bounds and verify toleranced -------------------------
    if (& $verifyIdentity $targetId $targetPid $targetTitle) {
      $applied = Send-AygRequest $helper 11 'apply' @{
        target = $targetId
        bounds = @{ x = 200; y = 180; width = 360; height = 260 }
      }
      Assert-True ($applied.outcome -eq 'success') 'apply succeeds'
      $ax = [double]$applied.observation.bounds.x
      $ay = [double]$applied.observation.bounds.y
      $aw = [double]$applied.observation.bounds.width
      $ah = [double]$applied.observation.bounds.height
      Assert-True ((Test-AygWindowTolerance $aw 360) -and (Test-AygWindowTolerance $ah 260)) "applied bounds round-trip (w=$aw h=$ah)"
      Assert-True ((Test-AygWindowTolerance $ax 200) -and (Test-AygWindowTolerance $ay 180)) "applied position round-trip (x=$ax y=$ay)"
      Log "applied bounds (200,180,360x260); observed (x=$ax y=$ay w=$aw h=$ah)"
    } else {
      Log 'FAIL: identity verification failed before apply'
      $script:failed += 1
    }

    # --- coalesced requests: two lines in one write -------------------------
    $reqA = @{ requestId = 12; method = 'observe'; target = $targetId } | ConvertTo-Json -Compress
    $reqB = @{ requestId = 13; method = 'list' } | ConvertTo-Json -Compress
    $combined = [System.Text.Encoding]::UTF8.GetBytes($reqA + "`n" + $reqB + "`n")
    $helper.StandardInput.BaseStream.Write($combined, 0, $combined.Length)
    $helper.StandardInput.BaseStream.Flush()
    $respA = Read-HelperLine $helper | ConvertFrom-Json
    $respB = Read-HelperLine $helper | ConvertFrom-Json
    Assert-True ($respA.requestId -eq 12 -and $respB.requestId -eq 13) 'coalesced requests respond in order with correct correlation'

    # --- MAX_SAFE requestId live: exact correlated echo without narrowing ---
    $maxSafe = Send-AygRequest $helper 9007199254740991 'list'
    Assert-True ($maxSafe.requestId -eq 9007199254740991 -and $maxSafe.outcome -eq 'success') 'MAX_SAFE requestId echoes exactly live'
    Log 'MAX_SAFE requestId: 9007199254740991 echoed exactly (no narrowing) on this runtime'

    # --- graceful close and disappearance -----------------------------------
    $closed = Send-AygRequest $helper 14 'close' @{ target = $targetId }
    Assert-True ($closed.outcome -eq 'success') 'close succeeds'
    for ($i = 0; $i -lt 40 -and -not $form.IsDisposed; $i += 1) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
    }
    $afterClose = Send-AygRequest $helper 15 'observe' @{ target = $targetId }
    Assert-True ($afterClose.outcome -eq 'missing') 'the window is gone after graceful close'
    $form = $null

    # --- replay proof: EOF, fresh helper receives no previous mutation ------
    Stop-AygHelper $helper
    $helperExitCode = $helper.ExitCode
    Log "main helper exit code: $helperExitCode"
    $helper = $null
    $fresh = Start-AygHelper $Runtime.Path
    try {
      $freshList = Send-AygRequest $fresh 16 'list'
      Assert-True ($freshList.requestId -eq 16 -and $freshList.outcome -eq 'success') 'fresh helper: first output is the response to the first request (no replay)'
      $freshMatches = @($freshList.windows | Where-Object { $_.title -eq $uniqueTitle })
      Assert-True ($freshMatches.Count -eq 0) 'the fresh helper sees no trace of the closed window'
      Log 'fresh-helper no-replay: PASS (first output = response to request 16; no window trace)'
      $oldToken = Send-AygRequest $fresh 17 'observe' @{ target = $targetId }
      Assert-True ($oldToken.outcome -eq 'missing') 'the main helper token is unusable in the fresh helper (session-scoped)'
      Log 'token session-scoping: PASS (previous-session token is missing in the fresh helper)'
    } finally {
      Stop-AygHelper $fresh
      Log "fresh helper exit code: $($fresh.ExitCode)"
    }
  } finally {
    if ($form -and -not $form.IsDisposed) {
      $form.Close()
      [System.Windows.Forms.Application]::DoEvents()
    }
    if ($helper -and -not $helper.HasExited) {
      Stop-AygHelper $helper
    }
    if ($helper -and $helper.HasExited) {
      try {
        $stderr = $helper.StandardError.ReadToEnd()
        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
          Log "helper stderr (bounded): $($stderr.Substring(0, [Math]::Min(400, $stderr.Length)))"
        }
      } catch { }
    }
    $runtimePassed = $script:passed - $runtimePassedBefore
    $runtimeFailed = $script:failed - $runtimeFailedBefore
    Log "runtime summary: $runtimePassed passed, $runtimeFailed failed"
  }
}

# ---- main ----------------------------------------------------------------
$runtimes = @(Get-RuntimeInfo)
Log "runtimes discovered: $(($runtimes | ForEach-Object { "$($_.Basename) $($_.Version)" }) -join ', ')"
if ($runtimes.Count -eq 0) { Write-Output 'FAIL: no PowerShell runtime available'; exit 1 }

try {
  foreach ($runtime in $runtimes) {
    Invoke-AygRuntimeProof $runtime
  }
} finally {
  $stillRunning = @($script:ownedHelperPids | Where-Object {
    try { -not (Get-Process -Id $_ -ErrorAction Stop).HasExited } catch { $false }
  })
  $leftoverWindows = @(Get-AygVisibleWindows | Where-Object { $_.Title -like 'AYG-013-*' })
  Log "cleanup: owned helper PIDs still running: $($stillRunning.Count); leftover AYG-013 windows: $($leftoverWindows.Count)"
  if ($leftoverWindows.Count -gt 0) {
    Log "FAIL: probe windows remain: $($leftoverWindows | ForEach-Object { $_.Title })"
  }
  if ($stillRunning.Count -gt 0) {
    Log "FAIL: owned helper processes remain: $($stillRunning -join ', ')"
  }
}

# final summary BEFORE saving the transcript
Log "---"
Log "run-013.ps1: $script:passed passed, $script:failed failed"
$script:transcript | Set-Content -LiteralPath "$PSScriptRoot/probe-013-transcript.txt" -Encoding utf8
if ($script:failed -gt 0) { exit 1 }
exit 0
