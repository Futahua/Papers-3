param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][int]$Width,
  [Parameter(Mandatory = $true)][int]$Height
)
# 035 live gate helper: resize the SMALLEST visible top-level window owned by
# the given (isolated Papers) process. The compact widget is the smallest
# visible window of the main process (the host + project frames are large), so
# resizing "the smallest" is unambiguous. Position and z-order are untouched.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$script:best = [IntPtr]::Zero
$script:bestArea = [long]::MaxValue
$callback = [Win32+EnumWindowsProc]{
  param($hWnd, $lParam)
  $procId = 0
  [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  if ($procId -eq $ProcessId -and [Win32]::IsWindowVisible($hWnd)) {
    $rect = New-Object Win32+RECT
    if ([Win32]::GetWindowRect($hWnd, [ref]$rect)) {
      $area = [long](($rect.Right - $rect.Left) * ($rect.Bottom - $rect.Top))
      if ($area -gt 0 -and $area -lt $script:bestArea) {
        $script:best = $hWnd
        $script:bestArea = $area
      }
    }
  }
  return $true
}
[void][Win32]::EnumWindows($callback, [IntPtr]::Zero)
if ($script:best -eq [IntPtr]::Zero) { Write-Error "no visible window found for pid $ProcessId"; exit 1 }
# SWP_NOMOVE (0x0002) | SWP_NOZORDER (0x0004) | SWP_NOACTIVATE (0x0010)
[void][Win32]::SetWindowPos($script:best, [IntPtr]::Zero, 0, 0, $Width, $Height, 0x0016)
Write-Output "resized $($script:best) to ${Width}x${Height}"
