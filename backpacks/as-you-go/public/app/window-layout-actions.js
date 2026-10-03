/**
 * 019B bounded concurrent scheduling with abort (AYG group-action performance).
 * Runs `fn(item, index)` for each item with at most `limit` workers in flight;
 * results are returned in item order. If `abortIf(result)` is true for any
 * result, no further items are started and the promise resolves once all
 * already-started items settle (the caller must gate any commit on its own
 * abort check - e.g. the detach read-only barrier). Deterministic for tests.
 */
export function runBoundedConcurrent(items, limit, fn, abortIf = () => false) {
  if (!Array.isArray(items) || !(limit >= 1)) {
    throw new TypeError('bounded concurrent scheduling requires an array and a positive limit');
  }
  if (typeof fn !== 'function' || typeof abortIf !== 'function') {
    throw new TypeError('bounded concurrent scheduling requires fn and abortIf');
  }
  return new Promise((resolve) => {
    const results = new Array(items.length);
    let index = 0;
    let settled = 0;
    let started = 0;
    let aborted = false;
    let done = false;

    function maybeFinish() {
      if (done || settled !== started) return;
      done = true;
      resolve(results);
    }

    function worker() {
      if (aborted || index >= items.length) {
        maybeFinish();
        return;
      }
      const i = index;
      index += 1;
      started += 1;
      Promise.resolve(fn(items[i], i)).then((result) => {
        results[i] = result;
        settled += 1;
        if (abortIf(result)) aborted = true;
        worker();
      });
    }

    const workers = Math.min(Math.max(1, limit), items.length);
    for (let w = 0; w < workers; w += 1) worker();
    if (items.length === 0) maybeFinish();
  });
}
