/**
 * Transport contract. Not a design decision — this is the frozen Papers relay,
 * restated in the terms this page must use.
 *
 * Backpack pages are served with `connect-src 'none'`: there is no fetch, no
 * XHR, no WebSocket and no localhost from here. Every call is a `postMessage` to
 * Papers, which holds the delegate-wave operator credential and performs the
 * authenticated loopback request. The page never sees a URL, a method or a
 * token, and its identity is attached by the Papers preload from the page
 * origin — never sent from this file.
 *
 * The nine operations below are the complete surface. If the interface needs a
 * truth these cannot express, that is a specific missing truth to raise as a
 * contract change, not a reason to widen anything here.
 */

export type Operation =
  | 'overview'
  | 'briefing'
  | 'attention'
  | 'job'
  | 'propose'
  | 'authorize'
  | 'integration'
  | 'approve'
  | 'decline';

export interface RelayResult<T = unknown> {
  ok: boolean;
  /** Typed failure from Papers or delegate-wave. Never carries a URL or token. */
  code?: string;
  message?: string;
  result?: T;
}

interface HostResult {
  type: string;
  requestId: string;
  ok: boolean;
  error?: string;
  delegateWave?: RelayResult;
}

const PENDING = new Map<string, (value: RelayResult) => void>();
let listening = false;
let counter = 0;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event) => {
    // Both checks are load-bearing: a reply must come from this window and this
    // origin, or it is not Papers answering.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data as HostResult | null;
    if (!message || message.type !== 'papers:host:result') return;
    const settle = PENDING.get(message.requestId);
    if (!settle) return;
    PENDING.delete(message.requestId);
    if (!message.ok) {
      settle({ ok: false, code: 'HOST_REFUSED', message: message.error ?? 'Papers refused the request.' });
      return;
    }
    settle(message.delegateWave ?? { ok: false, code: 'NO_RESULT', message: 'Papers returned no result.' });
  });
}

/**
 * A lost reply resolves as TIMEOUT rather than as a failure, because a mutation
 * that timed out may still have run. Reporting it as failed would invite a
 * second attempt at something that already happened.
 */
export function call<T = unknown>(
  operation: Operation,
  params: Record<string, unknown> = {},
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {},
): Promise<RelayResult<T>> {
  listen();
  counter += 1;
  const requestId = `dw-${Date.now()}-${counter}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      PENDING.delete(requestId);
      resolve({ ok: false, code: 'TIMEOUT', message: 'Papers did not answer. The operation may still have run.' });
    }, timeoutMs);
    PENDING.set(requestId, (value) => {
      clearTimeout(timer);
      resolve(value as RelayResult<T>);
    });
    window.postMessage(
      { type: 'papers:project:delegate-wave', requestId, operation, params },
      window.location.origin,
    );
  });
}
