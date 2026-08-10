# Papers-owned narrow native window capability adapter (window helper).
#
# One small typed boundary: enumerate visible top-level user windows,
# resolve exactly one target fail-closed, read/write bounds and state,
# and gracefully close an already resolved member. Two seams make the
# contract deterministically testable:
#   - WindowSource (scriptblock): where observations come from.
#   - $script:WhOps (hashtable): the runtime operations, so fake tests can
#     prove command routing without any live window.
#
# Behavior is LOCKED to the accepted protocol snapshot 013R5F (see
# manifest.json in this directory): do not drift without a reviewed
# protocol change.
#
# Safety invariants:
# - The adapter never executes arbitrary commands; it exposes only typed
#   window operations. There is no exec/eval path.
# - HWNDs are ephemeral runtime ids only; nothing here persists identity.
# - Resolve-WhTarget returns at most one match and refuses zero/multiple.
# - Close-ResolvedWhMember is the narrow graceful-close request
#   and requires an already resolved runtime member; it is proven only
#   against the disposable target during cleanup.
#
# Requires: Windows PowerShell 5.1 or PowerShell 7 + Windows Desktop
# (System.Windows.Forms for the Win32 P/Invoke surface; no other
# dependency). Proven on both runtimes by the accepted live matrix.

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

if (-not ('WH.Win32' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace WH
{
    public struct Rect { public int Left, Top, Right, Bottom; }
    public struct POINT { public int X, Y; }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFO
    {
        public uint cbSize;
        public Rect rcMonitor;
        public Rect rcWork;
        public uint dwFlags;
    }

    public static class Win32
    {
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int w, int h, uint flags);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out int pvAttribute, int cbAttribute);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
        [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT pt);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        public const int SW_MINIMIZE = 6;
        public const int SW_RESTORE = 9;
        public const int WM_CLOSE = 0x0010;
        public const int DWMWA_CLOAKED = 14;
        public const uint GW_OWNER = 4;
        public const uint GA_ROOT = 2;
        public const int GWL_EXSTYLE = -20;
        public const long WS_EX_TOOLWINDOW = 0x00000080;
        public const long WS_EX_NOACTIVATE = 0x08000000;
        public const uint MONITORINFOF_PRIMARY = 1;
        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
    }
}
'@
}

# Cached helper-parent process id (Papers main) for hover-through exclusion.
# The cache MUST start as $null: the ParentPid op queries WMI once on first
# use and caches the result. An initial 0 would short-circuit that query and
# permanently disable the parent exclusion (016R live proof: the pick overlay
# is owned by the helper's parent, so a broken exclusion makes the overlay
# itself win every hover, which the main process then nulls -> every pick
# reports "nothing eligible is under the pointer").
$script:WhParentPid = $null

