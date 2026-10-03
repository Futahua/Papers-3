/**
 * Native compact-widget presentation lifecycle.
 *
 * This owns only host presentation: open/reuse retry and which durable layouts
 * should have a widget at startup. It has no document-writer, store, revision,
 * or membership authority.
 */
export function windowLayoutWidgetOpenSucceeded(result) {
  return Boolean(result)
    && result.ok !== false
    && result.widget?.ok !== false
    && result.outcome !== 'failed'
    && result.outcome !== 'error';
}

export function createWindowLayoutWidgetLifecycle({
  widgetOpen,
  getLayouts,
  getDockedLayoutIds,
  isLayoutVisible,
  presentationSuppressed = () => false,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
}) {
  if (typeof widgetOpen !== 'function') throw new TypeError('widgetOpen is required');
  if (typeof getLayouts !== 'function') throw new TypeError('getLayouts is required');
  if (typeof getDockedLayoutIds !== 'function') throw new TypeError('getDockedLayoutIds is required');
  if (typeof isLayoutVisible !== 'function') throw new TypeError('isLayoutVisible is required');

  async function open(layoutId, options = {}) {
    let result = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        result = await widgetOpen(layoutId, options);
      } catch {
        result = null;
      }
      if (windowLayoutWidgetOpenSucceeded(result)) return result;
      if (attempt + 1 < attempts) await sleep(100 * (2 ** attempt));
    }
    return result;
  }

  async function ensureStartup() {
    if (presentationSuppressed()) return [];
    const docked = new Set(getDockedLayoutIds() ?? []);
    const layouts = (getLayouts() ?? []).filter((layout) =>
      layout?.binned !== true
      && !layout?.bin
      && !docked.has(layout?.id)
      && isLayoutVisible(layout));
    const results = [];
    for (const layout of layouts) {
      results.push(await open(layout.id, { activate: false }));
    }
    return results;
  }

  return { open, ensureStartup };
}
