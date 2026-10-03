window.__asYouGoVisualFixtureReportFailure = () => {
  const bridge = window.papersVisualDiagnosticBridgeV1;
  bridge?.reportStateHydrated('fixture-visual-failure-v1', { groups: 1, shortcuts: 1 });
  setTimeout(() => bridge?.reportHydrationFailed('fixture-visual-failure-v1', 'model', 'synthetic-model-failure'), 50);
};
window.addEventListener('load', () => setTimeout(() => window.__asYouGoVisualFixtureReportFailure?.(), 0));
