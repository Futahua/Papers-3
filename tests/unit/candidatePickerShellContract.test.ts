import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('native candidate picker immediate shell', () => {
  it('shows the ready picker without an entrance animation', () => {
    const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/index.ts'), 'utf8');
    const readyHandler = source.match(/picker\.once\('ready-to-show', \(\) => \{([\s\S]*?)\n        \}\);/);
    expect(readyHandler?.[1]).toContain('picker.show();');
    expect(readyHandler?.[1]).toContain('picker.focus();');
    expect(readyHandler?.[1]).not.toMatch(/setOpacity|setInterval|setTimeout/);
    expect(source).not.toContain('pickerShowAnimation');
  });

  it('renders loading immediately, preserves search/filter state on update, and Enter selects only a visible row', () => {
    const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/index.ts'), 'utf8');
    expect(source).toContain('loading=${candidates.length === 0}');
    expect(source).toContain("e.textContent=loading?'Loading windows…':'No matching windows'");
    expect(source).toContain('window.__papersPickerUpdate=(next)=>{all=next;loading=false;document.body.classList.remove(\'busy\');render()};');
    expect(source).toContain('if(!loading&&!document.body.classList.contains(\'busy\'))list.querySelector(\'.row\')?.click()');
    expect(source).toMatch(/active\.pickerId !== pickerId[\s\S]{0,100}return false/);
    // Updating rows leaves the search and filter controls in place; only list
    // children are replaced, so the active search value and keyboard focus live on.
    expect(source).toContain('list.replaceChildren()');
    expect(source).not.toContain('search.value=');
  });
});
