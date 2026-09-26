/**
 * Cross-boundary contract test: Papers' activation payload versus the REAL
 * AutoHotkey seed parser.
 *
 * Why it exists: a v3 change added `seedId` to each seed and the AutoHotkey
 * parser was matching one fixed key order with the wrong field count, so every
 * seed silently carried another field's value. Nothing resolved, nothing was
 * painted green, and Direct Pick looked dead - with no error anywhere. A
 * TypeScript test of the payload could not catch that, because the payload was
 * correct; the consumer misread it.
 *
 * So this test does what the product does: builds the payload exactly as the
 * transport serializes it, hands it to the parser extracted from the live
 * engine script, and compares meanings. Key order is deliberately permuted
 * between seeds, because JSON objects are unordered and the parser must not care.
 *
 * It skips itself when the engine script or AutoHotkey is not on this machine.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { SLOPTOP_PICKER_PROTOCOL_VERSION } from '../../src/main/windows/slopTopPickerProtocol';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const ENGINE_SCRIPT = process.env['SLOPTOP_ENGINE_SCRIPT'] ?? 'D:\\333\\SlopTop\\sloptop_engine.ahk';
const AHK_EXE = process.env['SLOPTOP_AHK_EXE'] ?? 'D:\\333\\SlopTop\\AutoHotkey64.exe';
const available = existsSync(ENGINE_SCRIPT) && existsSync(AHK_EXE);

interface Seed {
  seedId: number;
  processId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The parser as the engine defines it, so the test cannot drift from it. */
function engineFunctions(): { value: string; seeds: string } {
  const source = readFileSync(ENGINE_SCRIPT, 'utf8');
  const value = /PickerJsonValue\(text, key\) \{[\s\S]*?\n\}/.exec(source)?.[0];
  const seeds = /PickerActivationSeeds\(payload\) \{[\s\S]*?\n\}/.exec(source)?.[0];
  if (!value || !seeds) throw new Error('the engine script no longer defines the picker seed parser');
  return { value, seeds };
}

/** Runs the real parser over a payload and returns what it understood. */
function parseWithEngine(payload: unknown): Seed[] {
  const { value, seeds } = engineFunctions();
  const dir = mkdtempSync(path.join(tmpdir(), 'papers-picker-contract-'));
  const harness = path.join(dir, 'harness.ahk');
  const out = path.join(dir, 'out.txt');
  writeFileSync(harness, [
    '#Requires AutoHotkey v2.0',
    '#SingleInstance Off',
    value,
    seeds,
    `payload := '${JSON.stringify(payload).replaceAll("'", "''")}'`,
    'seeds := PickerActivationSeeds(payload)',
    'line := ""',
    'for s in seeds',
    '    line .= s.seedId "|" s.pid "|" s.x "|" s.y "|" s.w "|" s.h ";"',
    `FileAppend(line, "${out.replaceAll('\\', '\\\\')}")`,
    'ExitApp()',
    '',
  ].join('\n'), 'utf8');
  execFileSync(AHK_EXE, ['/ErrorStdOut', harness], { stdio: 'pipe' });
  const text = existsSync(out) ? readFileSync(out, 'utf8') : '';
  return text.split(';').filter((row) => row !== '').map((row) => {
    const [seedId, processId, x, y, width, height] = row.split('|').map(Number);
    return { seedId: seedId!, processId: processId!, x: x!, y: y!, width: width!, height: height! };
  });
}

describe.skipIf(!available)('sloptop picker activation contract', () => {
  it('the engine understands a v3 activation whose seed key order varies', () => {
    // One seed in the order the service builds it (identity spread, id last) and
    // one deliberately permuted. Both must mean the same thing to the engine.
    const activation = {
      version: 3,
      token: 'token-under-test',
      seeds: [
        { processId: 100, x: 638, y: -676, width: 1118, height: 675, seedId: 3 },
        { seedId: 7, height: 40, x: 1, processId: 456, width: 30, y: 2 },
      ],
    };
    expect(parseWithEngine(activation)).toEqual([
      { seedId: 3, processId: 100, x: 638, y: -676, width: 1118, height: 675 },
      { seedId: 7, processId: 456, x: 1, y: 2, width: 30, height: 40 },
    ]);
  });

  it('rejects a seed object that is not exactly the six-field schema', () => {
    const withExtra = {
      version: 3,
      token: 'token-under-test',
      seeds: [{ seedId: 1, processId: 100, x: 0, y: 0, width: 10, height: 10, extra: 5 }],
    };
    expect(parseWithEngine(withExtra)).toEqual([]);
  });

  it('the engine gates activation on the SAME protocol version Papers sends', () => {
    // The engine silently deleted every activation while its gate still said 2
    // and Papers said 3 - no error, no ack, "clicking Direct Pick does nothing".
    // The version is read from Papers' own constant, so the two cannot drift.
    const source = readFileSync(ENGINE_SCRIPT, 'utf8');
    const expected = String(SLOPTOP_PICKER_PROTOCOL_VERSION);
    expect(source).toContain(`PickerJsonValue(payload, "version") != "${expected}"`);
    expect(source).toContain(`PickerJsonValue(payload, "version") = "${expected}"`);
    for (const stale of ['"2"', '"1"']) {
      expect(source).not.toContain(`PickerJsonValue(payload, "version") != ${stale}`);
      expect(source).not.toContain(`PickerJsonValue(payload, "version") = ${stale}`);
    }
  });
});
