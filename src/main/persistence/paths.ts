/**
 * PapersData directory layout.
 * All functions are pure so tests can target a temporary base directory.
 */
import * as path from 'node:path';

export interface PapersPaths {
  root: string;
  registryFile: string;
  permissionsFile: string;
  recoveryDir: string;
  backupsDir: string;
  backpacksDir: string;
  integrationsDir: string;
  hermesIntegrationFile: string;
}

export function papersPaths(baseDir: string): PapersPaths {
  const root = path.join(baseDir, 'PapersData');
  return {
    root,
    registryFile: path.join(root, 'registry.json'),
    permissionsFile: path.join(root, 'permissions.json'),
    recoveryDir: path.join(root, 'recovery'),
    backupsDir: path.join(root, 'backups'),
    backpacksDir: path.join(root, 'backpacks'),
    integrationsDir: path.join(root, 'integrations'),
    hermesIntegrationFile: path.join(root, 'integrations', 'hermes.json'),
  };
}

export function backpackDir(paths: PapersPaths, backpackId: string): string {
  return path.join(paths.backpacksDir, backpackId);
}

export function backpackFile(paths: PapersPaths, backpackId: string): string {
  return path.join(backpackDir(paths, backpackId), 'backpack.json');
}

export function canvasFile(paths: PapersPaths, backpackId: string): string {
  return path.join(backpackDir(paths, backpackId), 'canvas.json');
}

export function resourcesFile(paths: PapersPaths, backpackId: string): string {
  return path.join(backpackDir(paths, backpackId), 'resources.json');
}

export function programDir(paths: PapersPaths, backpackId: string, programId: string): string {
  return path.join(backpackDir(paths, backpackId), 'programs', programId);
}

export function programStateFile(paths: PapersPaths, backpackId: string, programId: string): string {
  return path.join(programDir(paths, backpackId, programId), 'state.json');
}

export function programArtifactsDir(paths: PapersPaths, backpackId: string, programId: string): string {
  return path.join(programDir(paths, backpackId, programId), 'artifacts');
}

export function runsDir(paths: PapersPaths, backpackId: string): string {
  return path.join(backpackDir(paths, backpackId), 'runs');
}

export function runFile(paths: PapersPaths, backpackId: string, runId: string): string {
  return path.join(runsDir(paths, backpackId), `${runId}.json`);
}
