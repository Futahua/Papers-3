import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AtomicJsonStore } from '../persistence/atomicStore';

interface Policy { startupLoad: boolean; keepWarm: boolean }
export interface CapabilityRuntimeController {
  prepare(): Promise<{ ok: boolean; message?: string }>;
  setKeepWarm(value: boolean): void;
  snapshot(): Record<string, unknown>;
}
interface Usage { calls: number; activeCalls: number; failures: number; lastDurationMs: number | null; lastUsedAt: string | null }

/** Machine execution and observations only. Backpack projects define their tools. */
export function createCapabilityRuntimeService(root: string, controllers: Record<string, CapabilityRuntimeController>) {
  const store = new AtomicJsonStore(path.join(root, 'policies.json'), { recoveryDir: path.join(root, 'recovery') });
  let policies: Record<string, Policy> = {};
  const usage = new Map<string, Usage>();
  let policyWrites = Promise.resolve();
  let recording: { file: string; startedAt: string; error?: string } | null = null;
  let recordingTimer: NodeJS.Timeout | null = null;
  let writes = Promise.resolve();
  let recordingOperations = Promise.resolve();
  function serializeRecording<T>(operation: () => Promise<T>): Promise<T> {
    const task = recordingOperations.then(operation);
    recordingOperations = task.then(() => undefined, () => undefined);
    return task;
  }
  const recordingsRoot = path.join(root, 'recordings');
  const snapshot = () => ({ sampledAt: new Date().toISOString(), capabilities: Object.fromEntries([...new Set([...Object.keys(controllers), ...usage.keys()])].map(id => [id, {
    controls: { startupLoad: Boolean(controllers[id]), keepWarm: Boolean(controllers[id]), prepare: Boolean(controllers[id]) },
    policy: policies[id] ?? { startupLoad: false, keepWarm: Boolean(controllers[id]) },
    usage: usage.get(id) ?? { calls: 0, activeCalls: 0, failures: 0, lastDurationMs: null, lastUsedAt: null },
    runtime: controllers[id]?.snapshot() ?? null,
  }])), recording });
  const recordSample = () => {
    if (!recording || recording.error) return;
    const file = recording.file, sample = JSON.stringify(snapshot()) + '\n';
    writes = writes.then(() => fs.appendFile(file, sample, 'utf8')).catch(error => { if (recording?.file === file) recording.error = String(error); });
  };
  return {
    async initialize() {
      const saved = await store.load<{ schemaVersion: number; policies: Record<string, Policy> }>();
      for (const [id, value] of Object.entries(saved.value?.policies ?? {})) {
        if (value && typeof value.startupLoad === 'boolean' && typeof value.keepWarm === 'boolean') policies[id] = value;
      }
      for (const [id, controller] of Object.entries(controllers)) {
        const policy = policies[id] ?? { startupLoad: false, keepWarm: true };
        controller.setKeepWarm(policy.keepWarm);
        if (policy.startupLoad) void controller.prepare().catch(() => undefined);
      }
    },
    snapshot,
    begin(id: string | null) {
      if (!id) return (_ok: boolean, _duration?: number) => undefined;
      const value = usage.get(id) ?? { calls: 0, activeCalls: 0, failures: 0, lastDurationMs: null, lastUsedAt: null };
      usage.set(id, value); value.calls++; value.activeCalls++;
      const started = performance.now();
      return (ok: boolean, duration?: number) => { value.activeCalls--; value.failures += ok ? 0 : 1; value.lastDurationMs = duration ?? performance.now() - started; value.lastUsedAt = new Date().toISOString(); };
    },
    async configure(id: string, policy: Policy) {
      const controller = controllers[id];
      if (!controller) throw new Error('This capability does not expose a resident runtime.');
      if (typeof policy.startupLoad !== 'boolean' || typeof policy.keepWarm !== 'boolean') throw new Error('Runtime settings must be booleans.');
      const task = policyWrites.then(async () => { const next = { ...policies, [id]: { ...policy } }; await store.save({ schemaVersion: 1, policies: next }); policies = next; controller.setKeepWarm(policy.keepWarm); });
      policyWrites = task.catch(() => undefined);
      await task;
      if (policy.startupLoad || policy.keepWarm) void controller.prepare().catch(() => undefined);
      return snapshot();
    },
    async prepare(id: string) {
      if (!controllers[id]) throw new Error('This capability does not expose a resident runtime.');
      return controllers[id].prepare();
    },
    startRecording() { return serializeRecording(async () => {
      if (recording) return recording;
      await fs.mkdir(recordingsRoot, { recursive: true });
      const startedAt = new Date().toISOString();
      const file = path.join(recordingsRoot, startedAt.replace(/[:.]/g, '-') + '-' + randomUUID() + '.jsonl');
      await fs.writeFile(file, '', { flag: 'wx' });
      recording = { file, startedAt };
      recordSample(); recordingTimer = setInterval(recordSample, 1000); recordingTimer.unref();
      return recording;
    }); },
    stopRecording() { return serializeRecording(async () => {
      if (recordingTimer) clearInterval(recordingTimer);
      recordingTimer = null;
      const stopped = recording; recording = null;
      await writes;
      return stopped;
    }); },
    async recordings() {
      await fs.mkdir(recordingsRoot, { recursive: true });
      return Promise.all((await fs.readdir(recordingsRoot)).filter(name => name.endsWith('.jsonl')).sort().reverse().map(async name => {
        const file = path.join(recordingsRoot, name), stat = await fs.stat(file);
        return { file, name, bytes: stat.size, createdAt: stat.birthtime.toISOString() };
      }));
    },
  };
}

export function capabilityForOperation(operation: string): string | null {
  if (/^office-editor-(open|save|close|close-owner)$/.test(operation)) return 'officeEditor';
  if (operation === 'search') return 'everything';
  if (['copy', 'move', 'rename', 'delete'].includes(operation)) return 'directoryOpus';
  if (operation === 'preview') return 'filePreview';
  const prefix = /^preview-(pdf|html|native|revit|calibre|autocad|mlightcad|powerpoint)-(open|close)$/.exec(operation);
  if (prefix) return ({ pdf: 'pdfPreview', html: 'htmlPreview', native: 'windowsPreview', revit: 'revitPreview', calibre: 'calibrePreview', autocad: 'autoCadPreview', mlightcad: 'mlightCadPreview', powerpoint: 'powerPointPreview' } as Record<string, string>)[prefix[1]!] ?? null;
  if (/^browser-(tab-create|tab-close|navigate)$/.test(operation)) return 'webBrowser';
  return null;
}
