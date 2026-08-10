# Papers-owned fake/schema regressions for the window helper (protocol
# snapshot 013R5F). No live window and no helper process: validation,
# token issuance, capacity and routing are exercised directly against the
# PACKAGED Papers scripts (../../resources/window-helper) with injected
# fake ops (the $script:WhOps seam) plus a wire-schema validator applied
# to EVERY response that mirrors the 010R response predicates without
# coercive comparisons. Runs unchanged under Windows PowerShell 5.1 and
# PowerShell 7 (JSON is normalized via the helper's own
# ConvertTo-PsHashtable, never -AsHashtable).
# Run:  pwsh -File tests/window-helper/helper-schema.test.ps1

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../../resources/window-helper/window-helper.ps1"
. "$PSScriptRoot/window-helper-resolver.ps1"

# 016R regression: keep the REAL lazy ParentPid op before the fake ops below
# replace the registry. The production hover-through exclusion depends on the
# cache starting at $null and resolving the helper's actual parent on first
# use; an injected fake op would hide the 0/$null sentinel defect again.
$script:realParentPidOp = $script:WhOps['ParentPid']

$script:passed = 0
$script:failed = 0
function Assert-True {
  param([bool]$Condition, [string]$Message)
  if ($Condition) { $script:passed += 1; Write-Output "PASS: $Message" }
  else { $script:failed += 1; Write-Output "FAIL: $Message" }
}
function Assert-Outcome {
  param([object]$Response, [string]$Expected, [string]$Message)
  if ($null -eq $Response) { $script:failed += 1; Write-Output "FAIL: $Message (no response)" }
  elseif ($Response.outcome -eq $Expected) { $script:passed += 1; Write-Output "PASS: $Message ($Expected)" }
  else { $script:failed += 1; Write-Output "FAIL: $Message (got $($Response.outcome))" }
}

# ---- wire-schema validator: faithful 010R predicates, no coercion ----------
$STATES = @('normal', 'minimized', 'maximized', 'missing')
$OUTCOMES = @('success', 'missing', 'ambiguous', 'denied', 'malformed')
function Test-WireFiniteNumber {
  param([object]$Value)
  if (-not ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [float])) { return $false }
  return -not [double]::IsNaN([double]$Value) -and -not [double]::IsInfinity([double]$Value)
}
function Test-WireSafeIntegerOk {
  param([object]$Value)
  if ($Value -isnot [int] -and $Value -isnot [long]) { return $false }
  $n = [long]$Value
  return $n -ge 0 -and $n -le 9007199254740991
}
function Test-WireBoundsOk {
  param([object]$Bounds)
  if ($null -eq $Bounds) { return $true }
  if ($Bounds -isnot [System.Collections.IDictionary]) { return $false }
  foreach ($k in @('x', 'y', 'width', 'height')) {
    if (-not (Test-WireFiniteNumber $Bounds[$k])) { return $false }
  }
  return [double]$Bounds['width'] -gt 0 -and [double]$Bounds['height'] -gt 0
}
function Test-WireObservationOk {
  param([object]$Obs)
  if ($Obs -isnot [System.Collections.IDictionary]) { return $false }
  foreach ($k in @('runtimeId', 'title', 'processId', 'processPath', 'state', 'bounds')) {
    if (-not $Obs.ContainsKey($k)) { return $false }
  }
  if (-not ($Obs['runtimeId'] -is [string] -and $Obs['runtimeId'] -match '^T[0-9a-f]{32}$')) { return $false }
  if ($Obs['title'] -isnot [string]) { return $false }
  if ($null -ne $Obs['processId'] -and -not (Test-WireSafeIntegerOk $Obs['processId'])) { return $false }
  if ($null -ne $Obs['processPath'] -and $Obs['processPath'] -isnot [string]) { return $false }
  if ($Obs['state'] -isnot [string] -or $STATES -notcontains $Obs['state']) { return $false }
  if (-not (Test-WireBoundsOk $Obs['bounds'])) { return $false }
  return $true
}
function Test-WireResponseOk {
  param([object]$R)
  if ($R -isnot [System.Collections.IDictionary]) { return $false }
  if (-not (Test-WireSafeIntegerOk $R['requestId']) -or [long]$R['requestId'] -lt 1) { return $false }
  if ($R['method'] -isnot [string] -or $VALID_METHODS -notcontains $R['method']) { return $false }
  if ($R['outcome'] -isnot [string] -or $OUTCOMES -notcontains $R['outcome']) { return $false }
  if ($R.ContainsKey('error') -and $R['error'] -isnot [string]) { return $false }
  $hasObservationKey = $R.ContainsKey('observation')
  $hasWindowsKey = $R.ContainsKey('windows')
  $hasWindowKey = $R.ContainsKey('window')
  $windowsIsArray = $hasWindowsKey -and $R['windows'] -is [System.Array]
  if ($R['outcome'] -eq 'success') {
    if ($R['method'] -eq 'list') {
      if (-not ($hasWindowsKey -and $windowsIsArray -and -not $hasObservationKey -and -not $hasWindowKey)) { return $false }
    } elseif ($R['method'] -eq 'close') {
      if ($hasWindowsKey -or $hasObservationKey -or $hasWindowKey) { return $false }
    } elseif ($R['method'] -eq 'hover') {
      if (-not ($hasWindowKey -and -not $hasWindowsKey -and -not $hasObservationKey)) { return $false }
      if ($null -ne $R['window'] -and -not (Test-WireObservationOk $R['window'])) { return $false }
    } else {
      if (-not ($hasObservationKey -and -not $hasWindowsKey -and -not $hasWindowKey)) { return $false }
    }
  } else {
    if ($hasWindowsKey -or $hasObservationKey -or $hasWindowKey) { return $false }
  }
  if ($hasObservationKey -and -not (Test-WireObservationOk $R['observation'])) { return $false }
  if ($windowsIsArray) {
    foreach ($w in $R['windows']) {
      if (-not (Test-WireObservationOk $w)) { return $false }
    }
  }
  return $true
}
function Test-WireResponseShape {
  param([object]$R, [string]$Context)
  if ($null -eq $R) { return }
  Assert-True (Test-WireResponseOk $R) "${Context}: all 010R wire predicates hold"
  Assert-True (-not $R.ContainsKey('error') -or $R['error'] -is [string]) "${Context}: error is absent or a non-null string"
  if ($R['outcome'] -eq 'success') {
    $members = @()
    if ($R.ContainsKey('windows')) { $members = @($R['windows']) }
    elseif ($R.ContainsKey('observation')) { $members = @($R['observation']) }
    foreach ($member in $members) {
      Assert-True (Test-WireObservationOk $member) "${Context}: observation member predicates hold"
    }
  }
  if ($R.ContainsKey('window') -and $null -ne $R['window']) {
    Assert-True (Test-WireObservationOk $R['window']) "${Context}: hover window member predicates hold"
  }
}

