/**
 * Which build of Papers is this, and where is it running from?
 *
 * Papers runs on more than one machine. Until now every copy reported version
 * `1.0.0` and nothing else, so "are these two machines running the same Papers?"
 * could not be answered from inside the product — the version string had never
 * changed and no build carried any other mark.
 *
 * Two different kinds of fact are combined here, and the distinction matters:
 *
 *   - The **build stamp** (commit, branch, build time) is fixed when Papers is
 *     packaged. It is genuinely a property of the build, so baking it in is
 *     correct — unlike a folder path, which is a property of one machine and must
 *     never be baked in (see D-016).
 *   - The **installation facts** (which folder Papers runs from, where its data
 *     lives, the computer's name) are read at run time, because they differ per
 *     machine by definition.
 *
 * Together they answer the real question: two machines match when their commits
 * match, and when they differ, the paths show which copy is which.
 */
import { app } from 'electron';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

/**
 * Injected at build time by electron-vite (see `electron.vite.config.ts`).
 * `unknown` is the honest answer for a build made outside git or before this
 * stamping existed — Papers says so rather than inventing a value.
 */
declare const __PAPERS_COMMIT__: string;
declare const __PAPERS_BRANCH__: string;
declare const __PAPERS_BUILT_AT__: string;

function stamped(value: string | undefined, fallback = 'unknown'): string {
  return value && value.length > 0 ? value : fallback;
}

export interface BuildIdentity {
  /** Version from package.json, e.g. `1.0.0`. */
  version: string;
  /** Short git commit this build was made from, or `unknown`. */
  commit: string;
  /** Git branch this build was made from, or `unknown`. */
  branch: string;
  /** ISO timestamp of when this build was packaged, or `unknown`. */
  builtAt: string;
  /** True when running a packaged build rather than a development run. */
  packaged: boolean;
  /** The folder Papers.exe runs from — differs per machine. */
  installDir: string;
  /** The Papers data folder holding the runtime profile. */
  dataDir: string;
  /** This computer's name, so two machines are told apart at a glance. */
  machine: string;
  /**
   * A single short line safe to read aloud or paste into a message when
   * comparing two machines, e.g. `1.0.0 · a1b2c3d · MINH-DESKTOP`.
   */
  summary: string;
}

export function buildIdentity(): BuildIdentity {
  const version = app.getVersion();
  const commit = stamped(typeof __PAPERS_COMMIT__ === 'string' ? __PAPERS_COMMIT__ : undefined);
  const branch = stamped(typeof __PAPERS_BRANCH__ === 'string' ? __PAPERS_BRANCH__ : undefined);
  const builtAt = stamped(typeof __PAPERS_BUILT_AT__ === 'string' ? __PAPERS_BUILT_AT__ : undefined);
  const machine = hostname();

  return {
    version,
    commit,
    branch,
    builtAt,
    packaged: app.isPackaged,
    installDir: dirname(app.getPath('exe')),
    dataDir: app.getPath('userData'),
    machine,
    summary: `${version} · ${commit} · ${machine}`,
  };
}
