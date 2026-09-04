import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/host/styles.css'), 'utf8');
const workspaceDock = readFileSync(resolve(process.cwd(), 'src/host/WorkspaceDock.tsx'), 'utf8');

describe('host theme contract', () => {
  it('keeps light values, adds OS dark values, and preserves hex native overlay tokens', () => {
    expect(styles).toContain('@media (prefers-color-scheme: dark)');
    expect(styles).toContain('--titlebar-bg: #efede7;');
    expect(styles).toContain('--titlebar-symbol: #20201e;');
    expect(styles).toContain('--titlebar-bg: #211f1b;');
    expect(styles).toContain('--titlebar-symbol: #f1ede3;');
    expect(styles).toContain('color-scheme: dark;');
    expect(styles).toContain('--paper: #211f1b;');
    expect(styles).toContain('--raised: #302d26;');
  });

  it('routes former out-of-root light literals through themeable tokens', () => {
    for (const token of [
      '--control-surface', '--menu-surface', '--card-surface', '--empty-surface',
      '--header-surface', '--overlay-scrim', '--dock-shadow', '--destructive-surface',
    ]) expect(styles).toContain(`${token}:`);
    for (const literal of [
      'rgba(251, 250, 246, 0.72)', 'rgba(251, 250, 246, 0.98)',
      'rgba(251, 250, 246, 0.7)', 'rgba(251, 250, 246, 0.45)',
      '#fff7f4', '#8a3e34', '#74372f',
    ]) {
      const occurrences = styles.match(new RegExp(literal.replace(/[()[.]/g, '\\$&'), 'g')) ?? [];
      expect(occurrences.length).toBeGreaterThan(0);
      expect(styles.indexOf(literal)).toBeLessThan(styles.indexOf('* {'));
    }
  });

  it('declares the transparent mode as a restart-time window choice', () => {
    expect(styles).toContain(':root[data-transparent-window="true"] .app');
    expect(styles).toContain(':root[data-transparent-window="true"] .titlebar');
    expect(styles).toContain(':root[data-transparent-window="true"] .pane');
    expect(styles).toContain(':root[data-transparent-window="true"] .backpack-project-frame iframe');
    expect(styles).toContain('background: transparent;');
  });

  it('keeps the native-project edge seam and explains explicit drag states', () => {
    expect(styles).toContain('.workspace-dock[data-split] .backpack-project-frame');
    expect(styles).toContain('width: calc(100% - 8px);');
    expect(styles).toContain('margin: 4px;');
    expect(styles).toContain('.workspace-dock .dv-dockview');
    expect(styles).toContain('.workspace-dock .backpack-project-frame');
    expect(styles).toContain('--dv-group-view-background-color: transparent !important;');
    expect(styles).toContain('.workspace-split-preview.is-neutral');
    expect(workspaceDock).toContain('Drop on a panel edge to split');
  });
});
