import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RemoteFileEditNativeProvider } from '../src/main/backpacks/remoteFileEditNativeProvider';

it.skipIf(process.platform !== 'win32')('runs the actual native checked provider and rolls back withdrawn precommit permission', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-native-edit-adapter-'));
  const original = path.join(root, 'original.txt'); const upload = path.join(root, 'upload.txt');
  await fs.writeFile(original, 'original'); await fs.writeFile(upload, 'edited');
  const provider = new RemoteFileEditNativeProvider(path.resolve('resources/native/conditional-file-save.ps1'), path.resolve('resources/native/conditional-file-save.cs'));
  const source = { path: original, approvedRoot: root };
  const revision = await provider.inspect(source);
  const edited = await provider.inspect({ path: upload, approvedRoot: root });
  let checks = 0;
  await expect(provider.save(source, upload, { token: revision.token, sourceSha256: revision.sha256, editedSha256: edited.sha256 }, () => { checks++; if (checks === 3) throw new Error('permission withdrawn'); })).rejects.toThrow('permission withdrawn');
  expect(checks).toBe(3); expect(await fs.readFile(original, 'utf8')).toBe('original'); expect(await fs.readFile(upload, 'utf8')).toBe('edited');
  checks = 0;
  expect(await provider.save(source, upload, { token: revision.token, sourceSha256: revision.sha256, editedSha256: edited.sha256 }, () => { checks++; })).toEqual({ savedSha256: edited.sha256 });
  expect(checks).toBe(3); expect(await fs.readFile(original, 'utf8')).toBe('edited');
  await expect(provider.save(source, upload, { token: revision.token, sourceSha256: revision.sha256, editedSha256: edited.sha256 }, () => {})).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
}, 30_000);
