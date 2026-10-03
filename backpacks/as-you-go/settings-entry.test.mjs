// The workspace toolbar must not grow a separate top-level Settings button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markup = await readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8');
const entry = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

test('there is no separate Settings button in the workspace toolbar', () => {
  assert.doesNotMatch(markup, /id="open-settings"/);
  assert.doesNotMatch(entry, /document\.querySelector\('#open-settings'\)/);
});

test('the existing Settings tab remains in the dialog', () => {
  assert.match(markup, /id="prompt-tab-hotkeys"[^>]*>Settings<\/button>/);
});
