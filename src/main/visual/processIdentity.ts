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
    canonicalFileId: string;
  };
}
export interface ProcessIdentityOptions {
  pid: number;
  executablePath: string;
  build: Pick<ControlBuildIdentity, 'version' | 'commit' | 'packaged'>;
  appInstanceId?: string;
  startedAt?: string;
  now?: () => Date;
  realpath?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{ dev: number; ino: number }>;
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
  const resolvePath = options.realpath ?? realpath;
  const readStat = options.stat ?? (async (path: string) => stat(path));
  const canonicalPath = await resolvePath(options.executablePath);
  const file = await readStat(canonicalPath);
  if (!Number.isSafeInteger(file.dev) || !Number.isSafeInteger(file.ino)
    || file.dev < 0 || file.ino <= 0) {
    throw new Error('Executable file identity is unavailable.');
  }

  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now().toISOString();
  const appInstanceId = options.appInstanceId ?? randomUUID();
  if (!appInstanceId || !startedAt) throw new Error('Process instance identity is incomplete.');

  return {
    pid: options.pid,
    appInstanceId,
    startedAt,
    build: {
      version: options.build.version,
      commit: options.build.commit,
      packaged: options.build.packaged,
    },
    executableIdentity: {
      // Do not return canonicalPath: it is useful to the resolver but is not
      // safe diagnostic output and is not restart evidence.
      canonicalFileId: `dev:${file.dev}:ino:${file.ino}`,
    },
  };
}
