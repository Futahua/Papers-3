import { describe, it, expect, vi } from 'vitest';
import { attachBrowserDiagnostics, diagnosticOrigin, diagnosticErrorSignature, diagnosticScript, diagnosticErrorFrames } from '../../src/main/backpacks/browserDiagnostics';
import type { WebContents } from 'electron';
describe('bounded browser diagnostics', () => {
  it('retains only recognized technical signatures and static script filenames', () => {
    expect(diagnosticErrorSignature([{description:"NotFoundError: Failed to execute 'removeChild' on 'Node': PRIVATE CONVERSATION"}, {value:'Minified React error #185; secret-token'}])).toEqual(['NotFoundError','dom-removeChild','react-error-185']);
    expect(diagnosticErrorSignature([{value:'PRIVATE CONVERSATION'}])).toEqual([]);
    expect(diagnosticScript('https://chatgpt.com/c/private?token=secret')).toBeNull();
    expect(diagnosticScript('https://chatgpt.com/cdn/assets/app-123.js?token=secret')).toBe('/cdn/assets/app-123.js');
  });
  it('identifies RangeError causes and retains only static error stack frames', () => {
    expect(diagnosticErrorSignature([{description:'RangeError: Maximum call stack size exceeded'}])).toEqual(['RangeError','stack-overflow']);
    expect(diagnosticErrorFrames([{description:'RangeError: PRIVATE\n at x (https://chatgpt.com/c/private?secret=1:2:3)\n at y (https://chatgpt.com/cdn/assets/app.js?secret=1:10:20)'}])).toEqual([{origin:'https://chatgpt.com',script:'/cdn/assets/app.js',line:10,column:20}]);
  });
  it('reads an Error own stack without evaluating the page or retaining its message', async () => {
    const handlers: Record<string, Function> = {};
    const write=vi.fn();
    const sendCommand=vi.fn(async(method:string) => method==='Runtime.getProperties' ? {result:[{name:'stack',value:{value:'RangeError: Maximum call stack size exceeded PRIVATE\n at f (https://chatgpt.com/cdn/assets/app.js:7:10)'}}]} : {});
    const contents={getURL:()=> 'https://chatgpt.com',on:vi.fn(),debugger:{isAttached:()=>false,attach:vi.fn(),on:(name:string,handler:Function)=>handlers[name]=handler,sendCommand}} as unknown as WebContents;
    attachBrowserDiagnostics(contents,'tab',write);
    handlers.message!(null,'Runtime.consoleAPICalled',{type:'error',args:[{className:'RangeError',objectId:'error-object',description:'RangeError: PRIVATE'}]});
    await Promise.resolve();await Promise.resolve();
    const stack=write.mock.calls.find(([entry])=>entry.kind==='caught-error-stack')?.[0];
    expect(stack.errorFrames).toEqual([{origin:'https://chatgpt.com',script:'/cdn/assets/app.js',line:7,column:10}]);
    expect(stack.signatures).toContain('stack-overflow');
    expect(JSON.stringify(write.mock.calls)).not.toContain('PRIVATE');
    expect(sendCommand).toHaveBeenCalledWith('Runtime.getProperties',{objectId:'error-object',ownProperties:true,generatePreview:false});
  });
  it('removes credentials, conversation paths and query tokens', () => {
    expect(diagnosticOrigin('https://user:secret@chatgpt.com/c/private?token=secret')).toBe('https://chatgpt.com');
    expect(diagnosticOrigin('data:text/plain,private')).toBeNull();
  });
  it('captures failures without retaining console or exception text or response bodies', async () => {
    const handlers: Record<string, Function> = {};
    const write = vi.fn();
    const sendCommand = vi.fn().mockResolvedValue({});
    const contents = { getURL: () => 'https://chatgpt.com/c/private', on: vi.fn(), debugger: {
      isAttached: () => false, attach: vi.fn(), on: (event: string, handler: Function) => handlers[event] = handler, sendCommand,
    } } as unknown as WebContents;
    attachBrowserDiagnostics(contents, 'tab', write);
    handlers.message!(null, 'Network.responseReceived', { response: {status: 503, url:'https://chatgpt.com/backend-api/private?token=secret'}, type:'Fetch' });
    handlers.message!(null, 'Runtime.exceptionThrown', {exceptionDetails: { exception: {className:'TypeError', description:'PRIVATE CONVERSATION'}, url:'https://chatgpt.com/assets/private.js',lineNumber:8}});
    handlers.message!(null, 'Runtime.consoleAPICalled', {args:[{value:'PRIVATE CONVERSATION'}]});
    await Promise.resolve();
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/private|secret|PRIVATE/);
    expect(write.mock.calls.some(([entry]) => entry.kind==='http-error' && entry.status===503)).toBe(true);
    expect(write.mock.calls.some(([entry]) => entry.kind==='script-exception' && entry.name==='TypeError')).toBe(true);
    expect(sendCommand.mock.calls.map(([method]) => method)).toEqual(['Network.enable','Runtime.enable']);
  });
});

