import { useEffect } from 'react';
import { host } from './bridge';

const MIME = 'application/x-papers-page';

/** Outer page tabs move through the same main-process transaction as the
 * Pages menu. Runtime windows are containers, never persisted page identity. */
export function usePageWindowDrag(surfaceIds: string[], onError: (message: string) => void): void {
  const identity = surfaceIds.join('\0');
  useEffect(() => {
    const own = new Set(identity ? identity.split('\0') : []);
    let dragged: string | null = null;
    let cancelled = false;
    let indicator: Element | null = null;
    const clear = (): void => { indicator?.classList.remove('papers-page-drop'); indicator = null; };
    const target = (event: DragEvent): Element | null => event.target instanceof Element
      ? event.target.closest('.dv-tabs-and-actions-container, .titlebar') : null;
    const start = (event: DragEvent): void => {
      const id = event.dataTransfer?.getData(MIME);
      dragged = id && own.has(id) ? id : null;
      cancelled = false;
    };
    const over = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes(MIME) || dragged) return;
      clear(); indicator = target(event);
      if (!indicator) return;
      event.preventDefault(); event.stopImmediatePropagation();
      event.dataTransfer.dropEffect = 'move';
      indicator.classList.add('papers-page-drop');
    };
    const drop = (event: DragEvent): void => {
      const id = event.dataTransfer?.getData(MIME);
      if (!id || own.has(id) || !target(event)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      event.dataTransfer!.dropEffect = 'move'; clear();
      void host().app.adoptPage(id).catch(error => onError(String(error)));
    };
    const end = (event: DragEvent): void => {
      const id = dragged; dragged = null; clear();
      // Escape and absent terminal coordinates are cancellation, not tear-out.
      const outside = event.clientX < 0 || event.clientY < 0 || event.clientX > innerWidth || event.clientY > innerHeight;
      if (!id || cancelled || !outside || (event.screenX === 0 && event.screenY === 0)
        || event.dataTransfer?.dropEffect !== 'none') return;
      void host().app.detachPage(id).catch(error => onError(String(error)));
    };
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancelled = true; };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    window.addEventListener('dragend', end);
    window.addEventListener('keydown', key, true);
    window.addEventListener('dragleave', clear);
    return () => {
      clear(); window.removeEventListener('dragstart', start); window.removeEventListener('dragover', over, true);
      window.removeEventListener('drop', drop, true); window.removeEventListener('dragend', end);
      window.removeEventListener('keydown', key, true); window.removeEventListener('dragleave', clear);
    };
  }, [identity, onError]);
}
