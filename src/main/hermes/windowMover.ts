/**
 * WindowMover — position a foreign OS window (the real Hermes Desktop) from
 * Papers, with no native Node addon.
 *
 * Papers cannot move another process's Electron window through Electron APIs,
 * so on Windows we drive user32 (`SetWindowPos`/`ShowWindow`) through a single
 * persistent PowerShell host. One long-lived PowerShell process reads one JSON
 * command per line from stdin and applies it, so there is no per-move process
 * startup cost and dock realignment during a Papers drag stays smooth.
 *
 * This is the Papers side of the "Papers-managed window that visually docks"
 * decision (D-012). Hermes stays a real, independently-stable window; Papers
 * only repositions it. On non-Windows platforms every method is a safe no-op
 * (the batch targets the creator's Windows machine).
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const IS_WINDOWS = process.platform === 'win32';

/**
 * The PowerShell host program. It defines the user32 P/Invoke surface once,
 * then loops over stdin: each line is a JSON command
 * `{op, title, x, y, width, height}`. Window lookup is by process name
 * ("Hermes") + main-window handle, which is stable for the Hermes Desktop
 * top-level window.
 */
const PS_HOST = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PapersWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
"@
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040
$SW_MINIMIZE = 6
$SW_RESTORE = 9

function Get-HermesHandle([string]$title) {
  $p = Get-Process -Name 'Hermes' -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 -and ($title -eq '' -or $_.MainWindowTitle -eq $title) } |
       Select-Object -First 1
  if ($p) { return $p.MainWindowHandle } else { return [IntPtr]::Zero }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  try {
    $cmd = $line | ConvertFrom-Json
    $h = Get-HermesHandle $cmd.title
    if ($h -eq [IntPtr]::Zero) { Write-Output ('{"ok":false,"reason":"no-window"}'); continue }
    switch ($cmd.op) {
      'move' {
        [void][PapersWin]::ShowWindow($h, $SW_RESTORE)
        [void][PapersWin]::SetWindowPos($h, [IntPtr]::Zero, [int]$cmd.x, [int]$cmd.y, [int]$cmd.width, [int]$cmd.height, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW))
        Write-Output '{"ok":true}'
      }
      'minimize' { [void][PapersWin]::ShowWindow($h, $SW_MINIMIZE); Write-Output '{"ok":true}' }
      'restore'  { [void][PapersWin]::ShowWindow($h, $SW_RESTORE); [void][PapersWin]::SetForegroundWindow($h); Write-Output '{"ok":true}' }
      'rect'     {
        $r = New-Object PapersWin+RECT
        [void][PapersWin]::GetWindowRect($h, [ref]$r)
        Write-Output ('{"ok":true,"x":' + $r.Left + ',"y":' + $r.Top + ',"width":' + ($r.Right - $r.Left) + ',"height":' + ($r.Bottom - $r.Top) + '}')
      }
      'find'     { Write-Output '{"ok":true}' }
      default    { Write-Output '{"ok":false,"reason":"unknown-op"}' }
    }
  } catch {
    Write-Output ('{"ok":false,"reason":"exception"}')
  }
}
`;

export class WindowMover {
  private ps: ChildProcess | null = null;
  private lastLine = '';

  private host(): ChildProcess | null {
    if (!IS_WINDOWS) return null;
    if (this.ps && this.ps.exitCode === null) return this.ps;
    this.ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-Command', PS_HOST],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    this.ps.stdout?.on('data', (chunk: Buffer) => {
      this.lastLine = chunk.toString().trim().split(/\r?\n/).pop() ?? '';
    });
    this.ps.once('exit', () => {
      this.ps = null;
    });
    return this.ps;
  }

  private send(command: Record<string, unknown>): void {
    const host = this.host();
    host?.stdin?.write(`${JSON.stringify(command)}\n`);
  }

  /**
   * Poll until a window with `title` exists (its process has painted a main
   * window), or reject after `timeoutMs`. Uses the Get-Process main-window
   * handle via a short-lived probe so it works before the host stream warms up.
   */
  async waitForWindow(title: string, timeoutMs: number): Promise<void> {
    if (!IS_WINDOWS) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await probeWindowExists(title)) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('Hermes Desktop window did not appear in time.');
  }

  /** Dock: move + size the window to `rect` (absolute screen pixels). */
  async dock(title: string, rect: WindowRect): Promise<void> {
    this.move(title, rect);
  }

  /** Move/resize the window (no-op off Windows). */
  move(title: string, rect: WindowRect): void {
    this.send({ op: 'move', title, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  /**
   * Read the current screen rectangle of the Hermes window, or null if the
   * window is gone / off Windows. Used to detect the detached window entering
   * the Papers dock target. One short-lived probe keeps it independent of the
   * persistent host's async stdout timing.
   */
  rect(title: string): Promise<WindowRect | null> {
    if (!IS_WINDOWS) return Promise.resolve(null);
    return new Promise((resolve) => {
      const script = `Add-Type -Namespace P -Name W -MemberDefinition '[StructLayout(LayoutKind.Sequential)]public struct R{public int L,T,Rr,B;}[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr h,out R r);' -UsingNamespace System.Runtime.InteropServices;$p=Get-Process -Name 'Hermes' -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0 -and (${JSON.stringify(title)} -eq '' -or $_.MainWindowTitle -eq ${JSON.stringify(title)})}|Select-Object -First 1;if($p){$r=New-Object P.W+R;[void][P.W]::GetWindowRect($p.MainWindowHandle,[ref]$r);Write-Output ($r.L.ToString()+','+$r.T+','+($r.Rr-$r.L)+','+($r.B-$r.T))}`;
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-Command', script],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.once('exit', () => {
        const parts = out.trim().split(',').map((n) => parseInt(n, 10));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
          resolve({ x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! });
        } else {
          resolve(null);
        }
      });
      child.once('error', () => resolve(null));
    });
  }

  /** Release dock pinning (a logical no-op; the window simply stops being moved). */
  undock(_title: string): void {
    /* Detached windows are not repositioned; nothing to release on Windows. */
  }

  minimize(title: string): void {
    this.send({ op: 'minimize', title });
  }

  restore(title: string): void {
    this.send({ op: 'restore', title });
  }

  /** Forget any per-window state (after the Hermes window closes). */
  reset(): void {
    this.lastLine = '';
  }

  dispose(): void {
    if (this.ps && this.ps.exitCode === null) {
      try {
        this.ps.stdin?.end();
        this.ps.kill();
      } catch {
        /* already gone */
      }
    }
    this.ps = null;
  }
}

/**
 * One-shot check for a Hermes window by title. Kept separate from the
 * persistent host so window-appearance polling doesn't depend on the host's
 * async stdout timing.
 */
function probeWindowExists(title: string): Promise<boolean> {
  if (!IS_WINDOWS) return Promise.resolve(false);
  return new Promise((resolve) => {
    const script = `$p = Get-Process -Name 'Hermes' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and (${JSON.stringify(title)} -eq '' -or $_.MainWindowTitle -eq ${JSON.stringify(title)}) } | Select-Object -First 1; if ($p) { 'yes' } else { 'no' }`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.once('exit', () => resolve(out.includes('yes')));
    child.once('error', () => resolve(false));
  });
}
