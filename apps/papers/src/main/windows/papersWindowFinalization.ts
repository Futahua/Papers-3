export interface PapersWindowFinalizationDependencies {
  closeOwnedWidgets(windowId: number): Promise<void>;
  reconcileHermes(windowId: number): Promise<void>;
  unbindSurfaceSenders(windowId: number): void;
  retireLogicalSurfaces(windowId: number): void;
  clearWorkspaceTopology(windowId: number): void;
  removeWindow(windowId: number): void;
  emitHermesSurface(): void;
}

/** Finish one already-closed native window. Registry cleanup is guaranteed
 * even when the physical Hermes hide fails. Logical surfaces end as soon as the
 * native window is dead; the window record remains only long enough for Hermes
 * reconciliation, so inspection never observes live project orphans. */
export async function finalizePapersWindow(
  windowId: number,
  dependencies: PapersWindowFinalizationDependencies,
): Promise<void> {
  await dependencies.closeOwnedWidgets(windowId).catch(() => undefined);
  // The native window is already dead when this runs. Sender authority and
  // logical project identity must end before Hermes awaits a native
  // acknowledgement; otherwise control inspection can report a dead window
  // with live surfaces during that bounded interval.
  dependencies.unbindSurfaceSenders(windowId);
  dependencies.retireLogicalSurfaces(windowId);
  dependencies.clearWorkspaceTopology(windowId);
  try {
    await dependencies.reconcileHermes(windowId);
  } finally {
    dependencies.removeWindow(windowId);
    dependencies.emitHermesSurface();
  }
}
