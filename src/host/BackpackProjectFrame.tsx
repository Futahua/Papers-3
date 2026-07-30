import React, { useEffect, useRef } from 'react';

import { host } from './bridge';

interface ProjectMessage {
  type: string;
  requestId?: string;
  actionId?: string;
  text?: string;
}

function message(value: unknown): ProjectMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['type'] !== 'string') return null;
  return {
    type: candidate['type'],
    ...(typeof candidate['requestId'] === 'string'
      ? { requestId: candidate['requestId'] }
      : {}),
    ...(typeof candidate['actionId'] === 'string' ? { actionId: candidate['actionId'] } : {}),
    ...(typeof candidate['text'] === 'string' ? { text: candidate['text'] } : {}),
  };
}

export function BackpackProjectFrame(props: {
  url: string;
  onDismiss: () => void;
}): React.JSX.Element {
  const { url, onDismiss } = props;
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const origin = new URL(url).origin;
    const receive = async (event: MessageEvent): Promise<void> => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      const request = message(event.data);
      if (!request) return;
      if (request.type === 'papers:project:close') {
        onDismiss();
        return;
      }

      let task: Promise<void> | null = null;
      if (request.type === 'papers:project:run-action' && request.actionId) {
        task = host().backpackProject.runAction(request.actionId);
      }
      if (request.type === 'papers:project:copy-text' && request.text) {
        task = host().backpackProject.copyText(request.text);
      }
      if (!task) return;

      try {
        await task;
        frame.current?.contentWindow?.postMessage(
          { type: 'papers:host:result', requestId: request.requestId, ok: true },
          origin,
        );
      } catch (caught) {
        frame.current?.contentWindow?.postMessage(
          {
            type: 'papers:host:result',
            requestId: request.requestId,
            ok: false,
            error: String(caught instanceof Error ? caught.message : caught),
          },
          origin,
        );
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onDismiss, url]);

  return (
    <section className="backpack-project-frame" aria-label="Backpack project">
      <iframe
        ref={frame}
        data-backpack-project
        src={url}
        sandbox="allow-scripts allow-same-origin"
        title="Backpack project"
      />
    </section>
  );
}
