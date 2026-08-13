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
Add-Type -AssemblyName System.Drawing

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

    [StructLayout(LayoutKind.Sequential)]
    public struct DWM_THUMBNAIL_PROPERTIES
    {
        public uint dwFlags;
        public Rect rcDestination;
        public Rect rcSource;
        public byte opacity;
        public bool fVisible;
        public bool fSourceClientAreaOnly;
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
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int dwAttribute, ref int pvAttribute, int cbAttribute);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
        [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT pt);
        [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "GetClassLongW")] public static extern int GetClassLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr hIcon, int cx, int cy, int istepIfAniCur, IntPtr hbrFlickerFreeDraw, uint diFlags);
        [DllImport("dwmapi.dll")] public static extern int DwmRegisterThumbnail(IntPtr hwndDestination, IntPtr hwndSource, out IntPtr phThumbnailId);
        [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr hThumbnailId, ref DWM_THUMBNAIL_PROPERTIES ptnProperties);
        [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr hThumbnailId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowExW(uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);
        [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
        [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, uint rop);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
        [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

        public const int SW_HIDE = 0;
        public const int SW_MINIMIZE = 6;
        public const int SW_SHOWNA = 8;
        public const int SW_SHOWNOACTIVATE = 4;
        public const int SW_RESTORE = 9;
        public const int WM_CLOSE = 0x0010;
        public const int DWMWA_CLOAKED = 14;
        public const int DWMWA_CLOAK = 13;
        public const uint GW_OWNER = 4;
        public const uint GA_ROOT = 2;
        public const int GWL_EXSTYLE = -20;
        public const int GCLP_HICON = -14;
        public const uint WM_GETICON = 0x007F;
        public const uint ICON_BIG = 1;
        public const uint DI_NORMAL = 0x0003;
        public const long WS_EX_TOOLWINDOW = 0x00000080;
        public const long WS_EX_NOACTIVATE = 0x08000000;
        public const uint MONITORINFOF_PRIMARY = 1;
        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint PW_RENDERFULLCONTENT = 0x00000002;
        public const int DWM_TNP_RECTDESTINATION = 0x00000001;
        public const int DWM_TNP_VISIBLE = 0x00000008;
        public const uint SRCCOPY = 0x00CC0020;
        public const uint WS_POPUP = 0x80000000;
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

# 019G bounded-memory capture limits: source dimensions and pixel area are
# rejected BEFORE any bitmap allocation, so a pathological window size can
# never exhaust the helper process.
$script:WhMaxSourceDimension = 8192
$script:WhMaxSourcePixels = 33554432

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
  Cloak = { param([IntPtr]$id, [bool]$enabled)
    # DWMWA_CLOAK can return S_OK for a foreign top-level window while leaving
    # it visibly composed. Use a reversible visibility change instead: SW_HIDE
    # does not mutate placement/minimized state, and SW_SHOWNA restores without
    # activation or z-order theft. The service records and restores only the
    # exact windows hidden by its current bounded Peek session.
    if ($enabled) {
      [void][WH.Win32]::ShowWindow($id, [WH.Win32]::SW_HIDE)
    } else {
      # A minimized Peek target must become visible without stealing focus.
      # SW_SHOWNA preserves an iconic window, while SW_SHOWNOACTIVATE reveals
      # it at its restored placement. The main service re-minimizes exactly
      # that target when Peek ends.
      $showCommand = if ([WH.Win32]::IsIconic($id)) {
        [WH.Win32]::SW_SHOWNOACTIVATE
      } else {
        [WH.Win32]::SW_SHOWNA
      }
      [void][WH.Win32]::ShowWindow($id, $showCommand)
    }
  }
  Close = { param([IntPtr]$id) [void][WH.Win32]::PostMessage($id, [WH.Win32]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) }
  # ---- 019G real-window thumbnail native seams (all injectable) -------------
  GetWindowRect = { param([IntPtr]$id)
    $rect = New-Object WH.Rect
    if (-not [WH.Win32]::GetWindowRect($id, [ref]$rect)) { return $null }
    return @{ Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top }
  }
  IsIconic = { param([IntPtr]$id) [WH.Win32]::IsIconic($id) }
  PrintWindow = { param([IntPtr]$id, [IntPtr]$hdc) [WH.Win32]::PrintWindow($id, $hdc, [WH.Win32]::PW_RENDERFULLCONTENT) }
  # 024: window/class program icon (WM_GETICON ICON_BIG, then the class icon)
  # used as a REAL image fallback for minimized or hardware-accelerated (acad)
  # windows that PrintWindow cannot paint. Same identity as the taskbar image.
  ResolveWindowIcon = { param([IntPtr]$id)
    $h = [WH.Win32]::SendMessage($id, [WH.Win32]::WM_GETICON, [IntPtr]([WH.Win32]::ICON_BIG), [IntPtr]::Zero)
    if ($h -eq [IntPtr]::Zero) {
      if ([IntPtr]::Size -eq 8) { $h = [WH.Win32]::GetClassLongPtr($id, [WH.Win32]::GCLP_HICON) }
      else { $h = [IntPtr]([WH.Win32]::GetClassLong($id, [WH.Win32]::GCLP_HICON)) }
    }
    return $h
  }
  CaptureIcon = { param([IntPtr]$id, [int]$maxWidth, [int]$maxHeight)
    $hicon = & $script:WhOps['ResolveWindowIcon'] $id
    if ($null -eq $hicon -or $hicon -eq [IntPtr]::Zero) { return $null }
    $scaled = Get-WhThumbnailScale 48 48 $maxWidth $maxHeight
    $bmp = New-Object System.Drawing.Bitmap -ArgumentList $scaled.width, $scaled.height
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $hdc = $graphics.GetHdc()
        try {
          [void][WH.Win32]::DrawIconEx($hdc, 0, 0, $hicon, $scaled.width, $scaled.height, 0, [IntPtr]::Zero, [WH.Win32]::DI_NORMAL)
        } finally {
          $graphics.ReleaseHdc($hdc)
        }
      } finally {
        $graphics.Dispose()
      }
      $stream = New-Object System.IO.MemoryStream
      try {
        $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $stream.ToArray()
      } finally {
        $stream.Dispose()
      }
      if ($bytes.Length -gt 256 * 1024) { return $null }
      return @{ outcome = 'success'; image = [Convert]::ToBase64String($bytes); width = $scaled.width; height = $scaled.height; source = 'icon'; minimized = [bool](& $script:WhOps['IsIconic'] $id) }
    } finally {
      $bmp.Dispose()
    }
  }
  # 025: DWM-composited real-content capture for hardware-accelerated windows
  # (acad / OpenGL) that PrintWindow cannot paint. DwmRegisterThumbnail gives the
  # actual composited window content; BitBlt reads it off the destination DC into
  # a bounded PNG (source='dwm'). Returns $null on any failure so the caller can
  # fall back to the honest terminal icon. Injectable for deterministic tests.
  CaptureDwm = { param([IntPtr]$id, [int]$maxWidth, [int]$maxHeight)
    $rect = & $script:WhOps['GetWindowRect'] $id
    if ($null -eq $rect -or [int]$rect.Width -le 0 -or [int]$rect.Height -le 0) { return $null }
    $scaled = Get-WhThumbnailScale ([int]$rect.Width) ([int]$rect.Height) $maxWidth $maxHeight
    $dest = [WH.Win32]::CreateWindowExW(0, 'STATIC', '', [WH.Win32]::WS_POPUP, 0, 0, $scaled.width, $scaled.height, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($dest -eq [IntPtr]::Zero) { return $null }
    try {
      $thumbId = [IntPtr]::Zero
      if ([WH.Win32]::DwmRegisterThumbnail($dest, $id, [ref]$thumbId) -ne 0 -or $thumbId -eq [IntPtr]::Zero) { return $null }
      try {
        $props = New-Object WH.DWM_THUMBNAIL_PROPERTIES
        $props.dwFlags = [WH.Win32]::DWM_TNP_RECTDESTINATION -bor [WH.Win32]::DWM_TNP_VISIBLE
        $props.rcDestination = New-Object WH.Rect
        $props.rcDestination.Right = $scaled.width
        $props.rcDestination.Bottom = $scaled.height
        $props.opacity = 255
        $props.fVisible = $true
        if ([WH.Win32]::DwmUpdateThumbnailProperties($thumbId, [ref]$props) -ne 0) { return $null }
        $destDc = [WH.Win32]::GetWindowDC($dest)
        if ($destDc -eq [IntPtr]::Zero) { return $null }
        try {
          $bmp = New-Object System.Drawing.Bitmap -ArgumentList $scaled.width, $scaled.height
          try {
            $graphics = [System.Drawing.Graphics]::FromImage($bmp)
            try {
              $bmpDc = $graphics.GetHdc()
              try {
                if (-not [WH.Win32]::BitBlt($bmpDc, 0, 0, $scaled.width, $scaled.height, $destDc, 0, 0, [WH.Win32]::SRCCOPY)) { return $null }
              } finally {
                $graphics.ReleaseHdc($bmpDc)
              }
            } finally {
              $graphics.Dispose()
            }
            $stream = New-Object System.IO.MemoryStream
            try {
              $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
              $bytes = $stream.ToArray()
            } finally {
              $stream.Dispose()
            }
            if ($bytes.Length -gt 256 * 1024) { return $null }
            # 026: a minimized or minimized+hardware window may present a blank /
            # uniform DWM surface. A uniform capture is NOT useful content; treat
            # it as no-content so the caller falls through to the cache or the
            # honest terminal icon instead of shipping a blank "preview".
            if (Test-WhCaptureUniform $bmp) { return $null }
            return @{ outcome = 'success'; image = [Convert]::ToBase64String($bytes); width = $scaled.width; height = $scaled.height; source = 'dwm'; minimized = [bool](& $script:WhOps['IsIconic'] $id) }
          } finally {
            $bmp.Dispose()
          }
        } finally {
          [void][WH.Win32]::ReleaseDC($dest, $destDc)
        }
      } finally {
        [void][WH.Win32]::DwmUnregisterThumbnail($thumbId)
      }
    } finally {
      [void][WH.Win32]::DestroyWindow($dest)
    }
  }
  # ---- 019G real-window thumbnail (injectable) -----------------------------
  Capture = { param([IntPtr]$id, [int]$maxWidth, [int]$maxHeight)
    if (-not (& $script:WhOps['IsWindow'] $id)) {
      return @{ outcome = 'missing'; error = 'window is gone' }
    }
    if (& $script:WhOps['IsIconic'] $id) {
      # 026: a minimized window still deserves a REAL window-content preview that
      # does not depend on the service's volatile in-memory frame cache. DWM
      # may render the window's retained last frame into a thumbnail; try that
      # first. Only when DWM yields no useful content do we fall through to the
      # cache/terminal-icon path (the caller resolves those).
      $dwm = & $script:WhOps['CaptureDwm'] $id $maxWidth $maxHeight
      if ($null -ne $dwm -and $dwm.outcome -eq 'success') { return $dwm }
      $icon = & $script:WhOps['CaptureIcon'] $id $maxWidth $maxHeight
      if ($null -ne $icon -and $icon.outcome -eq 'success') { return $icon }
      return @{ outcome = 'minimized'; error = 'window is minimized' }
    }
    $rect = & $script:WhOps['GetWindowRect'] $id
    if ($null -eq $rect -or [int]$rect.Width -le 0 -or [int]$rect.Height -le 0) {
      return @{ outcome = 'denied'; error = 'window bounds are unavailable' }
    }
    $srcW = [int]$rect.Width
    $srcH = [int]$rect.Height
    # Bounded memory: reject unsafe source dimensions/pixel area BEFORE any
    # bitmap allocation.
    if ($srcW -gt $script:WhMaxSourceDimension -or $srcH -gt $script:WhMaxSourceDimension -or
        ([long]$srcW * [long]$srcH) -gt $script:WhMaxSourcePixels) {
      return @{ outcome = 'denied'; error = 'window capture dimensions are unsafe' }
    }
    $scaled = Get-WhThumbnailScale $srcW $srcH $maxWidth $maxHeight
    # Capture into a bounded NATIVE-SIZE source bitmap first; PrintWindow does
    # NOT scale to a smaller destination HDC (a smaller bitmap would only get
    # a top-left crop). The full source is scaled aspect-preservingly below.
    $source = New-Object System.Drawing.Bitmap -ArgumentList $srcW, $srcH
    try {
      Fill-WhSentinel $source
      $sentinelChecksum = Get-WhCaptureChecksum $source
      $graphics = [System.Drawing.Graphics]::FromImage($source)
      try {
        $hdc = $graphics.GetHdc()
        try {
          # PrintWindow(PW_RENDERFULLCONTENT) is BEST EFFORT: it captures the
          # full window surface (including occluded parts) for most windows but
          # is not guaranteed for every application. Failure is an honest
          # typed fallback, never a fabricated placeholder.
          $printed = & $script:WhOps['PrintWindow'] $id $hdc
        } finally {
          $graphics.ReleaseHdc($hdc)
        }
      } finally {
        $graphics.Dispose()
      }
      if (-not $printed) {
        # 025 acad/OpenGL reproduction: PrintWindow(PW_RENDERFULLCONTENT) is
        # best effort and reports FALSE / paints nothing for hardware-accelerated
        # windows. Capture REAL composited window content via a DWM thumbnail;
        # only when DWM is unavailable fall back to the terminal window icon.
        $dwm = & $script:WhOps['CaptureDwm'] $id $maxWidth $maxHeight
        if ($null -ne $dwm -and $dwm.outcome -eq 'success') { return $dwm }
        $icon = & $script:WhOps['CaptureIcon'] $id $maxWidth $maxHeight
        if ($null -ne $icon -and $icon.outcome -eq 'success') { return $icon }
        return @{ outcome = 'denied'; error = 'PrintWindow capture is not supported for this window' }
      }
      # PrintWindow can return TRUE without painting anything. The nonuniform
      # sentinel makes "unchanged" detectable: equal checksums mean no paint.
      if ((Get-WhCaptureChecksum $source) -eq $sentinelChecksum) {
        $dwm = & $script:WhOps['CaptureDwm'] $id $maxWidth $maxHeight
        if ($null -ne $dwm -and $dwm.outcome -eq 'success') { return $dwm }
        $icon = & $script:WhOps['CaptureIcon'] $id $maxWidth $maxHeight
        if ($null -ne $icon -and $icon.outcome -eq 'success') { return $icon }
        return @{ outcome = 'denied'; error = 'PrintWindow returned without painting the capture' }
      }
      $output = ConvertTo-WhCaptureThumbnail $source $scaled.width $scaled.height
      try {
        $stream = New-Object System.IO.MemoryStream
        try {
          $output.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
          $bytes = $stream.ToArray()
        } finally {
          $stream.Dispose()
        }
        if ($bytes.Length -gt 256 * 1024) {
          return @{ outcome = 'denied'; error = 'captured thumbnail exceeds the size bound' }
        }
        return @{ outcome = 'success'; image = [Convert]::ToBase64String($bytes); width = $scaled.width; height = $scaled.height; source = 'capture'; minimized = $false }
      } finally {
        $output.Dispose()
      }
    } finally {
      $source.Dispose()
    }
  }
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

# 019G real-window thumbnail: capture the FULL window content via PrintWindow
# scaled to fit within (MaxWidth, MaxHeight), bounded to the exact contract
# (decoded PNG <= 256 KiB, dimensions <= 320x180). Returns the op's typed
# hashtable: @{ outcome='success'; image; width; height } or a typed fallback
# @{ outcome='minimized'|'missing'|'denied'; error }. The caller already ran
# the token identity gate immediately before; this op rechecks IsWindow and
# the minimized state fail-closed.
function Get-WhWindowThumbnail {
  param([IntPtr]$RuntimeId, [int]$MaxWidth, [int]$MaxHeight)
  return & $script:WhOps['Capture'] $RuntimeId $MaxWidth $MaxHeight
}

function Cloak-WhWindow([IntPtr]$RuntimeId) { & $script:WhOps['Cloak'] $RuntimeId $true }
function Uncloak-WhWindow([IntPtr]$RuntimeId) { & $script:WhOps['Cloak'] $RuntimeId $false }

# A deliberately separate, bounded icon seam. Callers use this only after a
# window has already been selected/bound; it must never decorate the full
# latency-critical `list` response.
function Get-WhWindowIcon {
  param(
    [Parameter(Mandatory = $true)][IntPtr]$RuntimeId,
    [int]$MaxWidth = 48,
    [int]$MaxHeight = 48
  )
  if (-not (& $script:WhOps['IsWindow'] $RuntimeId)) {
    return @{ outcome = 'missing'; error = 'window is gone' }
  }
  $icon = & $script:WhOps['CaptureIcon'] $RuntimeId $MaxWidth $MaxHeight
  if ($null -eq $icon -or $icon.outcome -ne 'success') {
    return @{ outcome = 'denied'; error = 'window icon is unavailable' }
  }
  return $icon
}

# Pure aspect-preserving scale policy: fit a source rectangle into
# (MaxWidth, MaxHeight) WITHOUT upscaling, flooring so the output never
# exceeds the requested max; never below 1x1.
function Get-WhThumbnailScale {
  param([int]$SourceWidth, [int]$SourceHeight, [int]$MaxWidth, [int]$MaxHeight)
  if ($SourceWidth -lt 1 -or $SourceHeight -lt 1 -or $MaxWidth -lt 1 -or $MaxHeight -lt 1) {
    throw "WH-COMMAND-ROUTING: thumbnail scale requires positive dimensions."
  }
  $scale = [Math]::Min(1.0, [Math]::Min([double]$MaxWidth / $SourceWidth, [double]$MaxHeight / $SourceHeight))
  return @{
    width = [Math]::Max(1, [int][Math]::Floor($SourceWidth * $scale))
    height = [Math]::Max(1, [int][Math]::Floor($SourceHeight * $scale))
  }
}

# Prefill a bitmap with a DISTINCTIVE NONUNIFORM sentinel (a deterministic
# block pattern) so a no-paint PrintWindow is detectable by checksum equality.
function Fill-WhSentinel {
  param([System.Drawing.Bitmap]$Bitmap)
  $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  try {
    for ($y = 0; $y -lt $Bitmap.Height; $y += 16) {
      for ($x = 0; $x -lt $Bitmap.Width; $x += 16) {
        $color = [System.Drawing.Color]::FromArgb(
          (($x + $y) / 16) % 256, (($x * 2 + $y) / 16) % 256, (($x + $y * 3) / 16) % 256)
        $brush = New-Object System.Drawing.SolidBrush $color
        try {
          $graphics.FillRectangle($brush, $x, $y, 16, 16)
        } finally {
          $brush.Dispose()
        }
      }
    }
  } finally {
    $graphics.Dispose()
  }
}

# Strong whole-surface checksum of a bitmap's raw pixels (MD5 of the locked
# bytes): two identical buffers always match, any painted difference does not.
function Get-WhCaptureChecksum {
  param([System.Drawing.Bitmap]$Bitmap)
  $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $Bitmap.Width, $Bitmap.Height
  $data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $Bitmap.PixelFormat)
  try {
    $length = [int]$data.Stride * $Bitmap.Height
    $bytes = New-Object byte[] $length
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $length)
    $hasher = [System.Security.Cryptography.MD5]::Create()
    try {
      return [System.BitConverter]::ToString($hasher.ComputeHash($bytes))
    } finally {
      $hasher.Dispose()
    }
  } finally {
    $Bitmap.UnlockBits($data)
  }
}

