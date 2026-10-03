/**
 * Authority gate for a staged project renderer.
 *
 * A staged WebContents may be loading before it has been adopted by a live
 * logical surface, but project IPC must not run against an absent binding (or
 * fail and poison arbitrary project startup). The IPC layer awaits this gate
 * before its normal project-sender guard. Adoption releases queued calls;
 * discard rejects them and keeps the sender non-authoritative.
 */
export interface ProjectSurfaceAuthorityBarrier {
  stage(senderId: number): { adopt(): void; discard(): void };
  wait(senderId: number): Promise<void>;
  isPending(senderId: number): boolean;
  forget(senderId: number): void;
}

type Entry = {
  state: 'pending' | 'adopted' | 'discarded';
  resolve: () => void;
  reject: (error: Error) => void;
  promise: Promise<void>;
};

export function createProjectSurfaceAuthorityBarrier(): ProjectSurfaceAuthorityBarrier {
  const entries = new Map<number, Entry>();

  return {
    stage(senderId) {
      if (entries.has(senderId)) throw new Error('project sender is already staged');
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      entries.set(senderId, { state: 'pending', resolve, reject, promise });
      let settled = false;
      return {
        adopt() {
          const entry = entries.get(senderId);
          if (!entry || entry.state !== 'pending' || settled) return;
          settled = true;
          entry.state = 'adopted';
          entry.resolve();
        },
        discard() {
          const entry = entries.get(senderId);
          if (!entry || entry.state !== 'pending' || settled) return;
          settled = true;
          entry.state = 'discarded';
          entry.reject(new Error('staged project surface was discarded before adoption'));
        },
      };
    },

    wait(senderId) {
      return entries.get(senderId)?.promise ?? Promise.resolve();
    },

    isPending(senderId) {
      return entries.get(senderId)?.state === 'pending';
    },

    forget(senderId) {
      entries.delete(senderId);
    },
  };
}
