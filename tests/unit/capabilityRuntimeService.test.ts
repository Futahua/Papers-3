import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityRuntimeService } from '../../src/main/backpacks/capabilityRuntimeService';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-runtime-test-')); roots.push(root);
  const controller = { prepare: vi.fn(async () => ({ ok: true })), setKeepWarm: vi.fn(), snapshot: () => ({ runtimes: [{ usage: { workingSetBytes: 12345 } }] }) };
  return { root, controller, service: createCapabilityRuntimeService(root, { officeEditor: controller }) };
};
describe('machine capability observations and policies', () => {
  it('persists policy and starts the same controller on a later launch', async () => {
    const f = await fixture(); await f.service.initialize();
    await f.service.configure('officeEditor', { startupLoad: true, keepWarm: false });
    f.controller.prepare.mockClear(); f.controller.setKeepWarm.mockClear();
    const next = createCapabilityRuntimeService(f.root, { officeEditor: f.controller }); await next.initialize();
    expect(f.controller.setKeepWarm).toHaveBeenCalledWith(false);
    expect(f.controller.prepare).toHaveBeenCalledOnce();
    expect(next.snapshot().capabilities.officeEditor!.policy).toEqual({ startupLoad: true, keepWarm: false });
    await expect(next.configure('filePreview', { startupLoad: true, keepWarm: true })).rejects.toThrow('resident runtime');
  });
  it('records measured calls and writes a single explicit recording under concurrent starts', async () => {
    const f = await fixture(); await f.service.initialize();
    const finish = f.service.begin('officeEditor');
    expect(f.service.snapshot().capabilities.officeEditor!.usage.activeCalls).toBe(1);
    finish(false, 120);
    const [a, b] = await Promise.all([f.service.startRecording(), f.service.startRecording()]);
    expect(a.file).toBe(b.file); await f.service.stopRecording();
    const samples = (await fs.readFile(a.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(samples).toHaveLength(1);
    expect(samples[0].capabilities.officeEditor!.usage).toMatchObject({ calls: 1, activeCalls: 0, failures: 1, lastDurationMs: 120 });
    expect(samples[0].capabilities.officeEditor.runtime.runtimes[0].usage.workingSetBytes).toBe(12345);
    expect(await f.service.recordings()).toHaveLength(1);
    expect(f.service.snapshot().recording).toBeNull();
  });
});
