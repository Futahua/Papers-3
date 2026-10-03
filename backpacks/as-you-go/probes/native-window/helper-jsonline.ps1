# Assignment 013/013R/013R3 — long-lived JSON-lines helper (probe only,
# PS 5.1-safe).
#
# Reads UTF-8 JSON request lines from stdin, validates against the typed
# schema, routes through the REUSED 009 native adapter (window-capability.ps1)
# and writes exactly one typed JSON response per REQUEST ACCEPTED for
# correlation. Protocol JSON only on stdout; nothing else.
#
# Wire contract (010R-aligned):
# - The wire id is a helper-session TOKEN; raw HWNDs NEVER appear on the
#   wire, in the transcript or in product-facing error text. Token issuance
#   is the only product-facing identity path.
# - requestId is echoed/stored as a positive safe integer
#   (1 .. 9007199254740991) with NO Int32 narrowing cast.
# - 011-aligned invalid-input policy: an unparseable line, an invalid
#   requestId, or an unknown/missing method is IGNORED (no stdout response, no
#   act) — correlation is impossible for those. A valid requestId+method with
#   forbidden command-like fields is typed 'denied'; a valid requestId+method
#   with malformed target/bounds/state is typed 'malformed'.
# - Fail-closed command vocabulary: exactly the six methods list/observe/
#   minimize/restore/apply/close. Extra command-like keys are never executed.
#
# Session tokens (013R2 FINDINGS 1+2, 013R3 FINDING 2):
# - The wire id is a high-entropy helper-session TOKEN ('T'+32 hex GUID),
#   never a raw HWND. Tokens are issued on list, keyed by the full
#   (HWND, PID, exact title) identity: an unchanged identity keeps its
#   token across repeated list calls; an HWND reused with a different
#   PID/title gets a NEW token while the old token stays bound to the old
#   identity and fails closed. Tokens are never overwritten or rebound.
# - The session registry is BOUNDED: a fixed probe limit of 4096 issued
#   tokens per helper session. The list path preflights the FULL list
#   atomically BEFORE issuing anything: if existing token count + distinct
#   new identities would exceed the limit, the list returns a typed 'denied'
#   envelope with bounded non-sensitive text, issues NO new tokens, returns
#   NO partial windows payload and leaves both maps unchanged. Old tokens are
#   never evicted or rebound, so known tokens remain usable at capacity.
# - observe/minimize/restore/apply/close accept ONLY issued tokens:
#   unknown, guessed, raw numeric HWND or previous-session tokens are
#   typed 'missing' with no native observation/mutation.
# - Before EVERY observe and mutation, the token is resolved and IsWindow
#   plus exact PID/title are rechecked in the SAME request handler:
#   mismatch => typed 'denied'; vanished => typed 'missing'. Observe NEVER
#   re-registers or repairs a mismatched token.
#
# Native hardening (013R FINDING 4):
# - apply bounds are validated as platform-representable BEFORE casts:
#   finite numbers within Int32; fractional values are deterministically
#   rounded away from zero; width/height must round to >= 1; overflow or
#   non-positive-after-rounding => typed 'malformed'. An apply.state field is
#   NOT silently ignored: it returns typed 'malformed' for now.
# - Every native observation/mutation runs inside a per-request catch that
#   returns typed 'denied' with bounded non-sensitive error text and keeps
#   the helper live.
#
# Requires: Windows PowerShell 5.1 or PowerShell 7 + the 009 P/Invoke adapter.

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/window-capability.ps1"

$VALID_METHODS = @('list', 'observe', 'minimize', 'restore', 'apply', 'close')
$FORBIDDEN_KEYS = @('exec', 'command', 'script', 'path', 'handle', 'env', 'args', 'cmd', 'powershell', 'invoke', 'shell')
$MAX_SAFE_REQUEST_ID = 9007199254740991L
$script:AygSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }

# Normalize parsed JSON (PSCustomObject in PS 5.1, hashtable with -AsHashtable
# in PS 7) into plain nested hashtables so validation is runtime-agnostic.
function ConvertTo-PsHashtable {
  param([object]$Value)
  if ($Value -is [System.Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) { $table[[string]$key] = (ConvertTo-PsHashtable $Value[$key]) }
    return $table
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($prop in $Value.PSObject.Properties) { $table[$prop.Name] = (ConvertTo-PsHashtable $prop.Value) }
    return $table
  }
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    $list = @()
    foreach ($item in $Value) { $list += (ConvertTo-PsHashtable $item) }
    return ,$list
  }
  return $Value
}

