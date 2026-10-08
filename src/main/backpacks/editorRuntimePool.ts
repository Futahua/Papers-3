/** Keep one clean editor runtime ready without retaining document state.
 * Providers own document close/handoff and decide whether a lease is reusable.
 * Future native editors can use this same bounded idle lifecycle.
 */
export function createEditorRuntimePool<T>(options: {
  create: () => T;
  usable: (runtime: T) => boolean;
  retire: (runtime: T) => void;
  keepWarm?: () => boolean;
}) {
  const leased = new Set<T>();
  let idle: T | undefined;
  let disposed = false;
  return {
    acquire(): T {
      if (disposed) throw new Error('The editor runtime pool has closed.');
      let runtime = idle;
      idle = undefined;
      if (runtime && !options.usable(runtime)) { options.retire(runtime); runtime = undefined; }
      runtime ??= options.create();
      leased.add(runtime);
      return runtime;
    },
    release(runtime: T, reusable: boolean, preload = false): void {
      if (!leased.delete(runtime)) return;
      if (disposed || !reusable || !options.usable(runtime) || idle || (!preload && options.keepWarm?.() === false)) options.retire(runtime);
      else idle = runtime;
    },
    trimIdle(): void { if (idle) options.retire(idle); idle = undefined; },
    dispose(): void {
      // Active leases must be safely closed by their document owner first.
      if (leased.size) throw new Error('Close active editor documents before disposing their runtimes.');
      disposed = true;
      if (idle) options.retire(idle);
      idle = undefined;
    },
  };
}
