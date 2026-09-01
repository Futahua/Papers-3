/**
 * Dedicated IPC for the direct-onscreen pick session (Assignment 016).
 *
 * Every invoke is gated on `backpackProjectRuntime.isSender` and every input
 * is deeply validated (exact keys, bounded member list, strict descriptor
 * shapes). The Backpack may request begin/cancel and receives the session
 * result on a dedicated push channel; it never supplies HWNDs, PIDs, paths,
 * native coordinates as authority or overlay identity. The overlay, hover
 * resolution and eligibility are Papers-owned.
 */

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

import {
  type PersistedWindowMemberDescriptor,
} from '../windows/windowCapabilityService';
import type { WindowPickSession, WindowPickResult } from '../windows/windowPickSession';

export const WINDOW_PICK_MAX_MEMBERS = 32;
export const WINDOW_PICK_MAX_STRING_BYTES = 512;

export interface WindowPickIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>;
  session: WindowPickSession;
  isSender: (sender: WebContents) => boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseBoundedString(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > WINDOW_PICK_MAX_STRING_BYTES) {
    throw new Error('a bounded non-empty string is required');
  }
  return raw;
}

function parseMemberDescriptor(raw: unknown): PersistedWindowMemberDescriptor {
  if (!isPlainObject(raw)) throw new Error('member descriptor must be an object');
  if (!exactKeys(raw, ['version', 'title', 'executableFingerprint'])) {
    throw new Error('member descriptor contains unknown fields');
  }
  if (raw['version'] !== 1) throw new Error('unsupported member descriptor version');
  const title = parseBoundedString(raw['title']);
  const executableFingerprint = parseBoundedString(raw['executableFingerprint']);
  if (!/^[a-f0-9]{64}$/i.test(executableFingerprint)) {
    throw new Error('member descriptor.executableFingerprint is invalid');
  }
  return { version: 1, title, executableFingerprint };
}

export function registerWindowPickIpc({
  ipcMain,
  session,
  isSender,
}: WindowPickIpcDependencies): void {
  let owner: { senderId: number; generation: number } | null = null;

  const requireOwner = (sender: WebContents): void => {
    if (owner && owner.senderId !== sender.id) {
      throw new Error('denied: sender does not own the active picker');
    }
  };

  ipcMain.handle('papers:window-pick:begin', async (event, raw) => {
    console.info('[045-direct-pick] ipc-begin-received', event.sender.id);
    if (!isSender(event.sender)) {
      console.warn('[045-direct-pick] ipc-sender-rejected', event.sender.id);
      throw new Error('denied: not a Backpack project sender');
    }
    if (!isPlainObject(raw)) throw new Error('pick begin payload must be an object');
    if (!exactKeys(raw, ['members'])) throw new Error('pick begin payload contains unknown fields');
    if (!Array.isArray(raw['members'])) throw new Error('pick begin members must be an array');
    if (raw['members'].length > WINDOW_PICK_MAX_MEMBERS) {
      throw new Error('pick begin member list exceeds the bound');
    }
    const members = raw['members'].map(parseMemberDescriptor);
    const sender = event.sender;
    requireOwner(sender);
    const claim = {
      senderId: sender.id,
      generation: owner?.senderId === sender.id ? owner.generation + 1 : 1,
    };
    owner = claim;
    if (typeof (sender as WebContents & { once?: unknown }).once === 'function') {
      sender.once('destroyed', () => {
        if (owner?.generation === claim.generation) {
          owner = null;
          void session.cancel();
        }
      });
    }
    const result = await session.begin({
      memberDescriptors: members,
      onResult: (result: WindowPickResult) => {
        if (owner?.generation === claim.generation) owner = null;
        if (!sender.isDestroyed()) {
          sender.send('papers:window-pick:result', result);
        }
      },
    });
    if (result.outcome !== 'started' && owner?.generation === claim.generation) owner = null;
    console.info('[045-direct-pick] session-begin-result', result.outcome,
      result.outcome === 'failed' ? (result.error ?? '') : '');
    return result;
  });

  ipcMain.handle('papers:window-pick:cancel', async (event, raw) => {
    if (!isSender(event.sender)) {
      throw new Error('denied: not a Backpack project sender');
    }
    requireOwner(event.sender);
    if (raw !== undefined && !(isPlainObject(raw) && Object.keys(raw).length === 0)) {
      throw new Error('pick cancel payload must be empty');
    }
    await session.cancel();
    owner = null;
    return { outcome: 'cancelled' };
  });

  // 021: keyboard flow lives on the launching workspace page. Enter commits the
  // staged set; a toggle key (e.g. Space) stages the hovered window. Both are
  // empty-payload invokes gated on the Backpack sender.
  ipcMain.handle('papers:window-pick:stage', async (event, raw) => {
    if (!isSender(event.sender)) {
      throw new Error('denied: not a Backpack project sender');
    }
    requireOwner(event.sender);
    if (raw !== undefined && !(isPlainObject(raw) && Object.keys(raw).length === 0)) {
      throw new Error('pick stage payload must be empty');
    }
    session.stage();
    return { outcome: 'staged' };
  });

  ipcMain.handle('papers:window-pick:commit', async (event, raw) => {
    if (!isSender(event.sender)) {
      throw new Error('denied: not a Backpack project sender');
    }
    requireOwner(event.sender);
    if (raw !== undefined && !(isPlainObject(raw) && Object.keys(raw).length === 0)) {
      throw new Error('pick commit payload must be empty');
    }
    await session.commit();
    return { outcome: 'committed' };
  });
}