function Test-PositiveSafeInteger {
  param([object]$Value)
  if ($Value -isnot [long] -and $Value -isnot [int]) { return $false }
  $n = [long]$Value
  return $n -gt 0 -and $n -le $MAX_SAFE_REQUEST_ID
}

function Test-FiniteNumber {
  param([object]$Value)
  if (-not ($Value -is [double] -or $Value -is [float] -or $Value -is [decimal] -or $Value -is [int] -or $Value -is [long])) {
    return $false
  }
  $d = [double]$Value
  return -not [double]::IsNaN($d) -and -not [double]::IsInfinity($d)
}

# Deterministic platform policy: finite, within Int32, rounded away from
# zero; width/height must round to at least 1.
function Test-PlatformBounds {
  param([object]$Bounds)
  if ($Bounds -isnot [System.Collections.IDictionary]) { return $false }
  foreach ($name in @('x', 'y', 'width', 'height')) {
    $value = $Bounds[$name]
    if (-not (Test-FiniteNumber $value)) { return $false }
    $d = [double]$value
    if ($d -lt [int]::MinValue -or $d -gt [int]::MaxValue) { return $false }
  }
  $w = [Math]::Round([double]$Bounds['width'], 0, [MidpointRounding]::AwayFromZero)
  $h = [Math]::Round([double]$Bounds['height'], 0, [MidpointRounding]::AwayFromZero)
  return $w -gt 0 -and $h -gt 0
}

function ConvertTo-AygResponse {
  param([long]$RequestId, [string]$Method, [string]$Outcome, [hashtable]$Payload, [string]$ErrorText)
  $response = [ordered]@{ requestId = $RequestId; method = $Method; outcome = $Outcome }
  if ($Payload -ne $null) { foreach ($key in $Payload.Keys) { $response[$key] = $Payload[$key] } }
  if ($ErrorText) { $response['error'] = $ErrorText }
  return $response
}

function Get-BoundedErrorText {
  param([object]$ErrorRecord)
  $message = ''
  if ($ErrorRecord -is [System.Management.Automation.ErrorRecord]) { $message = [string]$ErrorRecord.Exception.Message }
  elseif ($ErrorRecord -is [System.Exception]) { $message = [string]$ErrorRecord.Message }
  if ([string]::IsNullOrWhiteSpace($message)) { return 'native operation failed' }
  if ($message.Length -gt 80) { $message = $message.Substring(0, 80) }
  return $message
}

function Get-AygWireBounds {
  param([object]$Bounds)
  if ($Bounds -eq $null) { return $null }
  return [ordered]@{
    x = [int]$Bounds['Left']
    y = [int]$Bounds['Top']
    width = [int]$Bounds['Width']
    height = [int]$Bounds['Height']
  }
}

function Get-AygIdentityKey {
  param([long]$Hwnd, [int]$PidValue, [string]$Title)
  return "$Hwnd|$PidValue|$Title"
}

function Get-AygResponseObservation {
  param([string]$Token)
  $entry = Resolve-AygSessionToken $Token
  $obs = Get-AygWindowObservation ([IntPtr]$entry.hwnd)
  return [ordered]@{
    runtimeId = $Token
    title = $obs.Title
    processId = $obs.ProcessId
    processPath = $obs.ProcessPath
    state = $obs.State
    bounds = (Get-AygWireBounds $obs.Bounds)
  }
}

# Issue or reuse the session token for one (HWND, PID, exact title) identity.
# A changed identity under the same HWND yields a NEW token; tokens are never
# overwritten or rebound.
function New-AygSessionToken {
  param([long]$Hwnd, [int]$PidValue, [string]$Title)
  $key = Get-AygIdentityKey $Hwnd $PidValue $Title
  if ($script:AygSession.byKey.ContainsKey($key)) {
    return $script:AygSession.byKey[$key]
  }
  $token = 'T' + [guid]::NewGuid().ToString('N')
  $script:AygSession.byKey[$key] = $token
  $script:AygSession.byToken[$token] = @{ hwnd = $Hwnd; pid = $PidValue; title = $Title }
  return $token
}

