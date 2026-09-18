import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PersistedWindowMemberDescriptor, WindowResolveResult, WindowRuntimeCapability } from './windowCapabilityService';
import type { WindowBounds, WindowCapabilityResult } from './windowCapabilityTypes';

const JOURNAL_VERSION = 1 as const;
const MAX_ENTRIES = 64;

export interface AdoptedWindowRecoveryEntry {
  version: typeof JOURNAL_VERSION;
  recoveryId: string;
  descriptor: PersistedWindowMemberDescriptor;
  originalBounds: WindowBounds;
  recordedAt: number;
}

export interface AdoptedWindowRecoveryJournal {
  arm(entry: Omit<AdoptedWindowRecoveryEntry, 'version'>): Promise<void>;
  clear(recoveryId: string): Promise<void>;
  entries(): AdoptedWindowRecoveryEntry[];
  flush(): Promise<void>;
}

function validBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))
    && Number(bounds.width) > 0
    && Number(bounds.height) > 0;
}

function validDescriptor(value: unknown): value is PersistedWindowMemberDescriptor {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as Record<string, unknown>;
  return descriptor.version === 1 && typeof descriptor.title === 'string'
    && descriptor.title.length <= 256
    && (descriptor.windowInstanceId === undefined || typeof descriptor.windowInstanceId === 'string')
    && (descriptor.executableFingerprint === undefined || typeof descriptor.executableFingerprint === 'string');
}

function parseEntries(value: unknown): AdoptedWindowRecoveryEntry[] {
  if (!value || typeof value !== 'object') return [];
  if ((value as { version?: unknown }).version !== JOURNAL_VERSION) return [];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const parsed: AdoptedWindowRecoveryEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    if (candidate.version !== JOURNAL_VERSION
      || typeof candidate.recoveryId !== 'string'
      || candidate.recoveryId.length < 1
      || candidate.recoveryId.length > 128
      || !validDescriptor(candidate.descriptor)
      || !validBounds(candidate.originalBounds)
      || typeof candidate.recordedAt !== 'number'
      || !Number.isFinite(candidate.recordedAt)) continue;
    parsed.push({
      version: JOURNAL_VERSION,
      recoveryId: candidate.recoveryId,
      descriptor: { ...candidate.descriptor },
      originalBounds: { ...(candidate.originalBounds as WindowBounds) },
      recordedAt: candidate.recordedAt,
    });
    if (parsed.length >= MAX_ENTRIES) break;
  }
  return parsed;
}

export function createAdoptedWindowRecoveryJournal(filePath: string): AdoptedWindowRecoveryJournal {
  let entries = new Map<string, AdoptedWindowRecoveryEntry>();
  let loaded = false;
  let writeTail = Promise.resolve();

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = parseEntries(JSON.parse(await readFile(filePath, 'utf8')));
      entries = new Map(parsed.map((entry) => [entry.recoveryId, entry]));
    } catch {
      // Missing, malformed, or partially-written journals are treated as an
      // empty set. A later successful arm replaces the file atomically.
      entries = new Map();
    }
  }

  function ensureLoadedSynchronously(): void {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = parseEntries(JSON.parse(readFileSync(filePath, 'utf8')));
      entries = new Map(parsed.map((entry) => [entry.recoveryId, entry]));
    } catch {
      entries = new Map();
    }
  }

  async function writeSnapshot(): Promise<void> {
    const snapshot = {
      version: JOURNAL_VERSION,
      entries: [...entries.values()].slice(-MAX_ENTRIES),
    };
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    await rename(temporary, filePath);
  }

  function scheduleWrite(): Promise<void> {
    // A failed disk write must not poison every later arm/clear operation;
    // the next mutation gets a fresh atomic attempt.
    writeTail = writeTail.catch(() => undefined).then(writeSnapshot);
    return writeTail;
  }

  return {
    async arm(entry) {
      await ensureLoaded();
      entries.set(entry.recoveryId, {
        version: JOURNAL_VERSION,
        recoveryId: entry.recoveryId,
        descriptor: { ...entry.descriptor },
        originalBounds: { ...entry.originalBounds },
        recordedAt: entry.recordedAt,
      });
      if (entries.size > MAX_ENTRIES) {
        const oldest = [...entries.values()].sort((a, b) => a.recordedAt - b.recordedAt)[0];
        if (oldest) entries.delete(oldest.recoveryId);
      }
      await scheduleWrite();
    },
    async clear(recoveryId) {
      await ensureLoaded();
      if (!entries.delete(recoveryId)) return;
      await scheduleWrite();
    },
    entries() {
      ensureLoadedSynchronously();
      return [...entries.values()].map((entry) => ({
        ...entry,
        descriptor: { ...entry.descriptor },
        originalBounds: { ...entry.originalBounds },
      }));
    },
    async flush() {
      await ensureLoaded();
      await writeTail;
    },
  };
}

export interface AdoptedWindowRecoveryService {
  resolvePersisted(descriptor: PersistedWindowMemberDescriptor): Promise<WindowResolveResult>;
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  placeAdoptedCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult>;
}

export interface AdoptedWindowRecoveryReport {
  restored: number;
  missing: number;
  deferred: number;
}

/** Restore entries left by an ungraceful Papers exit. Entries are cleared only
 * after proven restoration or proven target disappearance; ambiguity and
 * helper failures remain durable for a later launch. */
export async function recoverAdoptedWindows(
  journal: AdoptedWindowRecoveryJournal,
  service: AdoptedWindowRecoveryService,
): Promise<AdoptedWindowRecoveryReport> {
  const report: AdoptedWindowRecoveryReport = { restored: 0, missing: 0, deferred: 0 };
  for (const entry of journal.entries()) {
    let resolved: WindowResolveResult;
    try {
      resolved = await service.resolvePersisted(entry.descriptor);
    } catch {
      report.deferred += 1;
      continue;
    }
    if (resolved.outcome === 'missing') {
      await journal.clear(entry.recoveryId).catch(() => undefined);
      report.missing += 1;
      continue;
    }
    if (resolved.outcome !== 'success') {
      report.deferred += 1;
      continue;
    }
    const observed = await service.observeCapability(resolved.capability).catch(() => null);
    if (!observed || observed.outcome !== 'success' || !observed.observation || observed.observation.bounds === null) {
      report.deferred += 1;
      continue;
    }
    const restored = await service.placeAdoptedCapability(resolved.capability, entry.originalBounds).catch(() => ({ outcome: 'helper-unavailable' as const }));
    if (restored.outcome === 'success') {
      await journal.clear(entry.recoveryId).catch(() => undefined);
      report.restored += 1;
    } else {
      report.deferred += 1;
    }
  }
  return report;
}
