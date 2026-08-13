# Papers-owned window helper - long-lived JSON-lines helper.
#
# Behavior is LOCKED to the accepted protocol snapshot 013R5F plus the
# reviewed Assignment 016 additions (protocolVersion '016' in manifest.json)
# plus the reviewed Assignment 019G thumbnail method (protocolVersion '017'):
# protocol, session tokens, identity revalidation, capacity limits and native
# behavior are preserved exactly; 016 adds the task-worthy eligibility filter
# to list, the hover method (task-worthy window at a point, for direct
# onscreen pick), and offscreen-safe bounds clamping in apply; 019G adds the
# thumbnail method (bounded PrintWindow full-content capture). This file is
# the packaged runtime asset; do not drift from the manifest hash without a
# reviewed protocol change.
#
# Reads UTF-8 JSON request lines from stdin, validates against the typed
# schema, routes through the reused native adapter (window-capability.ps1)
# and writes exactly one typed JSON response per REQUEST ACCEPTED for
# correlation. Protocol JSON only on stdout; nothing else.
#
# Wire contract (010R-aligned):
# - The wire id is a helper-session TOKEN; raw HWNDs NEVER appear on the
#   wire or in product-facing error text. Token issuance is the only
#   product-facing identity path.
# - requestId is echoed/stored as a positive safe integer
#   (1 .. 9007199254740991) with NO Int32 narrowing cast.
# - 011-aligned invalid-input policy: an unparseable line, an invalid
#   requestId, or an unknown/missing method is IGNORED (no stdout response, no
#   act) - correlation is impossible for those. A valid requestId+method with
#   forbidden command-like fields is typed 'denied'; a valid requestId+method
#   with malformed target/bounds/x/y/state is typed 'malformed'.
# - Fail-closed command vocabulary: list/observe/minimize/restore/apply/
#   close/hover (016) + thumbnail (019G). Extra command-like keys are never
#   executed.
#
# 016 method `hover`: {requestId, method:'hover', x, y} resolves the TOPMOST
# TASK-WORTHY window at the point (helper-owned eligibility: cloaked
# surfaces, shell desktop/worker, tool/no-activate and owned-non-active
# windows are excluded; minimized applications stay eligible). The response
# is success with `window` = a valid wire observation OR null when nothing
# eligible is at the point. Hover issues/reuses a registered session token
# for the found identity (identity-reused, so polling does not grow the
# registry) and honors the capacity limit (denied at capacity).
#
# 016 clamping: apply ALWAYS clamps the desired rectangle into a currently
# visible monitor work area (minimum usable size) before SetWindowPos, so a
# stale/disconnected-monitor rectangle can never move a window offscreen.
# Persisted per-layout intent is unchanged; clamping is the runtime
# application only.
#
# 019G method `thumbnail`: {requestId, method:'thumbnail', target, maxWidth?,
# maxHeight?} rechecks the exact token identity in the SAME request handler
# and then captures the window's FULL content with PrintWindow(
# PW_RENDERFULLCONTENT), scaled to fit within (maxWidth, maxHeight). Bounds:
# maxWidth <= 320, maxHeight <= 180, positive integers; absent dimensions
# default to 240x135. The response is success with `thumbnail` = { image
# (base64 PNG, decoded <= 256 KiB), width, height } or a payload-free typed
# fallback outcome: 'minimized' (window is minimized), 'missing' (window
# vanished), 'denied' (unsupported/oversized/no-paint capture). PrintWindow is
# BEST EFFORT: an unsupported application is an honest typed fallback, never a
# fabricated placeholder.
#
# 019GR2 corrections: (a) the thumbnail request is STRICT - only the exact
# keys requestId, method, target and the optional maxWidth/maxHeight are
# accepted; EVERY extra key is rejected. (b) PrintWindow cannot scale to a
# smaller destination HDC, so the capture happens into a bounded NATIVE-SIZE
# source bitmap (unsafe dimensions/pixel area rejected before allocation) and
# the FULL source rectangle is then scaled aspect-preservingly into the
# <=320x180 output. (c) PrintWindow can return TRUE without painting: the
# source is prefilled with a distinctive nonuniform sentinel and an unchanged
# capture (checksum equal) is typed 'denied'.
#
# 019GR3: every thumbnail response (success AND fallback) echoes the accepted
# helper `target` token as a strict main-internal correlation field; the
# Papers client resolves a pending thumbnail only when requestId, method AND
# target all match, and strips the token before it reaches the service/IPC/page.
#
# 019GR4: an unexpected exception from an accepted thumbnail capture also
# echoes the accepted target on its generic denied envelope (the strict parser
# would reject a target-less fallback and the client would time out).
#
# Session tokens:
# - The wire id is a high-entropy helper-session TOKEN ('T'+32 hex GUID),
#   never a raw HWND. Tokens are issued on list, keyed by the full
#   (HWND, PID, exact title) identity: an unchanged identity keeps its
#   token across repeated list calls; an HWND reused with a different
#   PID/title gets a NEW token while the old token stays bound to the old
#   identity and fails closed. Tokens are never overwritten or rebound.
# - The session registry is BOUNDED: a fixed limit of 4096 issued
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
# Native hardening:
# - apply bounds are validated as platform-representable BEFORE casts:
#   finite numbers within Int32; fractional values are deterministically
#   rounded away from zero; width/height must round to >= 1; overflow or
#   non-positive-after-rounding => typed 'malformed'. An apply.state field is
#   NOT silently ignored: it returns typed 'malformed' for now.
# - hover x/y are validated as finite numbers within Int32 (typed
#   'malformed' otherwise).
# - Every native observation/mutation runs inside a per-request catch that
#   returns typed 'denied' with bounded non-sensitive error text and keeps
#   the helper live.
#
# Requires: Windows PowerShell 5.1 or PowerShell 7 + the native adapter.

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/window-capability.ps1"