# ---- injected fake registry (009-style $script:WhOps seam) ---------------
# 016 task-worthiness metadata: every entry carries its own Visible/Cloaked/
# ExStyle/ClassName/ProcessName/OwnerHwnd/RootAncestor/LastActivePopup so the
# helper-owned eligibility predicate is fully exercisable without Win32.
function New-PristineRegistry {
  return @(
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1001; Title = 'WH-TEST-AAAA'; ProcessId = 1001; ProcessPath = 'C:\fake-a.exe'; State = 'normal'; Bounds = @{ Left = 10; Top = 20; Right = 210; Bottom = 120; Width = 200; Height = 100 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1001; LastActivePopup = [IntPtr]0x1313 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2002; Title = 'WH-TEST-BBBB'; ProcessId = 2002; ProcessPath = 'C:\fake-b.exe'; State = 'minimized'; Bounds = @{ Left = 0; Top = 0; Right = 100; Bottom = 80; Width = 100; Height = 80 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x2002; LastActivePopup = [IntPtr]0x2002 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x3003; Title = 'WH-TEST-ZERO'; ProcessId = 3003; ProcessPath = 'C:\fake-c.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 0; Bottom = 0; Width = 0; Height = 0 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x3003; LastActivePopup = [IntPtr]0x3003 }
  # ---- 016 task-worthiness fixtures --------------------------------------
  [pscustomobject]@{ RuntimeId = [IntPtr]0x4004; Title = 'Program Manager'; ProcessId = 4004; ProcessPath = 'C:\Windows\explorer.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 400; Bottom = 300; Width = 400; Height = 300 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'Progman'; ProcessName = 'explorer.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x4004; LastActivePopup = [IntPtr]0x4004 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x5005; Title = ''; ProcessId = 5005; ProcessPath = 'C:\Windows\explorer.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 400; Bottom = 300; Width = 400; Height = 300 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'WorkerW'; ProcessName = 'explorer.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x5005; LastActivePopup = [IntPtr]0x5005 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x6006; Title = 'WH-TEST-CLOAKED'; ProcessId = 6006; ProcessPath = 'C:\fake-uwp.exe'; State = 'normal'; Bounds = @{ Left = 400; Top = 400; Right = 700; Bottom = 600; Width = 300; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $true; ExStyle = 0; ClassName = 'FakeUwp'; ProcessName = 'fake-uwp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x6006; LastActivePopup = [IntPtr]0x6006 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x7007; Title = 'WH-TEST-TOOL'; ProcessId = 7007; ProcessPath = 'C:\fake-tool.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 200; Bottom = 150; Width = 200; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0x00000080; ClassName = 'FakeTool'; ProcessName = 'fake-tool.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x7007; LastActivePopup = [IntPtr]0x7007 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x8008; Title = 'WH-TEST-OWNED-INACTIVE'; ProcessId = 8008; ProcessPath = 'C:\fake-a.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 200; Bottom = 150; Width = 200; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]0x1001; RootAncestor = [IntPtr]0x1001; LastActivePopup = [IntPtr]0x1001 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x9009; Title = 'TextInput'; ProcessId = 9009; ProcessPath = 'C:\Windows\SystemApps\TextInputHost.exe'; State = 'normal'; Bounds = @{ Left = 800; Top = 800; Right = 1000; Bottom = 900; Width = 200; Height = 100 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'TextInputHost'; ProcessName = 'TextInputHost'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x9009; LastActivePopup = [IntPtr]0x9009 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1010; Title = 'WH-TEST-MINIMIZED-LEGIT'; ProcessId = 1010; ProcessPath = 'C:\fake-min.exe'; State = 'minimized'; Bounds = @{ Left = 0; Top = 0; Right = 200; Bottom = 150; Width = 200; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-min.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1010; LastActivePopup = [IntPtr]0x1010 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1111; Title = 'WH-TEST-DOC-1'; ProcessId = 1111; ProcessPath = 'C:\fake-docs.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 300; Bottom = 200; Width = 300; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-docs.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1111; LastActivePopup = [IntPtr]0x1111 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1212; Title = 'WH-TEST-DOC-2'; ProcessId = 1212; ProcessPath = 'C:\fake-docs.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 300; Bottom = 200; Width = 300; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-docs.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1212; LastActivePopup = [IntPtr]0x1212 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1313; Title = 'WH-TEST-OWNED-ACTIVE'; ProcessId = 1313; ProcessPath = 'C:\fake-a.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 200; Bottom = 150; Width = 200; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]0x1001; RootAncestor = [IntPtr]0x1001; LastActivePopup = [IntPtr]0x1313 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1414; Title = 'Papers'; ProcessId = 1414; ProcessPath = 'C:\Papers\App\Papers.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 600; Right = 800; Bottom = 900; Width = 800; Height = 300 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'Chrome_WidgetWin_1'; ProcessName = 'Papers'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1414; LastActivePopup = [IntPtr]0x1414 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1515; Title = 'Code'; ProcessId = 1515; ProcessPath = 'C:\Users\admin\AppData\Local\Programs\Microsoft VS Code\Code.exe'; State = 'normal'; Bounds = @{ Left = 1000; Top = 600; Right = 1800; Bottom = 900; Width = 800; Height = 300 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'Chrome_WidgetWin_1'; ProcessName = 'Code'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1515; LastActivePopup = [IntPtr]0x1515 }
  # ---- 016R gap 7 same-task fixtures -------------------------------------
  # A task window (root) + its owned ACTIVE popup surface, same process: the
  # popup is task-worthy alone, but together they are ONE task.
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1616; Title = 'WH-TEST-TASK-ROOT'; ProcessId = 1616; ProcessPath = 'C:\fake-task.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 300; Bottom = 200; Width = 300; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-task.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1616; LastActivePopup = [IntPtr]0x1717 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1717; Title = 'WH-TEST-TASK-POPUP'; ProcessId = 1616; ProcessPath = 'C:\fake-task.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 200; Bottom = 150; Width = 200; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-task.exe'; OwnerHwnd = [IntPtr]0x1616; RootAncestor = [IntPtr]0x1616; LastActivePopup = [IntPtr]0x1717 }
  # Two genuine documents of ONE application: same process, NO owner chain -
  # both must stay listed.
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1818; Title = 'WH-TEST-DOC-A'; ProcessId = 1818; ProcessPath = 'C:\fake-docs2.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 300; Bottom = 200; Width = 300; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-docs2.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1818; LastActivePopup = [IntPtr]0x1818 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1919; Title = 'WH-TEST-DOC-B'; ProcessId = 1919; ProcessPath = 'C:\fake-docs2.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 300; Bottom = 200; Width = 300; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-docs2.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1919; LastActivePopup = [IntPtr]0x1919 }
  # Owned by the helper's parent (fake ParentPid 999999): hover-through
  # exclusion must null it even though it is otherwise task-worthy.
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2020; Title = 'WH-TEST-PARENT-OWNED'; ProcessId = 999999; ProcessPath = 'C:\fake-parent.exe'; State = 'normal'; Bounds = @{ Left = 2000; Top = 100; Right = 2400; Bottom = 400; Width = 400; Height = 300 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-parent.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x2020; LastActivePopup = [IntPtr]0x2020 }
  # ---- 016R2 direct-pick dedup fixtures (RoketPuncha lane) -----------------
  # POPUP is listed FIRST so z-order is popup-above-root; it is an owned
  # active popup of the same process as its root. Hover over its bounds must
  # resolve to the ROOT task identity (the identity the list keeps), including
  # a point on the popup area OUTSIDE the root bounds.
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2424; Title = 'WH-TEST-DEDUP-POPUP'; ProcessId = 2323; ProcessPath = 'C:\fake-dedup.exe'; State = 'normal'; Bounds = @{ Left = 700; Top = 200; Right = 950; Bottom = 400; Width = 250; Height = 200 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-dedup.exe'; OwnerHwnd = [IntPtr]0x2323; RootAncestor = [IntPtr]0x2323; LastActivePopup = [IntPtr]0x2424 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2323; Title = 'WH-TEST-DEDUP-ROOT'; ProcessId = 2323; ProcessPath = 'C:\fake-dedup.exe'; State = 'normal'; Bounds = @{ Left = 600; Top = 100; Right = 850; Bottom = 250; Width = 250; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-dedup.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x2323; LastActivePopup = [IntPtr]0x2424 }
  # Two genuine ownerless documents of ONE application (same process, no
  # owner chain): both must stay listed and each must resolve to itself in
  # hover, never collapsing into each other.
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2525; Title = 'WH-TEST-DOC-C'; ProcessId = 2525; ProcessPath = 'C:\fake-docs3.exe'; State = 'normal'; Bounds = @{ Left = 600; Top = 500; Right = 850; Bottom = 650; Width = 250; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-docs3.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x2525; LastActivePopup = [IntPtr]0x2525 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2626; Title = 'WH-TEST-DOC-D'; ProcessId = 2525; ProcessPath = 'C:\fake-docs3.exe'; State = 'normal'; Bounds = @{ Left = 900; Top = 500; Right = 1150; Bottom = 650; Width = 250; Height = 150 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fake-docs3.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x2626; LastActivePopup = [IntPtr]0x2626 }
  )
}
$script:fakeRegistry = New-PristineRegistry
# Fake monitor work areas (primary first) for the 016 clamping policy.
$script:fakeMonitors = @(
  @{ Left = 0; Top = 0; Right = 1920; Bottom = 1040; Primary = $true }
  @{ Left = 1920; Top = 0; Right = 3840; Bottom = 1040; Primary = $false }
)
# Point -> window resolution map for hover tests (set per test).
$script:windowAtPoint = @{}
$script:WhOps = @{
  IsWindow = { param([IntPtr]$id) (@($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id -and $_.alive }).Count) -eq 1 }
  Visible = { param([IntPtr]$id) [bool](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).Visible) }
  Cloaked = { param([IntPtr]$id) [bool](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).Cloaked) }
  ExStyle = { param([IntPtr]$id) [long](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).ExStyle) }
  ClassName = { param([IntPtr]$id) [string](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).ClassName) }
  ProcessName = { param([IntPtr]$id) [string](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).ProcessName) }
  OwnerHwnd = { param([IntPtr]$id) [IntPtr](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).OwnerHwnd) }
  RootAncestor = { param([IntPtr]$id) [IntPtr](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).RootAncestor) }
  LastActivePopup = { param([IntPtr]$id) [IntPtr](($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).LastActivePopup) }
  Observation = { param([IntPtr]$id) (Get-WhWindowObservation $id) }
  ParentPid = { return [int]999999 }
  WindowAtPoint = { param([int]$x, [int]$y) if ($script:windowAtPoint.ContainsKey("$x,$y")) { return [IntPtr]$script:windowAtPoint["$x,$y"] } return [IntPtr]::Zero }
  Monitors = { return @($script:fakeMonitors) }
  State = { param([IntPtr]$id) ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).State }
  Bounds = { param([IntPtr]$id) ($script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1).Bounds }
  SetBounds = { param([IntPtr]$id, [int]$x, [int]$y, [int]$w, [int]$h)
    $entry = $script:fakeRegistry | Where-Object { $_.RuntimeId -eq $id } | Select-Object -First 1
    $entry.Bounds = @{ Left = $x; Top = $y; Right = $x + $w; Bottom = $y + $h; Width = $w; Height = $h }
    $entry.touched += "set-bounds:$x,$y,$w,$h"
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
# The helper's observation reader and enumeration must read ONLY the fake
# registry (never real Win32) in these tests.
function Get-WhWindowObservation {
  param([IntPtr]$hWnd)
  $entry = $script:fakeRegistry | Where-Object { $_.RuntimeId -eq $hWnd } | Select-Object -First 1
  return [pscustomobject]@{
    RuntimeId = $hWnd
    Title = $entry.Title
    ProcessId = $entry.ProcessId
    ProcessPath = $entry.ProcessPath
    State = $entry.State
    Bounds = $entry.Bounds
  }
}
function Get-WhVisibleWindows {
  return @($script:fakeRegistry | ForEach-Object { Get-WhWindowObservation $_.RuntimeId })
}

function Invoke-Line {
  param([string]$Line)
  $response = Invoke-WhRequestLine $Line
  if ($null -eq $response) { return $null }
  $json = $response | ConvertTo-Json -Compress -Depth 10
  $roundTripped = ConvertTo-PsHashtable ($json | ConvertFrom-Json)
  Test-WireResponseShape $roundTripped "wire[$Line]" | ForEach-Object { Write-Host $_ }
  return $roundTripped
}

# ---- schema gate ----------------------------------------------------------
Assert-True ($null -eq (Invoke-Line '')) 'an empty line is ignored'
Assert-True ($null -eq (Invoke-Line 'not json')) 'invalid JSON is ignored (011 policy)'
Assert-True ($null -eq (Invoke-Line '{"requestId":0,"method":"list"}')) 'non-positive requestId is ignored'
Assert-True ($null -eq (Invoke-Line '{"requestId":9007199254740992,"method":"list"}')) 'requestId above MAX_SAFE_INTEGER is ignored'
Assert-True ($null -eq (Invoke-Line '{"requestId":1.5,"method":"list"}')) 'fractional requestId is ignored'
Assert-True ($null -eq (Invoke-Line '{"requestId":1,"method":"pwn"}')) 'unknown method is ignored'
$benign = Invoke-Line '{"requestId":1,"method":"list","extra":"x"}'
Assert-True ($benign.outcome -eq 'success') 'a benign extra field is accepted, not treated as command-like'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"list","exec":"calc.exe"}') 'denied' 'exec field is denied'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"list","script":"x"}') 'denied' 'script field is denied'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"observe"}') 'malformed' 'missing target is malformed'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"observe","target":123}') 'malformed' 'non-string target is malformed'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"apply","target":"A","bounds":{"x":0,"y":0,"width":0,"height":10}}') 'malformed' 'zero width is malformed'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"apply","target":"A","bounds":{"x":0,"y":0,"width":10}}') 'malformed' 'missing height is malformed'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"apply","target":"A","bounds":{"x":0,"y":0,"width":"10","height":10}}') 'malformed' 'non-numeric bounds are malformed'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"apply","target":"A","bounds":{"x":0,"y":0,"width":3e10,"height":10}}') 'malformed' 'overflowing width is malformed'
Assert-Outcome (Invoke-Line '{"requestId":1,"method":"apply","target":"A","bounds":{"x":0,"y":0,"width":300,"height":260},"state":"normal"}') 'malformed' 'apply.state is not silently ignored'