# The live runtime operations. Commands route through this table, so fake
# tests can replace it with a deterministic in-memory registry.
$script:WhOps = @{
  IsWindow = { param([IntPtr]$id) [WH.Win32]::IsWindow($id) }
  Visible = { param([IntPtr]$id) [WH.Win32]::IsWindowVisible($id) }
  State = { param([IntPtr]$id) (Get-WhWindowObservation $id).State }
  Bounds = { param([IntPtr]$id) (Get-WhWindowObservation $id).Bounds }
  SetBounds = { param([IntPtr]$id, [int]$x, [int]$y, [int]$w, [int]$h)
    if (-not [WH.Win32]::SetWindowPos($id, [WH.Win32]::HWND_TOP, $x, $y, $w, $h,
      [WH.Win32]::SWP_NOZORDER -bor [WH.Win32]::SWP_NOACTIVATE)) {
      throw "WH-COMMAND-ROUTING: SetWindowPos failed for runtime id $id."
    }
  }
  Minimize = { param([IntPtr]$id) [void][WH.Win32]::ShowWindow($id, [WH.Win32]::SW_MINIMIZE) }
  Restore = { param([IntPtr]$id) [void][WH.Win32]::ShowWindow($id, [WH.Win32]::SW_RESTORE) }
  Close = { param([IntPtr]$id) [void][WH.Win32]::PostMessage($id, [WH.Win32]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) }
  # ---- 016 direct-pick / task-worthiness seams (all injectable) -----------
  Cloaked = { param([IntPtr]$id)
    $cloak = 0
    [void][WH.Win32]::DwmGetWindowAttribute($id, [WH.Win32]::DWMWA_CLOAKED, [ref]$cloak, [Runtime.InteropServices.Marshal]::SizeOf([int]0))
    return $cloak -ne 0
  }
  ClassName = { param([IntPtr]$id)
    $name = New-Object System.Text.StringBuilder 256
    [void][WH.Win32]::GetClassName($id, $name, $name.Capacity)
    return $name.ToString()
  }
  ExStyle = { param([IntPtr]$id)
    if ([IntPtr]::Size -eq 8) { return [WH.Win32]::GetWindowLongPtr($id, [WH.Win32]::GWL_EXSTYLE).ToInt64() }
    return [long][WH.Win32]::GetWindowLong($id, [WH.Win32]::GWL_EXSTYLE)
  }
  OwnerHwnd = { param([IntPtr]$id) [WH.Win32]::GetWindow($id, [WH.Win32]::GW_OWNER) }
  RootAncestor = { param([IntPtr]$id) [WH.Win32]::GetAncestor($id, [WH.Win32]::GA_ROOT) }
  LastActivePopup = { param([IntPtr]$id) [WH.Win32]::GetLastActivePopup($id) }
  ProcessName = { param([IntPtr]$id)
    $pidValue = [uint32]0
    [void][WH.Win32]::GetWindowThreadProcessId($id, [ref]$pidValue)
    try { return (Get-Process -Id ([int]$pidValue) -ErrorAction Stop).ProcessName } catch { return '' }
  }
  Observation = { param([IntPtr]$id) (Get-WhWindowObservation $id) }
  ParentPid = {
    if ($null -eq $script:WhParentPid) {
      try { $script:WhParentPid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop).ParentProcessId } catch { $script:WhParentPid = 0 }
    }
    return [int]$script:WhParentPid
  }
  WindowAtPoint = { param([int]$x, [int]$y)
    $pt = New-Object WH.POINT
    $pt.X = $x
    $pt.Y = $y
    return [WH.Win32]::WindowFromPoint($pt)
  }
  Monitors = {
    try {
      $areas = @()
      foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
        $areas += @{
          Left = $screen.WorkingArea.Left; Top = $screen.WorkingArea.Top
          Right = $screen.WorkingArea.Right; Bottom = $screen.WorkingArea.Bottom
          Primary = $screen.Primary
        }
      }
      return @($areas)
    } catch {
      # A monitor enumeration failure must never kill the helper: degrade to
      # no work areas (the apply clamp then leaves bounds untouched).
      return @()
    }
  }
}

function Get-WhWindowObservation([IntPtr]$hWnd) {
  $title = New-Object System.Text.StringBuilder 512
  [void][WH.Win32]::GetWindowText($hWnd, $title, $title.Capacity)
  $pidValue = [uint32]0
  [void][WH.Win32]::GetWindowThreadProcessId($hWnd, [ref]$pidValue)
  $rect = New-Object WH.Rect
  $hasRect = [WH.Win32]::GetWindowRect($hWnd, [ref]$rect)
  $state = 'normal'
  if ([WH.Win32]::IsZoomed($hWnd)) { $state = 'maximized' }
  elseif ([WH.Win32]::IsIconic($hWnd)) { $state = 'minimized' }
  $processPath = $null
  try {
    $processPath = (Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue).Path
  } catch { }
  return [pscustomobject]@{
    RuntimeId = $hWnd
    ProcessId = [int]$pidValue
    ProcessPath = $processPath
    Title = $title.ToString()
    Bounds = if ($hasRect) { @{ Left = $rect.Left; Top = $rect.Top; Right = $rect.Right; Bottom = $rect.Bottom; Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top } } else { $null }
    State = $state
  }
}

