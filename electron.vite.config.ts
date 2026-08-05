import { defineConfig } from 'electron-vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Stamp the build with the commit it came from, so a packaged Papers can say
 * which build it is. Papers runs on two machines and every copy has reported
 * `1.0.0` forever, which makes "same build?" unanswerable.
 *
 * A commit is a property of the BUILD, so baking it in is correct. Folder paths
 * are properties of a MACHINE and must never be baked in (see D-016).
 */
function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // Building from a tarball or without git: say so honestly rather than guess.
    return '';
  }
}

/**
 * True when tracked files differ from HEAD. `git diff --quiet` reports this
 * through its exit status (1 = differences), which `git()` cannot distinguish
 * from git being absent — so run it separately and read the failure.
 */
function hasLocalEdits(): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], {
      cwd: __dirname,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return false;
  } catch {
    return true;
  }
}

function buildStamp(): Record<string, string> {
  const commit = git('rev-parse', '--short', 'HEAD');
  // Only TRACKED files decide dirtiness. A plain `git status --porcelain` also
  // lists untracked paths, and packaging writes `release/` inside the repo while
  // this very build is being stamped — so every packaged build would falsely
  // mark itself `+local`, which is precisely the signal that must stay
  // trustworthy. `diff HEAD` ignores untracked and ignored files entirely.
  // `commit` is empty when git is unavailable, in which case the build reports
  // `unknown` and dirtiness is not consulted at all.
  const dirty = commit !== '' && hasLocalEdits();
  return {
    __PAPERS_COMMIT__: JSON.stringify(commit ? (dirty ? `${commit}+local` : commit) : ''),
    __PAPERS_BRANCH__: JSON.stringify(git('rev-parse', '--abbrev-ref', 'HEAD')),
    __PAPERS_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  };
}

export default defineConfig({
  main: {
    define: buildStamp(),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          host: resolve(__dirname, 'src/preload/host.ts'),
          backpackProject: resolve(__dirname, 'src/preload/backpackProject.ts'),
          program: resolve(__dirname, 'src/preload/program.ts'),
        },
        // Sandboxed preloads cannot use ESM; emit CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/host'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/host/index.html') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
});