# ---- negative validator fixtures (010R predicates demonstrably reject) ------
function New-WireObservation {
  param([object]$RuntimeId, [object]$ProcessId, [string]$State = 'normal', [object]$Bounds = $null, [object]$ProcessPath = $null, [object]$Title = 'x')
  return @{ runtimeId = $RuntimeId; title = $Title; processId = $ProcessId; processPath = $ProcessPath; state = $State; bounds = $Bounds }
}
function New-WireListResponse {
  param([object]$Windows)
  return @{ requestId = 1; method = 'list'; outcome = 'success'; windows = $Windows }
}
function Assert-WireRejected {
  param([object]$Response, [string]$Message)
  Assert-True (-not (Test-WireResponseOk $Response)) $Message
}
$validObs = New-WireObservation 'T11111111111111111111111111111111' 1
Assert-WireRejected (New-WireListResponse @(New-WireObservation 4097 1)) 'a numeric runtimeId is rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1.5)) 'a fractional processId is rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' -1)) 'a negative processId is rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1 'bogus')) 'an invalid state is rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1 'normal' @{ x = 0; y = 0; width = [double]::NaN; height = 10 })) 'NaN bounds are rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1 'normal' @{ x = 0; y = 0; width = [double]::PositiveInfinity; height = 10 })) 'infinite bounds are rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1 'normal' @{ x = 0; y = 0; width = 0; height = 10 })) 'non-positive width is rejected'
Assert-WireRejected (New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1 'normal' @{ x = 0; y = 0; width = 10; height = -5 })) 'negative height is rejected'
$badError = @{ requestId = 1; method = 'observe'; outcome = 'denied'; error = 42 }
Assert-WireRejected $badError 'a non-string error is rejected'
$listWithObs = @{ requestId = 1; method = 'list'; outcome = 'success'; observation = $validObs }
Assert-WireRejected $listWithObs 'list success with an observation payload is rejected'
$closeWithObs = @{ requestId = 1; method = 'close'; outcome = 'success'; observation = $validObs }
Assert-WireRejected $closeWithObs 'close success with a payload is rejected'
$deniedWithWindows = @{ requestId = 1; method = 'observe'; outcome = 'denied'; windows = @($validObs) }
Assert-WireRejected $deniedWithWindows 'non-success with a windows payload is rejected'
$closeScalarWindows = @{ requestId = 1; method = 'close'; outcome = 'success'; windows = $validObs }
Assert-WireRejected $closeScalarWindows 'close success with a scalar windows key is rejected'
$deniedScalarWindows = @{ requestId = 1; method = 'observe'; outcome = 'denied'; windows = $validObs }
Assert-WireRejected $deniedScalarWindows 'non-success with a scalar windows key is rejected'
$observePlusScalarWindows = @{ requestId = 1; method = 'observe'; outcome = 'success'; observation = $validObs; windows = $validObs }
Assert-WireRejected $observePlusScalarWindows 'observation success with an extra scalar windows key is rejected'
$badRequestId = @{ requestId = 0; method = 'list'; outcome = 'success'; windows = @() }
Assert-WireRejected $badRequestId 'a non-positive requestId is rejected'
$missingStateOk = New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' $null 'missing' $null)
Assert-True (Test-WireResponseOk $missingStateOk) 'processId null and state missing are ACCEPTED by the 010R union'

