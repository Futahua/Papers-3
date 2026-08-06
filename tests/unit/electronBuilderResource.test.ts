import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Dependency-free package-configuration gate (Assignment 014R FINDING 4):
 * electron-builder.yml must include EXACTLY ONE intended
 * `resources/window-helper -> window-helper` extraResources mapping and no
 * broader `resources/` or `tests/` mapping that could ship this helper.
 */

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

  it('ships no broader resources or tests mapping for this helper', () => {
    const broader = entries.filter((entry) => entry.from !== 'resources/window-helper'
      && (entry.from.startsWith('resources') || entry.from.startsWith('tests') || entry.from.includes('window-helper')));
    expect(broader).toHaveLength(0);
  });

  it('keeps the helper out of the app bundle', () => {
    expect(yml).toContain('asar: true');
    const filesSection = yml.split(/^files:$/m)[1]?.split(/^[a-z]/m)[0] ?? '';
    expect(filesSection).not.toContain('window-helper');
    expect(filesSection).not.toContain('resources/');
  });
});
