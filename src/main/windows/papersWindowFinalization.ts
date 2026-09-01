export interface PapersWindowFinalizationDependencies {
  closeOwnedWidgets(windowId: number): Promise<void>;
  reconcileHermes(windowId: number): Promise<void>;
  unbindSurfaceSenders(windowId: number): void;
  retireLogicalSurfaces(windowId: number): void;
  removeWindow(windowId: number): void;
  emitHermesSurface(): void;
}

/** Finish one already-closed native window. Registry cleanup is guaranteed
 * even when the physical Hermes hide fails; logical surfaces end before their
 * owning window record disappears, so inspection never observes live orphans. */
export async function finalizePapersWindow(
  windowId: number,
  dependencies: PapersWindowFinalizationDependencies,
): Promise<void> {
  await dependencies.closeOwnedWidgets(windowId).catch(() => undefined);
  try {
    await dependencies.reconcileHermes(windowId);
  } finally {
    dependencies.unbindSurfaceSenders(windowId);
    dependencies.retireLogicalSurfaces(windowId);
    dependencies.removeWindow(windowId);
    dependencies.emitHermesSurface();
  }
}