# ---- structural array/key fixtures (FINDING 1-4) ---------------------------
$scalarWindows = @{ requestId = 1; method = 'list'; outcome = 'success'; windows = $validObs }
Assert-WireRejected $scalarWindows 'a scalar observation mapping as windows is rejected (windows must be an array)'
$omitProcessId = New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1)
$omitProcessId.windows[0].Remove('processId')
Assert-WireRejected $omitProcessId 'an observation with processId omitted is rejected'
$omitProcessPath = New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1)
$omitProcessPath.windows[0].Remove('processPath')
Assert-WireRejected $omitProcessPath 'an observation with processPath omitted is rejected'
$omitBounds = New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' 1)
$omitBounds.windows[0].Remove('bounds')
Assert-WireRejected $omitBounds 'an observation with bounds omitted is rejected'
$nullError = @{ requestId = 1; method = 'observe'; outcome = 'denied'; error = $null }
Assert-WireRejected $nullError 'an explicit-null error is rejected'
$zeroWindows = @{ requestId = 1; method = 'list'; outcome = 'success'; windows = @() }
Assert-True (Test-WireResponseOk $zeroWindows) 'a zero-member list windows array is ACCEPTED'
$oneWindows = @{ requestId = 1; method = 'list'; outcome = 'success'; windows = @($validObs) }
Assert-True (Test-WireResponseOk $oneWindows) 'a one-member list windows array is ACCEPTED'
$manyWindows = @{ requestId = 1; method = 'list'; outcome = 'success'; windows = @($validObs, $validObs) }
Assert-True (Test-WireResponseOk $manyWindows) 'a many-member list windows array is ACCEPTED'
$nullBounds = New-WireListResponse @(New-WireObservation 'T11111111111111111111111111111111' $null 'normal' $null)
Assert-True (Test-WireResponseOk $nullBounds) 'explicit-null processId/processPath/bounds values are ACCEPTED when the keys are present'

# ---- token issuance and stable identity -----------------------------------
$list = Invoke-Line '{"requestId":7,"method":"list"}'
Assert-True ($list.outcome -eq 'success' -and $list.windows.Count -eq 15) 'list returns all fake task-worthy windows (same-task surfaces collapsed)'
$tokenA = [string]$list.windows[0].runtimeId
$tokenB = [string]$list.windows[1].runtimeId
Assert-True ([string]$tokenA -match '^T[0-9a-f]{32}$') 'token A is nonempty high-entropy nonnumeric'
Assert-True ([string]$tokenB -match '^T[0-9a-f]{32}$') 'token B is nonempty high-entropy nonnumeric'
Assert-True ($tokenA -ne $tokenB) 'two identities get distinct tokens'
$list2 = Invoke-Line '{"requestId":8,"method":"list"}'
Assert-True ([string]$list2.windows[0].runtimeId -eq $tokenA -and [string]$list2.windows[1].runtimeId -eq $tokenB) 'unchanged identities keep stable tokens across repeated list'

