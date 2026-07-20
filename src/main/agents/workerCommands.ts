/**
 * Worker delegation (plan section 16, decision D-007): Hermes supervises the
 * Codex/OpenCode CLIs through its own terminal tool. Papers only composes the
 * exact, inspectable instruction — shown verbatim in the invocation preview —
 * and never runs the worker CLIs itself.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Pinned OpenCode worker model — a non-OpenAI provider for comparison runs. */
export const OPENCODE_WORKER_MODEL = 'opencode/big-pickle';

/**
 * Resolve the working Codex CLI. The npm shim (0.125.0) cannot parse this
 * machine's config; the Codex Desktop app bundles a current CLI under
 * %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe (see docs/DECISIONS.md
 * D-003). Newest build wins; PATH `codex` is the fallback.
 */
export async function resolveCodexExecutable(): Promise<string> {
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    const binDir = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    try {
      const entries = await fs.readdir(binDir);
      const candidates: { exe: string; mtime: number }[] = [];
      for (const entry of entries) {
        const exe = path.join(binDir, entry, 'codex.exe');
        try {
          const stat = await fs.stat(exe);
          candidates.push({ exe, mtime: stat.mtimeMs });
        } catch {
          // not a build dir
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      if (candidates[0]) return candidates[0].exe;
    } catch {
      // no desktop install
    }
  }
  return 'codex';
}

export async function buildWorkerDelegationBlock(
  worker: 'codex' | 'opencode',
  cwd: string,
): Promise<string> {
  if (worker === 'codex') {
    const codexExe = await resolveCodexExecutable();
    return [
      '',
      '## Worker delegation (Codex)',
      'Delegate the implementation to the Codex CLI instead of editing files yourself.',
      'Run exactly this command with your terminal tool and wait for it to finish (it may take several minutes):',
      '```',
      `"${codexExe}" exec --cd "${cwd}" --sandbox workspace-write "Implement the task described below. Work only inside this directory. Run any quick existing checks. Task: <insert the full task description from the shared material>"`,
      '```',
      'Replace only the <insert…> placeholder with the complete task text; keep every flag unchanged.',
      'After it completes, run `git -C "' + cwd + '" diff --stat` and `git -C "' + cwd + '" status --porcelain` with your terminal tool, review what Codex changed, and report honestly.',
    ].join('\n');
  }
  return [
    '',
    '## Worker delegation (OpenCode)',
    'Delegate the implementation to the OpenCode CLI instead of editing files yourself.',
    'Run exactly this command with your terminal tool and wait for it to finish (it may take several minutes):',
    '```',
    `opencode run --dir "${cwd}" -m ${OPENCODE_WORKER_MODEL} --dangerously-skip-permissions "Implement the task described below. Work only inside this directory. Run any quick existing checks. Task: <insert the full task description from the shared material>"`,
    '```',
    'Replace only the <insert…> placeholder with the complete task text; keep every flag unchanged.',
    `The directory is a disposable git worktree, so the skip-permissions flag is confined to it.`,
    'After it completes, run `git -C "' + cwd + '" diff --stat` and `git -C "' + cwd + '" status --porcelain` with your terminal tool, review what OpenCode changed, and report honestly.',
  ].join('\n');
}
