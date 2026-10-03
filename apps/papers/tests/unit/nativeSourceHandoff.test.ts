import { promises as fs, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackpackProjectService } from '../../src/main/backpacks/backpackProjectService';

const OWNER = 'bp-11111111-1111-4111-8111-111111111111';
const OTHER = 'bp-22222222-2222-4222-8222-222222222222';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const temporaryRoots: string[] = [];

async function sourceFixture(): Promise<{
  root: string;
  source: string;
  bindings: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-native-source-'));
  temporaryRoots.push(root);
  const source = path.join(root, 'exact-source.txt');
  await fs.writeFile(source, 'gate-9.3-native-source', 'utf8');
  return {
    root,
    source,
    bindings: path.join(root, 'backpack-projects.json'),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('native source handoff', () => {
  it('opens and reveals the exact canonical source through an opaque grant', async () => {
    const { source, bindings } = await sourceFixture();
    const opened: string[] = [];
    const revealed: string[] = [];

    const service = new BackpackProjectService(
      bindings,
      async (target) => {
        opened.push(target);
        return '';
      },
      undefined,
      async (target) => {
        revealed.push(target);
      },
    );

    const canonicalSource = await fs.realpath(source);
    const before = await fs.readFile(source);
    const sourceRef = await service.grantNativeSource(OWNER, source);

    expect(sourceRef).toMatch(UUID_V4);
    expect(sourceRef).not.toContain(path.basename(source));

    await service.openNativeSource(OWNER, sourceRef);
    await service.revealNativeSource(OWNER, sourceRef);

    expect(opened).toEqual([canonicalSource]);
    expect(revealed).toEqual([canonicalSource]);
    expect(await fs.readFile(source)).toEqual(before);
  });

  it('scopes each grant to its owning Backpack', async () => {
    const { source, bindings } = await sourceFixture();
    const opened: string[] = [];

    const service = new BackpackProjectService(
      bindings,
      async (target) => {
        opened.push(target);
        return '';
      },
      undefined,
      async () => undefined,
    );

    const sourceRef = await service.grantNativeSource(OWNER, source);

    await expect(
      service.openNativeSource(OTHER, sourceRef),
    ).rejects.toThrow('Native source is not granted for this Backpack.');
    await expect(
      service.revealNativeSource(OTHER, sourceRef),
    ).rejects.toThrow('Native source is not granted for this Backpack.');

    expect(opened).toEqual([]);
  });

  it('rejects raw paths and unknown opaque references', async () => {
    const { source, bindings } = await sourceFixture();
    const opened: string[] = [];

    const service = new BackpackProjectService(
      bindings,
      async (target) => {
        opened.push(target);
        return '';
      },
      undefined,
      async () => undefined,
    );

    await expect(
      service.openNativeSource(OWNER, source),
    ).rejects.toThrow('Native source is not granted.');

    await expect(
      service.openNativeSource(
        OWNER,
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow('Native source is not granted for this Backpack.');

    expect(opened).toEqual([]);
  });

  it('invalidates a grant safely when its source becomes stale', async () => {
    const { source, bindings } = await sourceFixture();
    const opened: string[] = [];

    const service = new BackpackProjectService(
      bindings,
      async (target) => {
        opened.push(target);
        return '';
      },
      undefined,
      async () => undefined,
    );

    const sourceRef = await service.grantNativeSource(OWNER, source);
    await fs.rm(source);

    await expect(
      service.openNativeSource(OWNER, sourceRef),
    ).rejects.toThrow('Native source grant is stale.');

    expect(opened).toEqual([]);

    await expect(
      service.openNativeSource(OWNER, sourceRef),
    ).rejects.toThrow('Native source is not granted for this Backpack.');
  });

  it('keeps machine paths inside the trusted preload and sends only opaque references for execution', () => {
    const preload = readFileSync(
      path.resolve(process.cwd(), 'src/preload/backpackProject.ts'),
      'utf8',
    );

    expect(preload).toContain(
      'const target = webUtils.getPathForFile(file);',
    );
    expect(preload).toContain(
      "ipcRenderer.invoke('host:backpack-project:native-source-grant', target)",
    );
    expect(preload).toContain(
      "ipcRenderer.invoke('host:backpack-project:native-source-open-granted', request.sourceRef)",
    );
    expect(preload).toContain(
      "ipcRenderer.invoke('host:backpack-project:native-source-reveal-granted', request.sourceRef)",
    );
    expect(preload).toContain(
      "['type', 'requestId', 'files']",
    );
    expect(preload).toContain(
      "['type', 'requestId', 'sourceRef']",
    );
    expect(preload).not.toContain(
      "ipcRenderer.invoke('host:backpack-project:native-source-open-granted', request.target",
    );
    expect(preload).not.toContain(
      "ipcRenderer.invoke('host:backpack-project:native-source-reveal-granted', request.target",
    );
    expect(preload).not.toContain('request.backpackId');
  });

  it('derives Backpack ownership from the sender and uses the existing production shell primitives', () => {
    const facade = readFileSync(
      path.resolve(process.cwd(), 'src/main/hostFacade.ts'),
      'utf8',
    );
    const ipc = readFileSync(
      path.resolve(process.cwd(), 'src/main/ipc/hostIpc.ts'),
      'utf8',
    );
    const index = readFileSync(
      path.resolve(process.cwd(), 'src/main/index.ts'),
      'utf8',
    );

    expect(facade).toContain(
      'grantNativeSource(this.requireProjectForSender(senderId), target)',
    );
    expect(facade).toContain(
      'openNativeSource(this.requireProjectForSender(senderId), sourceRef)',
    );
    expect(facade).toContain(
      'revealNativeSource(this.requireProjectForSender(senderId), sourceRef)',
    );

    expect(ipc).toContain(
      "handle('host:backpack-project:native-source-grant'",
    );
    expect(ipc).toContain(
      "handle('host:backpack-project:native-source-open-granted'",
    );
    expect(ipc).toContain(
      "handle('host:backpack-project:native-source-reveal-granted'",
    );

    expect(index).toContain('(target) => shell.openPath(target)');
    expect(index).toContain('shell.showItemInFolder(target);');
  });
});
