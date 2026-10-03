/** Looks up one required element by selector and fails fast if the markup
 * and script have drifted apart, instead of carrying around a null that
 * surfaces as a confusing runtime error later. */
function requiredElement(document, selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Required element missing: ${selector}`);
  return element;
}

/** Central registry of every workspace element the app drives. The HTML and
 * this registry must stay in lockstep — a missing ID here means the
 * interface is broken, not an optional enhancement. */
export function getWorkspaceElements(document) {
  return {
    status: requiredElement(document, '#status'),
    grid: requiredElement(document, '#icon-grid'),
    explorer: requiredElement(document, '#explorer'),
    marquee: requiredElement(document, '#selection-marquee'),
    empty: requiredElement(document, '#empty'),
    breadcrumbs: requiredElement(document, '#breadcrumbs'),
    deleteAllBin: requiredElement(document, '#delete-all-bin'),
    restoreAllBin: requiredElement(document, '#restore-all-bin'),
    selectionStatus: requiredElement(document, '#selection-status'),
    backdropOpacitySlider: requiredElement(document, '#backdrop-opacity-slider'),
    backdropOpacityValue: requiredElement(document, '#backdrop-opacity-value'),
    menu: requiredElement(document, '#context-menu'),
    binButton: requiredElement(document, '#bin-button'),
    binLabel: requiredElement(document, '#bin-label'),
    binCount: requiredElement(document, '#bin-count'),
    editorLayer: requiredElement(document, '#editor-layer'),
    editor: requiredElement(document, '#editor'),
    saveButton: requiredElement(document, '#save-editor'),
    editorTitle: requiredElement(document, '#editor-title'),
    editorError: requiredElement(document, '#editor-error'),
    name: requiredElement(document, '#name-input'),
    description: requiredElement(document, '#description-input'),
    descriptionLabel: requiredElement(document, '#description-label'),
    target: requiredElement(document, '#target-input'),
    targetFields: requiredElement(document, '#target-fields'),
    targetActions: requiredElement(document, '#target-actions'),
    iconInput: requiredElement(document, '#icon-input'),
    iconPreview: requiredElement(document, '#icon-preview'),
    iconFallback: requiredElement(document, '#icon-fallback'),
    iconDefaultButton: requiredElement(document, '#use-target-icon'),
    confirmLayer: requiredElement(document, '#confirm-layer'),
    confirmTitle: requiredElement(document, '#confirm-title'),
    confirmCopy: requiredElement(document, '#confirm-copy'),
    confirmDelete: requiredElement(document, '#confirm-delete'),
    confirmRestore: requiredElement(document, '#confirm-restore'),
    cancelConfirm: requiredElement(document, '#cancel-confirm'),
    linkEditLayer: requiredElement(document, '#link-edit-layer'),
    promptLayer: requiredElement(document, '#prompt-layer'),
    quickRunLayer: requiredElement(document, '#quick-run-layer'),
    quickRunInput: requiredElement(document, '#quick-run-input'),
    quickRunChips: requiredElement(document, '#quick-run-chips'),
    quickRunCap: requiredElement(document, '#quick-run-cap'),
    quickRunResults: requiredElement(document, '#quick-run-results'),
    quickRunNotice: requiredElement(document, '#quick-run-notice'),
  };
}
