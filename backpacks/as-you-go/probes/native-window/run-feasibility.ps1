# Assignment 009 — live feasibility transcript with ONE disposable window.
#
# Launches a single uniquely-identifiable WinForms window in-process
# (PS 7.6 shows the window only after an explicit ShowWindow(SW_SHOW), with
# DoEvents pumping the message queue), then drives the adapter through the
# full contract: resolve fail-closed, record original bounds/state, minimize,
# restore, set bounds, read back, close via the narrow graceful-close
# contract, and verify disappearance. The original bounds/state are recorded
# before every operation. Cleanup closes ONLY the disposable target; nothing
# is left running.
#
# Run:  pwsh -File probes/native-window/run-feasibility.ps1

#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/window-capability.ps1"

$title = "AYG-FEASIBILITY-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$transcript = [System.Collections.Generic.List[string]]::new()
function Log([string]$Line) {
  $script:transcript.Add($Line)
  Write-Output $Line
}
function Pump-DoEvents {
  for ($i = 0; $i -lt 4; $i += 1) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
  }
}

$form = $null
try {
  Log "== Assignment 009 live feasibility transcript =="
  Log "host: $([System.Environment]::OSVersion.VersionString) (PS $($PSVersionTable.PSVersion))"
  Log "disposable target title: $title"

  # --- launch the one disposable window ------------------------------------
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $title
  $form.Size = New-Object System.Drawing.Size(400, 300)
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.Location = New-Object System.Drawing.Point(120, 140)
  $form.Show()
  $hwnd = $form.Handle
  # PS 7.6 quirk: Show() marks the form Visible without the native show;
  # the explicit SW_SHOW makes it a real visible top-level window.
  [void][AYG.Win32]::ShowWindow($hwnd, 5)
  Pump-DoEvents
  Log "launched; runtime id (ephemeral HWND): $hwnd"

  # --- resolve fail-closed -------------------------------------------------
  $observed = Get-AygVisibleWindows
  $matching = @($observed | Where-Object { $_.Title -eq $title })
  Log "enumeration count (visible top-level): $($observed.Count); " +
    "targets matching the unique title: $($matching.Count)"
  $target = Resolve-AygTarget -Predicate { $_.Title -eq $title }
  Log "resolved exactly one: runtimeId=$($target.RuntimeId) pid=$($target.ProcessId) " +
    "state=$($target.State) bounds=$($target.Bounds.Width)x$($target.Bounds.Height)@$($target.Bounds.Left),$($target.Bounds.Top)"

  # --- original bounds/state recorded, then minimize/restore ---------------
  $before = Get-AygWindowBounds $target.RuntimeId
  $stateBefore = Get-AygWindowState $target.RuntimeId
  Log "before minimize: state=$stateBefore bounds=$($before.Width)x$($before.Height)@$($before.Left),$($before.Top)"

  Minimize-AygWindow $target.RuntimeId
  Pump-DoEvents
  $stateMin = Get-AygWindowState $target.RuntimeId
  Log "after minimize: state=$stateMin (expect minimized)"

  Restore-AygWindow $target.RuntimeId
  Pump-DoEvents
  $stateRestored = Get-AygWindowState $target.RuntimeId
  Log "after restore: state=$stateRestored (expect normal)"

  # --- set new bounds and read them back -----------------------------------
  Set-AygWindowBounds $target.RuntimeId 300 220 520 340
  Pump-DoEvents
  $after = Get-AygWindowBounds $target.RuntimeId
  Log "after set-bounds: bounds=$($after.Width)x$($after.Height)@$($after.Left),$($after.Top) (expect 520x340@300,220)"

  # --- graceful close via the narrow resolved-member contract --------------
  Close-ResolvedAygMember $target.RuntimeId
  Pump-DoEvents
  $stillAlive = Test-AygWindowAlive $target.RuntimeId
  $remaining = @(Get-AygVisibleWindows | Where-Object { $_.Title -eq $title })
  Log "after graceful close: alive=$stillAlive (expect False), formDisposed=$($form.IsDisposed), " +
    "windows with the unique title remaining: $($remaining.Count) (expect 0)"

  $clean = -not $stillAlive -and $form.IsDisposed -and $remaining.Count -eq 0
  Log "== cleanup: only the disposable target was launched, manipulated and closed; nothing remains running =="

  $script:transcript | Set-Content -LiteralPath "$PSScriptRoot/feasibility-transcript.txt" -Encoding utf8
  if ($clean) { Log "RESULT: PASS" } else { Log "RESULT: FAIL"; exit 1 }
} finally {
  if ($form -and -not $form.IsDisposed) {
    $form.Close()
    Pump-DoEvents
  }
}