# ---- zero-sized window rects become null bounds (015 helper fix) -----------
$zeroEntry = @($list.windows | Where-Object { $_.title -eq 'WH-TEST-ZERO' } | Select-Object -First 1)
Assert-True ($zeroEntry.Count -eq 1) 'the zero-rect window appears in the list'
Assert-True ($null -eq $zeroEntry[0].bounds) 'a zero-size rect is emitted as null bounds, never as a zero-width bounds object'

# ---- raw numeric HWND and guessed tokens are missing, no act --------------
Assert-Outcome (Invoke-Line '{"requestId":9,"method":"observe","target":"4097"}') 'missing' 'a raw numeric HWND is not a token, missing'
Assert-Outcome (Invoke-Line '{"requestId":10,"method":"observe","target":"T00000000000000000000000000000000"}') 'missing' 'a guessed token is missing'
Assert-Outcome (Invoke-Line '{"requestId":11,"method":"minimize","target":"4097"}') 'missing' 'a raw numeric HWND cannot mutate'
Assert-True ($script:fakeRegistry[0].touched.Count -eq 0) 'no fake window was touched by raw numeric targets'

# ---- routing through issued tokens ----------------------------------------
$observedA = Invoke-Line ('{"requestId":12,"method":"observe","target":"' + $tokenA + '"}')
Assert-True ($observedA.outcome -eq 'success' -and [string]$observedA.observation.runtimeId -eq $tokenA) 'observe routes to the requested token'
$min = Invoke-Line ('{"requestId":13,"method":"minimize","target":"' + $tokenA + '"}')
Assert-Outcome $min 'success' 'minimize succeeds on an issued token'
Assert-True ($script:fakeRegistry[0].touched -contains 'minimize') 'minimize touched only A'
Assert-True ($script:fakeRegistry[1].touched.Count -eq 0) 'B was never touched'
$apply = Invoke-Line ('{"requestId":14,"method":"apply","target":"' + $tokenA + '","bounds":{"x":50.4,"y":60.6,"width":300.5,"height":150.5}}')
Assert-True ($apply.outcome -eq 'success' -and $apply.observation.bounds.width -eq 301 -and $apply.observation.bounds.height -eq 151) 'fractional bounds are deterministically rounded away from zero'
Assert-True ($apply.observation.bounds.x -eq 50 -and $apply.observation.bounds.y -eq 61) 'fractional position is rounded away from zero'
Assert-Outcome (Invoke-Line ('{"requestId":15,"method":"close","target":"' + $tokenA + '"}')) 'success' 'close succeeds on an issued token'
Assert-Outcome (Invoke-Line ('{"requestId":16,"method":"observe","target":"' + $tokenA + '"}')) 'missing' 'vanished token returns missing'
Assert-Outcome (Invoke-Line ('{"requestId":17,"method":"restore","target":"' + $tokenA + '","handle":123}')) 'denied' 'a handle field on a mutation is denied'

# ---- HWND reuse: new token, old token never rebound -----------------------
$script:fakeRegistry[0].alive = $true
$script:fakeRegistry[0].touched = @()
$script:fakeRegistry[0].ProcessId = 7777
$script:fakeRegistry[0].Title = 'WH-TEST-EVIL'
$listReuse = Invoke-Line '{"requestId":18,"method":"list"}'
$replacementEntry = @($listReuse.windows | Where-Object { $_.title -eq 'WH-TEST-EVIL' } | Select-Object -First 1)
Assert-True ($replacementEntry.Count -eq 1) 'the replacement identity appears in the list'
$tokenNew = [string]$replacementEntry.runtimeId
Assert-True ([string]$tokenNew -match '^T[0-9a-f]{32}$' -and $tokenNew -ne $tokenA) 'the reused HWND receives a NEW token'
$oldAfterReuse = Invoke-Line ('{"requestId":19,"method":"observe","target":"' + $tokenA + '"}')
Assert-Outcome $oldAfterReuse 'denied' 'the old token is denied (identity changed), never repaired'
$oldMinAfterReuse = Invoke-Line ('{"requestId":20,"method":"minimize","target":"' + $tokenA + '"}')
Assert-Outcome $oldMinAfterReuse 'denied' 'the old token cannot mutate'
Assert-True ($script:fakeRegistry[0].touched.Count -eq 0) 'the replacement window was never touched by the old token'
Assert-True ($script:fakeRegistry[0].Title -eq 'WH-TEST-EVIL') 'the replacement identity is untouched'
$oldApplyAfterReuse = Invoke-Line ('{"requestId":21,"method":"apply","target":"' + $tokenA + '","bounds":{"x":0,"y":0,"width":300,"height":260}}')
Assert-Outcome $oldApplyAfterReuse 'denied' 'the old token cannot apply'
$widthBeforeOldApply = $script:fakeRegistry[0].Bounds.Width
Assert-True ($script:fakeRegistry[0].Bounds.Width -eq $widthBeforeOldApply) 'bounds were never changed under the old token'
# repeated list/observe keep the old token denied (no repair via refresh)
$listAgain = Invoke-Line '{"requestId":22,"method":"list"}'
Assert-Outcome (Invoke-Line ('{"requestId":23,"method":"observe","target":"' + $tokenA + '"}')) 'denied' 'repeated list refresh never repairs the old token'
# the new token can act only after the resolver selects it
$resolvedNew = Resolve-WhUniqueTarget @($listAgain.windows) 'WH-TEST-EVIL'
Assert-True ($resolvedNew.outcome -eq 'success' -and $resolvedNew.runtimeId -eq $tokenNew) 'the resolver selects the new token'
$newObserve = Invoke-Line ('{"requestId":24,"method":"observe","target":"' + $tokenNew + '"}')
Assert-Outcome $newObserve 'success' 'the resolver-selected new token observes successfully'
$newMin = Invoke-Line ('{"requestId":25,"method":"minimize","target":"' + $tokenNew + '"}')
Assert-Outcome $newMin 'success' 'the resolver-selected new token mutates successfully'
Assert-True ($script:fakeRegistry[0].touched -contains 'minimize') 'the new token acts on the replacement window'

# ---- simulated helper restart: old tokens are unusable --------------------
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }
Assert-Outcome (Invoke-Line ('{"requestId":26,"method":"observe","target":"' + $tokenNew + '"}')) 'missing' 'a token from a previous helper session is missing'
Assert-Outcome (Invoke-Line ('{"requestId":27,"method":"minimize","target":"' + $tokenA + '"}')) 'missing' 'the old token is unusable after restart'

