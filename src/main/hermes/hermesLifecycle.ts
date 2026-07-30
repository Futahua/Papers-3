import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export type HermesConnection = {
  schemaVersion: 1;
  reportPort: number;
  controlPort: number;
  dockToken: string;
  desktopPid: number;
};

export type ReleasableProcess = {
  unref(): void;
  stderr?: unknown;
};

export function hermesUpdateProcessIds(
  current: { desktopPid?: number; backendPid?: number },
  adopted: { desktopPid: number } | null,
): number[] {
  return [
    current.desktopPid ?? adopted?.desktopPid,
    current.backendPid,
  ].filter((pid): pid is number => validPid(pid));
}

function unrefPipe(pipe: unknown): void {
  if (
    pipe &&
    typeof pipe === 'object' &&
    'unref' in pipe &&
    typeof (pipe as { unref?: unknown }).unref === 'function'
  ) {
    (pipe as { unref(): void }).unref();
  }
}

function validPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65_535;
}

function validPid(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function readHermesConnection(path: string): HermesConnection | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<HermesConnection>;
    if (
      value.schemaVersion !== 1 ||
      !validPort(value.reportPort) ||
      !validPort(value.controlPort) ||
      typeof value.dockToken !== 'string' ||
      value.dockToken.length < 1 ||
      !validPid(value.desktopPid)
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      reportPort: value.reportPort,
      controlPort: value.controlPort,
      dockToken: value.dockToken,
      desktopPid: value.desktopPid,
    };
  } catch {
    return null;
  }
}

export function writeHermesConnection(path: string, connection: HermesConnection): void {
  writeFileSync(path, JSON.stringify(connection), { encoding: 'utf8', mode: 0o600 });
}

export function clearHermesConnection(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* missing or already removed */
  }
}

/**
 * Papers launches Hermes when asked, but does not own Hermes' lifetime.
 * Releasing the child handles lets Papers exit while Hermes and its current
 * session continue running independently.
 */
export function leaveHermesRunning(
  desktop: ReleasableProcess | null,
  backend: ReleasableProcess | null,
): void {
  desktop?.unref();
  unrefPipe(desktop?.stderr);
  backend?.unref();
  unrefPipe(backend?.stderr);
}
