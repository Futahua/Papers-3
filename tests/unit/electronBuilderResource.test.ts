import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Dependency-free package-configuration gate (Assignment 014R FINDING 4):
 * electron-builder.yml must include EXACTLY the intended `extraResources`
 * mappings and no broader `resources/` or `tests/` mapping that could ship more
 * than the two directories that are deliberately packaged:
 *   - `resources/window-helper -> window-helper`  the window helper scripts
 *   - `resources/native -> native`                the foreground bridge source
 */

const REPO_ROOT = path.join(__dirname, '../..');
const BUILDER_YML = path.join(__dirname, '../../electron-builder.yml');

interface ExtraResourceEntry {
  from: string;
  to: string;
}

function parseExtraResources(yml: string): ExtraResourceEntry[] {
  const entries: ExtraResourceEntry[] = [];
  const lines = yml.split(/\r?\n/);
  let inExtraResources = false;
  let pendingFrom: string | null = null;
  for (const line of lines) {
    if (/^extraResources:$/.test(line)) {
      inExtraResources = true;
      continue;
    }
    if (!inExtraResources) continue;
    const fromMatch = /^  - from: (.+)$/.exec(line);
    if (fromMatch) {
      pendingFrom = fromMatch[1]!;
      continue;
    }
    const toMatch = /^    to: (.+)$/.exec(line);
    if (toMatch && pendingFrom !== null) {
      entries.push({ from: pendingFrom, to: toMatch[1]! });
      pendingFrom = null;
      continue;
    }
    if (/^\S/.test(line) && !/^  - from:/.test(line)) {
      // A new top-level key ends the extraResources block.
      inExtraResources = false;
    }
  }
  return entries;
}

describe('electron-builder window-helper resource inclusion', () => {
  const yml = fs.readFileSync(BUILDER_YML, 'utf8');
  const entries = parseExtraResources(yml);

  it('includes exactly one window-helper extraResources mapping', () => {
    const helperEntries = entries.filter((entry) => entry.from === 'resources/window-helper');
    expect(helperEntries).toHaveLength(1);
    expect(helperEntries[0]!.to).toBe('window-helper');
  });

  it('ships exactly two resource mappings and no broader resources or tests mapping', () => {
    // The intent is that resources are mapped one directory at a time, never by
    // a glob that would sweep in tests, fixtures or the whole resources tree.
    // The exact set is asserted so a new mapping has to be a deliberate edit
    // here rather than an accident that silently widens what ships.
    const resourceMappings = entries
      .filter((entry) => entry.from.startsWith('resources'))
      .map((entry) => `${entry.from}->${entry.to}`)
      .sort();
    expect(resourceMappings).toEqual(['resources/native->native', 'resources/window-helper->window-helper']);

    const broader = entries.filter((entry) => entry.from.startsWith('tests')
      || (entry.from.startsWith('resources') && !/^resources\/(window-helper|native)$/.test(entry.from)));
    expect(broader).toHaveLength(0);
  });

  it('ships the native foreground bridge SOURCE, so no prebuilt binary is distributed', () => {
    const nativeEntries = entries.filter((entry) => entry.from === 'resources/native');
    expect(nativeEntries).toHaveLength(1);
    expect(nativeEntries[0]!.to).toBe('native');
    expect(fs.existsSync(path.join(REPO_ROOT, 'resources', 'native', 'fg-bridge.cs'))).toBe(true);
  });

  it('keeps the helper out of the app bundle', () => {
    expect(yml).toContain('asar: true');
    const filesSection = yml.split(/^files:$/m)[1]?.split(/^[a-z]/m)[0] ?? '';
    expect(filesSection).not.toContain('window-helper');
    expect(filesSection).not.toContain('resources/');
  });
});
