/**
 * Papers-owned window-helper resource paths, provenance and validation
 * (Assignment 014/014R).
 *
 * The helper PowerShell scripts ship as a packaged resource OUTSIDE app.asar
 * (narrow `extraResources` entry in electron-builder.yml). This module owns
 * the ONLY path derivation: an explicit dev layout (appPath/resources/
 * window-helper) and an explicit packaged layout (resourcesPath/
 * window-helper). Nothing here reads renderer input or the working
 * directory, and the factory never exposes these paths.
 *
 * Provenance lock (014R FINDING 1): the exact accepted protocol version,
 * the exact two resource basenames, the manifest executable and the fixed
 * argument prefix are compiled into this module; SHA-256 for both resource
 * files is pinned HERE and in manifest.json. Validation requires:
 *   manifest hashes == compiled expected hashes
 *   AND actual resource bytes == those hashes.
 * Resource-only tampering (including a one-byte script mutation) fails
 * before any spawn; a deliberate future helper edit requires an explicit
 * reviewed code+manifest update. Duplicates, extras, separators/
 * traversal and mismatched supplied path objects are rejected. Errors are
 * bounded and never disclose script contents.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { WINDOW_HELPER_ARGUMENT_PREFIX, WINDOW_HELPER_EXECUTABLE } from './windowHelperSpawn';

export const WINDOW_HELPER_PROTOCOL_VERSION = '017';
export const WINDOW_HELPER_RESOURCE_DIRECTORY_NAME = 'window-helper';
export const WINDOW_HELPER_MANIFEST_FILE = 'manifest.json';
export const WINDOW_HELPER_SCRIPT_FILE = 'window-helper.ps1';
export const WINDOW_HELPER_ADAPTER_FILE = 'window-capability.ps1';

/** Compiled pin of the accepted resource bytes. A future reviewed helper
 * edit updates these hashes AND manifest.json together. */
export const WINDOW_HELPER_EXPECTED_HASHES: Record<string, string> = {
  [WINDOW_HELPER_SCRIPT_FILE]: 'd1e69c080ca46d7a399612932e38e4c5a82dc66d1aaa178777ba2560a8e35c0a',
  [WINDOW_HELPER_ADAPTER_FILE]: '28cf27c83cb246ac65cdd9ca1dd113aea569cb711bed3828775f1b1b1a834e8a',
};

export interface WindowHelperResourcePaths {
  directory: string;
  helperPath: string;
  adapterPath: string;
  manifestPath: string;
}

export function resolveWindowHelperResourcePaths(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): WindowHelperResourcePaths {
  const directory = input.packaged
    ? path.join(input.resourcesPath, WINDOW_HELPER_RESOURCE_DIRECTORY_NAME)
    : path.join(input.appPath, 'resources', WINDOW_HELPER_RESOURCE_DIRECTORY_NAME);
  return {
    directory,
    helperPath: path.join(directory, WINDOW_HELPER_SCRIPT_FILE),
    adapterPath: path.join(directory, WINDOW_HELPER_ADAPTER_FILE),
    manifestPath: path.join(directory, WINDOW_HELPER_MANIFEST_FILE),
  };
}

export interface WindowHelperResourceValidation {
  ok: boolean;
  reason?: string;
}

function sha256OfFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Canonical file names exactly: array length AND set size equal the exact
 * expected length (2), every canonical basename exactly once (order
 * irrelevant), no duplicates or extras, and no separators or traversal
 * (each name must be its own basename). */
function parseResourceFileList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const names = raw.map((entry) => (typeof entry === 'string' ? entry : null));
  if (names.some((name) => name === null || name === '' || name === undefined)) return null;
  const list = names as string[];
  const expected = [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE];
  const seen = new Set<string>(list);
  if (list.length !== expected.length || seen.size !== expected.length) return null;
  for (const name of expected) {
    if (!seen.has(name)) return null;
  }
  for (const name of list) {
    if (path.basename(name) !== name) return null;
  }
  return list;
}

function parseManifestHashes(raw: unknown): Record<string, string> | null {
  if (!isPlainObject(raw)) return null;
  const expected = [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE];
  const names = Object.keys(raw);
  if (names.length !== expected.length) return null;
  for (const name of names) {
    if (!expected.includes(name)) return null;
    const hash = raw[name];
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null;
  }
  return raw as Record<string, string>;
}

export function validateWindowHelperResource(paths: WindowHelperResourcePaths): WindowHelperResourceValidation {
  // Supplied path objects must match the canonical files under the directory.
  if (paths.helperPath !== path.join(paths.directory, WINDOW_HELPER_SCRIPT_FILE)
    || paths.adapterPath !== path.join(paths.directory, WINDOW_HELPER_ADAPTER_FILE)
    || paths.manifestPath !== path.join(paths.directory, WINDOW_HELPER_MANIFEST_FILE)) {
    return { ok: false, reason: 'window helper paths do not match the canonical resource layout' };
  }

  let manifest: unknown;
  try {
    const raw = fs.readFileSync(paths.manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'window helper manifest is missing or unreadable' };
  }
  if (!isPlainObject(manifest)) {
    return { ok: false, reason: 'window helper manifest is not an object' };
  }
  if (manifest['protocolVersion'] !== WINDOW_HELPER_PROTOCOL_VERSION) {
    return { ok: false, reason: 'window helper manifest protocol version mismatch' };
  }
  if (manifest['executable'] !== WINDOW_HELPER_EXECUTABLE) {
    return { ok: false, reason: 'window helper manifest executable mismatch' };
  }
  const spawnArguments = manifest['spawnArguments'];
  if (!Array.isArray(spawnArguments)
    || spawnArguments.length !== WINDOW_HELPER_ARGUMENT_PREFIX.length
    || spawnArguments.some((arg, index) => arg !== WINDOW_HELPER_ARGUMENT_PREFIX[index])) {
    return { ok: false, reason: 'window helper manifest argument prefix mismatch' };
  }
  const files = parseResourceFileList(manifest['files']);
  if (files === null) {
    return { ok: false, reason: 'window helper manifest file list is not the exact canonical set' };
  }
  const hashes = parseManifestHashes(manifest['hashes']);
  if (hashes === null) {
    return { ok: false, reason: 'window helper manifest hashes are not the exact canonical set' };
  }
  for (const file of files) {
    if (hashes[file] !== WINDOW_HELPER_EXPECTED_HASHES[file]) {
      return { ok: false, reason: `window helper manifest hash mismatch: ${file}` };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(paths.directory, file));
    } catch {
      return { ok: false, reason: `window helper resource file is missing or empty: ${file}` };
    }
    if (!stat.isFile() || stat.size <= 0) {
      return { ok: false, reason: `window helper resource file is missing or empty: ${file}` };
    }
    try {
      if (sha256OfFile(path.join(paths.directory, file)) !== WINDOW_HELPER_EXPECTED_HASHES[file]) {
        return { ok: false, reason: `window helper resource hash mismatch: ${file}` };
      }
    } catch {
      return { ok: false, reason: `window helper resource file is unreadable: ${file}` };
    }
  }
  return { ok: true };
}
