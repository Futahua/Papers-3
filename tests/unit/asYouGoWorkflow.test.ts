import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AsYouGoWorkflow } from '../../src/main/backpacks/asYouGoWorkflow';

let root: string;
let manifestFile: string;
let target: string;

async function hash(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function writeManifest(): Promise<void> {
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  await fs.writeFile(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        buttons: [
          {
            id: 'button-a3ea849d-dfc7-486f-b6d8-5b2c12d89246',
            label: 'CLIPS',
            target,
            createdAt: '2026-07-29T15:08:08.288Z',
          },
          {
            id: 'button-7b551853-0471-4e3e-9cc1-421338db3469',
            label: 'SLOPTOP MODE',
            target,
            createdAt: '2026-07-29T15:08:46.159Z',
          },
          {
            id: 'button-26dbe75c-e79b-4a9e-a232-74c1dadd1bbc',
            label: 'slop_engine',
            target,
            createdAt: '2026-07-29T15:11:14.000Z',
          },
          {
            id: 'button-2929b1b4-6054-4b4a-a71f-b1bd5b1ff358',
            label: 'usb',
            target,
            createdAt: '2026-07-29T15:11:56.505Z',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-as-you-go-'));
  manifestFile = path.join(root, 'buttons.json');
  target = path.join(root, 'local-action.cmd');
  await fs.writeFile(target, '@echo local', 'utf8');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('AsYouGoWorkflow', () => {
  it('reads the existing local actions without exposing paths or modifying the manifest', async () => {
    await writeManifest();
    const before = await hash(manifestFile);
    const workflow = new AsYouGoWorkflow(manifestFile);

    expect(await workflow.listActions()).toEqual([
      { id: 'button-a3ea849d-dfc7-486f-b6d8-5b2c12d89246', label: 'CLIPS' },
      { id: 'button-7b551853-0471-4e3e-9cc1-421338db3469', label: 'SLOPTOP MODE' },
      { id: 'button-26dbe75c-e79b-4a9e-a232-74c1dadd1bbc', label: 'slop_engine' },
      { id: 'button-2929b1b4-6054-4b4a-a71f-b1bd5b1ff358', label: 'usb' },
    ]);
    expect(await hash(manifestFile)).toBe(before);
  });

  it('launches only a target already named by the local manifest', async () => {
    await writeManifest();
    const opened: string[] = [];
    const workflow = new AsYouGoWorkflow(manifestFile, async (selected) => {
      opened.push(selected);
      return '';
    });

    await workflow.launchAction('button-a3ea849d-dfc7-486f-b6d8-5b2c12d89246');

    expect(opened).toEqual([path.resolve(target)]);
    await expect(workflow.launchAction('button-00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /not found/i,
    );
  });

  it('stays honestly empty when this machine has no As you Go manifest', async () => {
    const workflow = new AsYouGoWorkflow(manifestFile);

    await expect(workflow.listActions()).resolves.toEqual([]);
  });

  it('rejects malformed local data instead of inventing or rewriting actions', async () => {
    await fs.writeFile(manifestFile, '{"schemaVersion":1,"buttons":[{"id":"bad"}]}', 'utf8');
    const before = await hash(manifestFile);
    const workflow = new AsYouGoWorkflow(manifestFile);

    await expect(workflow.listActions()).rejects.toThrow(/could not be read/i);
    expect(await hash(manifestFile)).toBe(before);
  });

  it('rejects missing, altered, or additional actions instead of expanding the workflow', async () => {
    await writeManifest();
    const state = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      buttons: Record<string, unknown>[];
    };
    state.buttons.push({
      id: 'button-00000000-0000-4000-8000-000000000000',
      label: 'Not authorized',
      target,
      createdAt: '2026-07-30T00:00:00.000Z',
    });
    await fs.writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, ...state }), 'utf8');

    await expect(new AsYouGoWorkflow(manifestFile).listActions()).rejects.toThrow(
      /could not be read/i,
    );

    state.buttons.pop();
    state.buttons[0]!['label'] = 'Changed';
    await fs.writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, ...state }), 'utf8');
    await expect(new AsYouGoWorkflow(manifestFile).listActions()).rejects.toThrow(
      /could not be read/i,
    );

    state.buttons[0]!['label'] = 'CLIPS';
    state.buttons.pop();
    await fs.writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, ...state }), 'utf8');
    await expect(new AsYouGoWorkflow(manifestFile).listActions()).rejects.toThrow(
      /could not be read/i,
    );
  });
});
