#!/usr/bin/env node
/**
 * Sample Backpack creator for opt-in fixture testing.
 *
 * Creates the "Logseq Repository Lab" Canvas Backpack in the creator's
 * PapersData and registers the pinned Logseq fixture checkout as a granted
 * repository resource for Repository Research. Running this tool IS the
 * creator's explicit consent for that single grant; nothing is copied and no
 * program state is fabricated. Papers must not be running while seeding.
 *
 *   node tools/seed-demo-backpack.mjs [fixtureDir] [--user-data <dir>]
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
let fixtureDir = path.resolve(repoRoot, '..', 'papers3-fixtures', 'logseq');
let userDataDir = path.join(
  process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'Papers 3',
);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--user-data') {
    userDataDir = path.resolve(args[i + 1] ?? userDataDir);
    i += 1;
  } else if (args[i]) {
    fixtureDir = path.resolve(args[i]);
  }
}

const PINNED = 'a4963dca579f42817135d8473166a03fa7ea2409';
const BACKPACK_NAME = 'Logseq Repository Lab';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// 1. Verify the fixture.
const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
  cwd: fixtureDir,
  windowsHide: true,
});
if (head.trim() !== PINNED) {
  console.error(
    `Fixture at ${fixtureDir} is at ${head.trim()}, not the pinned ${PINNED}. Run: npm run fixture:logseq`,
  );
  process.exit(1);
}

// 2. Create or find the Backpack in the registry.
const papersData = path.join(userDataDir, 'PapersData');
const registryFile = path.join(papersData, 'registry.json');
const registry = await readJson(registryFile, {
  schemaVersion: 1,
  backpacks: [],
  lastActiveBackpackId: null,
});

let backpack = registry.backpacks.find((b) => b.name === BACKPACK_NAME && !b.archived);
if (!backpack) {
  backpack = {
    id: `bp-${randomUUID()}`,
    name: BACKPACK_NAME,
    type: 'canvas',
    createdAt: new Date().toISOString(),
    lastEnteredAt: null,
    archived: false,
  };
  registry.backpacks.push(backpack);
  await writeJsonAtomic(registryFile, registry);
  await writeJsonAtomic(path.join(papersData, 'backpacks', backpack.id, 'backpack.json'), {
    schemaVersion: 1,
    ...backpack,
  });
  console.log(`Created Backpack "${BACKPACK_NAME}" (${backpack.id})`);
} else {
  console.log(`Backpack "${BACKPACK_NAME}" already exists (${backpack.id})`);
}

// 3. Register the fixture as a granted repository resource.
const resourcesFile = path.join(papersData, 'backpacks', backpack.id, 'resources.json');
const resources = await readJson(resourcesFile, { schemaVersion: 1, resources: [] });
let entry = resources.resources.find(
  (r) => r.type === 'git-repository' && r.path.toLowerCase() === fixtureDir.toLowerCase(),
);
if (!entry) {
  entry = {
    id: `res-${randomUUID()}`,
    type: 'git-repository',
    name: 'logseq (pinned fixture)',
    path: fixtureDir,
    addedAt: new Date().toISOString(),
    grants: ['repository-research'],
    meta: { pinnedCommit: PINNED, license: 'AGPL-3.0', demo: true },
  };
  resources.resources.push(entry);
  await writeJsonAtomic(resourcesFile, resources);
  console.log(`Registered fixture repository as ${entry.id} (granted to repository-research)`);
} else {
  if (!entry.grants.includes('repository-research')) {
    entry.grants.push('repository-research');
    await writeJsonAtomic(resourcesFile, resources);
  }
  console.log(`Fixture repository already registered (${entry.id})`);
}

console.log('Done. Launch Papers, enter "Logseq Repository Lab", open Repository Research.');
