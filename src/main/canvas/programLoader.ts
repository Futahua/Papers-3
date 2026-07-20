/**
 * ProgramLoader — discovers and validates bundled first-party program
 * packages. Only programs whose manifest validates are loadable; nothing is
 * ever downloaded or loaded from arbitrary local folders (plan section 7).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { ProgramManifest } from '@shared/types';
import { programManifestSchema } from '@shared/schemas';

export interface ProgramLoadIssue {
  directory: string;
  problem: string;
}

export interface ProgramCatalog {
  programs: Map<string, ProgramManifest>;
  issues: ProgramLoadIssue[];
}

export async function loadProgramCatalog(programsRoot: string): Promise<ProgramCatalog> {
  const programs = new Map<string, ProgramManifest>();
  const issues: ProgramLoadIssue[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(programsRoot);
  } catch (err) {
    issues.push({ directory: programsRoot, problem: `programs root unreadable: ${String(err)}` });
    return { programs, issues };
  }

  for (const entry of entries) {
    const dir = path.join(programsRoot, entry);
    const manifestPath = path.join(dir, 'manifest.json');
    let raw: string;
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) continue;
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      issues.push({ directory: entry, problem: 'missing manifest.json' });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      issues.push({ directory: entry, problem: `manifest is not valid JSON: ${String(err)}` });
      continue;
    }

    const result = programManifestSchema.safeParse(parsed);
    if (!result.success) {
      issues.push({
        directory: entry,
        problem: `manifest failed validation: ${result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
      continue;
    }

    if (result.data.id !== entry) {
      issues.push({
        directory: entry,
        problem: `manifest id "${result.data.id}" must match directory name "${entry}"`,
      });
      continue;
    }

    const entryFile = path.normalize(path.join(dir, result.data.entry));
    const relative = path.relative(dir, entryFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      issues.push({ directory: entry, problem: 'entry escapes program directory' });
      continue;
    }
    try {
      await fs.access(entryFile);
    } catch {
      issues.push({ directory: entry, problem: `entry file "${result.data.entry}" not found` });
      continue;
    }

    programs.set(result.data.id, result.data);
  }

  return { programs, issues };
}
