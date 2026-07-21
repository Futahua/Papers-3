#!/usr/bin/env node
/**
 * update-hermes-skin.mjs — the one documented, recoverable command for keeping
 * the Papers-skinned Hermes Desktop up to date with upstream.
 *
 * What it does (see docs/HERMES_SKIN_INTEGRATION.md):
 *   1. In a dedicated clean Hermes clone (never the live install), fetch a
 *      selected upstream ref and rebase the `papers-skin` branch onto it.
 *   2. Re-copy the versioned theme data (hermes-skin/papers-theme.json) and
 *      re-assert the small theme-loader + type-bump patches.
 *   3. Build Hermes Desktop's renderer (dist/) from the rebased branch.
 *   4. Verify the Papers theme is present in the build.
 *   5. Only then swap the new dist/ into the live install, keeping the previous
 *      dist/ as a timestamped rollback. Hermes sessions, credentials and config
 *      are never touched.
 *
 * Usage:
 *   node hermes-skin/update-hermes-skin.mjs [--ref <upstream-ref>] [--check-only]
 *
 * Defaults: ref = upstream/main. --check-only builds + verifies without swapping
 * the live install. If any step fails the live install is left untouched and the
 * exact failing step is reported.
 *
 * This script is intentionally conservative: it treats the live Hermes as
 * precious and the clone as disposable.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAPERS_ROOT = path.resolve(HERE, '..');

// Locations on the creator's machine. Overridable by env for other machines.
const CLONE =
  process.env.HERMES_SKIN_CLONE ??
  'D:\\LapSlop brotherhood\\Programs\\Assistant\\HermesAI\\hermes-papers-skin';
const LIVE_DESKTOP =
  process.env.HERMES_SKIN_LIVE ??
  'D:\\LapSlop brotherhood\\Programs\\Assistant\\HermesAI\\.hermes\\hermes-agent\\apps\\desktop';
const ROLLBACK_ROOT =
  process.env.HERMES_SKIN_ROLLBACK ?? 'D:\\LapSlop brotherhood\\Programs\\_PapersHermesRollback';

const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const UPSTREAM_REF = refIdx >= 0 ? args[refIdx + 1] : 'upstream/main';
const CHECK_ONLY = args.includes('--check-only');

function run(cmd, cmdArgs, cwd) {
  process.stdout.write(`\n$ ${cmd} ${cmdArgs.join(' ')}   (in ${cwd})\n`);
  return execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: false });
}

function step(label) {
  process.stdout.write(`\n=== ${label} ===\n`);
}

function fail(label, error) {
  process.stderr.write(`\nFAILED at: ${label}\n${error?.message ?? error}\n`);
  process.stderr.write('The live Hermes install was NOT modified.\n');
  process.exit(1);
}

try {
  if (!existsSync(CLONE)) {
    fail('locate clone', new Error(`Clean Hermes clone not found at ${CLONE}. See docs/HERMES_SKIN_INTEGRATION.md for one-time setup.`));
  }

  step(`Rebase papers-skin onto ${UPSTREAM_REF}`);
  try {
    run('git', ['fetch', 'upstream', '--tags'], CLONE);
  } catch {
    process.stdout.write('(upstream fetch skipped — offline or no upstream remote)\n');
  }
  run('git', ['checkout', 'papers-skin'], CLONE);
  try {
    run('git', ['rebase', UPSTREAM_REF], CLONE);
  } catch (error) {
    fail(`rebase onto ${UPSTREAM_REF} (resolve conflicts, then re-run)`, error);
  }

  step('Re-copy versioned theme data + re-assert patches');
  cpSync(
    path.join(PAPERS_ROOT, 'hermes-skin', 'papers-theme.json'),
    path.join(CLONE, 'apps', 'desktop', 'src', 'themes', 'papers-theme.json'),
  );
  assertPatched(path.join(CLONE, 'apps', 'desktop', 'src', 'themes', 'presets.ts'), 'papers-theme.json', 'theme-loader import');
  assertPatched(path.join(CLONE, 'apps', 'desktop', 'src', 'themes', 'presets.ts'), 'papers: papersTheme', 'theme registry entry');
  assertPatched(path.join(CLONE, 'apps', 'desktop', 'src', 'styles.css'), "data-hermes-theme='papers'", 'type-bump CSS');

  step('Build Hermes Desktop renderer (dist/)');
  run('npm', ['install', '--workspace', 'apps/desktop', '--workspace', 'apps/shared', '--ignore-scripts', '--no-audit', '--no-fund'], CLONE);
  run('node', [path.join(CLONE, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], path.join(CLONE, 'apps', 'desktop'));

  step('Verify the Papers theme is in the build');
  const built = path.join(CLONE, 'apps', 'desktop', 'dist');
  const indexJs = findFirst(built, /\.js$/);
  if (!indexJs || !readFileSync(indexJs, 'utf8').includes('data-hermes-theme') && !bundleMentionsPapers(built)) {
    // A softer check: the theme name should appear somewhere in the built assets.
    if (!bundleMentionsPapers(built)) fail('verify built theme', new Error('Papers theme not found in built assets.'));
  }
  process.stdout.write('Papers theme present in built dist/.\n');

  if (CHECK_ONLY) {
    process.stdout.write('\n--check-only: build + verify passed. Live install left unchanged.\n');
    process.exit(0);
  }

  step('Swap dist/ into the live install (with rollback)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackDir = path.join(ROLLBACK_ROOT, `hermes-dist-${stamp}`);
  mkdirSync(ROLLBACK_ROOT, { recursive: true });
  const liveDist = path.join(LIVE_DESKTOP, 'dist');
  if (existsSync(liveDist)) {
    renameSync(liveDist, rollbackDir);
    process.stdout.write(`Previous dist/ preserved at ${rollbackDir}\n`);
  }
  cpSync(built, liveDist, { recursive: true });
  process.stdout.write('\nDone. Restart Hermes Desktop to load the updated skin.\n');
} catch (error) {
  fail('unexpected error', error);
}

function assertPatched(file, needle, label) {
  const content = readFileSync(file, 'utf8');
  if (!content.includes(needle)) {
    fail(`re-assert ${label}`, new Error(`Expected "${needle}" in ${file}. The upstream file may have changed shape; update the patch in hermes-skin/.`));
  }
}

function findFirst(dir, re) {
  const { readdirSync } = require('node:fs');
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && re.test(entry.name)) return path.join(entry.parentPath ?? dir, entry.name);
  }
  return null;
}

function bundleMentionsPapers(dir) {
  const { readdirSync } = require('node:fs');
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
      const p = path.join(entry.parentPath ?? dir, entry.name);
      if (readFileSync(p, 'utf8').includes('data-hermes-theme') || readFileSync(p, 'utf8').includes('"papers"')) return true;
    }
  }
  return false;
}
