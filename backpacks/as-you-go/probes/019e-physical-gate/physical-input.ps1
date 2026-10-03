param(
  [Parameter(Mandatory = $true)][ValidateSet('snapshot', 'move', 'left-click', 'focus', 'focus-hwnd', 'space', 'enter', 'escape', 'restore')][string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Hwnd = '0',
  [int]$ProcessId = 0,
  [string]$CreationDate = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AygPhysicalInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scan, uint flags, UIntPtr extraInfo);
}
'@ -ErrorAction SilentlyContinue

function Get-AygPhysicalSnapshot {
  $point = New-Object AygPhysicalInput+POINT
  [void][AygPhysicalInput]::GetCursorPos([ref]$point)
  $foreground = [AygPhysicalInput]::GetForegroundWindow()
  [uint32]$foregroundPid = 0
  [void][AygPhysicalInput]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $title = New-Object System.Text.StringBuilder 512
  [void][AygPhysicalInput]::GetWindowText($foreground, $title, $title.Capacity)
  $creation = ''
  if ($foregroundPid -ne 0) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$foregroundPid" -ErrorAction SilentlyContinue
    if ($process) { $creation = $process.CreationDate.ToString('o') }
  }
  return @{
    ok = $true
    cursor = @{ x = $point.X; y = $point.Y }
    foreground = @{
      hwnd = $foreground.ToInt64().ToString()
      pid = [int]$foregroundPid
      creationDate = $creation
      title = $title.ToString().Substring(0, [Math]::Min(120, $title.Length))
    }
  }
}

switch ($Action) {
  'snapshot' {
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'move' {
    if (-not [AygPhysicalInput]::SetCursorPos($X, $Y)) { throw 'SetCursorPos failed.' }
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'left-click' {
    [AygPhysicalInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 55
    [AygPhysicalInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'focus' {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.CreationDate -or $process.CreationDate.ToString('o') -ne $CreationDate) {
      throw "refusing native focus for PID/CreationDate mismatch: $ProcessId/$CreationDate"
    }
    $window = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $window -or $window.MainWindowHandle -eq 0) { throw "isolated process has no main window: $ProcessId" }
    if (-not [AygPhysicalInput]::SetForegroundWindow($window.MainWindowHandle)) { throw "SetForegroundWindow failed: $ProcessId" }
    Start-Sleep -Milliseconds 80
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'focus-hwnd' {
    [long]$rawHwnd = 0
    if (-not [long]::TryParse($Hwnd, [ref]$rawHwnd) -or $rawHwnd -eq 0) { throw "invalid native HWND: $Hwnd" }
    $handle = [IntPtr]$rawHwnd
    if (-not [AygPhysicalInput]::IsWindow($handle)) { throw "native HWND is not alive: $Hwnd" }
    [uint32]$livePid = 0
    [void][AygPhysicalInput]::GetWindowThreadProcessId($handle, [ref]$livePid)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$livePid" -ErrorAction SilentlyContinue
    if (-not $process -or $process.CreationDate.ToString('o') -ne $CreationDate -or [int]$livePid -ne $ProcessId) {
      throw "refusing native HWND focus for PID/CreationDate mismatch: $Hwnd/$ProcessId/$CreationDate"
    }
    if (-not [AygPhysicalInput]::SetForegroundWindow($handle)) { throw "SetForegroundWindow failed: $Hwnd" }
    Start-Sleep -Milliseconds 80
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'space' {
    [AygPhysicalInput]::keybd_event(0x20, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [AygPhysicalInput]::keybd_event(0x20, 0, 0x0002, [UIntPtr]::Zero)
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress
  }
  'enter' {
    [AygPhysicalInput]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [AygPhysicalInput]::keybd_event(0x0D, 0, 0x0002, [UIntPtr]::Zero)
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'escape' {
    [AygPhysicalInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [AygPhysicalInput]::keybd_event(0x1B, 0, 0x0002, [UIntPtr]::Zero)
    Get-AygPhysicalSnapshot | ConvertTo-Json -Compress -Depth 5
  }
  'restore' {
    $cursorRestored = [AygPhysicalInput]::SetCursorPos($X, $Y)
    $foregroundRestored = $false
    $reason = 'no captured foreground identity'
    [long]$rawHwnd = 0
    if ([long]::TryParse($Hwnd, [ref]$rawHwnd) -and $rawHwnd -ne 0 -and $ProcessId -gt 0 -and $CreationDate) {
      $handle = [IntPtr]$rawHwnd
      [uint32]$livePid = 0
      if ([AygPhysicalInput]::IsWindow($handle)) {
        [void][AygPhysicalInput]::GetWindowThreadProcessId($handle, [ref]$livePid)
        $live = Get-CimInstance Win32_Process -Filter "ProcessId=$livePid" -ErrorAction SilentlyContinue
        if ($live -and [int]$livePid -eq $ProcessId -and $live.CreationDate.ToString('o') -eq $CreationDate) {
          $foregroundRestored = [AygPhysicalInput]::SetForegroundWindow($handle)
          $reason = if ($foregroundRestored) { 'exact HWND/PID/CreationDate restored' } else { 'SetForegroundWindow was denied by Windows' }
        } else {
          $reason = 'captured foreground identity no longer matches'
        }
      } else {
        $reason = 'captured foreground HWND no longer exists'
      }
    }
    @{ ok = $true; cursorRestored = $cursorRestored; foregroundRestored = $foregroundRestored; reason = $reason } | ConvertTo-Json -Compress
  }
}
