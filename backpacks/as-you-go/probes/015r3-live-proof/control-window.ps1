param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0
)

# Harness-side window control for the 015R3 live proof. Reuses the reviewed
# 009/013 adapter (window-capability.ps1): every command resolves the target
# by EXACT title, fail-closed on zero/multiple matches, and acts only on the
# resolved runtime id. Output is one compact JSON line on stdout.

$ErrorActionPreference = 'Stop'

. 'D:\Letters\MatTroiSeConMoc\Papers\Backpack projects\As you Go\probes\native-window\window-capability.ps1'

$target = Resolve-AygTarget -Predicate { param($observation) $observation.Title -eq $Title }

switch ($Action) {
  'topmost' {
    # Bring the resolved target to the top of the z-order without moving,
    # resizing, activating or otherwise changing it - used by the direct-pick
    # proof so the hovered target is above the harness host window.
    [void][AYG.Win32]::SetWindowPos($target.RuntimeId, [IntPtr](New-Object System.IntPtr -ArgumentList (-1)), 0, 0, 0, 0,
      0x0001 -bor 0x0002 -bor 0x0010)
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'get-state' {
    @{ ok = $true; state = (Get-AygWindowState $target.RuntimeId) } | ConvertTo-Json -Compress
    break
  }
  'get-bounds' {
    $bounds = Get-AygWindowBounds $target.RuntimeId
    @{ ok = $true; x = $bounds.Left; y = $bounds.Top; width = $bounds.Width; height = $bounds.Height }
      | ConvertTo-Json -Compress
    break
  }
  'minimize' {
    Minimize-AygWindow $target.RuntimeId
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'restore' {
    Restore-AygWindow $target.RuntimeId
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'move' {
    Set-AygWindowBounds $target.RuntimeId $X $Y $Width $Height
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'hover-point' {
    # 016: place the cursor at a screen point and click there with real
    # input (direct-pick overlay + real click path).
    [void][AYG.Win32]::SetCursorPos($X, $Y)
    Start-Sleep -Milliseconds 250
    [AYG.Win32]::mouse_event([AYG.Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [AYG.Win32]::mouse_event([AYG.Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'move-only' {
    # 016R: place the cursor at a screen point with real input and DO NOT
    # click - used to probe a point for production-null hover before the
    # blank-click proof (a real click during probing would end the session).
    [void][AYG.Win32]::SetCursorPos($X, $Y)
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'get-cursor' {
    $point = New-Object AYG.POINT
    [void][AYG.Win32]::GetCursorPos([ref]$point)
    @{ ok = $true; x = $point.X; y = $point.Y } | ConvertTo-Json -Compress
    break
  }
  'right-click' {
    # 016R: real OS right-click at the current cursor point (blank/owned
    # areas must cancel the production pick session via the overlay page).
    [AYG.Win32]::mouse_event([AYG.Win32]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [AYG.Win32]::mouse_event([AYG.Win32]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [IntPtr]::Zero)
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'escape' {
    # 016R: real OS Escape key to the foreground window (the production
    # overlay owns keyboard focus during a pick session).
    [AYG.Win32]::keybd_event([AYG.Win32]::VK_ESCAPE, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [AYG.Win32]::keybd_event([AYG.Win32]::VK_ESCAPE, 0, [AYG.Win32]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  'get-show' {
    # 016R: visibility/show-state of the resolved target (IsWindowVisible).
    $visible = [AYG.Win32]::IsWindowVisible($target.RuntimeId)
    $iconic = [AYG.Win32]::IsIconic($target.RuntimeId)
    @{ ok = $true; visible = $visible; iconic = $iconic } | ConvertTo-Json -Compress
    break
  }
  'get-foreground' {
    $hwnd = [AYG.Win32]::GetForegroundWindow()
    $obs = Get-AygWindowObservation $hwnd
    @{ ok = $true; hwnd = $hwnd.ToString(); pid = $obs.ProcessId; title = $obs.Title } | ConvertTo-Json -Compress
    break
  }
  'close' {
    Close-ResolvedAygMember $target.RuntimeId
    @{ ok = $true } | ConvertTo-Json -Compress
    break
  }
  default {
    throw "AYG-FAIL-CLOSED: unknown action '$Action'."
  }
}
