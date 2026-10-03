import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { windowLayoutMemberIcon } from './public/app/window-layout-member-icon.js';
import { windowLayoutWidgetSnapshot } from './public/app/window-layout-widget-channel.js';
import { windowLayoutMemberMarkup } from './public/app/window-layout-control-icons.js';

const id = 'W0123456789abcdef';
const member = { descriptor: { title: 'Notepad', windowInstanceId: id } };

test('Auto icon hydration selects artwork by exact window instance, not title', () => {
  const replacement = { title: 'Notepad', windowInstanceId: 'W1111111111111111', icon: 'replacement-icon' };
  const exact = { title: 'Notepad', windowInstanceId: id, icon: 'window-icon' };
  assert.equal(windowLayoutMemberIcon(member, [replacement]), null);
  assert.equal(windowLayoutMemberIcon(member, [replacement, exact]), 'window-icon');
  assert.equal(windowLayoutMemberIcon(member, [exact, { ...exact }]), null, 'ambiguous duplicates fail closed');
});

test('the exact native icon is carried into widget markup for its matching member', () => {
  const member = {
    id: 'member-a',
    descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64), windowInstanceId: id },
    state: 'normal',
  };
  const candidates = [
    { title: 'Notepad', windowInstanceId: 'W1111111111111111', icon: 'data:image/png;base64,replacement' },
    { title: 'Notepad', windowInstanceId: id, icon: 'data:image/png;base64,exact' },
  ];
  const layout = { id: 'L1', name: 'Auto', tracking: { enabled: true }, arrangement: { members: [member] } };
  const snapshot = windowLayoutWidgetSnapshot(layout, (_layoutId, memberId) =>
    memberId === member.id ? windowLayoutMemberIcon(member, candidates) : null);
  assert.equal(snapshot.members[0].icon, 'data:image/png;base64,exact');
  assert.match(windowLayoutMemberMarkup('L1', member, snapshot.members[0].icon), /src="data:image\/png;base64,exact"/);
  assert.doesNotMatch(windowLayoutMemberMarkup('L1', member, snapshot.members[0].icon), /replacement/);
});

test('legacy members without exact instance identity keep a neutral placeholder', () => {
  assert.equal(windowLayoutMemberIcon({ descriptor: { title: 'Notepad' } }, [
    { title: 'Notepad', windowInstanceId: id, icon: 'window-icon' },
  ]), null);
});

test('workspace entry is parseable before the browser can run its first render', () => {
  const entry = fileURLToPath(new URL('./public/workspace-20260730b.js', import.meta.url));
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', entry], { stdio: 'pipe' }));
});

test('picker enumeration skips serial native icon extraction while Auto hydration keeps exact icons', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const picker = source.match(/async function openWindowLayoutPicker\(layoutId\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const widgetPicker = source.match(/async function openWidgetPicker\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';
  const iconRefresh = source.match(/async function runWindowLayoutIconRefresh\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(picker, /host\.windowCandidates\(\{\s*includeNativeIcons:\s*false\s*\}\)/);
  assert.match(widgetPicker, /host\.windowCandidates\(\{\s*includeNativeIcons:\s*false\s*\}\)/);
  assert.match(source, /createWindowLayoutCandidateBinder\([\s\S]*listWindowCandidates:\s*\(\)\s*=>\s*host\.windowCandidates\(\{\s*includeNativeIcons:\s*false\s*\}\)/);
  assert.match(source, /requestCandidates:\s*\(\)\s*=>\s*host\.windowCandidates\(\{\s*includeNativeIcons:\s*true\s*\}\)/);
  assert.match(source, /createWindowLayoutIconHydration/);
});