# ---- bounded token registry (FINDING 2) ------------------------------------
# The 016 fixtures grow the registry, so this section isolates a compact
# three-entry task-worthy registry and restores the full one afterwards.
$script:fullRegistry = $script:fakeRegistry
$script:fakeRegistry = @(
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1001; Title = 'WH-TEST-AAAA'; ProcessId = 1001; ProcessPath = 'C:\fake-a.exe'; State = 'normal'; Bounds = @{ Left = 10; Top = 20; Right = 210; Bottom = 120; Width = 200; Height = 100 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x1001; LastActivePopup = [IntPtr]0x1001 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2002; Title = 'WH-TEST-BBBB'; ProcessId = 2002; ProcessPath = 'C:\fake-b.exe'; State = 'minimized'; Bounds = @{ Left = 0; Top = 0; Right = 100; Bottom = 80; Width = 100; Height = 80 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x2002; LastActivePopup = [IntPtr]0x2002 }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x3003; Title = 'WH-TEST-ZERO'; ProcessId = 3003; ProcessPath = 'C:\fake-c.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 0; Bottom = 0; Width = 0; Height = 0 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x3003; LastActivePopup = [IntPtr]0x3003 }
)
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 3 }
$fillList = Invoke-Line '{"requestId":28,"method":"list"}'
Assert-True ($fillList.outcome -eq 'success' -and $fillList.windows.Count -eq 3) 'filling to the injected limit succeeds'
Assert-True ($script:WhSession.byToken.Count -eq 3) 'both tokens issued at capacity'
$capToken = [string]$fillList.windows[0].runtimeId
$script:fakeRegistry += [pscustomobject]@{ RuntimeId = [IntPtr]0x4004; Title = 'WH-TEST-CCCC'; ProcessId = 4004; ProcessPath = 'C:\fake-d.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 50; Bottom = 50; Width = 50; Height = 50 }; alive = $true; touched = @(); Visible = $true; Cloaked = $false; ExStyle = 0; ClassName = 'FakeWin'; ProcessName = 'fakeapp.exe'; OwnerHwnd = [IntPtr]::Zero; RootAncestor = [IntPtr]0x4004; LastActivePopup = [IntPtr]0x4004 }
$capDenied = Invoke-Line '{"requestId":29,"method":"list"}'
Assert-Outcome $capDenied 'denied' 'a new identity beyond the limit makes list denied atomically'
Assert-True ([string]$capDenied.error -eq 'session token capacity reached') 'the capacity error is bounded non-sensitive text'
Assert-True ($script:WhSession.byToken.Count -eq 3 -and $script:WhSession.byKey.Count -eq 3) 'no tokens were issued, both maps unchanged'
Assert-True (-not $capDenied.ContainsKey('windows')) 'no partial windows payload on capacity denial'
$capObserve = Invoke-Line ('{"requestId":30,"method":"observe","target":"' + $capToken + '"}')
Assert-Outcome $capObserve 'success' 'previously issued tokens still resolve at capacity'
Assert-True ($script:fakeRegistry[3].touched.Count -eq 0) 'the un-issued window was never acted on'
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }
$resetList = Invoke-Line '{"requestId":31,"method":"list"}'
Assert-Outcome $resetList 'success' 'resetting the helper session resets capacity'
$script:fakeRegistry = $script:fullRegistry
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }

# ---- native exception hardening (FINDING 4) --------------------------------
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }
$listLive = Invoke-Line '{"requestId":32,"method":"list"}'
$liveToken = [string]$listLive.windows[0].runtimeId
$script:WhOps['Minimize'] = { param([IntPtr]$id) throw 'boom native failure' }
$throwing = Invoke-Line ('{"requestId":33,"method":"minimize","target":"' + $liveToken + '"}')
Assert-Outcome $throwing 'denied' 'a throwing native op returns typed denied'
Assert-True ($throwing.requestId -eq 33) 'the denied response correlates'
Assert-True ([string]$throwing.error -match 'boom') 'the bounded error text carries the cause'
$listAfter = Invoke-Line '{"requestId":34,"method":"list"}'
Assert-Outcome $listAfter 'success' 'the helper stays live after a native exception'

# ---- requestId fidelity (FINDING 2) ----------------------------------------
$bigId = Invoke-Line '{"requestId":9007199254740991,"method":"list"}'
Assert-True ($bigId.requestId -eq 9007199254740991 -and $bigId.outcome -eq 'success') 'MAX_SAFE requestId echoes without narrowing'

# ---- serialization round-trip ----------------------------------------------
$roundTrip = Invoke-Line ('{"requestId":40,"method":"observe","target":"' + $liveToken + '"}')
Assert-True ($roundTrip.requestId -eq 40 -and $roundTrip.method -eq 'observe') 'response echoes requestId and method'

# ---- resolver (outside the six-command vocabulary) -------------------------
$missingResolve = Resolve-WhUniqueTarget @($list.windows) 'WH-TEST-NOPE'
Assert-True ($missingResolve.outcome -eq 'missing') 'resolver: zero match is typed missing'
$successResolve = Resolve-WhUniqueTarget @($list.windows) 'WH-TEST-AAAA'
Assert-True ($successResolve.outcome -eq 'success' -and $successResolve.runtimeId -eq $tokenA) 'resolver: exactly one match is typed success'
$twoTitles = @(
  [pscustomobject]@{ runtimeId = 'Taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'; title = 'WH-TEST-DUP' }
  [pscustomobject]@{ runtimeId = 'Taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'; title = 'WH-TEST-DUP' }
)
$ambiguousResolve = Resolve-WhUniqueTarget $twoTitles 'WH-TEST-DUP'
Assert-True ($ambiguousResolve.outcome -eq 'ambiguous') 'resolver: two matches are typed ambiguous, no target chosen'
$substringResolve = Resolve-WhUniqueTarget @($list.windows) 'WH-TEST-AAA'
Assert-True ($substringResolve.outcome -eq 'missing') 'resolver: exact title equality only, no substring match'

