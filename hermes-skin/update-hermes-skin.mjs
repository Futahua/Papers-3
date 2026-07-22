#!/usr/bin/env node
/**
 * Manual recovery for the Papers ↔ Hermes integration.
 *
 * Normal updates require no terminal: use Hermes Settings → Updates. Hermes
 * asks Papers to close both processes, Papers runs Hermes' official updater,
 * reapplies this overlay, rebuilds Hermes Desktop, and reopens itself.
 *
 * This command is only a fallback when that handoff was interrupted:
 *   node hermes-skin/update-hermes-skin.mjs --check-only
 *   node hermes-skin/update-hermes-skin.mjs --repair
 *   node hermes-skin/update-hermes-skin.mjs --repair --build
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hermesRoot =
  process.env.PAPERS_HERMES_ROOT ??
  'D:\\LapSlop brotherhood\\Programs\\Assistant\\HermesAI\\.hermes\\hermes-agent';
const hermesHome = path.resolve(hermesRoot, '..');
const patchFile = path.join(here, 'papers-integration.patch');
const pluginFile = path.join(here, 'papers-theme-plugin.js');
const pluginTarget = path.join(hermesHome, 'desktop-plugins', 'papers-theme', 'plugin.js');
const repair = process.argv.includes('--repair');
const build = process.argv.includes('--build');

function gitApply(args, quiet = false) {
  return spawnSync('git', ['-C', hermesRoot, 'apply', ...args, patchFile], {
    stdio: quiet ? 'ignore' : 'inherit',
    shell: false,
  }).status === 0;
}

if (!existsSync(hermesRoot) || !existsSync(patchFile) || !existsSync(pluginFile)) {
  throw new Error('Hermes or the Papers integration files could not be found.');
}

const canApply = gitApply(['--check'], true);
const alreadyApplied = canApply ? false : gitApply(['--reverse', '--check'], true);

if (!repair) {
  if (!alreadyApplied) {
    throw new Error(
      canApply
        ? 'The Papers integration is not installed. Run again with --repair.'
        : 'Hermes changed around the Papers seam. Refresh papers-integration.patch before rebuilding.',
    );
  }
  if (!existsSync(pluginTarget)) throw new Error('The Papers theme plugin is not installed. Run with --repair.');
  console.log('Papers ↔ Hermes integration is installed.');
  process.exit(0);
}

if (canApply && !gitApply([])) throw new Error('Could not apply the Papers integration patch.');
if (!canApply && !alreadyApplied) throw new Error('The Papers integration patch does not fit this Hermes version.');

mkdirSync(path.dirname(pluginTarget), { recursive: true });
cpSync(pluginFile, pluginTarget);
console.log('Papers integration and theme plugin are installed.');

if (build) {
  const hermesExe = path.join(hermesRoot, 'venv', 'Scripts', 'hermes.exe');
  execFileSync(hermesExe, ['desktop', '--build-only', '--force-build'], {
    cwd: hermesRoot,
    stdio: 'inherit',
    shell: false,
  });
}
