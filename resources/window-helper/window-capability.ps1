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

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

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

        public const int SW_MINIMIZE = 6;
        public const int SW_RESTORE = 9;
        public const int WM_CLOSE = 0x0010;
        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
    }
}
'@
}

# The live runtime operations. Commands route through this table, so fake
# tests can replace it with a deterministic in-memory registry.
$script:WhOps = @{
  IsWindow = { param([IntPtr]$id) [WH.Win32]::IsWindow($id) }
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