function Resolve-AygSessionToken {
  param([string]$Token)
  if (-not $script:AygSession.byToken.ContainsKey($Token)) { return $null }
  return $script:AygSession.byToken[$Token]
}

# Atomic capacity preflight (FINDING 2): returns $true when the full list can
# be issued within the session limit without touching either map.
function Test-AygListCapacity {
  param([object[]]$Observations)
  $newCount = 0
  foreach ($observation in $Observations) {
    $key = Get-AygIdentityKey ([long]$observation.RuntimeId) ([int]$observation.ProcessId) ([string]$observation.Title)
    if (-not $script:AygSession.byKey.ContainsKey($key)) { $newCount += 1 }
  }
  return ($script:AygSession.byToken.Count + $newCount) -le $script:AygSession.maxTokens
}

# Fail-closed identity gate executed in the SAME request handler, immediately
# before EVERY observe and mutation. Never re-registers or repairs.
# Returns @{ ok; outcome; error }.
function Test-AygTokenIdentity {
  param([string]$Token)
  $entry = Resolve-AygSessionToken $Token
  if ($null -eq $entry) {
    return @{ ok = $false; outcome = 'missing'; error = 'unknown session token' }
  }
  if (-not (Test-AygWindowAlive ([IntPtr]$entry.hwnd))) {
    return @{ ok = $false; outcome = 'missing'; error = 'session token no longer refers to a live window' }
  }
  try {
    $live = Get-AygWindowObservation ([IntPtr]$entry.hwnd)
  } catch {
    return @{ ok = $false; outcome = 'denied'; error = (Get-BoundedErrorText $_) }
  }
  if ([int]$live.ProcessId -ne [int]$entry.pid -or [string]$live.Title -ne [string]$entry.title) {
    return @{ ok = $false; outcome = 'denied'; error = 'window identity changed since the token was issued' }
  }
  return @{ ok = $true }
}

# Validate one parsed request object. Always returns an envelope: ignored
# paths (impossible to correlate) return @{ Valid = $false; Response = $null },
# fail-closed paths return @{ Valid = $false; Response = <typed response> },
# acceptance returns @{ Valid = $true; RequestId; Method }.
function Test-AygRequestShape {
  param([object]$Request)
  if ($Request -isnot [System.Collections.IDictionary]) {
    return @{ Valid = $false; Response = $null }
  }
  $requestId = $Request['requestId']
  if (-not (Test-PositiveSafeInteger $requestId)) {
    return @{ Valid = $false; Response = $null }
  }
  $method = $Request['method']
  if (-not ($VALID_METHODS -contains $method)) {
    return @{ Valid = $false; Response = $null }
  }
  $id = [long]$requestId
  foreach ($key in $Request.Keys) {
    if ($FORBIDDEN_KEYS -contains ([string]$key).ToLowerInvariant()) {
      return @{ Valid = $false; Response = (ConvertTo-AygResponse $id ([string]$method) 'denied' $null 'command-like fields are not accepted') }
    }
  }
  if ($method -ne 'list') {
    $target = $Request['target']
    if ($target -isnot [string] -or $target.Length -eq 0) {
      return @{ Valid = $false; Response = (ConvertTo-AygResponse $id ([string]$method) 'malformed' $null 'target must be a non-empty string') }
    }
  }
  if ($method -eq 'apply') {
    if ($Request.ContainsKey('state')) {
      return @{ Valid = $false; Response = (ConvertTo-AygResponse $id ([string]$method) 'malformed' $null 'apply.state is not supported') }
    }
    if (-not (Test-PlatformBounds $Request['bounds'])) {
      return @{ Valid = $false; Response = (ConvertTo-AygResponse $id ([string]$method) 'malformed' $null 'apply requires platform-representable bounds (finite, within Int32; width/height at least 1 after rounding away from zero)') }
    }
  }
  return @{ Valid = $true; RequestId = $id; Method = [string]$method }
}

