import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import type {
  SlopTopPickerActivation,
  SlopTopPickerTransport,
} from './slopTopPickerProtocol';

export interface SlopTopPickerSignalPaths {
  root: string;
  activate: string;
  ack: string;
  result: string;
  cancel: string;
}

export function slopTopPickerSignalPaths(
  root = path.join(
    process.env.PUBLIC ?? 'C:\\Users\\Public',
    'Documents',
    'PapersNativeBridgeReceipts',
  ),
): SlopTopPickerSignalPaths {
  return {
    root,
    activate: path.join(root, 'picker-activate.signal'),
    ack: path.join(root, 'picker-ack.signal'),
    result: path.join(root, 'picker-result.signal'),
    cancel: path.join(root, 'picker-cancel.signal'),
  };
}

function removeSignal(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Absent is already clean.
  }
}

function writeSignal(file: string, value: unknown): void {
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8' });
  removeSignal(file);
  renameSync(temp, file);
}

function readSignal(file: string): unknown {
  // Tolerate one legacy AHK BOM while all new signals use UTF-8-RAW.
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

/**
 * Filesystem transport for the creator's already-running SlopTop AHK picker.
 *
 * This owns only signal-file mechanics. Picker semantics, capability binding,
 * cancellation policy and result validation remain in slopTopPickerProtocol.
 */
export function createSlopTopPickerFileTransport(
  root?: string,
): SlopTopPickerTransport & { paths: SlopTopPickerSignalPaths } {
  const paths = slopTopPickerSignalPaths(root);

  return {
    paths,
    activate(request: SlopTopPickerActivation): void {
      mkdirSync(paths.root, { recursive: true });
      removeSignal(paths.ack);
      removeSignal(paths.result);
      removeSignal(paths.cancel);
      writeSignal(paths.activate, request);
    },
    readAck(): unknown {
      return readSignal(paths.ack);
    },
    readResult(): unknown {
      return readSignal(paths.result);
    },
    requestCancel(token: string): void {
      writeSignal(paths.cancel, { version: 2, token, cancel: true });
    },
    cleanup(): void {
      removeSignal(paths.activate);
      removeSignal(paths.ack);
      removeSignal(paths.result);
    },
  };
}
