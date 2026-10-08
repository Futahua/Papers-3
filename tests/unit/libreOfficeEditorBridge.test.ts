import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
const fileSystem = vi.hoisted(() => ({ exists: vi.fn(() => true), stat: vi.fn(async () => ({ isFile: () => true })) }));
vi.mock('node:fs', () => ({ existsSync: fileSystem.exists, promises: { stat: fileSystem.stat } }));
import { createLibreOfficeEditorBridge } from '../../src/main/backpacks/libreOfficeEditorBridge';

function fixture(autoClose = true, detached = false, autoOpen = true) {
  const commands: Record<string, unknown>[] = [];
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: Writable };
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const command = JSON.parse(String(chunk)); commands.push(command);
    if (command.id && (command.operation !== 'close' || autoClose) && (command.operation !== 'open' || autoOpen)) queueMicrotask(() => child.stdout.write(JSON.stringify({ kind: 'reply', id: command.id, ok: true, ...(command.operation === 'open' ? { hwnd: '456', readOnly: false } : {}), detached: command.operation === 'close' && detached, reusable: command.operation === 'close' && !detached }) + '\n'));
    callback();
  } });
  const launch = vi.fn(() => child);
  const bridge = createLibreOfficeEditorBridge({ officePath: 'C:/Office/soffice.exe', sourcePath: 'C:/native/editor.py', cacheDirectory: 'C:/cache', spawnProcess: launch as unknown as typeof spawn })!;
  const context = { ownerKey: '3:surface', parentHwnd: '123', surfaceBounds: { x: 10, y: 15, width: 1000, height: 800 } };
  const rect = { x: 20, y: 25, width: 600, height: 500 };
  const ready = () => child.stdout.write('{"kind":"engine-ready"}\n');
  return { child, bridge, context, rect, launch, commands, ready };
}
beforeEach(() => { fileSystem.exists.mockReturnValue(true); fileSystem.stat.mockClear(); });
describe('inline LibreOffice ownership', () => {
  it('uses the real source file and rejects another surface before any editor command', async () => {
    const f = fixture(), opening = f.bridge.open(f.context, 'C:/work/report.odt', f.rect);
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled()); f.ready();
    const opened = await opening; expect(opened.ok).toBe(true);
    const args = f.launch.mock.calls[0] as unknown as [string, string[]];
    expect(args[1]).not.toContain('C:/work/report.odt');
    expect(f.commands[0]).toMatchObject({ operation: 'open', path: 'C:/work/report.odt', rect: [30, 40, 600, 500] });
    expect(f.bridge.focus('foreign', opened.sessionId!)).toBe(false);
    expect(f.bridge.move('foreign', opened.sessionId!, f.rect)).toBe(false);
    expect(await f.bridge.save('foreign', opened.sessionId!)).toMatchObject({ ok: false });
    expect(f.commands).toHaveLength(1);
    expect(await f.bridge.save(f.context.ownerKey, opened.sessionId!)).toMatchObject({ ok: true });
    expect(await f.bridge.close(f.context.ownerKey, opened.sessionId!)).toMatchObject({ ok: true, detached: false });
    expect(f.bridge.hasWindow(3)).toBe(false);
  });
  it('uses the existing surface coordinate contract and keeps visibility commands scoped', async () => {
    const f = fixture(), opening = f.bridge.open(f.context, 'C:/work/sheet.ods', f.rect);
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled()); f.ready(); const opened = await opening;
    f.bridge.setOwnerSurfaceBounds('foreign', { x: 100, y: 100, width: 900, height: 800 }); expect(f.commands).toHaveLength(1);
    f.bridge.setOwnerSurfaceBounds(f.context.ownerKey, { x: 100, y: 120, width: 900, height: 800 });
    expect(f.commands.at(-1)).toEqual({ operation: 'move', rect: [120, 145, 600, 500] });
    f.bridge.setOwnerVisible(f.context.ownerKey, false); expect(f.commands.at(-1)).toEqual({ operation: 'visible', visible: false });
    await f.bridge.closeWindow(3); expect(f.bridge.move(f.context.ownerKey, opened.sessionId!, f.rect)).toBe(false);
  });
  it('fences late readiness when a document is closed while it is opening', async () => {
    const f = fixture(false), opening = f.bridge.open(f.context, 'C:/work/report.odt', f.rect);
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled());
    const closing = f.bridge.closeWindow(3); f.ready();
    expect(await opening).toMatchObject({ ok: false });
    const command = f.commands.find(item => item.operation === 'close')!;
    f.child.stdout.write(JSON.stringify({ kind: 'reply', id: command.id, ok: true, detached: false }) + '\n');
    await closing; expect(f.bridge.hasWindow(3)).toBe(false);
  });
  it('does not advertise editing without the installed office runtime', () => {
    fileSystem.exists.mockReturnValue(false);
    expect(createLibreOfficeEditorBridge({ officePath: 'C:/missing/soffice.exe', sourcePath: 'C:/native/editor.py', cacheDirectory: 'C:/cache' })).toBeNull();
  });
  it('reuses a clean engine while issuing a fresh document identity and rejects stale commands', async () => {
    const f = fixture(), first = f.bridge.open(f.context, 'C:/work/first.odt', f.rect);
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled()); f.ready();
    const opened = await first;
    await f.bridge.close(f.context.ownerKey, opened.sessionId!);
    const next = await f.bridge.open(f.context, 'C:/work/second.ods', f.rect);
    expect(next.runtimeId).toBe(opened.runtimeId);
    expect(next.sessionId).not.toBe(opened.sessionId);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.bridge.focus(f.context.ownerKey, opened.sessionId!)).toBe(false);
    expect(await f.bridge.save(f.context.ownerKey, opened.sessionId!)).toMatchObject({ ok: false });
    await f.bridge.close(f.context.ownerKey, opened.sessionId!);
    expect(f.bridge.hasWindow(3)).toBe(true);
    await f.bridge.dispose(); expect(f.child.stdin.writableEnded).toBe(true);
  });
  it('retires the helper after unsaved handoff instead of reusing the dirty engine', async () => {
    const f = fixture(true, true), first = f.bridge.open(f.context, 'C:/work/report.odt', f.rect);
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled()); f.ready();
    const opened = await first;
    expect(await f.bridge.close(f.context.ownerKey, opened.sessionId!)).toMatchObject({ detached: true });
    expect(f.child.stdin.writableEnded).toBe(true);
  });
  it('keeps unproven presentation editors out of the inline path', async () => {
    const f = fixture();
    expect(await f.bridge.open(f.context, 'C:/work/slides.pptx', f.rect)).toMatchObject({ ok: false });
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('reports only native progress for the current owner and load, clearing it on readiness', async () => {
    const f = fixture(true, false, false);
    const opening = f.bridge.open(f.context, 'C:/work/report.odt', f.rect, 'load-a');
    await vi.waitFor(() => expect(f.launch).toHaveBeenCalled());
    expect(f.bridge.status(f.context.ownerKey, 'load-a')).toMatchObject({ phase: 'starting-engine', value: null, maximum: null });
    f.ready(); await vi.waitFor(() => expect(f.commands[0]).toMatchObject({ operation: 'open' }));
    f.child.stdout.write('{"kind":"progress","phase":"loading-document","text":"Loading","value":37,"maximum":100}\n');
    expect(f.bridge.status(f.context.ownerKey, 'load-a')).toMatchObject({ value: 37, maximum: 100 });
    expect(f.bridge.status('foreign', 'load-a')).toBeNull();
    expect(f.bridge.status(f.context.ownerKey, 'stale')).toBeNull();
    f.child.stdout.write(JSON.stringify({ kind: 'reply', id: f.commands[0]!.id, ok: true, hwnd: '456' }) + '\n');
    await opening; expect(f.bridge.status(f.context.ownerKey, 'load-a')).toBeNull();
    await f.bridge.dispose();
  });
  it('fences an owner closed during path validation before creating a runtime', async () => {
    let finish!: (value: { isFile: () => true }) => void;
    fileSystem.stat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const f = fixture(), opening = f.bridge.open(f.context, 'C:/work/report.odt', f.rect);
    await f.bridge.closeOwner(f.context.ownerKey);
    finish({ isFile: () => true });
    expect(await opening).toMatchObject({ ok: false }); expect(f.launch).not.toHaveBeenCalled();
    await f.bridge.dispose();
  });
});