# Route one validated request through the REUSED 009 adapter ops and return
# the typed response hashtable. Every native call is inside the per-request
# catch (FINDING 4); failures become typed 'denied' and the helper stays live.
function Invoke-AygRequest {
  param([object]$Request, [long]$RequestId, [string]$Method)
  try {
    if ($Method -eq 'list') {
      $observations = @(Get-AygVisibleWindows)
      if (-not (Test-AygListCapacity $observations)) {
        return (ConvertTo-AygResponse $RequestId $Method 'denied' $null 'session token capacity reached')
      }
      $windows = @()
      foreach ($observation in $observations) {
        $token = New-AygSessionToken ([long]$observation.RuntimeId) ([int]$observation.ProcessId) ([string]$observation.Title)
        $windows += [ordered]@{
          runtimeId = $token
          title = $observation.Title
          processId = $observation.ProcessId
          processPath = $observation.ProcessPath
          state = $observation.State
          bounds = (Get-AygWireBounds $observation.Bounds)
        }
      }
      return (ConvertTo-AygResponse $RequestId $Method 'success' @{ windows = $windows } $null)
    }
    $target = [string]$Request['target']
    if ($Method -eq 'observe') {
      $identity = Test-AygTokenIdentity $target
      if (-not $identity.ok) {
        return (ConvertTo-AygResponse $RequestId $Method $identity.outcome $null $identity.error)
      }
      return (ConvertTo-AygResponse $RequestId $Method 'success' @{ observation = (Get-AygResponseObservation $target) } $null)
    }
    # ---- mutations: identity gate BEFORE any native act -------------------
    $identity = Test-AygTokenIdentity $target
    if (-not $identity.ok) {
      return (ConvertTo-AygResponse $RequestId $Method $identity.outcome $null $identity.error)
    }
    $entry = Resolve-AygSessionToken $target
    $runtimeId = [IntPtr]$entry.hwnd
    if ($Method -eq 'minimize') {
      Minimize-AygWindow $runtimeId
      return (ConvertTo-AygResponse $RequestId $Method 'success' @{ observation = (Get-AygResponseObservation $target) } $null)
    }
    if ($Method -eq 'restore') {
      Restore-AygWindow $runtimeId
      return (ConvertTo-AygResponse $RequestId $Method 'success' @{ observation = (Get-AygResponseObservation $target) } $null)
    }
    if ($Method -eq 'apply') {
      $b = $Request['bounds']
      $x = [Math]::Round([double]$b['x'], 0, [MidpointRounding]::AwayFromZero)
      $y = [Math]::Round([double]$b['y'], 0, [MidpointRounding]::AwayFromZero)
      $w = [Math]::Round([double]$b['width'], 0, [MidpointRounding]::AwayFromZero)
      $h = [Math]::Round([double]$b['height'], 0, [MidpointRounding]::AwayFromZero)
      Set-AygWindowBounds $runtimeId ([int]$x) ([int]$y) ([int]$w) ([int]$h)
      return (ConvertTo-AygResponse $RequestId $Method 'success' @{ observation = (Get-AygResponseObservation $target) } $null)
    }
    if ($Method -eq 'close') {
      Close-ResolvedAygMember $runtimeId
      return (ConvertTo-AygResponse $RequestId $Method 'success' $null $null)
    }
    return (ConvertTo-AygResponse $RequestId $Method 'denied' $null 'method not permitted')
  } catch {
    return (ConvertTo-AygResponse $RequestId $Method 'denied' $null (Get-BoundedErrorText $_))
  }
}

# Handle one raw input line: returns the response hashtable to write, or
# $null when the line is ignored (empty, unparseable, invalid id/method).
function Invoke-AygRequestLine {
  param([string]$Line)
  if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
  try {
    $parsed = $Line | ConvertFrom-Json
    $parsed = ConvertTo-PsHashtable $parsed
  } catch {
    return $null
  }
  $shape = Test-AygRequestShape $parsed
  if ($null -eq $shape) { return $null }
  if (-not $shape.Valid) { return $shape.Response }
  return (Invoke-AygRequest $parsed $shape.RequestId $shape.Method)
}

# ---- long-lived loop ------------------------------------------------------
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while (($inputLine = [Console]::In.ReadLine()) -ne $null) {
  $response = Invoke-AygRequestLine $inputLine
  if ($response -ne $null) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $response -Compress -Depth 10))
    [Console]::Out.Flush()
  }
}
