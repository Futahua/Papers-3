const BRIDGE_NAME = 'papersVisualDiagnosticBridgeV1';

function bridge(windowRef) {
  const candidate = windowRef?.[BRIDGE_NAME];
  return candidate && typeof candidate === 'object' ? candidate : null;
}

export function workspaceVisualSummary(state) {
  return {
    groups: Array.isArray(state?.groups) ? state.groups.length : 0,
    shortcuts: Array.isArray(state?.shortcuts) ? state.shortcuts.length : 0,
    windowLayouts: Array.isArray(state?.windowLayouts) ? state.windowLayouts.length : 0,
  };
}

export function hydrationSummaryDisagrees(source, installed) {
  const sourceSummary = workspaceVisualSummary(source);
  const installedSummary = workspaceVisualSummary(installed);
  const sourceCount = Object.values(sourceSummary).reduce((total, count) => total + count, 0);
  const installedCount = Object.values(installedSummary).reduce((total, count) => total + count, 0);
  return sourceCount > 0 && installedCount === 0;
}

export function createVisualObservability(windowRef) {
  return {
    hydrated(state, revision) {
      const reporter = bridge(windowRef);
      if (typeof reporter?.reportStateHydrated !== 'function') return false;
      try {
        reporter.reportStateHydrated(revision, workspaceVisualSummary(state));
        return true;
      } catch {
        return false;
      }
    },
    hydrationFailed(stage, code, revision) {
      const reporter = bridge(windowRef);
      if (typeof reporter?.reportHydrationFailed !== 'function') return false;
      try {
        reporter.reportHydrationFailed(revision, stage, code);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function semanticKeyForItem(item) {
  if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(item.id)) return null;
  if (item.kind === 'group') return `group.${item.id}`;
  if (item.kind === 'shortcut') return `shortcut.${item.id}`;
  if (item.kind === 'window-layout') return `window-layout.${item.id}`;
  return null;
}
