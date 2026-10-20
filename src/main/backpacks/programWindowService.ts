/**
 * Program windows for Backpack templates: a page names a template (for example
 * `appflowy`) and a target (that program's own identity for what to show), and
 * Papers launches the program, finds its window and docks it over a rectangle
 * of the page. The program stays its own top-level window (D-012): Papers only
 * keeps it glued to the rectangle, hides it with the page and releases it back
 * to the desktop when the page closes.
 *
 * Pages never name executables. Templates come from Papers' built-in list and
 * the creator's `program-templates.json`; a target must match its template's
 * pattern before it is put into the launch link.
 */
import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChromePaneBridge } from './chromePaneBridge';

export interface ProgramTemplate {
  id: string;
  label: string;
  /** Executable to run. When absent, the program registered for `protocol` is used. */
  executable?: string;
  protocol?: string;
  /** Argument passed to the program; `{target}` is replaced by the URI-encoded target. */
  launch: string;
  /** Pattern every target must match in full. */
  target: string;
}

interface Rect { x: number; y: number; width: number; height: number; rightInset?: number; bottomInset?: number }
interface HostContext { ownerKey: string; parentHwnd: string; paneGroup?: string; layoutKey?: string; surfaceBounds: Rect }
type Reply = { ok: boolean; error?: string; message?: string; code?: string };

const BUILT_IN: ProgramTemplate[] = [{
  id: 'appflowy',
  label: 'AppFlowy',
  protocol: 'appflowy-flutter',
  launch: 'appflowy-flutter://open-workspace?workspace_id={target}',
  target: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
}];
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const WINDOW_WAIT_MS = 25_000;

export interface ProgramWindowService {
  templates(): Array<Pick<ProgramTemplate, 'id' | 'label'>>;
  open(context: HostContext, template: string, target: string, rect: Rect): Promise<Reply>;
  move(owner: string, template: string, rect: Rect): void;
  setVisible(owner: string, template: string, visible: boolean): void;
  close(owner: string, template: string): Promise<void>;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 10_000 }, (error, stdout) => error ? reject(error) : resolve(String(stdout))));
}

/** The command Windows runs for `protocol:` links, reduced to its executable. */
async function protocolExecutable(protocol: string): Promise<string | null> {
  for (const root of ['HKCU\\Software\\Classes', 'HKLM\\Software\\Classes']) {
    const output = await run('reg', ['query', `${root}\\${protocol}\\shell\\open\\command`, '/ve']).catch(() => '');
    const command = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(output)?.[1]?.trim();
    const executable = command && (command.startsWith('"') ? command.slice(1, command.indexOf('"', 1)) : command.split(/\s+/)[0]);
    if (executable && fs.existsSync(executable)) return executable;
  }
  return null;
}

/** The visible top-level window of a process started from `executable`, if one exists. */
async function findWindow(executable: string): Promise<{ handle: number; pid: number } | null> {
  const script = `$p=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:PAPERS_PROGRAM_PATH -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if($p){ "$($p.Id) $([int64]$p.MainWindowHandle)" }`;
  const output = await new Promise<string>(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 10_000, env: { ...process.env, PAPERS_PROGRAM_PATH: executable } }, (_error, stdout) => resolve(String(stdout ?? ''))));
  const match = /^(\d+) (\d+)/.exec(output.trim());
  return match ? { pid: Number(match[1]), handle: Number(match[2]) } : null;
}

function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

export function createProgramWindowService(input: { bridge: ChromePaneBridge | null; dataDirectory: string }): ProgramWindowService | null {
  const bridge = input.bridge;
  if (process.platform !== 'win32' || !bridge?.programOpen) return null;
  const known = new Map<string, { handle: number; pid: number; executable: string; target: string }>();

  function load(): Map<string, ProgramTemplate> {
    const result = new Map(BUILT_IN.map(t => [t.id, t]));
    try {
      const file = JSON.parse(fs.readFileSync(path.join(input.dataDirectory, 'program-templates.json'), 'utf8')) as { templates?: Record<string, Partial<ProgramTemplate>> };
      for (const [id, value] of Object.entries(file.templates ?? {})) {
        if (!ID.test(id) || typeof value?.launch !== 'string' || typeof value.target !== 'string' || (!value.executable && !value.protocol)) continue;
        result.set(id, { id, label: typeof value.label === 'string' ? value.label : id, launch: value.launch, target: value.target,
          ...(typeof value.executable === 'string' ? { executable: value.executable } : {}), ...(typeof value.protocol === 'string' ? { protocol: value.protocol } : {}) });
      }
    } catch { /* no creator templates */ }
    return result;
  }

  function template(id: string): ProgramTemplate {
    const found = ID.test(id) ? load().get(id) : undefined;
    if (!found) throw Object.assign(new Error('Unknown program template.'), { code: 'PROGRAM_TEMPLATE_UNKNOWN' });
    return found;
  }

  async function window(definition: ProgramTemplate, target: string): Promise<{ handle: number; pid: number }> {
    const executable = definition.executable ?? (definition.protocol ? await protocolExecutable(definition.protocol) : null);
    if (!executable || !fs.existsSync(executable)) throw new Error(`${definition.label} is not installed on this computer.`);
    const previous = known.get(definition.id);
    const running = previous && previous.executable === executable && alive(previous.pid) ? previous : undefined;
    // Showing the same target again needs no link: the program is already there.
    if (running?.target === target) return running;
    const argument = definition.launch.split('{target}').join(encodeURIComponent(target));
    // A running program receives the link through its own single-instance handoff;
    // otherwise this starts it. Either way it opens the target.
    spawn(executable, [argument], { detached: true, stdio: 'ignore' }).unref();
    // A docked window may be hidden with its page, so it is not listed as a main window.
    if (running) { running.target = target; return running; }
    const deadline = Date.now() + WINDOW_WAIT_MS;
    while (Date.now() < deadline) {
      const found = await findWindow(executable);
      if (found) { known.set(definition.id, { ...found, executable, target }); return found; }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error(`${definition.label} did not open a window.`);
  }

  return {
    templates: () => [...load().values()].map(({ id, label }) => ({ id, label })),
    async open(context, id, target, rect) {
      const definition = template(id);
      if (!new RegExp(definition.target).test(target)) return { ok: false, code: 'PROGRAM_TARGET_INVALID', message: 'This template target is not valid.' };
      try {
        const found = await window(definition, target);
        const reply = await bridge.programOpen!(context, id, found.handle, found.pid, rect);
        if (!reply.ok) known.delete(id);
        return reply.ok ? { ok: true } : { ok: false, message: reply.error ?? `${definition.label} could not be placed here.` };
      } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
    },
    move: (owner, id, rect) => bridge.programMove?.(owner, id, rect),
    setVisible: (owner, id, visible) => bridge.programVisible?.(owner, id, visible),
    close: async (owner, id) => { await bridge.programClose?.(owner, id); },
  };
}
