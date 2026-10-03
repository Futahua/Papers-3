/**
 * Raw CDP driver for the 015R3 live proof (Node 24 built-in WebSocket).
 * Launches the built Papers app directly with --remote-debugging-port, waits
 * for the CDP endpoint, and exposes per-target Runtime.evaluate. Session
 * cleanup uses Browser.close so the app quits through its real before-quit
 * barrier (helper stop) rather than being killed.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import * as fs from 'node:fs';

const PAPERS_REPO = 'D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3';
const ELECTRON = 'D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3\\node_modules\\electron\\dist\\electron.exe';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

export async function launchPapers(dataDir, port, logPath = null) {
  const log = [];
  const stdio = ['ignore', 'pipe', 'pipe'];
  let outFd = null;
  let errFd = null;
  if (logPath) {
    outFd = fs.openSync(logPath, 'a');
    errFd = fs.openSync(logPath, 'a');
    stdio[1] = outFd;
    stdio[2] = errFd;
  }
  const proc = spawn(ELECTRON, [
    PAPERS_REPO,
    `--papers-data-dir=${dataDir}`,
    `--remote-debugging-port=${port}`,
  ], {
    cwd: PAPERS_REPO,
    env: { ...process.env, PAPERS_TEST_USER_DATA: dataDir, ELECTRON_ENABLE_LOGGING: '1' },
    stdio,
  });
  if (!logPath) {
    proc.stdout.on('data', (chunk) => log.push(String(chunk)));
    proc.stderr.on('data', (chunk) => log.push(String(chunk)));
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  let targets = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/json/list`);
      const list = await response.json();
      if (Array.isArray(list) && list.length > 0) {
        targets = list;
        break;
      }
    } catch {
      // endpoint not up yet
    }
    await sleep(500);
  }
  if (!targets) {
    proc.kill();
    throw new Error(`CDP endpoint did not come up; log tail:\n${log.join('').slice(-2000)}`);
  }
  return { proc, log, targets, baseUrl };
}

/** Minimal CDP client over one WebSocket target connection. */
export class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`CDP ${message.error.message}`));
        else resolve(message.result);
      }
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
    });
  }

  async send(method, params = {}) {
    await this.open();
    const id = ++this.id;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 60000);
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? 'evaluate exception';
      throw new Error(String(text));
    }
    return result.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

export async function connectToTarget(target, port) {
  let url = target.webSocketDebuggerUrl;
  if (!url) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await response.json();
    const fresh = list.find((entry) => entry.id === target.id);
    url = fresh?.webSocketDebuggerUrl;
  }
  if (!url) throw new Error(`no websocket url for target ${target.url}`);
  const client = new Cdp(url);
  await client.open();
  return client;
}

/** Send Browser.close through the browser-level endpoint (graceful app quit). */
export async function closeApp(proc, baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/json/version`);
    const version = await response.json();
    if (version.webSocketDebuggerUrl) {
      const client = new Cdp(version.webSocketDebuggerUrl);
      await client.open();
      await client.send('Browser.close').catch(() => undefined);
      client.close();
    }
  } catch {
    // fall through to kill
  }
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 45000);
    proc.once('exit', () => { clearTimeout(timer); resolve(true); });
    if (proc.exitCode !== null) { clearTimeout(timer); resolve(true); }
  });
  if (!exited) {
    proc.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  return exited;
}
