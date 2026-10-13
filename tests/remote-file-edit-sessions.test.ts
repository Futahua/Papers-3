import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RemoteFileEditSessions } from '../src/main/backpacks/remoteFileEditSessions';
const source = { resourceId: randomUUID(), sourceVersion: 'a'.repeat(64), sourceSha256: 'b'.repeat(64) };
const edited = 'c'.repeat(64);
async function directory() { return fs.mkdtemp(path.join(os.tmpdir(), 'papers-edit-receipts-')); }
describe('remote edit save receipts', () => {
  it('journals the save before dispatch and distrusts an unverified receipt', async () => {
    const root = await directory();
    const sessions = new RemoteFileEditSessions(root, async session => {
      const journal = JSON.parse(await fs.readFile(path.join(root, 'edit-sessions.json'), 'utf8'));
      expect(journal.sessions[0].phase).toBe('saving');
      expect(journal.sessions[0].saveId).toBe(session.saveId);
      return { savedVersion: 'd'.repeat(64), savedSha256: 'e'.repeat(64) };
    });
    await sessions.initialize(); const session = await sessions.begin('peer', source);
    expect((await sessions.commit('peer', session.id, randomUUID(), edited)).phase).toBe('uncertain');
  });
  it('retains a successful receipt across restart without replaying the write', async () => {
    const root = await directory(); let writes = 0;
    const owner = async () => { writes++; return { savedVersion: 'd'.repeat(64), savedSha256: edited }; };
    const sessions = new RemoteFileEditSessions(root, owner); await sessions.initialize();
    const session = await sessions.begin('peer', source); const saveId = randomUUID();
    expect((await sessions.commit('peer', session.id, saveId, edited)).phase).toBe('saved');
    await sessions.close();
    const restarted = new RemoteFileEditSessions(root, owner); await restarted.initialize();
    expect((await restarted.commit('peer', session.id, saveId, edited)).phase).toBe('saved');
    expect(writes).toBe(1);
    await expect(restarted.commit('peer', session.id, randomUUID(), edited)).rejects.toThrow('receipt');
  });
  it('retains conflict and ambiguous results without redispatching', async () => {
    for (const conflict of [true, false]) {
      const root = await directory(); let writes = 0;
      const sessions = new RemoteFileEditSessions(root, async () => { writes++; throw Object.assign(new Error('external edit'), { code: conflict ? 'VERSION_CHANGED' : 'PROVIDER_LOST' }); });
      await sessions.initialize(); const session = await sessions.begin('peer', source); const saveId = randomUUID();
      expect((await sessions.commit('peer', session.id, saveId, edited)).phase).toBe(conflict ? 'conflict' : 'uncertain');
      await sessions.commit('peer', session.id, saveId, edited); expect(writes).toBe(1);
    }
  });
  it('turns an interrupted saving journal into uncertainty and refuses other peers', async () => {
    const root = await directory(); const id = randomUUID(); const saveId = randomUUID();
    await fs.writeFile(path.join(root, 'edit-sessions.json'), JSON.stringify({ sessions: [{ ...source, id, deviceId: 'peer', phase: 'saving', saveId, editedSha256: edited }] }));
    let writes = 0;
    const sessions = new RemoteFileEditSessions(root, async () => { writes++; throw new Error('must not run'); }); await sessions.initialize();
    expect((await sessions.commit('peer', id, saveId, edited)).phase).toBe('uncertain'); expect(writes).toBe(0);
    await expect(sessions.commit('other', id, saveId, edited)).rejects.toThrow('unavailable');
    sessions.revoke('peer'); await expect(sessions.commit('peer', id, saveId, edited)).rejects.toThrow('unavailable');
  });
});
