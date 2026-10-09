import { describe, expect, it, vi } from 'vitest';

import { registerPapersWindowIpc } from '../../src/main/ipc/papersWindowIpc';
import type { PapersWindowIpcDependencies } from '../../src/main/ipc/papersWindowIpc';

function harness() {
  const handlers = new Map<string, (event:{sender:object},value?:unknown)=>Promise<unknown>>();
  let handler: ((event: { sender: object }) => Promise<unknown>) | undefined;
  const ipcMain = { handle: vi.fn((_channel: string, current: typeof handler) => { handlers.set(_channel,current!); if (_channel === 'host:window:new') handler = current; }) };
  return { ipcMain, getHandler: () => handler!, handlers };
}

describe('Papers window IPC', () => {
  it('closes a saved page directly without constructing or showing a window',async()=>{
    const h=harness(),closePage=vi.fn(async()=>{}),showPage=vi.fn(async()=>{}),createAdditionalWindow=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow,closePage,showPage});
    await h.handlers.get('host:pages:close')!({sender:{}},'durable-page');
    expect(closePage).toHaveBeenCalledWith('durable-page');expect(showPage).not.toHaveBeenCalled();expect(createAdditionalWindow).not.toHaveBeenCalled();
  });
  it.each(['list','close','show','adopt','detach'])('refuses page %s from a Backpack renderer',async action=>{
    const h=harness(),callback=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>false,createAdditionalWindow:callback,closePage:callback,showPage:callback,adoptPage:callback,detachPage:callback});
    await expect(h.handlers.get('host:pages:'+action)!({sender:{}},'page')).rejects.toThrow('non-host sender');expect(callback).not.toHaveBeenCalled();
  });
  it.each(['close','show','adopt','detach'])('validates page identity before %s',async action=>{
    const h=harness(),callback=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow:callback,closePage:callback,showPage:callback,adoptPage:callback,detachPage:callback});
    for(const key of ['',null,{},'a'.repeat(513)])await expect(h.handlers.get('host:pages:'+action)!({sender:{}},key)).rejects.toThrow('Invalid');
    expect(callback).not.toHaveBeenCalled();
  });
  it('creates a secondary window only for a trusted host sender', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    registerPapersWindowIpc({ ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'], isHostSender: () => true, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).resolves.toBeUndefined();
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('rejects non-host senders before constructing a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    registerPapersWindowIpc({ ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'], isHostSender: () => false, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('non-host sender');
    expect(createAdditionalWindow).not.toHaveBeenCalled();
  });

  it('allows a second legitimate host sender to request a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    const hostSenders = new Set<object>([{}]);
    registerPapersWindowIpc({
      ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'],
      isHostSender: (sender) => hostSenders.has(sender),
      createAdditionalWindow,
    });
    const secondHost = {};
    hostSenders.add(secondHost);

    await expect(h.getHandler()({ sender: secondHost })).resolves.toBeUndefined();
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('propagates secondary-window construction failures', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => { throw new Error('construction failed'); });
    registerPapersWindowIpc({
      ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'],
      isHostSender: () => true,
      createAdditionalWindow,
    });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('construction failed');
  });
});
