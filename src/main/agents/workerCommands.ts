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
 * Runtime overrides for non-interactive OpenCode runs. Auto-approval still
 * enforces explicit denies, so the worker cannot request external paths,
 * network tools, subagents, pushes, history rewrites, or destructive shell
 * commands. This is defense in depth around a disposable git worktree, not an
 * operating-system sandbox.
 */
export const OPENCODE_INLINE_CONFIG = JSON.stringify({
  autoupdate: false,
  share: 'disabled',
  permission: {
    external_directory: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    task: 'deny',
    bash: {
      '*': 'allow',
      'git push': 'deny',
      'git push *': 'deny',
      'git commit': 'deny',
      'git commit *': 'deny',
      'git reset *': 'deny',
      'git clean *': 'deny',
      'rm *': 'deny',
      'rmdir *': 'deny',
      'del *': 'deny',
      'Remove-Item *': 'deny',
      'curl *': 'deny',
      'Invoke-WebRequest *': 'deny',
    },
  },
});

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
      'Run exactly this Git Bash block with your terminal tool and wait for it to finish (it may take several minutes). The quoted here-document prevents task text from becoming shell syntax:',
      '```',
      `"${codexExe}" --ask-for-approval never exec --cd "${cwd}" --sandbox workspace-write -c 'windows.sandbox="unelevated"' --ephemeral - <<'PAPERS_CODEX_TASK'`,
      'Implement the task described below. Work only inside this directory. Run any quick existing checks.',
      'Task:',
      '<insert the full task description from the shared material>',
      'PAPERS_CODEX_TASK',
      '```',
      'Replace only the <insert…> placeholder with the complete task text; keep every flag unchanged.',
      'If Codex exits without producing the requested working diff and passing checks, STOP. Do not edit files yourself or use a fallback. Report delegationSucceeded=false.',
      'After it completes, run `git -C "' + cwd + '" diff --stat` and `git -C "' + cwd + '" status --porcelain` with your terminal tool, review what Codex changed, and report honestly.',
      'Your final JSON block must include {"checksPassed": true|false, "delegationSucceeded": true|false, "worker": "codex"}. Set delegationSucceeded=true only when Codex itself made the requested change.',
    ].join('\n');
  }
  return [
    '',
    '## Worker delegation (OpenCode)',
    'Delegate the implementation to the OpenCode CLI instead of editing files yourself.',
    'Run this exact Git Bash block with your terminal tool and wait for it to finish (it may take several minutes). The quoted here-document prevents task text from becoming shell syntax:',
    '```',
    `papers_task="$(cat <<'PAPERS_OPENCODE_TASK'`,
    'Implement the task described below. Work only inside this directory. Run any quick existing checks.',
    'Task:',
    '<insert the full task description from the shared material>',
    'PAPERS_OPENCODE_TASK',
    ')"',
    `OPENCODE_CONFIG_CONTENT='${OPENCODE_INLINE_CONFIG}' opencode run --pure --dir "${cwd}" -m ${OPENCODE_WORKER_MODEL} --dangerously-skip-permissions "$papers_task"`,
    '```',
    'Replace only the <insert…> placeholder with the complete task text; keep every flag unchanged.',
    'The inline policy denies external directories, network tools, subagents, pushes, history rewrites, and destructive shell commands. Auto-approval does not override explicit denies. The directory is also a disposable git worktree; this is defense in depth, not an OS sandbox.',
    'If OpenCode exits without producing the requested working diff and passing checks, STOP. Do not edit files yourself or use a fallback. Report delegationSucceeded=false.',
    'After it completes, run `git -C "' + cwd + '" diff --stat` and `git -C "' + cwd + '" status --porcelain` with your terminal tool, review what OpenCode changed, and report honestly.',
    'Your final JSON block must include {"checksPassed": true|false, "delegationSucceeded": true|false, "worker": "opencode"}. Set delegationSucceeded=true only when OpenCode itself made the requested change.',
  ].join('\n');
}