# ================= Assignment 016 sections ==================================
# Earlier sections mutate registry entries in place; the 016 fixtures need the
# pristine full registry with fresh objects.
$script:fakeRegistry = New-PristineRegistry
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }
# ---- 016: task-worthy list filter -----------------------------------------
$taskList = Invoke-Line '{"requestId":50,"method":"list"}'
$taskTitles = @($taskList.windows | ForEach-Object { $_.title })
Assert-True ($taskTitles -contains 'WH-TEST-AAAA') 'task-worthy: ordinary window stays listed'
Assert-True ($taskTitles -contains 'WH-TEST-MINIMIZED-LEGIT') 'task-worthy: legitimate minimized window stays listed'
Assert-True ($taskTitles -contains 'WH-TEST-DOC-1' -and $taskTitles -contains 'WH-TEST-DOC-2') 'task-worthy: two genuine same-app document windows stay separate'
Assert-True ($taskTitles -contains 'WH-TEST-OWNED-ACTIVE') 'task-worthy: owned active popup stays listed'
Assert-True ($taskTitles -contains 'Code') 'task-worthy: unrelated Electron application stays listed (Code)'
Assert-True ($taskTitles -notcontains 'Papers') 'task-worthy: packaged Papers process excluded structurally (executable identity, not title)'
# 016R gap 7: same-task surface dedup without collapsing documents.
Assert-True ($taskTitles -contains 'WH-TEST-TASK-ROOT') 'same-task dedup: the task root surface stays listed'
Assert-True ($taskTitles -notcontains 'WH-TEST-TASK-POPUP') 'same-task dedup: the owned popup surface of the SAME process collapses into its root'
Assert-True ($taskTitles -contains 'WH-TEST-DOC-A' -and $taskTitles -contains 'WH-TEST-DOC-B') 'same-task dedup: two genuine documents of one application both stay listed'
Assert-True ($taskTitles -notcontains 'Program Manager') 'task-worthy: Progman shell excluded (class, not title)'
Assert-True ($taskTitles -notcontains 'WH-TEST-CLOAKED') 'task-worthy: cloaked duplicate surface excluded'
Assert-True ($taskTitles -notcontains 'WH-TEST-TOOL') 'task-worthy: WS_EX_TOOLWINDOW excluded'
Assert-True ($taskTitles -notcontains 'WH-TEST-OWNED-INACTIVE') 'task-worthy: owned inactive popup excluded'
Assert-True ($taskTitles -notcontains 'TextInput') 'task-worthy: TextInputHost system surface excluded'
# 016R2 direct-pick dedup: list keeps the root identity, popup collapses.
Assert-True ($taskTitles -contains 'WH-TEST-DEDUP-ROOT') 'same-task dedup: DEDUP-ROOT stays listed'
Assert-True ($taskTitles -notcontains 'WH-TEST-DEDUP-POPUP') 'same-task dedup: DEDUP-POPUP collapses into its root in the list'
Assert-True ($taskTitles -contains 'WH-TEST-DOC-C' -and $taskTitles -contains 'WH-TEST-DOC-D') 'same-task dedup: two ownerless same-process documents both stay listed'

# ---- 016: hover method ----------------------------------------------------
Assert-Outcome (Invoke-Line '{"requestId":51,"method":"hover"}') 'malformed' 'hover without x/y is malformed'
Assert-Outcome (Invoke-Line '{"requestId":52,"method":"hover","x":"a","y":1}') 'malformed' 'hover non-numeric x is malformed'
Assert-Outcome (Invoke-Line '{"requestId":53,"method":"hover","x":1e10,"y":1}') 'malformed' 'hover overflowing x is malformed'
# hover resolution is now z-order enumeration with bounds containment; the fake registry order IS the z-order.
$hoverA = Invoke-Line '{"requestId":54,"method":"hover","x":100,"y":70}'
Assert-True ($hoverA.outcome -eq 'success' -and $null -ne $hoverA.window) 'hover: task-worthy window at point resolves'
Assert-True ([string]$hoverA.window.runtimeId -match '^T[0-9a-f]{32}$') 'hover: window carries a session token'
$hoverShell = Invoke-Line '{"requestId":55,"method":"hover","x":300,"y":200}'
Assert-True ($hoverShell.outcome -eq 'success' -and $null -eq $hoverShell.window) 'hover: Progman at point resolves to null'
$hoverCloaked = Invoke-Line '{"requestId":56,"method":"hover","x":500,"y":450}'
Assert-True ($hoverCloaked.outcome -eq 'success' -and $null -eq $hoverCloaked.window) 'hover: cloaked surface at point resolves to null'
$hoverText = Invoke-Line '{"requestId":57,"method":"hover","x":900,"y":850}'
Assert-True ($hoverText.outcome -eq 'success' -and $null -eq $hoverText.window) 'hover: TextInputHost at point resolves to null'
$hoverBlank = Invoke-Line '{"requestId":58,"method":"hover","x":5000,"y":5000}'
Assert-True ($hoverBlank.outcome -eq 'success' -and $null -eq $hoverBlank.window) 'hover: blank point resolves to null'
# 016R gap 6 hover-path evidence: a point inside the packaged Papers fixture
# rect resolves to null (structural name exclusion), an unrelated Electron
# application at its rect stays eligible, and a window owned by the helper's
# parent PID resolves to null (hover-through exclusion).
$hoverPapers = Invoke-Line '{"requestId":63,"method":"hover","x":400,"y":750}'
Assert-True ($hoverPapers.outcome -eq 'success' -and $null -eq $hoverPapers.window) 'hover: packaged Papers surface at point resolves to null (name exclusion)'
$hoverCode = Invoke-Line '{"requestId":64,"method":"hover","x":1400,"y":750}'
Assert-True ($hoverCode.outcome -eq 'success' -and $null -ne $hoverCode.window -and $hoverCode.window.title -eq 'Code') 'hover: unrelated Electron application stays eligible at point'
$hoverParent = Invoke-Line '{"requestId":65,"method":"hover","x":2200,"y":250}'
Assert-True ($hoverParent.outcome -eq 'success' -and $null -eq $hoverParent.window) 'hover: helper-parent-owned surface at point resolves to null'
$hoverAgain = Invoke-Line '{"requestId":59,"method":"hover","x":100,"y":70}'
Assert-True ($hoverAgain.window.runtimeId -eq $hoverA.window.runtimeId) 'hover: unchanged identity reuses its session token'
# hover capacity: at the limit a NEW identity is denied and issues nothing
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 1 }
$hoverCap1 = Invoke-Line '{"requestId":60,"method":"hover","x":100,"y":70}'
Assert-True ($hoverCap1.outcome -eq 'success' -and $null -ne $hoverCap1.window) 'hover capacity: first identity issues'
# capacity: AAAA at (100,70), DOC-1 at (250,100)
$hoverCap2 = Invoke-Line '{"requestId":61,"method":"hover","x":250,"y":100}'
Assert-Outcome $hoverCap2 'denied' 'hover capacity: new identity at the limit is denied'
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }
$resetHover = Invoke-Line '{"requestId":62,"method":"hover","x":100,"y":70}'
Assert-True ($resetHover.outcome -eq 'success') 'hover capacity: session reset restores capacity'

