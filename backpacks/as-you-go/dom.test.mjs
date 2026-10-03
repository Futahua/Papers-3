import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkspaceElements } from './public/app/dom.js';

function fakeDocument(selectors) {
  const elements = new Map(selectors.map((selector) => [selector, { selector }]));
  return {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };
}

test('dom registry resolves every required workspace element', () => {
  const document = fakeDocument([
    '#status', '#icon-grid', '#explorer', '#selection-marquee', '#empty',
    '#breadcrumbs', '#delete-all-bin', '#restore-all-bin', '#selection-status',
    '#backdrop-opacity-slider', '#backdrop-opacity-value',
    '#context-menu', '#bin-button', '#bin-label', '#bin-count', '#editor-layer',
    '#editor', '#save-editor', '#editor-title', '#editor-error', '#name-input',
    '#description-input', '#description-label', '#target-input', '#target-fields',
    '#target-actions', '#icon-input', '#icon-preview', '#icon-fallback',
    '#use-target-icon', '#confirm-layer', '#confirm-title', '#confirm-copy',
    '#confirm-delete', '#confirm-restore', '#cancel-confirm', '#link-edit-layer',
    '#prompt-layer', '#quick-run-layer', '#quick-run-input', '#quick-run-chips', '#quick-run-results',
    '#quick-run-notice', '#quick-run-cap',
  ]);

  const elements = getWorkspaceElements(document);
  assert.equal(elements.grid.selector, '#icon-grid');
  assert.equal(elements.editor.selector, '#editor');
  assert.equal(elements.quickRunInput.selector, '#quick-run-input');
  assert.equal(elements.quickRunNotice.selector, '#quick-run-notice');
  assert.equal(elements.quickRunCap.selector, '#quick-run-cap');
  assert.equal(Object.keys(elements).length, 44);
});

test('dom registry fails fast when an element is missing', () => {
  const document = fakeDocument(['#icon-grid', '#editor']);
  assert.throws(
    () => getWorkspaceElements(document),
    /Required element missing: #status/,
  );
});
