param(
  [Parameter(Mandatory = $true)][ValidateSet('context','focus-process','bounds-process','window-at-point','key-state','left-up','move','sendinput-move','left-click','drag','ctrl-shift-down','ctrl-shift-up','enter','escape','snapshot')][string]$Action,
  [int]$X = 0,
  [int]$Y = 0
  ,[int]$X2 = 0
  ,[int]$Y2 = 0
  ,[int]$Steps = 16
  ,[int]$ProcessId = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AygNativeInput045 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr extraInfo; }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
'@
function Snapshot {
  $p = New-Object AygNativeInput045+POINT
  [void][AygNativeInput045]::GetCursorPos([ref]$p)
  @{ x = $p.X; y = $p.Y } | ConvertTo-Json -Compress
}
function Context {
  $desktop = [AygNativeInput045]::OpenInputDesktop(0, $false, 0x0100)
  $desktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  $foreground = [AygNativeInput045]::GetForegroundWindow()
  [uint32]$foregroundPid = 0
  [void][AygNativeInput045]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  @{ session = $env:SESSIONNAME; sessionId = $env:SESSIONID; user = $identity.Name; integrity = $identity.Label.Value; elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); inputDesktop = ($desktop -ne [IntPtr]::Zero); inputDesktopError = $desktopError; foreground = $foreground.ToInt64(); foregroundPid = $foregroundPid; cursor = (Snapshot | ConvertFrom-Json) } | ConvertTo-Json -Compress
}
switch ($Action) {
  'context' { Context }
  'focus-process' { $process = Get-Process -Id $ProcessId -ErrorAction Stop; if ($process.MainWindowHandle -eq 0) { throw "process has no main window: $ProcessId" }; $ok = [AygNativeInput045]::SetForegroundWindow($process.MainWindowHandle); Start-Sleep -Milliseconds 150; @{ ok = $ok; processId = $ProcessId; hwnd = $process.MainWindowHandle.ToInt64(); foreground = [AygNativeInput045]::GetForegroundWindow().ToInt64() } | ConvertTo-Json -Compress }
  'bounds-process' { $process = Get-Process -Id $ProcessId -ErrorAction Stop; $rect = New-Object AygNativeInput045+RECT; $ok = [AygNativeInput045]::GetWindowRect($process.MainWindowHandle, [ref]$rect); @{ ok = $ok; processId = $ProcessId; hwnd = $process.MainWindowHandle.ToInt64(); left = $rect.left; top = $rect.top; right = $rect.right; bottom = $rect.bottom } | ConvertTo-Json -Compress }
  'window-at-point' { $pt = New-Object AygNativeInput045+POINT; $pt.X = $X; $pt.Y = $Y; $hwnd = [AygNativeInput045]::WindowFromPoint($pt); [uint32]$pidAt = 0; if ($hwnd -ne [IntPtr]::Zero) { [void][AygNativeInput045]::GetWindowThreadProcessId($hwnd, [ref]$pidAt) }; @{ hwnd = $hwnd.ToInt64(); processId = $pidAt; x = $X; y = $Y } | ConvertTo-Json -Compress }
  'key-state' { $c = [AygNativeInput045]::GetAsyncKeyState(0x11); $s = [AygNativeInput045]::GetAsyncKeyState(0x10); $sp = [AygNativeInput045]::GetAsyncKeyState(0x20); $a = [AygNativeInput045]::GetAsyncKeyState(0x12); $lb = [AygNativeInput045]::GetAsyncKeyState(0x01); @{ ctrl = ($c -lt 0); shift = ($s -lt 0); space = ($sp -lt 0); alt = ($a -lt 0); lButton = ($lb -lt 0) } | ConvertTo-Json -Compress }
  'move' { $ok = [AygNativeInput045]::SetCursorPos($X, $Y); @{ ok = $ok; error = if ($ok) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }; cursor = (Snapshot | ConvertFrom-Json) } | ConvertTo-Json -Compress }
  'sendinput-move' { $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $mx = [Math]::Max(0, [Math]::Min(65535, [Math]::Round(($X * 65535) / [Math]::Max(1, $screen.Width - 1)))); $my = [Math]::Max(0, [Math]::Min(65535, [Math]::Round(($Y * 65535) / [Math]::Max(1, $screen.Height - 1)))); $input = New-Object AygNativeInput045+INPUT; $input.type = 0; $input.mi.dx = $mx; $input.mi.dy = $my; $input.mi.dwFlags = 0x8001; $sent = [AygNativeInput045]::SendInput(1, @($input), [Runtime.InteropServices.Marshal]::SizeOf($input)); @{ ok = ($sent -eq 1); sent = $sent; error = if ($sent -eq 1) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }; cursor = (Snapshot | ConvertFrom-Json) } | ConvertTo-Json -Compress }
  'left-up' { [AygNativeInput045]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; $lb = [AygNativeInput045]::GetAsyncKeyState(0x01); @{ lButton = ($lb -lt 0) } | ConvertTo-Json -Compress }
  'left-click' { [AygNativeInput045]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 55; [AygNativeInput045]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Snapshot }
  'drag' {
    $ok1 = [AygNativeInput045]::SetCursorPos($X, $Y)
    Start-Sleep -Milliseconds 40
    [AygNativeInput045]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
    Start-Sleep -Milliseconds 40
    $n = [Math]::Max(2, $Steps)
    for ($i = 1; $i -le $n; $i++) {
      $tx = [int][Math]::Round($X + (($X2 - $X) * $i / $n))
      $ty = [int][Math]::Round($Y + (($Y2 - $Y) * $i / $n))
      [AygNativeInput045]::SetCursorPos($tx, $ty) | Out-Null
      Start-Sleep -Milliseconds 12
    }
    Start-Sleep -Milliseconds 40
    [AygNativeInput045]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
    $endPoint = New-Object AygNativeInput045+POINT
    $okEnd = [AygNativeInput045]::GetCursorPos([ref]$endPoint)
    @{ ok = ($ok1 -and $okEnd); fromX = $X; fromY = $Y; toX = $X2; toY = $Y2; endX = $endPoint.X; endY = $endPoint.Y; cursor = (Snapshot | ConvertFrom-Json) } | ConvertTo-Json -Compress
  }
  'ctrl-shift-down' { [AygNativeInput045]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [AygNativeInput045]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero); Snapshot }
  'ctrl-shift-up' { [AygNativeInput045]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero); [AygNativeInput045]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero); Snapshot }
  'enter' { [AygNativeInput045]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 55; [AygNativeInput045]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero); Snapshot }
  'escape' { [AygNativeInput045]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 55; [AygNativeInput045]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero); Snapshot }
  'snapshot' { Snapshot }
}
