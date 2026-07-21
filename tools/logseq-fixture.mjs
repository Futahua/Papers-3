#!/usr/bin/env node
/**
 * Logseq demonstration fixture.
 *
 * Creates a disposable shallow checkout of logseq/logseq at the pinned commit
 * OUTSIDE the Papers source tree and outside PapersData, verifies the pin,
 * and can cleanly remove the fixture and any Papers worktrees later.
 *
 *   node tools/logseq-fixture.mjs setup   [targetDir]
 *   node tools/logseq-fixture.mjs status  [targetDir]
 *   node tools/logseq-fixture.mjs cleanup [targetDir]
 *
 * Never pushes anywhere; never copies Logseq code into Papers.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LOGSEQ_REMOTE = 'https://github.com/logseq/logseq.git';
export const LOGSEQ_PINNED_COMMIT = 'a4963dca579f42817135d8473166a03fa7ea2409';
export const LOGSEQ_LICENSE = 'GNU Affero General Public License v3';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTarget = path.resolve(repoRoot, '..', 'papers3-fixtures', 'logseq');

async function git(cwd, args, timeout = 600_000) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 16_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function setupFixture(targetDir = defaultTarget) {
  if (targetDir.startsWith(repoRoot + path.sep)) {
    throw new Error('fixture must live outside the Papers source tree');
  }
  if (await exists(path.join(targetDir, '.git'))) {
    const head = await git(targetDir, ['rev-parse', 'HEAD']);
    if (head === LOGSEQ_PINNED_COMMIT) {
      console.log(`Fixture already present at ${targetDir} @ ${head} (pinned). Nothing to do.`);
      return { targetDir, commit: head, created: false };
    }
    throw new Error(
      `Directory ${targetDir} exists at commit ${head}, not the pinned ${LOGSEQ_PINNED_COMMIT}. ` +
        'Remove it manually or run cleanup first.',
    );
  }

  console.log(`Creating disposable Logseq checkout at ${targetDir}`);
  await fs.mkdir(targetDir, { recursive: true });
  await git(targetDir, ['init', '--initial-branch=master']);
  await git(targetDir, ['remote', 'add', 'origin', LOGSEQ_REMOTE]);
  console.log(`Fetching pinned commit ${LOGSEQ_PINNED_COMMIT} (shallow)…`);
  await git(targetDir, ['fetch', '--depth', '1', 'origin', LOGSEQ_PINNED_COMMIT]);
  await git(targetDir, ['checkout', '-B', 'master', LOGSEQ_PINNED_COMMIT]);
  // Safety: strip push capability so nothing can ever be pushed upstream.
  await git(targetDir, ['remote', 'set-url', '--push', 'origin', 'DISABLED-no-push']);

  const head = await git(targetDir, ['rev-parse', 'HEAD']);
  if (head !== LOGSEQ_PINNED_COMMIT) {
    throw new Error(`checkout mismatch: HEAD is ${head}`);
  }
  console.log(`OK — HEAD ${head}`);
  console.log(`License: ${LOGSEQ_LICENSE}. External fixture only; never vendored into Papers.`);
  return { targetDir, commit: head, created: true };
}

export async function fixtureStatus(targetDir = defaultTarget) {
  if (!(await exists(path.join(targetDir, '.git')))) {
    console.log(`No fixture at ${targetDir}`);
    return { present: false };
  }
  const head = await git(targetDir, ['rev-parse', 'HEAD']);
  const status = await git(targetDir, ['status', '--porcelain']);
  const worktrees = await git(targetDir, ['worktree', 'list', '--porcelain']);
  const pushUrl = await git(targetDir, ['remote', 'get-url', '--push', 'origin']).catch(() => '(no origin)');
  console.log(`Fixture: ${targetDir}`);
  console.log(`HEAD: ${head} ${head === LOGSEQ_PINNED_COMMIT ? '(pinned ✔)' : '(NOT PINNED ✘)'}`);
  console.log(`Base checkout clean: ${status.length === 0}`);
  console.log(`Push URL: ${pushUrl} ${pushUrl === 'DISABLED-no-push' ? '(disabled ✔)' : '(NOT DISABLED ✘)'}`);
  console.log(worktrees);
  return {
    present: true,
    commit: head,
    pinned: head === LOGSEQ_PINNED_COMMIT,
    clean: status.length === 0,
    pushDisabled: pushUrl === 'DISABLED-no-push',
  };
}

export async function cleanupFixture(targetDir = defaultTarget) {
  if (!(await exists(targetDir))) {
    console.log(`Nothing to clean at ${targetDir}`);
    return;
  }
  // Remove Papers worktrees first so git metadata stays consistent.
  const worktreesRoot = `${targetDir}-papers-worktrees`;
  if (await exists(path.join(targetDir, '.git'))) {
    try {
      const list = await git(targetDir, ['worktree', 'list', '--porcelain']);
      for (const line of list.split('\n')) {
        if (line.startsWith('worktree ') && !path.resolve(line.slice(9)).startsWith(path.resolve(targetDir))) {
          const wt = line.slice(9).trim();
          console.log(`Removing worktree ${wt}`);
          await git(targetDir, ['worktree', 'remove', '--force', wt]).catch(() => undefined);
        }
      }
    } catch {
      // proceed with directory removal
    }
  }
  await fs.rm(worktreesRoot, { recursive: true, force: true });
  await fs.rm(targetDir, { recursive: true, force: true });
  console.log(`Removed ${targetDir} and ${worktreesRoot}`);
}

const [, , command, targetArg] = process.argv;
const target = targetArg ? path.resolve(targetArg) : defaultTarget;
try {
  if (command === 'setup') await setupFixture(target);
  else if (command === 'status') await fixtureStatus(target);
  else if (command === 'cleanup') await cleanupFixture(target);
  else {
    console.log('Usage: node tools/logseq-fixture.mjs <setup|status|cleanup> [targetDir]');
    process.exitCode = 2;
  }
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
}
