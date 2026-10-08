import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';

// An independent Backpack remains independently located. Supply its checkout
// explicitly for this integration check; no production project path is baked in.
const ayg = process.env['PAPERS_AYG_PROJECT'];
describe.runIf(Boolean(ayg))('AYG inline office editor pane', () => {
  let server: http.Server, browser: Browser, page: Page;
  beforeAll(async () => {
    const publicRoot = path.join(ayg!, 'public');
    server = http.createServer(async (request, response) => {
      if (request.url === '/') {
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><html><body><main class="workspace"></main></body></html>'); return;
      }
      const file = path.resolve(publicRoot, '.' + new URL(request.url!, 'http://localhost').pathname);
      if (!file.startsWith(publicRoot + path.sep)) { response.writeHead(403).end(); return; }
      try { response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/plain'); response.end(await fs.readFile(file)); }
      catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env['PAPERS_TEST_BROWSER'] });
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
    await page.addScriptTag({ type: 'module', content: "import { createFileCapabilityPanel } from '/app/file-capability-panel.js'; window.createOfficePane = createFileCapabilityPanel;" });
    await page.waitForFunction(() => typeof (window as any).createOfficePane === 'function');
    await page.evaluate(async () => {
      const state = { calls: [] as { operation: string; params: Record<string, unknown> }[], deferred: false, refuseClose: false, finishOpen: null as null | (() => void) };
      const host = { async fileCapability(operation: string, params: Record<string, unknown>) {
        state.calls.push({ operation, params });
        if (operation === 'office-editor-close' && state.refuseClose) return { ok: false, message: 'Save before leaving this editor.' };
        if (operation === 'providers') return { ok: true, providers: { officeEditor: true, libreOffice: true } };
        if (operation === 'preview') return { ok: true, entry: { kind: 'file', path: params.path, name: String(params.path).split('\\').at(-1), extension: '.odt' }, preview: { kind: 'unsupported' } };
        if (operation === 'office-editor-open') {
          if (state.deferred) await new Promise<void>(resolve => { state.finishOpen = resolve; });
          return { ok: true, sessionId: state.deferred ? 'late-editor' : 'current-editor', readOnly: false };
        }
        return { ok: true };
      } };
      const module = { createFileCapabilityPanel: (window as any).createOfficePane };
      Object.assign(window, { officeTest: state, officePane: module.createFileCapabilityPanel({ document, host }) });
    });
  }, 30_000);
  afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
  it('edits only after an explicit action, saves without losing its icon, and preserves the editor across pane collapse', async () => {
    await page.evaluate(async () => { const w = window as any; w.officePane.setExpanded(true); await w.officePane.previewPath('C:\\work\\report.odt'); });
    expect(await page.evaluate(() => (window as any).officeTest.calls.filter((call: any) => call.operation === 'office-editor-open'))).toHaveLength(0);
    await page.getByRole('button', { name: 'Edit document inline', exact: true }).click();
    await expect.poll(async () => page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Save document', exact: true }).click();
    await expect.poll(async () => page.getByRole('button', { name: 'Save document', exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Save document', exact: true }).locator('svg').count()).toBe(1);
    await page.evaluate(() => (window as any).officePane.setExpanded(false));
    await expect.poll(async () => page.evaluate(() => (window as any).officeTest.calls.some((call: any) => call.operation === 'office-editor-visible' && call.params.visible === false))).toBe(true);
    await page.evaluate(() => (window as any).officePane.setExpanded(true));
    expect(await page.evaluate(() => (window as any).officeTest.calls.filter((call: any) => call.operation === 'office-editor-open'))).toHaveLength(1);
    await page.evaluate(async () => { await (window as any).officePane.previewPath('C:\\work\\image.png'); });
    expect(await page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole('button', { name: 'Edit document inline', exact: true }).isVisible()).toBe(false);
  });
  it('cancels a pending editor when selection changes and retires late readiness', async () => {
    await page.evaluate(async () => { const w = window as any; w.officeTest.deferred = true; await w.officePane.previewPath('C:\\work\\pending.odt'); });
    await page.getByRole('button', { name: 'Edit document inline', exact: true }).click();
    await expect.poll(async () => page.evaluate(() => Boolean((window as any).officeTest.finishOpen))).toBe(true);
    await page.evaluate(async () => { await (window as any).officePane.previewPath('C:\\work\\new.png'); });
    expect(await page.evaluate(() => (window as any).officeTest.calls.some((call: any) => call.operation === 'office-editor-close-owner'))).toBe(true);
    await page.evaluate(() => (window as any).officeTest.finishOpen());
    await expect.poll(async () => page.evaluate(() => (window as any).officeTest.calls.some((call: any) => call.operation === 'office-editor-close' && call.params.sessionId === 'late-editor'))).toBe(true);
    expect(await page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(false);
  });
  it('keeps an editor reachable if unsaved handoff fails instead of changing the preview underneath it', async () => {
    await page.evaluate(async () => { const w = window as any; w.officeTest.deferred = false; await w.officePane.previewPath('C:\\work\\unsaved.odt'); });
    await page.getByRole('button', { name: 'Edit document inline', exact: true }).click();
    await expect.poll(async () => page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(true);
    await page.evaluate(() => { (window as any).officeTest.refuseClose = true; });
    await page.getByRole('button', { name: 'Return to document preview', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(true);
    const changed = await page.evaluate(async () => (window as any).officePane.previewPath('C:\\work\\other.png'));
    expect(changed).toBe(false);
    expect(await page.evaluate(async () => (window as any).officePane.syncSelection({ mode: 'empty' }))).toBe(false);
    expect(await page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(true);
    await page.evaluate(() => { (window as any).officeTest.refuseClose = false; });
    await page.getByRole('button', { name: 'Return to document preview', exact: true }).click();
    await expect.poll(async () => page.getByRole('button', { name: 'Save document', exact: true }).isVisible()).toBe(false);
  });
});
