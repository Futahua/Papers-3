/**
 * GitService — bounded repository inspection and disposable worktree
 * management through the system `git` CLI with structured argument arrays
 * (never shell strings; plan sections 17, 19).
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const GIT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 4_000_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_LISTED_FILES = 20_000;

export interface RepoInfo {
  path: string;
  isRepository: true;
  branch: string;
  headCommit: string;
  headSubject: string;
  headAuthor: string;
  headDate: string;
  clean: boolean;
  changedFiles: number;
  remoteUrl: string | null;
}

export interface RepoFileContent {
  path: string;
  commit: string;
  content: string;
  truncated: boolean;
  byteLength: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  baseCommit: string;
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
  ) {
    super(message);
  }
}

async function git(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(`git ${args[0]} failed: ${stderr || error.message}`, args, stderr ?? ''));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

export class GitService {
  /** True when the directory is inside a Git work tree. */
  async isRepository(repoPath: string): Promise<boolean> {
    try {
      const out = await git(repoPath, ['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true';
    } catch {
      return false;
    }
  }

  async info(repoPath: string): Promise<RepoInfo> {
    const [branch, head, statusOut, remote] = await Promise.all([
      git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(repoPath, ['log', '-1', '--format=%H%x1f%s%x1f%an%x1f%cI']),
      git(repoPath, ['status', '--porcelain']),
      git(repoPath, ['remote', 'get-url', 'origin']).catch(() => ''),
    ]);
    const [headCommit = '', headSubject = '', headAuthor = '', headDate = ''] = head
      .trim()
      .split('\x1f');
    const changed = statusOut.split('\n').filter((l) => l.trim().length > 0);
    return {
      path: repoPath,
      isRepository: true,
      branch: branch.trim(),
      headCommit,
      headSubject,
      headAuthor,
      headDate,
      clean: changed.length === 0,
      changedFiles: changed.length,
      remoteUrl: remote.trim() || null,
    };
  }

  /** Tracked files, bounded, optionally under a subdirectory. */
  async listFiles(repoPath: string, subdir?: string): Promise<{ files: string[]; truncated: boolean }> {
    const args = ['ls-files', '-z'];
    if (subdir) {
      assertSafeRelative(subdir);
      args.push('--', subdir);
    }
    const out = await git(repoPath, args);
    const all = out.split('\0').filter((f) => f.length > 0);
    return { files: all.slice(0, MAX_LISTED_FILES), truncated: all.length > MAX_LISTED_FILES };
  }

  /** Read a tracked file from the working tree with HEAD provenance. */
  async readFile(repoPath: string, filePath: string): Promise<RepoFileContent> {
    assertSafeRelative(filePath);
    const absolute = path.join(repoPath, filePath);
    const relative = path.relative(repoPath, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('file path escapes the repository');
    }
    const [head, stat] = await Promise.all([
      git(repoPath, ['rev-parse', 'HEAD']),
      fs.stat(absolute),
    ]);
    if (!stat.isFile()) throw new Error(`${filePath} is not a file`);
    const truncated = stat.size > MAX_FILE_BYTES;
    const handle = await fs.open(absolute, 'r');
    try {
      const length = Math.min(stat.size, MAX_FILE_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      return {
        path: filePath,
        commit: head.trim(),
        content: buffer.toString('utf8'),
        truncated,
        byteLength: stat.size,
      };
    } finally {
      await handle.close();
    }
  }

  /** Bounded content search over tracked files. */
  async search(repoPath: string, pattern: string, maxMatches = 200): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
    if (pattern.length < 2 || pattern.length > 200) {
      throw new Error('search pattern must be 2..200 characters');
    }
    let out: string;
    try {
      out = await git(repoPath, [
        'grep',
        '--line-number',
        '--fixed-strings',
        '--ignore-case',
        '--max-count',
        '50',
        '-e',
        pattern,
      ]);
    } catch (err) {
      // git grep exits 1 on "no matches".
      if (err instanceof GitError && err.stderr === '') return { matches: [], truncated: false };
      throw err;
    }
    const lines = out.split('\n').filter((l) => l.length > 0);
    const matches: GrepMatch[] = [];
    for (const line of lines.slice(0, maxMatches)) {
      const first = line.indexOf(':');
      const second = line.indexOf(':', first + 1);
      if (first < 0 || second < 0) continue;
      matches.push({
        path: line.slice(0, first),
        line: Number(line.slice(first + 1, second)),
        text: line.slice(second + 1).slice(0, 400),
      });
    }
    return { matches, truncated: lines.length > maxMatches };
  }

  // ------------------------------------------------------------- worktrees

  /**
   * Create a disposable worktree with a new branch off the repo's HEAD.
   * The worktree lives under `worktreesRoot`, never inside the repository.
   */
  async createWorktree(
    repoPath: string,
    worktreesRoot: string,
    name: string,
  ): Promise<WorktreeInfo> {
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(name)) {
      throw new Error('worktree name must be lowercase alphanumeric/dash');
    }
    await fs.mkdir(worktreesRoot, { recursive: true });
    const worktreePath = path.join(worktreesRoot, name);
    const branch = `papers/${name}`;
    const baseCommit = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
    await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], 120_000);
    return { worktreePath, branch, baseCommit };
  }

  async worktreeDiff(worktreePath: string): Promise<{ diff: string; stat: string; truncated: boolean }> {
    // Include untracked files in the diff view by staging intent (read-only op
    // on the worktree's index is acceptable: add -N marks intent only).
    await git(worktreePath, ['add', '--intent-to-add', '--all']);
    const [diff, stat] = await Promise.all([
      git(worktreePath, ['diff']),
      git(worktreePath, ['diff', '--stat']),
    ]);
    const truncated = diff.length > 400_000;
    return { diff: truncated ? diff.slice(0, 400_000) : diff, stat, truncated };
  }

  /** Remove a worktree and its branch. The base repository is untouched. */
  async removeWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    await git(repoPath, ['worktree', 'remove', '--force', worktreePath], 120_000);
    if (/^papers\//.test(branch)) {
      await git(repoPath, ['branch', '-D', branch]).catch(() => undefined);
    }
  }
}

function assertSafeRelative(p: string): void {
  if (p.includes('..') || p.includes('\0') || path.isAbsolute(p) || p.length > 500) {
    throw new Error('unsafe path');
  }
}
