/**
 * Where is Hermes on THIS machine?
 *
 * Papers runs on more than one computer and the Hermes folder moves. A build
 * must therefore never carry the packaging machine's own folder layout: a path
 * baked in at build time is correct on exactly one computer and wrong by
 * construction everywhere else.
 *
 * So Papers works it out at run time, in order, stopping at the first hit:
 *
 *   1. `PAPERS_HERMES_DESKTOP_EXE` — a deliberate manual override.
 *   2. The path Papers itself resolved and remembered last time, kept in the
 *      Papers data folder. This is what makes a move self-healing: Papers only
 *      writes an entry it has actually launched from.
 *   3. `HERMES_HOME` — the Hermes installer's own environment variable, and the
 *      closest thing to a single source of truth that already exists on every
 *      machine Hermes is installed on.
 *   4. A short list of ordinary places a Hermes home sits, derived from where
 *      Papers itself is installed and from the usual per-user locations.
 *
 * When every step misses, Papers says which paths it tried, because "not
 * installed where Papers expects it" without the path turns a glance into a
 * search.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Hermes Desktop's location beneath a Hermes home (`<home>/hermes-agent`). */
const DESKTOP_EXE_SUFFIX = ['hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe'];

/**
 * The Hermes source/venv root beneath a Hermes home. This is the folder holding
 * `venv\Scripts\hermes.exe`, which is what the update helper runs — NOT the
 * `.hermes` home above it.
 */
const AGENT_DIR = 'hermes-agent';

/** Remembered-location file, written inside the Papers data folder. */
const CACHE_FILE = 'hermes-location.json';

export interface HermesLocation {
  /** Full path to the Hermes Desktop executable. */
  desktopExe: string;
  /** The `hermes-agent` folder: holds `venv\Scripts\hermes.exe` and the git tree. */
  hermesRoot: string;
  /** The Hermes home (`.hermes`), the parent of `hermesRoot`. */
  hermesHome: string;
  /** Which rule found it — used for plain-language reporting, not for logic. */
  source: 'override' | 'remembered' | 'HERMES_HOME' | 'probe';
}

/** A location attempt, kept so a failure can say exactly what was tried. */
interface Attempt {
  label: string;
  path: string;
}

function desktopExeUnder(hermesHome: string): string {
  return join(hermesHome, ...DESKTOP_EXE_SUFFIX);
}

/**
 * Build a location from a Hermes Desktop exe path.
 *
 * `hermesRoot` is derived from the exe rather than from a separate setting, so
 * the two can never disagree: the exe sits at
 * `<home>/hermes-agent/apps/desktop/release/win-unpacked/Hermes.exe`, so four
 * levels up from its folder is `hermes-agent` and five is the home.
 */
function locationFromExe(desktopExe: string, source: HermesLocation['source']): HermesLocation {
  const hermesRoot = resolve(dirname(desktopExe), '..', '..', '..', '..');
  return { desktopExe, hermesRoot, hermesHome: resolve(hermesRoot, '..'), source };
}

/**
 * Plausible Hermes homes for this machine, most-likely first.
 *
 * These are shapes, not one machine's answer: a `HermesAI\.hermes` beside the
 * Papers installation (how both of the creator's machines are laid out, under
 * different drive roots), then the ordinary per-user locations. Nothing here is
 * specific to the computer that produced the build.
 */
function probeHomes(papersInstallDir: string | null): Attempt[] {
  const attempts: Attempt[] = [];
  const add = (label: string, path: string): void => {
    if (!attempts.some((entry) => entry.path.toLowerCase() === path.toLowerCase())) {
      attempts.push({ label, path });
    }
  };

  if (papersInstallDir) {
    // Papers installs as <root>\Papers\App, so <root> is two levels up. A
    // sibling HermesAI folder there is the creator's actual layout on both
    // machines (D:\Letters\... and C:\This is Minh\...).
    const beside = resolve(papersInstallDir, '..', '..');
    add('beside the Papers installation', join(beside, 'HermesAI', '.hermes'));
    add('beside the Papers installation', join(beside, '.hermes'));
  }

  const home = homedir();
  add('your user folder', join(home, '.hermes'));
  add('your user folder', join(home, 'HermesAI', '.hermes'));

  return attempts;
}

