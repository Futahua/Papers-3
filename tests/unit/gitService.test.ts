import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';

import { GitService } from '../../src/main/git/gitService';

const execFileAsync = promisify(execFile);
const service = new GitService();

let dir: string;
let repo: string;
let worktreesRoot: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout;
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-git-'));
  repo = path.join(dir, 'fixture-repo');
  worktreesRoot = path.join(dir, 'worktrees');
  await fs.mkdir(repo, { recursive: true });
  await git(repo, 'init', '--initial-branch=main');
  await git(repo, 'config', 'user.email', 'fixture@papers3.test');
  await git(repo, 'config', 'user.name', 'Papers Fixture');
  await fs.writeFile(path.join(repo, 'README.md'), '# Fixture\n\nSearchable needle alpha.\n');
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  await fs.writeFile(path.join(repo, 'src', 'index.js'), 'export const needle = "beta";\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', 'fixture: initial');
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('GitService', () => {
  it('detects repositories', async () => {
    expect(await service.isRepository(repo)).toBe(true);
    expect(await service.isRepository(os.tmpdir())).toBe(false);
  });

  it('reads structured repo info', async () => {
    const info = await service.info(repo);
    expect(info.branch).toBe('main');
    expect(info.headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(info.headSubject).toBe('fixture: initial');
    expect(info.clean).toBe(true);
  });

  it('lists tracked files', async () => {
    const { files, truncated } = await service.listFiles(repo);
    expect(files).toContain('README.md');
    expect(files).toContain('src/index.js');
    expect(truncated).toBe(false);
  });

  it('reads files with HEAD provenance', async () => {
    const file = await service.readFile(repo, 'README.md');
    expect(file.content).toContain('needle alpha');
    expect(file.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(file.truncated).toBe(false);
  });

  it('rejects traversal and absolute paths', async () => {
    await expect(service.readFile(repo, '../outside.txt')).rejects.toThrow(/unsafe/);
    await expect(service.readFile(repo, 'C:/Windows/win.ini')).rejects.toThrow(/unsafe/);
  });

  it('searches with bounded results', async () => {
    const { matches } = await service.search(repo, 'needle');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0]).toHaveProperty('path');
    expect(matches[0]).toHaveProperty('line');
    const none = await service.search(repo, 'zz-not-present-zz');
    expect(none.matches).toHaveLength(0);
  });

  it('creates, diffs, and removes worktrees without touching the base repo', async () => {
    const baseHead = (await git(repo, 'rev-parse', 'HEAD')).trim();
    const worktree = await service.createWorktree(repo, worktreesRoot, 'task-1');
    expect(worktree.branch).toBe('papers/task-1');
    expect(worktree.baseCommit).toBe(baseHead);

    // Modify inside the worktree only.
    await fs.writeFile(path.join(worktree.worktreePath, 'new-file.txt'), 'worktree change\n');
    const { diff } = await service.worktreeDiff(worktree.worktreePath);
    expect(diff).toContain('new-file.txt');

    // Base repo stays clean and at the same HEAD.
    const baseInfo = await service.info(repo);
    expect(baseInfo.clean).toBe(true);
    expect(baseInfo.headCommit).toBe(baseHead);

    await service.removeWorktree(repo, worktree.worktreePath, worktree.branch);
    const branches = await git(repo, 'branch', '--list', 'papers/task-1');
    expect(branches.trim()).toBe('');
    expect(await service.isRepository(repo)).toBe(true);
  });

  it('rejects bad worktree names', async () => {
    await expect(service.createWorktree(repo, worktreesRoot, '../evil')).rejects.toThrow(/name/);
    await expect(service.createWorktree(repo, worktreesRoot, 'UPPER CASE')).rejects.toThrow(/name/);
  });
});