# Enumerate visible top-level windows. `WindowSource` is injectable for the
# fake tests: it returns an array of observations.
function Get-WhVisibleWindows {
  param([scriptblock]$WindowSource)
  if ($WindowSource) { return @(& $WindowSource) }
  $result = [System.Collections.Generic.List[object]]::new()
  $callback = [WH.EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ([WH.Win32]::IsWindowVisible($hWnd)) {
      $result.Add((Get-WhWindowObservation $hWnd))
    }
    return $true
  }
  [void][WH.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  return @($result)
}

# Resolve exactly one window matching `Predicate` (scriptblock taking an
# observation). Returns the single match; throws on zero or multiple. This is
# the only way a window becomes routable through the adapter.
function Resolve-WhTarget {
  param(
    [scriptblock]$Predicate,
    [scriptblock]$WindowSource
  )
  $matches = @(Get-WhVisibleWindows -WindowSource $WindowSource | Where-Object { & $Predicate $_ })
  if ($matches.Count -eq 0) { throw "WH-FAIL-CLOSED: no window matched the predicate." }
  if ($matches.Count -gt 1) { throw "WH-FAIL-CLOSED: $($matches.Count) windows matched; refusing to guess." }
  return $matches[0]
}

# Fail-closed "is this still the window we resolved?" check.
function Test-WhWindowAlive([IntPtr]$RuntimeId) {
  return $RuntimeId -ne [IntPtr]::Zero -and (& $script:WhOps['IsWindow'] $RuntimeId)
}

function Get-WhWindowState([IntPtr]$RuntimeId) {
  return & $script:WhOps['State'] $RuntimeId
}

function Get-WhWindowBounds([IntPtr]$RuntimeId) {
  $bounds = & $script:WhOps['Bounds'] $RuntimeId
  if ($null -eq $bounds) { throw "WH-COMMAND-ROUTING: no bounds for runtime id $RuntimeId." }
  return $bounds
}

function Set-WhWindowBounds([IntPtr]$RuntimeId, [int]$X, [int]$Y, [int]$Width, [int]$Height) {
  & $script:WhOps['SetBounds'] $RuntimeId $X $Y $Width $Height
}

function Minimize-WhWindow([IntPtr]$RuntimeId) {
  & $script:WhOps['Minimize'] $RuntimeId
}

function Restore-WhWindow([IntPtr]$RuntimeId) {
  & $script:WhOps['Restore'] $RuntimeId
}

# Addendum: the narrow graceful-close request for an already resolved runtime
# member. Only posted to the resolved id; never exposed as a general close.
function Close-ResolvedWhMember([IntPtr]$RuntimeId) {
  if (-not (Test-WhWindowAlive $RuntimeId)) {
    throw "WH-FAIL-CLOSED: runtime member is gone; refusing close."
  }
  & $script:WhOps['Close'] $RuntimeId
}

# ---- 016: task-worthiness (helper-owned eligibility) ----------------------
# A task-worthy window is what the Alt-Tab/taskbar concept means: an ordinary
# application surface the creator can actually act on. Visibility plus a
# title is not enough (the creator's picker leaked system surfaces), so the
# predicate uses trusted native metadata only - never title blacklists:
# - DWM-cloaked surfaces (duplicate/background UWP surfaces) are excluded;
# - the shell desktop/worker surfaces (Progman/WorkerW classes) are excluded;
# - tool/no-activate auxiliary windows (WS_EX_TOOLWINDOW / WS_EX_NOACTIVATE)
#   are excluded;
# - owned windows whose root-owner's last-active popup is a DIFFERENT window
#   are excluded (they are not the app's active surface);
# - TextInputHost-style system input UI is excluded by process identity;
# - legitimate minimized application windows stay eligible.
function Test-WhTaskWorthy {
  param([object]$Observation)
  if ($null -eq $Observation) { return $false }
  $id = [IntPtr]$Observation.RuntimeId
  if (-not (& $script:WhOps['IsWindow'] $id)) { return $false }
  if (-not (& $script:WhOps['Visible'] $id)) { return $false }
  if (& $script:WhOps['Cloaked'] $id) { return $false }
  $exStyle = [long](& $script:WhOps['ExStyle'] $id)
  if (($exStyle -band [WH.Win32]::WS_EX_TOOLWINDOW) -ne 0L -or
      ($exStyle -band [WH.Win32]::WS_EX_NOACTIVATE) -ne 0L) { return $false }
  $className = [string](& $script:WhOps['ClassName'] $id)
  if ($className -eq 'Progman' -or $className -eq 'WorkerW') { return $false }
  $processName = [string](& $script:WhOps['ProcessName'] $id)
  if ($processName -eq 'TextInputHost') { return $false }
  # Every Papers application window is excluded STRUCTURALLY by executable
  # identity (the packaged Papers.exe reports the process name 'Papers'), not
  # by title; the current test instance is excluded separately by the
  # helper-parent PID in hover. Legitimate Electron applications (Code, etc.)
  # keep their own names and stay eligible.
  if ($processName -eq 'Papers') { return $false }
  $owner = [IntPtr](& $script:WhOps['OwnerHwnd'] $id)
  if ($owner -ne [IntPtr]::Zero) {
    $root = [IntPtr](& $script:WhOps['RootAncestor'] $id)
    $lastActivePopup = [IntPtr](& $script:WhOps['LastActivePopup'] $root)
    if ($lastActivePopup -ne $id) { return $false }
  }
  return $true
}

# Direct onscreen pick resolution: the topmost TASK-WORTHY window at a point,
# resolving THROUGH Papers-owned surfaces (the pick overlay and the Papers
# host window are always frontmost, so WindowFromPoint alone would return
# them). Enumeration is front-to-back (EnumWindows z-order); windows owned by
# the helper's parent process (Papers main) are excluded by process identity.
# Returns the observation or $null; there is no fallback to a different
# window (fail closed).
#
# 016R2 direct-pick identity parity (RoketPuncha lane): when the topmost
# surface at the point is an OWNED surface whose same-process root is present
# and task-worthy, resolve to the ROOT task observation - the exact identity
# the list keeps (Merge-WhTaskSurfaces). The point may lie on a popup area
# outside the root's bounds; the root task is still the member the layout
# records. Two ownerless documents of one application share no owner chain,
# so each resolves to itself.
function Resolve-WhTaskWindowAtPoint {
  param([int]$X, [int]$Y)
  $parentPid = [int](& $script:WhOps['ParentPid'])
  $observations = @(Get-WhVisibleWindows | Where-Object {
    (Test-WhTaskWorthy $_) -and ([int]$_.ProcessId -ne $parentPid)
  })
  foreach ($observation in $observations) {
    $bounds = $observation.Bounds
    if ($bounds -and $X -ge [int]$bounds.Left -and $X -lt [int]$bounds.Right -and
        $Y -ge [int]$bounds.Top -and $Y -lt [int]$bounds.Bottom) {
      $owner = [IntPtr](& $script:WhOps['OwnerHwnd'] $observation.RuntimeId)
      if ($owner -ne [IntPtr]::Zero) {
        $root = [IntPtr](& $script:WhOps['RootAncestor'] $observation.RuntimeId)
        $rootObservation = @($observations | Where-Object {
          $_.RuntimeId -eq $root -and $_.ProcessId -eq $observation.ProcessId
        } | Select-Object -First 1)
        if ($null -ne $rootObservation) { return $rootObservation }
      }
      return $observation
    }
  }
  return $null
}

# 016R gap 7 (Ning): same-task surface dedup for the picker LIST. When
# several task-worthy surfaces share one process and an owner chain (an
# owned popup/child surface and its root), they represent ONE task window:
# only the root is listed. Two genuine documents of one application share
# no owner chain and both stay listed.
function Merge-WhTaskSurfaces {
  param([object[]]$Observations)
  $owned = @{}
  foreach ($observation in $Observations) {
    $owner = [IntPtr](& $script:WhOps['OwnerHwnd'] $observation.RuntimeId)
    if ($owner -ne [IntPtr]::Zero) {
      $root = [IntPtr](& $script:WhOps['RootAncestor'] $observation.RuntimeId)
      $rootListed = $Observations | Where-Object { $_.RuntimeId -eq $root -and $_.ProcessId -eq $observation.ProcessId } | Select-Object -First 1
      if ($null -ne $rootListed) { $owned[[string]$observation.RuntimeId] = $true }
    }
  }
  return @($Observations | Where-Object { -not $owned.ContainsKey([string]$_.RuntimeId) })
}

# Live monitor WORK areas (primary flagged first for ties). Injectable via
# the Monitors op.
function Get-WhMonitorWorkAreas {
  return @(& $script:WhOps['Monitors'])
}

# Pure clamping policy (016 dispatch): translate/clamp a desired rectangle
# into a currently visible monitor work area with a minimum usable size, so a
# stale/disconnected-monitor rectangle can never move a window offscreen.
# Picks the monitor whose work area has the largest intersection with the
# desired rect (primary wins ties; a rect intersecting nothing goes to the
# primary), clamps the size to the work area (never below the minimum, which
# itself never exceeds the work area) and translates the origin inside the
# work area. Persisted intent is untouched - this is the runtime application.
function ConvertTo-WhClampedBounds {
  param(
    [int]$X, [int]$Y, [int]$Width, [int]$Height,
    [object[]]$WorkAreas,
    [int]$MinWidth = 160, [int]$MinHeight = 120
  )
  if (-not $WorkAreas -or $WorkAreas.Count -eq 0) {
    return @{ x = $X; y = $Y; width = $Width; height = $Height }
  }
  $best = $null
  $bestIntersection = -1L
  foreach ($area in $WorkAreas) {
    $areaLeft = [int]$area.Left; $areaTop = [int]$area.Top
    $areaRight = [int]$area.Right; $areaBottom = [int]$area.Bottom
    $interW = [Math]::Max(0, [Math]::Min($X + $Width, $areaRight) - [Math]::Max($X, $areaLeft))
    $interH = [Math]::Max(0, [Math]::Min($Y + $Height, $areaBottom) - [Math]::Max($Y, $areaTop))
    $intersection = [long]$interW * [long]$interH
    if ($intersection -gt $bestIntersection -or
        ($intersection -eq $bestIntersection -and $area.Primary -and $null -eq $best)) {
      $best = $area
      $bestIntersection = $intersection
    }
  }
  if ($null -eq $best) {
    return @{ x = $X; y = $Y; width = $Width; height = $Height }
  }
  $waLeft = [int]$best.Left; $waTop = [int]$best.Top
  $waWidth = [int]$best.Right - $waLeft
  $waHeight = [int]$best.Bottom - $waTop
  if ($waWidth -le 0 -or $waHeight -le 0) {
    return @{ x = $X; y = $Y; width = $Width; height = $Height }
  }
  $minWidth = [Math]::Min($MinWidth, $waWidth)
  $minHeight = [Math]::Min($MinHeight, $waHeight)
  $width = [Math]::Max($minWidth, [Math]::Min($Width, $waWidth))
  $height = [Math]::Max($minHeight, [Math]::Min($Height, $waHeight))
  $x = [Math]::Max($waLeft, [Math]::Min($X, $waLeft + $waWidth - $width))
  $y = [Math]::Max($waTop, [Math]::Min($Y, $waTop + $waHeight - $height))
  return @{ x = $x; y = $y; width = $width; height = $height }
}