/** Read a remembered location, ignoring anything unreadable or stale. */
function readRemembered(dataDir: string | null): string | null {
  if (!dataDir) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dataDir, CACHE_FILE), 'utf8'));
    if (parsed && typeof parsed === 'object' && 'desktopExe' in parsed) {
      const value = (parsed as { desktopExe: unknown }).desktopExe;
      if (typeof value === 'string' && value.length > 0) return value;
    }
  } catch {
    /* No memory yet, or it was damaged. Fall through to the other rules. */
  }
  return null;
}

/**
 * Remember a location Papers actually resolved, so the next launch finds it
 * immediately and a later move that breaks the probe still has a good answer to
 * fall back to. Best-effort: failing to write only costs a little speed.
 */
export function rememberHermesLocation(dataDir: string, location: HermesLocation): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, CACHE_FILE),
      `${JSON.stringify({ desktopExe: location.desktopExe, hermesRoot: location.hermesRoot }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    /* Resolution still works without a memory; it is only an optimisation. */
  }
}

export interface HermesLookup {
  location: HermesLocation | null;
  /** Every path considered, in order, for a failure message that helps. */
  attempts: Attempt[];
}

/**
 * Find Hermes Desktop on this machine.
 *
 * `dataDir` is the Papers data folder (`app.getPath('userData')`) and
 * `papersInstallDir` the folder holding Papers.exe; both are optional so this
 * stays a plain function that tests can drive without Electron.
 */
export function findHermes(
  dataDir: string | null = null,
  papersInstallDir: string | null = null,
  env: NodeJS.ProcessEnv = process.env,
): HermesLookup {
  const attempts: Attempt[] = [];

  const consider = (label: string, exe: string, source: HermesLocation['source']): HermesLocation | null => {
    attempts.push({ label, path: exe });
    return existsSync(exe) ? locationFromExe(exe, source) : null;
  };

  const override = env['PAPERS_HERMES_DESKTOP_EXE'];
  if (override) {
    const found = consider('the PAPERS_HERMES_DESKTOP_EXE setting', override, 'override');
    if (found) return { location: found, attempts };
  }

  const remembered = readRemembered(dataDir);
  if (remembered) {
    const found = consider('where Papers found Hermes last time', remembered, 'remembered');
    if (found) return { location: found, attempts };
  }

  const hermesHome = env['HERMES_HOME'];
  if (hermesHome) {
    const found = consider('your HERMES_HOME setting', desktopExeUnder(resolve(hermesHome)), 'HERMES_HOME');
    if (found) return { location: found, attempts };
  }

  for (const candidate of probeHomes(papersInstallDir)) {
    const found = consider(candidate.label, desktopExeUnder(candidate.path), 'probe');
    if (found) return { location: found, attempts };
  }

  return { location: null, attempts };
}

/**
 * The banner text when Hermes cannot be found. It names every path tried so the
 * creator can see at a glance which one is nearly right — a moved folder is
 * usually obvious the moment the wrong path is visible.
 */
export function describeMissingHermes(attempts: Attempt[]): string {
  const lines = attempts.map((attempt) => `  • ${attempt.path}  (${attempt.label})`);
  return [
    'Papers could not find Hermes Desktop on this computer.',
    '',
    'It looked for Hermes.exe here:',
    ...lines,
    '',
    'If Hermes has moved, point the HERMES_HOME setting at the Hermes folder (the one ending in .hermes) and reopen Papers.',
  ].join('\n');
}

/**
 * The Hermes source root, honouring `PAPERS_HERMES_ROOT` for a deliberate
 * override. The override is resolved to `hermes-agent` when it was pointed at
 * the `.hermes` home instead — that is the easy mistake to make, and the update
 * helper needs the folder that actually contains `venv\Scripts\hermes.exe`.
 */
export function resolveHermesRoot(location: HermesLocation, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['PAPERS_HERMES_ROOT'];
  if (!configured) return location.hermesRoot;

  const root = resolve(configured);
  if (existsSync(join(root, 'venv'))) return root;
  const nested = join(root, AGENT_DIR);
  if (existsSync(join(nested, 'venv'))) return nested;
  return root;
}
