import React, { useEffect, useRef } from 'react';

import { host } from './bridge';

interface ProjectMessage {
  type: string;
  requestId?: string;
  actionId?: string;
  text?: string;
  state?: string;
  url?: string;
  files?: File[];
  kind?: 'file' | 'folder';
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
    ...(typeof candidate['state'] === 'string' ? { state: candidate['state'] } : {}),
    ...(typeof candidate['url'] === 'string' ? { url: candidate['url'] } : {}),
    ...(Array.isArray(candidate['files']) && candidate['files'].every((file) => file instanceof File)
      ? { files: candidate['files'] }
      : {}),
    ...(candidate['kind'] === 'file' || candidate['kind'] === 'folder' ? { kind: candidate['kind'] } : {}),
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

      let task: Promise<Record<string, unknown> | void> | null = null;
      if (request.type === 'papers:project:run-action' && request.actionId) {
        task = host().backpackProject.runAction(request.actionId);
      }
      if (request.type === 'papers:project:copy-text' && request.text) {
        task = host().backpackProject.copyText(request.text);
      }
      if (request.type === 'papers:project:as-you-go-load') {
        task = host().backpackProject.projectStateLoad().then((state) => ({
          state: JSON.stringify(state),
        }));
      }
      if (request.type === 'papers:project:as-you-go-save' && request.state) {
        task = host().backpackProject.projectStateSave(request.state);
      }
      if (request.type === 'papers:project:as-you-go-pick-target' && request.kind) {
        task = host().backpackProject.projectPickTarget(request.kind).then((selection) => ({
          target: selection?.target ?? null,
          icon: selection?.icon ?? null,
        }));
      }
      if (request.type === 'papers:project:as-you-go-shortcut-icon' && request.actionId) {
        task = host().backpackProject.projectShortcutIcon(request.actionId).then((icon) => ({
          icon,
        }));
      }
      if (request.type === 'papers:project:as-you-go-launch' && request.actionId) {
        task = host().backpackProject.projectLaunchShortcut(request.actionId);
      }
      if (request.type === 'papers:project:open-web-link' && request.url) {
        task = host().backpackProject.projectOpenWebLink(request.url);
      }
      if (request.type === 'papers:project:resolve-dropped-targets' && request.files?.length) {
        task = host().backpackProject.projectResolveDroppedTargets(request.files).then((targets) => ({
          targets,
        }));
      }
      if (!task) return;

      try {
        const payload = await task;
        frame.current?.contentWindow?.postMessage(
          {
            type: 'papers:host:result',
            requestId: request.requestId,
            ok: true,
            ...(payload ?? {}),
          },
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
