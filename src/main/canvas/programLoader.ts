/**
 * ProgramLoader — discovers and validates bundled first-party program
 * packages. Only programs whose manifest validates are loadable; nothing is
 * ever downloaded or loaded from arbitrary local folders.
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

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Follow static, local assets from the HTML entry and ES-module/CSS imports.
 * Bundled programs are served as files rather than passed through Vite, so a
 * missing script otherwise becomes a silent blank program at runtime.
 */
async function validateLocalAssetGraph(programDir: string, entry: string): Promise<string | null> {
  const pending = [entry];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const relativeAsset = pending.shift();
    if (!relativeAsset || visited.has(relativeAsset)) continue;
    visited.add(relativeAsset);

    const assetPath = path.resolve(programDir, relativeAsset);
    const relativeToProgram = path.relative(programDir, assetPath);
    if (relativeToProgram.startsWith('..') || path.isAbsolute(relativeToProgram)) {
      return `referenced asset "${relativeAsset}" escapes program directory`;
    }

    let source: string;
    try {
      const stat = await fs.stat(assetPath);
      if (!stat.isFile()) return `referenced asset "${relativeAsset}" is not a file`;
      source = await fs.readFile(assetPath, 'utf8');
    } catch {
      return `referenced asset "${relativeAsset}" not found`;
    }

    const extension = path.extname(assetPath).toLowerCase();
    const references: string[] = [];
    if (extension === '.html' || extension === '.htm') {
      for (const match of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        if (match[1]) references.push(match[1]);
      }
    } else if (extension === '.js' || extension === '.mjs') {
      for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
        if (match[1]) references.push(match[1]);
      }
      for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        if (match[1]) references.push(match[1]);
      }
    } else if (extension === '.css') {
      for (const match of source.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s]+)["']?\s*\)?/gi)) {
        if (match[1]) references.push(match[1]);
      }
      for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        if (match[1]) references.push(match[1]);
      }
    }

    for (const reference of references) {
      const cleaned = reference.split(/[?#]/, 1)[0]?.trim();
      if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//') || URL_SCHEME.test(cleaned)) {
        continue;
      }
      const resolved = path.resolve(path.dirname(assetPath), cleaned);
      pending.push(path.relative(programDir, resolved));
    }
  }
  return null;
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

    const assetProblem = await validateLocalAssetGraph(dir, result.data.entry);
    if (assetProblem) {
      issues.push({ directory: entry, problem: assetProblem });
      continue;
    }

    programs.set(result.data.id, result.data);
  }

  return { programs, issues };
}
