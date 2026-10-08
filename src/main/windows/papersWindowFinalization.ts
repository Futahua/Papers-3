export interface PapersWindowFinalizationDependencies {
  closeOwnedWidgets(windowId: number): Promise<void>;
  unbindSurfaceSenders(windowId: number): void;
  retireLogicalSurfaces(windowId: number): void;
  clearWorkspaceTopology(windowId: number): void;
  removeWindow(windowId: number): void;
}

/** Retire sender and surface authority when the native window closes. */
export async function finalizePapersWindow(windowId: number, dependencies: PapersWindowFinalizationDependencies): Promise<void> {
  await dependencies.closeOwnedWidgets(windowId).catch(() => undefined);
  dependencies.unbindSurfaceSenders(windowId);
  dependencies.retireLogicalSurfaces(windowId);
  dependencies.clearWorkspaceTopology(windowId);
  dependencies.removeWindow(windowId);
}