$VALID_METHODS = @('list', 'observe', 'minimize', 'restore', 'cloak', 'uncloak', 'apply', 'close', 'hover', 'thumbnail')
$FORBIDDEN_KEYS = @('exec', 'command', 'script', 'path', 'handle', 'env', 'args', 'cmd', 'powershell', 'invoke', 'shell')
$MAX_SAFE_REQUEST_ID = 9007199254740991L
$script:WhSession = @{ byToken = @{}; byKey = @{}; maxTokens = 4096 }

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

function ConvertTo-WhResponse {
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

function Get-WhWireBounds {
  param([object]$Bounds)
  if ($Bounds -eq $null) { return $null }
  $width = [int]$Bounds['Width']
  $height = [int]$Bounds['Height']
  if ($width -le 0 -or $height -le 0) { return $null }
  return [ordered]@{
    x = [int]$Bounds['Left']
    y = [int]$Bounds['Top']
    width = $width
    height = $height
  }
}

function Get-WhIdentityKey {
  param([long]$Hwnd, [int]$PidValue, [string]$Title)
  return "$Hwnd|$PidValue|$Title"
}

function Get-WhResponseObservation {
  param([string]$Token)
  $entry = Resolve-WhSessionToken $Token
  $obs = Get-WhWindowObservation ([IntPtr]$entry.hwnd)
  return [ordered]@{
    runtimeId = $Token
    title = $obs.Title
    processId = $obs.ProcessId
    processPath = $obs.ProcessPath
    state = $obs.State
    bounds = (Get-WhWireBounds $obs.Bounds)
  }
}

# Issue or reuse the session token for one (HWND, PID, exact title) identity.
# A changed identity under the same HWND yields a NEW token; tokens are never
# overwritten or rebound.
function New-WhSessionToken {
  param([long]$Hwnd, [int]$PidValue, [string]$Title)
  $key = Get-WhIdentityKey $Hwnd $PidValue $Title
  if ($script:WhSession.byKey.ContainsKey($key)) {
    return $script:WhSession.byKey[$key]
  }
  $token = 'T' + [guid]::NewGuid().ToString('N')
  $script:WhSession.byKey[$key] = $token
  $script:WhSession.byToken[$token] = @{ hwnd = $Hwnd; pid = $PidValue; title = $Title }
  return $token
}

function Resolve-WhSessionToken {
  param([string]$Token)
  if (-not $script:WhSession.byToken.ContainsKey($Token)) { return $null }
  return $script:WhSession.byToken[$Token]
}

# Atomic capacity preflight (FINDING 2): returns $true when the full list can
# be issued within the session limit without touching either map.
function Test-WhListCapacity {
  param([object[]]$Observations)
  $newCount = 0
  foreach ($observation in $Observations) {
    $key = Get-WhIdentityKey ([long]$observation.RuntimeId) ([int]$observation.ProcessId) ([string]$observation.Title)
    if (-not $script:WhSession.byKey.ContainsKey($key)) { $newCount += 1 }
  }
  return ($script:WhSession.byToken.Count + $newCount) -le $script:WhSession.maxTokens
}

# Fail-closed identity gate executed in the SAME request handler, immediately
# before EVERY observe and mutation. Never re-registers or repairs.
# Returns @{ ok; outcome; error }.
function Test-WhTokenIdentity {
  param([string]$Token)
  $entry = Resolve-WhSessionToken $Token
  if ($null -eq $entry) {
    return @{ ok = $false; outcome = 'missing'; error = 'unknown session token' }
  }
  if (-not (Test-WhWindowAlive ([IntPtr]$entry.hwnd))) {
    return @{ ok = $false; outcome = 'missing'; error = 'session token no longer refers to a live window' }
  }
  try {
    $live = Get-WhWindowObservation ([IntPtr]$entry.hwnd)
  } catch {
    return @{ ok = $false; outcome = 'denied'; error = (Get-BoundedErrorText $_) }
  }
  if ([int]$live.ProcessId -ne [int]$entry.pid -or [string]$live.Title -ne [string]$entry.title) {
    return @{ ok = $false; outcome = 'denied'; error = 'window identity changed since the token was issued' }
  }
  return @{ ok = $true }
}

function Test-PlatformPoint {
  param([object]$X, [object]$Y)
  foreach ($value in @($X, $Y)) {
    if (-not (Test-FiniteNumber $value)) { return $false }
    $d = [double]$value
    if ($d -lt [int]::MinValue -or $d -gt [int]::MaxValue) { return $false }
  }
  return $true
}

# Validate one parsed request object. Always returns an envelope: ignored
# paths (impossible to correlate) return @{ Valid = $false; Response = $null },
# fail-closed paths return @{ Valid = $false; Response = <typed response> },
# acceptance returns @{ Valid = $true; RequestId; Method }.
function Test-WhRequestShape {
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
      # 019GR3: a thumbnail denial with a valid target echoes it so the strict
      # parser/client can still correlate requestId + method + target.
      $payload = $null
      if ($method -eq 'thumbnail' -and $Request['target'] -is [string] -and ([string]$Request['target']).Length -gt 0) {
        $payload = @{ target = [string]$Request['target'] }
      }
      return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'denied' $payload 'command-like fields are not accepted') }
    }
  }
  if ($method -eq 'hover') {
    if (-not (Test-PlatformPoint $Request['x'] $Request['y'])) {
      return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'malformed' $null 'hover requires finite x and y within Int32') }
    }
    return @{ Valid = $true; RequestId = $id; Method = [string]$method }
  }
  if ($method -ne 'list') {
    $target = $Request['target']
    if ($target -isnot [string] -or $target.Length -eq 0) {
      return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'malformed' $null 'target must be a non-empty string') }
    }
  }
  if ($method -eq 'apply') {
    if ($Request.ContainsKey('state')) {
      return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'malformed' $null 'apply.state is not supported') }
    }
    if (-not (Test-PlatformBounds $Request['bounds'])) {
      return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'malformed' $null 'apply requires platform-representable bounds (finite, within Int32; width/height at least 1 after rounding away from zero)') }
    }
  }
  if ($method -eq 'thumbnail') {
    # 019GR3: every thumbnail fallback echoes the accepted target so the strict
    # parser/client can correlate requestId + method + target. The request's
    # target has already been validated as a non-empty string above.
    $thumbTarget = [string]$Request['target']
    foreach ($name in @('maxWidth', 'maxHeight')) {
      if (-not $Request.ContainsKey($name)) { continue }
      $value = $Request[$name]
      if ($value -isnot [int] -and $value -isnot [long]) {
        return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'malformed' @{ target = $thumbTarget } 'thumbnail maxWidth/maxHeight must be integers') }
      }
      $n = [long]$value
      $limit = if ($name -eq 'maxWidth') { 320 } else { 180 }
      if ($n -le 0 -or $n -gt $limit) {
        return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'malformed' @{ target = $thumbTarget } ("thumbnail $name out of range (1..$limit)") ) }
      }
    }
    # 019GR2: strict thumbnail schema - only the exact documented keys
    # (requestId, method, target and the optional maxWidth/maxHeight) are
    # accepted. EVERY extra key is rejected, not only command-like names.
    $allowed = @('requestId', 'method', 'target')
    if ($Request.ContainsKey('maxWidth')) { $allowed += 'maxWidth' }
    if ($Request.ContainsKey('maxHeight')) { $allowed += 'maxHeight' }
    foreach ($key in $Request.Keys) {
      if ($allowed -notcontains ([string]$key)) {
        return @{ Valid = $false; Response = (ConvertTo-WhResponse $id ([string]$method) 'denied' @{ target = $thumbTarget } 'thumbnail request must contain only requestId, method, target and optional maxWidth/maxHeight') }
      }
    }
  }
  return @{ Valid = $true; RequestId = $id; Method = [string]$method }
}

