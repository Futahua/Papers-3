export interface PreviewOwnerSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewOwnerProvider {
  closeOwner(ownerKey: string): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewOwnerSurfaceBounds): void;
  raiseWindow?(windowId: number): void;
}

/**
 * One presentation boundary for preview/browser surfaces owned by a Backpack
 * project surface. Index/main should not need to know which preview engines
 * currently participate in owner visibility, bounds, close or host-overlay
 * raising.
 */
export function createPreviewOwnerGroup(providers: Array<PreviewOwnerProvider | null | undefined>) {
  const active = providers.filter((provider): provider is PreviewOwnerProvider => Boolean(provider));

  return {
    closeOwner(ownerKey: string): void {
      for (const provider of active) provider.closeOwner(ownerKey);
    },
    setOwnerVisible(ownerKey: string, visible: boolean): void {
      for (const provider of active) provider.setOwnerVisible(ownerKey, visible);
    },
    setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewOwnerSurfaceBounds): void {
      for (const provider of active) provider.setOwnerSurfaceBounds(ownerKey, bounds);
    },
    raiseWindow(windowId: number): void {
      for (const provider of active) provider.raiseWindow?.(windowId);
    },
  };
}
