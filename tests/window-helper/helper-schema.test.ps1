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
  $windowsIsArray = $hasWindowsKey -and $R['windows'] -is [System.Array]
  if ($R['outcome'] -eq 'success') {
    if ($R['method'] -eq 'list') {
      if (-not ($hasWindowsKey -and $windowsIsArray -and -not $hasObservationKey)) { return $false }
    } elseif ($R['method'] -eq 'close') {
      if ($hasWindowsKey -or $hasObservationKey) { return $false }
    } else {
      if (-not ($hasObservationKey -and -not $hasWindowsKey)) { return $false }
    }
  } else {
    if ($hasWindowsKey -or $hasObservationKey) { return $false }
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
}

# ---- injected fake registry (009-style $script:WhOps seam) ---------------
$script:fakeRegistry = @(
  [pscustomobject]@{ RuntimeId = [IntPtr]0x1001; Title = 'WH-TEST-AAAA'; ProcessId = 1001; ProcessPath = 'C:\fake-a.exe'; State = 'normal'; Bounds = @{ Left = 10; Top = 20; Right = 210; Bottom = 120; Width = 200; Height = 100 }; alive = $true; touched = @() }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x2002; Title = 'WH-TEST-BBBB'; ProcessId = 2002; ProcessPath = 'C:\fake-b.exe'; State = 'minimized'; Bounds = @{ Left = 0; Top = 0; Right = 100; Bottom = 80; Width = 100; Height = 80 }; alive = $true; touched = @() }
  [pscustomobject]@{ RuntimeId = [IntPtr]0x3003; Title = 'WH-TEST-ZERO'; ProcessId = 3003; ProcessPath = 'C:\fake-c.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 0; Bottom = 0; Width = 0; Height = 0 }; alive = $true; touched = @() }
)
$script:WhOps = @{
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
Assert-True ($list.outcome -eq 'success' -and $list.windows.Count -eq 3) 'list returns all fake windows'
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
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 3 }
$fillList = Invoke-Line '{"requestId":28,"method":"list"}'
Assert-True ($fillList.outcome -eq 'success' -and $fillList.windows.Count -eq 3) 'filling to the injected limit succeeds'
Assert-True ($script:WhSession.byToken.Count -eq 3) 'both tokens issued at capacity'
$capToken = [string]$fillList.windows[0].runtimeId
$script:fakeRegistry += [pscustomobject]@{ RuntimeId = [IntPtr]0x4004; Title = 'WH-TEST-CCCC'; ProcessId = 4004; ProcessPath = 'C:\fake-d.exe'; State = 'normal'; Bounds = @{ Left = 0; Top = 0; Right = 50; Bottom = 50; Width = 50; Height = 50 }; alive = $true; touched = @() }
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

Write-Output '---'
Write-Output "helper-schema.test.ps1 (Papers-owned window helper): $script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
exit 0