# Route one validated request through the REUSED 009 adapter ops and return
# the typed response hashtable. Every native call is inside the per-request
# catch (FINDING 4); failures become typed 'denied' and the helper stays live.
function Invoke-WhRequest {
  param([object]$Request, [long]$RequestId, [string]$Method)
  try {
    if ($Method -eq 'list') {
      $observations = @(Merge-WhTaskSurfaces (@(Get-WhVisibleWindows | Where-Object { Test-WhTaskWorthy $_ })))
      if (-not (Test-WhListCapacity $observations)) {
        return (ConvertTo-WhResponse $RequestId $Method 'denied' $null 'session token capacity reached')
      }
      $windows = @()
      foreach ($observation in $observations) {
        $token = New-WhSessionToken ([long]$observation.RuntimeId) ([int]$observation.ProcessId) ([string]$observation.Title)
        $windows += [ordered]@{
          runtimeId = $token
          title = $observation.Title
          processId = $observation.ProcessId
          processPath = $observation.ProcessPath
          state = $observation.State
          bounds = (Get-WhWireBounds $observation.Bounds)
        }
      }
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ windows = $windows } $null)
    }
    if ($Method -eq 'hover') {
      $observation = Resolve-WhTaskWindowAtPoint ([int][Math]::Round([double]$Request['x'], 0, [MidpointRounding]::AwayFromZero)) ([int][Math]::Round([double]$Request['y'], 0, [MidpointRounding]::AwayFromZero))
      if ($null -eq $observation) {
        return (ConvertTo-WhResponse $RequestId $Method 'success' @{ window = $null } $null)
      }
      $key = Get-WhIdentityKey ([long]$observation.RuntimeId) ([int]$observation.ProcessId) ([string]$observation.Title)
      $atCapacity = -not $script:WhSession.byKey.ContainsKey($key) -and $script:WhSession.byToken.Count -ge $script:WhSession.maxTokens
      if ($atCapacity) {
        return (ConvertTo-WhResponse $RequestId $Method 'denied' $null 'session token capacity reached')
      }
      $token = New-WhSessionToken ([long]$observation.RuntimeId) ([int]$observation.ProcessId) ([string]$observation.Title)
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ window = [ordered]@{
        runtimeId = $token
        title = $observation.Title
        processId = $observation.ProcessId
        processPath = $observation.ProcessPath
        state = $observation.State
        bounds = (Get-WhWireBounds $observation.Bounds)
      } } $null)
    }
    $target = [string]$Request['target']
    if ($Method -eq 'observe') {
      $identity = Test-WhTokenIdentity $target
      if (-not $identity.ok) {
        return (ConvertTo-WhResponse $RequestId $Method $identity.outcome $null $identity.error)
      }
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ observation = (Get-WhResponseObservation $target) } $null)
    }
    # ---- 019G thumbnail: identity gate immediately before capture ----------
    if ($Method -eq 'thumbnail') {
      $identity = Test-WhTokenIdentity $target
      if (-not $identity.ok) {
        # 019GR3: echo the accepted helper target on every fallback so the
        # client can correlate requestId + method + target.
        return (ConvertTo-WhResponse $RequestId $Method $identity.outcome @{ target = $target } $identity.error)
      }
      $maxWidth = 240
      $maxHeight = 135
      if ($Request.ContainsKey('maxWidth')) { $maxWidth = [int]$Request['maxWidth'] }
      if ($Request.ContainsKey('maxHeight')) { $maxHeight = [int]$Request['maxHeight'] }
      $entry = Resolve-WhSessionToken $target
      # 040I: 48x48 is the private post-selection icon request. It is kept on
      # the existing strictly correlated thumbnail envelope, but resolves only
      # the window/class icon and never captures full window content. Crucially,
      # this happens per selected member after commit—not during `list`.
      $capture = if ($maxWidth -eq 48 -and $maxHeight -eq 48) {
        Get-WhWindowIcon ([IntPtr]$entry.hwnd) $maxWidth $maxHeight
      } else {
        Get-WhWindowThumbnail ([IntPtr]$entry.hwnd) $maxWidth $maxHeight
      }
      if ($capture.outcome -ne 'success') {
        return (ConvertTo-WhResponse $RequestId $Method ([string]$capture.outcome) @{ target = $target } ([string]$capture.error))
      }
      $thumb = [ordered]@{
        image = [string]$capture.image
        width = [int]$capture.width
        height = [int]$capture.height
      }
      # 024: pass the honest capture source ('capture' | 'icon') and the window
      # state at capture time through to the client so minimized / acad-like
      # icon fallbacks are presented correctly.
      if ($capture.ContainsKey('source')) { $thumb['source'] = [string]$capture.source }
      if ($capture.ContainsKey('minimized')) { $thumb['minimized'] = [bool]$capture.minimized }
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ thumbnail = $thumb; target = $target } $null)
    }
    if ($Method -eq 'uncloak') {
      # A cloaked window is intentionally absent from task-worthy enumeration.
      # The still-issued session token plus live HWND are the bounded gate.
      $entry = Resolve-WhSessionToken $target
      $runtimeId = [IntPtr]$entry.hwnd
      if (-not (Test-WhWindowAlive $runtimeId)) {
        return (ConvertTo-WhResponse $RequestId $Method 'missing' $null 'window is gone')
      }
      Uncloak-WhWindow $runtimeId
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ observation = (Get-WhResponseObservation $target) } $null)
    }
    # ---- mutations: identity gate BEFORE any native act -------------------
    $identity = Test-WhTokenIdentity $target
    if (-not $identity.ok) {
      return (ConvertTo-WhResponse $RequestId $Method $identity.outcome $null $identity.error)
    }
    $entry = Resolve-WhSessionToken $target
    $runtimeId = [IntPtr]$entry.hwnd
    if ($Method -eq 'minimize') {
      Minimize-WhWindow $runtimeId
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ observation = (Get-WhResponseObservation $target) } $null)
    }
    if ($Method -eq 'restore') {
      Restore-WhWindow $runtimeId
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ observation = (Get-WhResponseObservation $target) } $null)
    }
    if ($Method -eq 'cloak') {
      Cloak-WhWindow $runtimeId
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ observation = (Get-WhResponseObservation $target) } $null)
    }
    if ($Method -eq 'apply') {
      $b = $Request['bounds']
      $x = [Math]::Round([double]$b['x'], 0, [MidpointRounding]::AwayFromZero)
      $y = [Math]::Round([double]$b['y'], 0, [MidpointRounding]::AwayFromZero)
      $w = [Math]::Round([double]$b['width'], 0, [MidpointRounding]::AwayFromZero)
      $h = [Math]::Round([double]$b['height'], 0, [MidpointRounding]::AwayFromZero)
      # 016: never move a window offscreen - clamp into a visible monitor
      # work area (minimum usable size) before applying.
      $clamped = ConvertTo-WhClampedBounds ([int]$x) ([int]$y) ([int]$w) ([int]$h) (Get-WhMonitorWorkAreas)
      Set-WhWindowBounds $runtimeId $clamped.x $clamped.y $clamped.width $clamped.height
      return (ConvertTo-WhResponse $RequestId $Method 'success' @{ observation = (Get-WhResponseObservation $target) } $null)
    }
    if ($Method -eq 'close') {
      Close-ResolvedWhMember $runtimeId
      return (ConvertTo-WhResponse $RequestId $Method 'success' $null $null)
    }
    return (ConvertTo-WhResponse $RequestId $Method 'denied' $null 'method not permitted')
  } catch {
    # 019GR4: an unexpected exception from an accepted THUMBNAIL capture must
    # still echo the exact accepted target, so the strict parser/client can
    # correlate requestId + method + target instead of timing out on a
    # target-less denied envelope. All other methods keep the null payload.
    $payload = $null
    if ($Method -eq 'thumbnail' -and $target -is [string] -and $target.Length -gt 0) {
      $payload = @{ target = $target }
    }
    return (ConvertTo-WhResponse $RequestId $Method 'denied' $payload (Get-BoundedErrorText $_))
  }
}

# Handle one raw input line: returns the response hashtable to write, or
# $null when the line is ignored (empty, unparseable, invalid id/method).
function Invoke-WhRequestLine {
  param([string]$Line)
  if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
  try {
    $parsed = $Line | ConvertFrom-Json
    $parsed = ConvertTo-PsHashtable $parsed
  } catch {
    return $null
  }
  $shape = Test-WhRequestShape $parsed
  if ($null -eq $shape) { return $null }
  if (-not $shape.Valid) { return $shape.Response }
  return (Invoke-WhRequest $parsed $shape.RequestId $shape.Method)
}

# ---- long-lived loop ------------------------------------------------------
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while (($inputLine = [Console]::In.ReadLine()) -ne $null) {
  $response = Invoke-WhRequestLine $inputLine
  if ($response -ne $null) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $response -Compress -Depth 10))
    [Console]::Out.Flush()
  }
}