# ---- 016R2 direct-pick dedup: hover resolves to the ROOT task identity -----
# The popup is above its root in z-order (fixture order); hovering it must
# keep the LIST token for the root task, including a point on the popup area
# OUTSIDE the root bounds. Ownerless same-process documents keep their own ids.
# The comparison list is issued in the CURRENT session (the earlier $taskList
# session was reset by the capacity test), so list and hover share byKey.
$dedupList = Invoke-Line '{"requestId":73,"method":"list"}'
$dedupRootToken = [string]@($dedupList.windows | Where-Object { $_.title -eq 'WH-TEST-DEDUP-ROOT' } | Select-Object -First 1)[0].runtimeId
Assert-True ($dedupRootToken -match '^T[0-9a-f]{32}$') 'direct-pick dedup: the list issued a token for DEDUP-ROOT'
$hoverDupPopupFirst = Invoke-Line '{"requestId":66,"method":"hover","x":800,"y":225}'
Assert-True ($hoverDupPopupFirst.outcome -eq 'success' -and $null -ne $hoverDupPopupFirst.window -and $hoverDupPopupFirst.window.title -eq 'WH-TEST-DEDUP-ROOT') 'direct-pick dedup: popup-FIRST z-order over its root resolves to the root task'
Assert-True ([string]$hoverDupPopupFirst.window.runtimeId -eq $dedupRootToken) 'direct-pick dedup: popup-first hover keeps the LIST token identity'
$hoverDupPopupOnly = Invoke-Line '{"requestId":67,"method":"hover","x":900,"y":350}'
Assert-True ($hoverDupPopupOnly.outcome -eq 'success' -and $null -ne $hoverDupPopupOnly.window -and $hoverDupPopupOnly.window.title -eq 'WH-TEST-DEDUP-ROOT') 'direct-pick dedup: a point on the popup area OUTSIDE the root bounds resolves to the root task'
$hoverDupRootOnly = Invoke-Line '{"requestId":68,"method":"hover","x":650,"y":150}'
Assert-True ($hoverDupRootOnly.outcome -eq 'success' -and $null -ne $hoverDupRootOnly.window -and $hoverDupRootOnly.window.title -eq 'WH-TEST-DEDUP-ROOT') 'direct-pick dedup: a point on the root-only area resolves to the root task'
$hoverDocC = Invoke-Line '{"requestId":69,"method":"hover","x":700,"y":550}'
Assert-True ($hoverDocC.outcome -eq 'success' -and $null -ne $hoverDocC.window -and $hoverDocC.window.title -eq 'WH-TEST-DOC-C') 'direct-pick dedup: ownerless DOC-C resolves to itself'
$hoverDocD = Invoke-Line '{"requestId":72,"method":"hover","x":1000,"y":570}'
Assert-True ($hoverDocD.outcome -eq 'success' -and $null -ne $hoverDocD.window -and $hoverDocD.window.title -eq 'WH-TEST-DOC-D') 'direct-pick dedup: ownerless DOC-D resolves to itself, never collapsing'

# ---- 016: apply bounds clamping -------------------------------------------
$clampKeep = ConvertTo-WhClampedBounds 100 100 800 600 $script:fakeMonitors
Assert-True ($clampKeep.x -eq 100 -and $clampKeep.y -eq 100 -and $clampKeep.width -eq 800 -and $clampKeep.height -eq 600) 'clamp: fully onscreen bounds are unchanged'
$clampOffscreen = ConvertTo-WhClampedBounds -5000 -5000 800 600 $script:fakeMonitors
Assert-True ($clampOffscreen.x -ge 0 -and $clampOffscreen.y -ge 0 -and $clampOffscreen.x + $clampOffscreen.width -le 1920 -and $clampOffscreen.y + $clampOffscreen.height -le 1040) 'clamp: fully offscreen bounds translate onto the visible work area'
$clampHuge = ConvertTo-WhClampedBounds 100 100 5000 5000 $script:fakeMonitors
Assert-True ($clampHuge.width -le 1920 -and $clampHuge.height -le 1040 -and $clampHuge.width -ge 160 -and $clampHuge.height -ge 120) 'clamp: oversized bounds clamp to the work area with minimum usable size'
$clampDisconnected = ConvertTo-WhClampedBounds 9000 9000 640 480 $script:fakeMonitors
Assert-True ($clampDisconnected.x -ge 0 -and $clampDisconnected.x + $clampDisconnected.width -le 1920 -and $clampDisconnected.y -ge 0 -and $clampDisconnected.y + $clampDisconnected.height -le 1040) 'clamp: disconnected-monitor rectangle lands on the primary work area'
$clampPartial = ConvertTo-WhClampedBounds 1900 0 800 600 $script:fakeMonitors
Assert-True ($clampPartial.x + $clampPartial.width -le 3840 -and $clampPartial.x -ge 1920) 'clamp: partial overlap prefers the intersecting monitor'
# integration: apply with an offscreen rectangle reaches SetBounds clamped
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }
$applyList = Invoke-Line '{"requestId":70,"method":"list"}'
$applyToken = [string]$applyList.windows[0].runtimeId
$applyClamped = Invoke-Line ('{"requestId":71,"method":"apply","target":"' + $applyToken + '","bounds":{"x":-5000,"y":-5000,"width":800,"height":600}}')
Assert-Outcome $applyClamped 'success' 'apply: offscreen bounds still succeed (clamped)'
$entryTouched = @($script:fakeRegistry | Where-Object { $_.RuntimeId -eq [IntPtr]0x1001 } | Select-Object -First 1).touched
$lastSet = $entryTouched | Where-Object { $_ -like 'set-bounds:*' } | Select-Object -Last 1
$parts = $lastSet -replace 'set-bounds:', '' -split ','
Assert-True ([int]$parts[0] -ge 0 -and [int]$parts[1] -ge 0) 'apply: SetBounds received clamped (visible) coordinates'
Assert-True ([int]$parts[2] -eq 800 -and [int]$parts[3] -eq 600) 'apply: SetBounds received the requested size when it fits'
# negative hover wire fixtures
$hoverBad1 = @{ requestId = 1; method = 'hover'; outcome = 'success'; window = @{} }
Assert-True (-not (Test-WireResponseOk $hoverBad1)) 'wire: hover success with malformed window is rejected'
$hoverBad2 = @{ requestId = 1; method = 'hover'; outcome = 'success'; window = $null; windows = @() }
Assert-True (-not (Test-WireResponseOk $hoverBad2)) 'wire: hover success with extra windows key is rejected'
$hoverBad3 = @{ requestId = 1; method = 'hover'; outcome = 'denied'; window = $null }
Assert-True (-not (Test-WireResponseOk $hoverBad3)) 'wire: hover non-success with window payload is rejected'

# ---- 016R regression: real lazy ParentPid path -----------------------------
# The production helper must resolve its OWN parent on first use (cache
# starts $null), return a nonzero parent pid and reuse the cached value on
# every later read. This exercises the REAL op + WMI, not the fake registry.
$script:WhParentPid = $null
Assert-True ($null -eq $script:WhParentPid) 'real ParentPid: cache starts null (lazy, no premature 0)'
$firstParent = [int](& $script:realParentPidOp)
Assert-True ($firstParent -gt 0) "real ParentPid: first resolution is a nonzero pid (got $firstParent)"
Assert-True ($script:WhParentPid -eq $firstParent) 'real ParentPid: first resolution caches the resolved pid'
$secondParent = [int](& $script:realParentPidOp)
Assert-True ($secondParent -eq $firstParent) 'real ParentPid: second read reuses the cached value'
$script:WhParentPid = $null

Write-Output '---'
Write-Output "helper-schema.test.ps1 (Papers-owned window helper): $script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
exit 0
