import {
  VISUAL_SEMANTIC_KEYS_CHANNEL,
  VISUAL_SEMANTIC_KEY_MAX_COUNT,
} from '@shared/visualSemanticKeyConstants';
import { VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL } from '@shared/visualSemanticKeyConstants';

export interface ProjectVisualSemanticKeyIpc {
  send(channel: string, payload: unknown): void;
  on?(channel: string, listener: () => void): void;
}

export type RefreshProjectVisualSemanticKeys = () => void;

interface SemanticKeyObserverEnvironment {
  document: Document;
  MutationObserver?: typeof MutationObserver;
  documentInstanceId?: string;
}

const PAPERS_SEMANTIC_KEY_ATTRIBUTE = 'data-papers-visual-key';

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
    const elements = document.querySelectorAll(`[${PAPERS_SEMANTIC_KEY_ATTRIBUTE}]`);
    for (const element of Array.from(elements).slice(0, VISUAL_SEMANTIC_KEY_MAX_COUNT + 1)) {
      const key = element.getAttribute(PAPERS_SEMANTIC_KEY_ATTRIBUTE);
      if (key !== null) keys.push(key);
    }
    const payload = JSON.stringify(keys);
    if (!force && payload === lastPayload) return;
    lastPayload = payload;
    ipc.send(VISUAL_SEMANTIC_KEYS_CHANNEL, {
      keys,
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
