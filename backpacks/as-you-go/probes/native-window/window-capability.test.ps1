# Assignment 009 — deterministic fake tests for the capability adapter.
#
# These tests never touch a live window: the observation source and the
# runtime ops are injected, so fail-closed matching and command routing are
# proven deterministically. Run:  pwsh -File probes/native-window/window-capability.test.ps1

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/window-capability.ps1"

$script:passed = 0
$script:failed = 0
function Assert-True {
  param([bool]$Condition, [string]$Message)
  if ($Condition) { $script:passed += 1; Write-Output "PASS: $Message" }
  else { $script:failed += 1; Write-Output "FAIL: $Message" }
}
function Assert-Throws {
  param([scriptblock]$Action, [string]$Needle, [string]$Message)
  try {
    & $Action
    $script:failed += 1
    Write-Output "FAIL: $Message (no exception thrown)"
  } catch {
    if ($_.Exception.Message -match $Needle) {
      $script:passed += 1
      Write-Output "PASS: $Message ($($_.Exception.Message))"
    } else {
      $script:failed += 1
      Write-Output "FAIL: $Message (unexpected: $($_.Exception.Message))"
    }
  }
}

# A fake in-memory registry of windows the ops can route to.
function New-FakeRegistry {
  $script:fakeRegistry = @(
    [pscustomobject]@{ RuntimeId = [IntPtr]0x1001; Title = 'Target A'; State = 'normal'; Bounds = @{ Left = 10; Top = 20; Right = 210; Bottom = 120; Width = 200; Height = 100 }; alive = $true; touched = @() }
    [pscustomobject]@{ RuntimeId = [IntPtr]0x2002; Title = 'Target B'; State = 'minimized'; Bounds = @{ Left = 0; Top = 0; Right = 100; Bottom = 80; Width = 100; Height = 80 }; alive = $true; touched = @() }
  )
  $ops = @{
    IsWindow = { param([IntPtr]$id) (@($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id -and $_.alive }).Count) -eq 1 }
    State = { param([IntPtr]$id) ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).State }
    Bounds = { param([IntPtr]$id) ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).Bounds }
    SetBounds = { param([IntPtr]$id, [int]$x, [int]$y, [int]$w, [int]$h)
      $entry = $script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1
      $entry.Bounds = @{ Left = $x; Top = $y; Right = $x + $w; Bottom = $y + $h; Width = $w; Height = $h }
      $entry.touched += 'set-bounds'
    }
    Minimize = { param([IntPtr]$id)
      ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).State = 'minimized'
      ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).touched += 'minimize'
    }
    Restore = { param([IntPtr]$id)
      ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).State = 'normal'
      ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).touched += 'restore'
    }
    Close = { param([IntPtr]$id)
      ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).alive = $false
      ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).touched += 'close'
    }
  }
  return [pscustomobject]@{ Registry = $script:fakeRegistry; Ops = $ops }
}

# --- fail-closed matching -------------------------------------------------

$fake = New-FakeRegistry
$script:AygOps = $fake.Ops
$source = { $fake.Registry | ForEach-Object {
    [pscustomobject]@{ RuntimeId = $_.RuntimeId; Title = $_.Title; State = $_.State; Bounds = $_.Bounds } } }

Assert-Throws { Resolve-AygTarget -Predicate { $_.Title -eq 'No such window' } -WindowSource $source } `
  'no window matched' 'zero matches fail closed'
Assert-Throws { Resolve-AygTarget -Predicate { $_.Title -like 'Target*' } -WindowSource $source } `
  '2 windows matched' 'multiple matches fail closed'

$target = Resolve-AygTarget -Predicate { $_.Title -eq 'Target A' } -WindowSource $source
Assert-True ($target.RuntimeId -eq [IntPtr]0x1001) 'single match resolves to exactly the matching window'

# --- command routing: commands address the resolved id only -----------------

Minimize-AygWindow $target.RuntimeId
Restore-AygWindow $target.RuntimeId
Set-AygWindowBounds $target.RuntimeId 50 60 300 150
$bounds = Get-AygWindowBounds $target.RuntimeId
Assert-True ($bounds.Width -eq 300 -and $bounds.Height -eq 150) 'bounds round-trip through the resolved id'
Assert-True ((Get-AygWindowState $target.RuntimeId) -eq 'normal') 'state round-trips after restore'

$touchedA = $fake.Registry[0].touched
$touchedB = $fake.Registry[1].touched
Assert-True ($touchedA -contains 'minimize' -and $touchedA -contains 'set-bounds') 'Target A received every routed command'
Assert-True ($touchedB.Count -eq 0) 'Target B was never touched — routing never falls through to a different window'

# The close contract requires an already resolved member and refuses a gone one.
Close-ResolvedAygMember $target.RuntimeId
Assert-True (-not (Test-AygWindowAlive $target.RuntimeId)) 'graceful close marks the resolved member gone'
Assert-Throws { Close-ResolvedAygMember $target.RuntimeId } 'refusing close' `
  'closing an already-gone member fails closed'
Assert-Throws { Close-ResolvedAygMember ([IntPtr]0xDEAD) } 'runtime member is gone' `
  'closing an unresolvable id fails closed'

# The adapter surface exposes typed ops only — no command-execution escape hatch.
$surface = (Get-Command -Name '*-Ayg*').Name -join ','
Assert-True ($surface -notmatch 'Exec|Invoke|Script|Eval') "no exec-style command on the adapter surface ($surface)"

Write-Output "---"
Write-Output "window-capability.test.ps1: $script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
exit 0
