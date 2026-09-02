import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';

import type { ControlBuildIdentity } from '../buildIdentity';

/**
 * Identity for one running Papers process.  This is deliberately not a
 * pathname: aliases can launch the same executable, while a fresh process
 * must still be distinguishable from the one that produced an old capture.
 */
export interface ProcessInstanceIdentity {
  pid: number;
  appInstanceId: string;
  startedAt: string;
  build: Pick<ControlBuildIdentity, 'version' | 'commit' | 'packaged'>;
  executableIdentity: {
    status: 'available';
    canonicalFileId: string;
  } | {
    status: 'unavailable';
  };
}
export interface ProcessIdentityOptions {
  pid: number;
  executablePath: string;
  build: Pick<ControlBuildIdentity, 'version' | 'commit' | 'packaged'>;
  appInstanceId?: string;
  startedAt?: string;
  realpath?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{ dev: bigint; ino: bigint }>;
}

const processAppInstanceId = randomUUID();
const processStartedAt = processStartTime();

export function processStartTime(
  now: () => Date = () => new Date(),
  uptime: () => number = () => process.uptime(),
): string {
  return new Date(now().getTime() - Math.max(0, uptime()) * 1000).toISOString();
}

/** The stable process-lifetime values used when diagnostics are initialized
 * after startup. This is intentionally not the time of the first query. */
export function currentProcessInstanceSeed(): { appInstanceId: string; startedAt: string } {
  return { appInstanceId: processAppInstanceId, startedAt: processStartedAt };
}

/**
 * Resolve the executable once, at process startup.  On Windows Node exposes
 * the volume/device and file identity through stat; unlike comparing strings,
 * this remains the same when startup went through a junction or symlink.
 */
export async function createProcessInstanceIdentity(
  options: ProcessIdentityOptions,
): Promise<ProcessInstanceIdentity> {
  if (!Number.isSafeInteger(options.pid) || options.pid <= 0) {
    throw new Error('Process identity requires a positive pid.');
  }
  const seed = currentProcessInstanceSeed();
  const startedAt = options.startedAt ?? seed.startedAt;
  const appInstanceId = options.appInstanceId ?? seed.appInstanceId;
  if (!appInstanceId || !startedAt) throw new Error('Process instance identity is incomplete.');

  let executableIdentity: ProcessInstanceIdentity['executableIdentity'] = { status: 'unavailable' };
  try {
    const resolvePath = options.realpath ?? realpath;
    const readStat = options.stat ?? (async (path: string) => stat(path, { bigint: true }));
    const canonicalPath = await resolvePath(options.executablePath);
    const file = await readStat(canonicalPath);
    if (file.dev >= 0n && file.ino > 0n) {
      executableIdentity = {
        status: 'available',
        // Keep the Windows file id lossless; it must never pass through JS
        // Number (which would corrupt values above 2^53).
        canonicalFileId: `dev:${file.dev}:ino:${file.ino}`,
      };
    }
  } catch {
    // PID + app-instance + process-start identity remain valid when a
    // filesystem cannot provide a stable file identity. Never use a path as
    // a fallback and never prevent the opt-in control plane from starting.
  }

  return {
    pid: options.pid,
    appInstanceId,
    startedAt,
    build: {
      version: options.build.version,
      commit: options.build.commit,
      packaged: options.build.packaged,
    },
    executableIdentity,
  };
}
