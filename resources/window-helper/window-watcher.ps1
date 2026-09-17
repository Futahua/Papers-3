# Papers-owned event-driven top-level window lifecycle watcher.
#
# This is intentionally a separate process from window-helper.ps1.  It never
# accepts commands on stdin and never exposes HWNDs: it emits a bounded JSON
# lifecycle stream on stdout.  A WinEvent hook is installed before the first
# enumeration; events raised during that enumeration are buffered and flushed
# after the complete baseline marker, so a newly-created window cannot be lost
# in the startup race.
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/window-capability.ps1"

if (-not ('WW.Win32' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace WW {
  public delegate void WinEventDelegate(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
  public static class Win32 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventDelegate callback, uint pid, uint thread, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWinEvent(IntPtr hook);
    public const uint EVENT_OBJECT_CREATE = 0x8000;
    public const uint EVENT_OBJECT_SHOW = 0x8002;
    public const uint EVENT_OBJECT_DESTROY = 0x8001;
    public const uint EVENT_MIN = EVENT_OBJECT_CREATE;
    public const uint EVENT_MAX = EVENT_OBJECT_SHOW;
    public const uint WINEVENT_OUTOFCONTEXT = 0;
    public const int OBJID_WINDOW = 0;
  }
}
'@
}

$queue = [System.Collections.Concurrent.ConcurrentQueue[object]]::new()
$callback = [WW.WinEventDelegate]{
  param([IntPtr]$hook, [uint32]$eventType, [IntPtr]$hwnd, [int]$idObject, [int]$idChild, [uint32]$threadId, [uint32]$timestamp)
  if ($hwnd -ne [IntPtr]::Zero -and $idObject -eq [WW.Win32]::OBJID_WINDOW -and $idChild -eq 0) {
    $kind = if ($eventType -eq [WW.Win32]::EVENT_OBJECT_DESTROY) { 'destroy' } else { 'upsert' }
    $queue.Enqueue([pscustomobject]@{ kind = $kind; hwnd = $hwnd.ToInt64() })
  }
}

function Emit([object]$value) {
  $json = $value | ConvertTo-Json -Compress -Depth 8
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function SafeObservation([IntPtr]$hwnd) {
  try {
    $observation = Get-WhWindowObservation $hwnd
    if (-not (Test-WhTaskWorthy $observation)) { return $null }
    return [pscustomobject]@{
      windowInstanceId = $observation.WindowInstanceId
      title = [string]$observation.Title
      processId = [int]$observation.ProcessId
      processPath = if ($observation.ProcessPath) { [string]$observation.ProcessPath } else { $null }
      windowClass = [string]$observation.ClassName
      state = [string]$observation.State
      bounds = if ($observation.Bounds) { @{ x = [int]$observation.Bounds.Left; y = [int]$observation.Bounds.Top; width = [int]$observation.Bounds.Width; height = [int]$observation.Bounds.Height } } else { $null }
    }
  } catch { return $null }
}

$hook = [WW.Win32]::SetWinEventHook(
  [WW.Win32]::EVENT_MIN, [WW.Win32]::EVENT_MAX, [IntPtr]::Zero,
  $callback, 0, 0, [WW.Win32]::WINEVENT_OUTOFCONTEXT)
if ($hook -eq [IntPtr]::Zero) { throw 'window lifecycle hook could not be installed' }

$trackerSessionId = 'L' + [guid]::NewGuid().ToString('N')
$sequence = 0L
$known = @{}
try {
  # Hook is live.  Build and emit the complete baseline now.
  $baseline = @{}
  foreach ($observation in @(Get-WhVisibleWindows | Where-Object { Test-WhTaskWorthy $_ })) {
    $instanceId = [string]$observation.WindowInstanceId
    if ([string]::IsNullOrWhiteSpace($instanceId)) { continue }
    $hwndKey = ([IntPtr]$observation.RuntimeId).ToInt64().ToString()
    $known[$hwndKey] = $instanceId
    $safe = SafeObservation ([IntPtr]$observation.RuntimeId)
    if ($null -ne $safe) { $baseline[$instanceId] = $safe }
  }
  $sequence += 1
  Emit ([pscustomobject]@{ type = 'baseline'; trackerSessionId = $trackerSessionId; sequence = $sequence; complete = $true; windows = @($baseline.Values) })

  while ($true) {
    $item = $null
    while ($queue.TryDequeue([ref]$item)) {
      $hwnd = [IntPtr]::new([int64]$item.hwnd)
      $hwndKey = $item.hwnd.ToString()
      $sequence += 1
      if ($item.kind -eq 'destroy') {
        $instanceId = $known[$hwndKey]
        $known.Remove($hwndKey)
        if ($instanceId) {
          Emit ([pscustomobject]@{ type = 'event'; trackerSessionId = $trackerSessionId; sequence = $sequence; kind = 'destroy'; windowInstanceId = [string]$instanceId })
        }
      } else {
        $safe = SafeObservation $hwnd
        if ($null -ne $safe -and $safe.windowInstanceId) {
          $known[$hwndKey] = [string]$safe.windowInstanceId
          Emit ([pscustomobject]@{ type = 'event'; trackerSessionId = $trackerSessionId; sequence = $sequence; kind = 'upsert'; windowInstanceId = [string]$safe.windowInstanceId; observation = $safe })
        }
      }
      $item = $null
    }
    Start-Sleep -Milliseconds 50
  }
} finally {
  [void][WW.Win32]::UnhookWinEvent($hook)
}