# 026: a sparse uniform-colour check on a captured bitmap. A minimized or
# minimized+hardware DWM surface can present a blank / single-colour result,
# which is NOT useful window content; this returns $true when a bounded sample
# of pixels are all identical so the caller can treat it as no-content instead
# of shipping a blank "preview".
function Test-WhCaptureUniform {
  param([System.Drawing.Bitmap]$Bitmap)
  $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $Bitmap.Width, $Bitmap.Height
  $data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $Bitmap.PixelFormat)
  try {
    $stride = [int]$data.Stride
    $height = $Bitmap.Height
    $length = $stride * $height
    $bytes = New-Object byte[] $length
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $length)
    $bpp = [System.Drawing.Image]::GetPixelFormatSize($Bitmap.PixelFormat) / 8
    if ($bpp -lt 1) { $bpp = 4 }
    # Sample up to 64 pixels on a sparse grid.
    $samples = @()
    $sampleCount = 0
    for ($y = 0; $y -lt $height -and $sampleCount -lt 64; $y += [Math]::Max(1, [int]($height / 8))) {
      for ($x = 0; $x -lt $Bitmap.Width -and $sampleCount -lt 64; $x += [Math]::Max(1, [int]($Bitmap.Width / 8))) {
        $offset = $y * $stride + $x * [int]$bpp
        if ($offset -ge 0 -and $offset + [int]$bpp -le $length) {
          $key = '{0}:{1}:{2}:{3}' -f $bytes[$offset], $bytes[$offset + 1], $bytes[$offset + 2], $bytes[$offset + 3]
          $samples += $key
          $sampleCount += 1
        }
      }
    }
    $first = $samples[0]
    foreach ($key in $samples) { if ($key -ne $first) { return $false } }
    return $sampleCount -ge 2
  } finally {
    $Bitmap.UnlockBits($data)
  }
}
# with high-quality interpolation. PrintWindow cannot scale to a smaller
# destination HDC, so this second pass is what makes a full-surface thumbnail:
# the whole source rectangle, corners included, is drawn aspect-preservingly.
function ConvertTo-WhCaptureThumbnail {
  param([System.Drawing.Bitmap]$Source, [int]$OutWidth, [int]$OutHeight)
  $output = New-Object System.Drawing.Bitmap -ArgumentList $OutWidth, $OutHeight
  $graphics = [System.Drawing.Graphics]::FromImage($output)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($Source, 0, 0, $OutWidth, $OutHeight)
  } finally {
    $graphics.Dispose()
  }
  return $output
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
