import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSlopTopPickerFileTransport } from '../../src/main/windows/slopTopPickerFileTransport';

describe('SlopTop picker file transport', () => {
  it('activates atomically after clearing stale ack/result/cancel signals', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papers-picker-'));
    const transport = createSlopTopPickerFileTransport(root);
    writeFileSync(transport.paths.ack, '{}');
    writeFileSync(transport.paths.result, '{}');
    writeFileSync(transport.paths.cancel, '{}');

    transport.activate({ version: 3, token: 'T1', seeds: [] });

    expect(JSON.parse(readFileSync(transport.paths.activate, 'utf8'))).toEqual({
      version: 3,
      token: 'T1',
      seeds: [],
    });
    expect(existsSync(transport.paths.ack)).toBe(false);
    expect(existsSync(transport.paths.result)).toBe(false);
    expect(existsSync(transport.paths.cancel)).toBe(false);
    expect(existsSync(`${transport.paths.activate}.tmp-${process.pid}`)).toBe(false);
  });

  it('reads legacy BOM JSON and writes the existing v2 cancel signal shape', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papers-picker-'));
    const transport = createSlopTopPickerFileTransport(root);
    transport.activate({ version: 3, token: 'T2', seeds: [] });
    writeFileSync(transport.paths.ack, '\uFEFF' + JSON.stringify({ token: 'T2', ok: true }), 'utf8');

    expect(transport.readAck('T2')).toEqual({ token: 'T2', ok: true });
    transport.requestCancel('T2');
    expect(JSON.parse(readFileSync(transport.paths.cancel, 'utf8'))).toEqual({
      version: 2,
      token: 'T2',
      cancel: true,
    });
  });

  it('cleanup removes session-owned activation/ack/result but leaves cancel semantics unchanged', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papers-picker-'));
    const transport = createSlopTopPickerFileTransport(root);
    transport.activate({ version: 3, token: 'T3', seeds: [] });
    writeFileSync(transport.paths.ack, '{}');
    writeFileSync(transport.paths.result, '{}');
    transport.requestCancel('T3');

    transport.cleanup('T3');

    expect(existsSync(transport.paths.activate)).toBe(false);
    expect(existsSync(transport.paths.ack)).toBe(false);
    expect(existsSync(transport.paths.result)).toBe(false);
    expect(existsSync(transport.paths.cancel)).toBe(true);
  });
});
