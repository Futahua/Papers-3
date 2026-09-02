import {
  VISUAL_SEMANTIC_KEYS_CHANNEL,
  VISUAL_SEMANTIC_KEY_MAX_COUNT,
} from '@shared/visualSemanticKeyConstants';
import { VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL } from '@shared/visualSemanticKeyConstants';
import type { VisualElementObservation } from '@shared/visualSemanticKeys';

export interface ProjectVisualSemanticKeyIpc {
  send(channel: string, payload: unknown): void;
  on?(channel: string, listener: () => void): void;
}

export type RefreshProjectVisualSemanticKeys = () => void;

interface SemanticKeyObserverEnvironment {
  document: Document;
  MutationObserver?: typeof MutationObserver;
  documentInstanceId?: string;
  devicePixelRatio?: number;
}

const PAPERS_SEMANTIC_KEY_ATTRIBUTE = 'data-papers-visual-key';

function quantize(value: number): number { return Math.round(value * 100) / 100; }

function bounds(rect: DOMRect | DOMRectReadOnly): VisualElementObservation['boundsCss'] {
  return { x: quantize(rect.x), y: quantize(rect.y), width: quantize(Math.max(0, rect.width)), height: quantize(Math.max(0, rect.height)) };
}

function clippedPercent(rect: DOMRect, viewportWidth: number, viewportHeight: number): number {
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  if (area === 0) return 0;
  const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  return quantize(Math.max(0, Math.min(100, 100 * (1 - (visibleWidth * visibleHeight) / area))));
}

function roleFor(element: Element): string | undefined {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit.slice(0, 64);
  return ({ BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox', NAV: 'navigation', MAIN: 'main' } as Record<string, string>)[element.tagName];
}

function accessibleNameFor(element: Element): string | undefined {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return undefined;
  const value = element.getAttribute('aria-label') ?? element.textContent?.replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 256) : undefined;
}

function contrastFor(element: Element): VisualElementObservation['contrast'] {
  if (typeof getComputedStyle === 'undefined') return { status: 'unknown' };
  const style = getComputedStyle(element);
  const foreground = style.color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  const background = style.backgroundColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!foreground || !background || style.backgroundImage !== 'none') return { status: 'unknown' };
  const lum = (match: RegExpMatchArray): number => match.slice(1).map(Number).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const left = lum(foreground); const right = lum(background);
  return { status: 'known', ratio: quantize((Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)) };
}

function observeElements(document: Document, elements: Element[], devicePixelRatio: number): VisualElementObservation[] {
  const viewportWidth = document.documentElement?.clientWidth ?? 0;
  const viewportHeight = document.documentElement?.clientHeight ?? 0;
  const result: VisualElementObservation[] = [];
  for (const element of elements) {
    const key = element.getAttribute(PAPERS_SEMANTIC_KEY_ATTRIBUTE);
    const getRect = (element as Element & { getBoundingClientRect?: unknown }).getBoundingClientRect;
    if (!key || typeof getRect !== 'function') continue;
    const rect = element.getBoundingClientRect();
    const style = typeof getComputedStyle === 'undefined' ? null : getComputedStyle(element);
    const reasons: VisualElementObservation['visibilityReasons'] = [];
    if (!element.isConnected) reasons.push('detached');
    if (style?.display === 'none') reasons.push('display-none');
    if (style?.visibility === 'hidden' || style?.visibility === 'collapse') reasons.push('visibility-hidden');
    const opacity = style ? Number.parseFloat(style.opacity) : 1;
    const safeOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    if (safeOpacity === 0) reasons.push('opacity-zero');
    if (rect.width <= 0 || rect.height <= 0) reasons.push('zero-area');
    const clipped = clippedPercent(rect, viewportWidth, viewportHeight);
    if (clipped > 0) reasons.push('outside-viewport');
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      const ancestorStyle = typeof getComputedStyle === 'undefined' ? null : getComputedStyle(ancestor);
      if (ancestorStyle && /(hidden|clip|scroll|auto)/.test(ancestorStyle.overflow + ancestorStyle.overflowX + ancestorStyle.overflowY)) {
        const clip = ancestor.getBoundingClientRect();
        if (rect.left < clip.left || rect.right > clip.right || rect.top < clip.top || rect.bottom > clip.bottom) reasons.push('ancestor-clipped');
        break;
      }
      ancestor = ancestor.parentElement;
    }
    result.push({ key, role: roleFor(element), accessibleName: accessibleNameFor(element), boundsCss: bounds(rect),
      boundsDevice: { x: quantize(rect.x * devicePixelRatio), y: quantize(rect.y * devicePixelRatio), width: quantize(rect.width * devicePixelRatio), height: quantize(rect.height * devicePixelRatio) },
      visible: reasons.length === 0, visibilityReasons: reasons, clippedPercent: clipped, opacity: quantize(safeOpacity), overlapKeys: [], contrast: contrastFor(element) });
  }
  return result.map((observation, index) => ({ ...observation, overlapKeys: result.filter((other, otherIndex) => otherIndex !== index
    && observation.boundsCss.x < other.boundsCss.x + other.boundsCss.width
    && observation.boundsCss.x + observation.boundsCss.width > other.boundsCss.x
    && observation.boundsCss.y < other.boundsCss.y + other.boundsCss.height
    && observation.boundsCss.y + observation.boundsCss.height > other.boundsCss.y).map((other) => other.key).slice(0, 16) }));
}

/** Observe only the fixed Papers-owned semantic-key attribute. The project
 * cannot provide a selector, XPath, script, or arbitrary style query here. */
export function installProjectVisualSemanticKeyObserver(
  ipc: ProjectVisualSemanticKeyIpc,
  environment: SemanticKeyObserverEnvironment,
): RefreshProjectVisualSemanticKeys {
  const { document, MutationObserver, documentInstanceId } = environment;
  if (!MutationObserver) return () => undefined;

  let lastPayload = '';
  const publish = (force = false): void => {
    const keys: string[] = [];
    const elements = Array.from(document.querySelectorAll(`[${PAPERS_SEMANTIC_KEY_ATTRIBUTE}]`)).slice(0, VISUAL_SEMANTIC_KEY_MAX_COUNT + 1);
    for (const element of elements) {
      const key = element.getAttribute(PAPERS_SEMANTIC_KEY_ATTRIBUTE);
      if (key !== null) keys.push(key);
    }
    const observations = observeElements(document, elements, environment.devicePixelRatio ?? 1);
    const payloadObject = observations.length > 0 ? { keys, observations } : { keys };
    const payload = JSON.stringify(payloadObject);
    if (!force && payload === lastPayload) return;
    lastPayload = payload;
    ipc.send(VISUAL_SEMANTIC_KEYS_CHANNEL, {
      keys,
      ...(observations.length > 0 ? { observations } : {}),
      ...(documentInstanceId ? { documentInstanceId } : {}),
    });
  };

  publish();
  // Document-start can precede parser-created semantic nodes. These browser
  // lifecycle events provide a deterministic resend after the project sender
  // has been bound, without introducing a polling timer.
  document.addEventListener('DOMContentLoaded', () => publish(), { once: true });
  document.addEventListener('load', () => publish(), { once: true });
  const observer = new MutationObserver(() => publish());
  ipc.on?.(VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL, () => publish(true));
  observer.observe(document, {
    attributes: true,
    attributeFilter: [PAPERS_SEMANTIC_KEY_ATTRIBUTE],
    childList: true,
    subtree: true,
  });
  return () => publish(true);
}
