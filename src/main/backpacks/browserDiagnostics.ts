import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WebContents } from 'electron';

export function diagnosticOrigin(value: unknown): string | null {
  try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.origin : null; } catch { return null; }
}

export function diagnosticErrorSignature(args: Array<{ className?: string; description?: string; value?: unknown }>) {
  const signatures = new Set<string>();
  for (const arg of args.slice(0, 8)) {
    const text = typeof arg.description === 'string' ? arg.description : typeof arg.value === 'string' ? arg.value : '';
    for (const name of ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'NotFoundError', 'SecurityError', 'InvalidStateError', 'AbortError']) {
      if (arg.className === name || text.startsWith(name + ':')) signatures.add(name);
    }
    const react = text.match(/Minified React error #(\d{1,4})\b/);
    if (react) signatures.add('react-error-' + react[1]);
    for (const operation of ['removeChild', 'insertBefore', 'appendChild']) {
      if (text.includes("Failed to execute '" + operation + "'")) signatures.add('dom-' + operation);
    }
    if (text.includes('Maximum update depth exceeded')) signatures.add('react-update-loop');
    if (text.includes('Rendered more hooks') || text.includes('Rendered fewer hooks')) signatures.add('react-hooks-order');
    for (const [phrase, signature] of [['Maximum call stack size exceeded','stack-overflow'],['Invalid time value','invalid-time'],['Invalid array length','invalid-array-length'],['Invalid string length','invalid-string-length'],['Incorrect locale information provided','invalid-locale'],['Invalid language tag','invalid-language-tag']] as const) {
      if (text.includes(phrase)) signatures.add(signature);
    }
    if (text.includes('Failed to fetch')) signatures.add('fetch-failure');
  }
  return [...signatures];
}

export function diagnosticScript(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    // Static JavaScript assets only; conversation paths and query strings never survive.
    return /^\/(?:cdn\/)?assets\/[A-Za-z0-9_./-]{1,180}\.js$/.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}

export function diagnosticErrorFrames(args: Array<{ description?: string }>) {
  const frames: Array<{ origin: string; script: string; line: number; column: number }> = [];
  for (const arg of args.slice(0, 8)) {
    for (const match of (arg.description ?? '').slice(0, 16000).matchAll(/(https?:\/\/[^\s)]+):(\d+):(\d+)/g)) {
      const origin = diagnosticOrigin(match[1]), script = diagnosticScript(match[1]);
      if (origin && script) frames.push({ origin, script, line:Number(match[2]), column:Number(match[3]) });
      if (frames.length >= 8) return frames;
    }
  }
  return frames;
}

export function diagnosticStackShape(value: string) {
  return value.slice(0,16000).split('\n').slice(1,13).map(line => {
    const name=line.trim().match(/^at ([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,5})(?: \(|$)/)?.[1] ?? null;
    const location=line.match(/:(\d+):(\d+)\)?$/);
    return { function:name, kind:line.includes('<anonymous>')?'anonymous':line.includes('eval at')?'eval':line.includes('native')?'native':'other',line:location?Number(location[1]):null,column:location?Number(location[2]):null };
  });
}

export function createBrowserDiagnosticLog(file: string) {
  let chain = Promise.resolve(), pending = 0;
  return (entry: object) => {
    if (pending >= 256) return;
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
    pending++;
    chain = chain.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const size = await fs.stat(file).then(s => s.size).catch(() => 0);
      if (size >= 1024 * 1024) {
        await fs.rm(file + '.previous', { force: true });
        await fs.rename(file, file + '.previous');
      }
      await fs.appendFile(file, line, 'utf8');
    }).catch(() => {}).finally(() => { pending--; });
  };
}

// Observe protocol events only. Never fetch request/response bodies or headers,
// page text, console messages, exception descriptions, cookies or full URLs.
export function attachBrowserDiagnostics(contents: WebContents, tabId: string, write: (entry: object) => void) {
  const emit = (kind: string, details: object = {}) => write({ kind, tabId, origin: diagnosticOrigin(contents.getURL()), ...details });
  const requests = new Map<string, string | null>();
  try {
    if (contents.debugger.isAttached()) { emit('observer-unavailable'); return; }
    contents.debugger.attach('1.3');
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        if (requests.size >= 512) requests.delete(requests.keys().next().value!);
        requests.set(params.requestId, diagnosticOrigin(params.request?.url));
      } else if (method === 'Network.responseReceived' && params.response?.status >= 400) {
        emit('http-error', { status: params.response.status, resourceOrigin: diagnosticOrigin(params.response.url), resourceType: String(params.type).replace(/[^A-Za-z]/g, '').slice(0, 32) });
      } else if (method === 'Network.loadingFailed') {
        emit('network-failure', { resourceOrigin: requests.get(params.requestId) ?? null,
          code: /^net::ERR_[A-Z_]+$/.test(params.errorText) ? params.errorText : 'network-error', cancelled: params.canceled === true });
        requests.delete(params.requestId);
      } else if (method === 'Network.loadingFinished') requests.delete(params.requestId);
      else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        // Console Error objects can expose only a message in their description.
        // Read the already-created own stack value; never evaluate page code or getters.
        const errorObjects = (params.args ?? []).filter((arg: { objectId?: string; className?: string }) => arg.objectId && ['Error','TypeError','ReferenceError','RangeError','SyntaxError','DOMException'].includes(arg.className ?? '')).slice(0, 2);
        for (const arg of errorObjects) {
          void contents.debugger.sendCommand('Runtime.getProperties', { objectId:arg.objectId, ownProperties:true, generatePreview:false })
            .then(result => {
              const stack = result.result?.find((property: { name?: string; value?: { value?: unknown } }) => property.name === 'stack')?.value?.value;
              if (typeof stack !== 'string') return;
              emit('caught-error-stack', { signatures:diagnosticErrorSignature([{description:stack}]), errorFrames:diagnosticErrorFrames([{description:stack}]), stackShape:diagnosticStackShape(stack) });
            }).catch(() => emit('error-stack-unavailable'));
        }
        emit('caught-console-error', { signatures: diagnosticErrorSignature(params.args ?? []), errorFrames: diagnosticErrorFrames(params.args ?? []), frames: (params.stackTrace?.callFrames ?? []).slice(0, 6).map((frame: { url?: string; lineNumber?: number; columnNumber?: number }) => ({
          origin: diagnosticOrigin(frame.url),
          script: diagnosticScript(frame.url),
          line: Number.isFinite(frame.lineNumber) ? frame.lineNumber : null,
          column: Number.isFinite(frame.columnNumber) ? frame.columnNumber : null,
        })) });
      }
      else if (method === 'Runtime.exceptionThrown') {
        const detail = params.exceptionDetails;
        const name = detail?.exception?.className;
        emit('script-exception', { name: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'DOMException'].includes(name) ? name : 'Exception',
          scriptOrigin: diagnosticOrigin(detail?.url), line: Number.isFinite(detail?.lineNumber) ? detail.lineNumber : null });
      }
    });
    void Promise.all([contents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }), contents.debugger.sendCommand('Runtime.enable')])
      .then(() => emit('observer-ready')).catch(() => emit('observer-error'));
    contents.debugger.on('detach', () => emit('observer-detached'));
    contents.on('render-process-gone', (_event, details) => emit('renderer-gone', { reason: details.reason }));
    contents.on('did-finish-load', () => emit('page-loaded'));
  } catch { emit('observer-error'); }
}
