import type { PreviewRect } from './windowsPreviewHandlerBridge';

/** Host surface visibility and pane demand are independent, conjunctive gates. */
export function createBrowserPresentationGate() {
  const owners = new Map<string, boolean>();
  const panes = new Map<string, boolean>();
  return {
    setOwner: (key: string, visible: boolean) => { owners.set(key, visible); },
    setPane: (key: string, visible: boolean) => { panes.set(key, visible); },
    allows: (key: string) => owners.get(key) !== false && panes.get(key) !== false,
    forget: (key: string) => { owners.delete(key); panes.delete(key); },
  };
}

export function browserViewBounds(surface: PreviewRect, local: PreviewRect): PreviewRect {
  const x = Math.max(surface.x, surface.x + local.x);
  const y = Math.max(surface.y, surface.y + local.y);
  return {
    x: Math.round(x), y: Math.round(y),
    width: Math.max(0, Math.floor(Math.min(surface.x + surface.width, surface.x + local.x + local.width) - x)),
    height: Math.max(0, Math.floor(Math.min(surface.y + surface.height, surface.y + local.y + local.height) - y)),
  };
}
