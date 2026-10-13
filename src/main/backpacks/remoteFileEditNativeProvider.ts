import { spawn } from 'node:child_process';
import type { CheckedFileEditProvider } from './remoteFileEditOwner';
import { RemoteFileError } from './remoteFileResources';

/** Fixed local script; request facts travel on stdin, never become shell text. */
export class RemoteFileEditNativeProvider implements CheckedFileEditProvider {
  constructor(private readonly script: string, private readonly source: string) {}
  private run(request: Record<string, unknown>, authorize?: () => void): Promise<Record<string, string>> {
    if (process.platform !== 'win32') return Promise.reject(new Error('Checked Windows save provider is unavailable.'));
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-MTA', '-File', this.script, '-ProviderSource', this.source], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '', total = 0, result: Record<string, string> | undefined, failure: Error | undefined;
      const refuse = (error: Error) => { failure ??= error; child.stdin.destroy(); child.kill(); };
      child.stdin.on('error', error => { failure ??= error; });
      child.on('error', reject);
      child.stderr.on('data', () => { /* Native diagnostics must not disclose owner paths to peers. */ });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        total += Buffer.byteLength(chunk);
        if (total > 16_384) { refuse(new Error('Native save protocol exceeded its limit.')); return; }
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line) as Record<string, string>;
            if (message.kind === 'authorize' && authorize && !result) {
              authorize(); child.stdin.write('commit-authorized\n');
            } else if (message.kind === 'result' && !result) {
              result = message; child.stdin.end();
            } else if (message.kind === 'error') {
              failure = new RemoteFileError(message.code === 'VERSION_CHANGED' ? 'VERSION_CHANGED' : 'PROVIDER_REFUSED', 'The checked file provider refused the operation. Both copies are retained.');
              child.stdin.end();
            } else refuse(new Error('Unexpected native save protocol message.'));
          } catch (error) { refuse(error instanceof Error ? error : new Error('Native save protocol failed.')); }
        }
      });
      child.on('close', code => {
        if (failure) reject(failure);
        else if (code !== 0 || !result || buffer.trim()) reject(new Error('Native save completion was not confirmed.'));
        else resolve(result);
      });
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  }
  async inspect(source: { path: string; approvedRoot: string }) {
    const result = await this.run({ operation: 'inspect', ...source });
    if (!/^[a-f0-9]{64}$/.test(result.token ?? '') || !/^[a-f0-9]{64}$/.test(result.sha256 ?? '')) throw new Error('Invalid native source revision.');
    return { token: result.token!, sha256: result.sha256! };
  }
  async save(source: { path: string; approvedRoot: string }, workingCopy: string, expected: { token: string; sourceSha256: string; editedSha256: string }, authorize: () => void) {
    authorize();
    const result = await this.run({ operation: 'save', ...source, workingCopy, ...expected }, authorize);
    if (result.savedSha256 !== expected.editedSha256) throw new Error('Native saved bytes were not confirmed.');
    return { savedSha256: result.savedSha256! };
  }
}
