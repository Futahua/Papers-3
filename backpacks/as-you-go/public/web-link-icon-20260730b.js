const DB_NAME = 'as-you-go-web-icons';
const DB_VERSION = 1;
const STORE = 'icons';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 256;
const RETRY_MS = 30_000;
const INFLIGHT = new Map();
const FAILED_UNTIL = new Map();

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'origin' });
        store.createIndex('lastUsed', 'lastUsed', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB blocked')); };
  });
  return dbPromise;
}

async function getStoredIcon(origin) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(origin);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function storeIcon(origin, dataUrl, mime, finalOrigin) {
  try {
    const db = await openDb();
    const entry = { origin, dataUrl, mime, finalOrigin: finalOrigin || origin, fetchedAt: Date.now(), lastUsed: Date.now() };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => { /* stored */ };
    tx.onerror = () => { /* best-effort */ };
    await trimDb(db);
  } catch {
    /* best-effort */
  }
}

async function touchIcon(origin) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(origin);
    req.onsuccess = () => {
      const record = req.result;
      if (record) {
        record.lastUsed = Date.now();
        store.put(record);
      }
    };
  } catch {
    /* best-effort */
  }
}

async function trimDb(db) {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result <= MAX_ENTRIES) return;
      const index = store.index('lastUsed');
      const cursorReq = index.openCursor(null, 'prev');
      const keys = [];
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && keys.length < countReq.result - MAX_ENTRIES) {
          keys.push(cursor.primaryKey);
          cursor.continue();
        } else {
          for (const key of keys) store.delete(key);
        }
      };
    };
  } catch {
    /* best-effort */
  }
}

function parseOrigin(url) {
  try {
    const u = new URL(url);
    const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${port}`;
  } catch {
    return null;
  }
}

export async function resolveWebIcon(targetUrl, requestFn) {
  const origin = parseOrigin(targetUrl);
  if (!origin) return null;

  if (FAILED_UNTIL.has(origin) && Date.now() < FAILED_UNTIL.get(origin)) {
    const stored = await getStoredIcon(origin);
    if (stored) { await touchIcon(origin); return stored.dataUrl; }
    return null;
  }
  FAILED_UNTIL.delete(origin);

  const stored = await getStoredIcon(origin);
  if (stored) {
    await touchIcon(origin);
    if (Date.now() - stored.fetchedAt <= FRESH_MS) return stored.dataUrl;
    refreshInBackground(origin, targetUrl, requestFn);
    return stored.dataUrl;
  }

  if (INFLIGHT.has(origin)) return await INFLIGHT.get(origin);

  const promise = (async () => {
    try {
      const result = await requestFn(targetUrl);
      if (result?.icon) {
        await storeIcon(origin, result.icon, result.mime || 'image/png', result.finalOrigin || origin);
        return result.icon;
      }
      FAILED_UNTIL.set(origin, Date.now() + RETRY_MS);
      return null;
    } catch {
      FAILED_UNTIL.set(origin, Date.now() + RETRY_MS);
      return null;
    } finally {
      INFLIGHT.delete(origin);
    }
  })();
  INFLIGHT.set(origin, promise);
  return await promise;
}

async function refreshInBackground(origin, targetUrl, requestFn) {
  if (INFLIGHT.has(origin)) return;
  const promise = (async () => {
    try {
      const result = await requestFn(targetUrl);
      if (result?.icon) {
        await storeIcon(origin, result.icon, result.mime || 'image/png', result.finalOrigin || origin);
      }
    } catch {
      /* best-effort background refresh */
    } finally {
      INFLIGHT.delete(origin);
    }
  })();
  INFLIGHT.set(origin, promise);
}

export function hydrateIcons(root, iconCache, requestIcon, requestWebIcon) {
  if (!root) return;

  const images = [...root.querySelectorAll('[data-default-icon]')];
  images.forEach(async (image) => {
    const shortcutId = image.dataset.defaultIcon;
    if (!shortcutId) return;
    if (image.dataset.hydrated === '1') return;
    image.dataset.hydrated = '1';
    if (!iconCache.has(shortcutId)) {
      try {
        iconCache.set(shortcutId, await requestIcon({ actionId: shortcutId }));
      } catch {
        iconCache.set(shortcutId, null);
      }
    }
    const resolved = iconCache.get(shortcutId);
    if (!resolved || !image.isConnected) return;
    image.src = resolved;
    image.hidden = false;
    image.nextElementSibling?.setAttribute('hidden', '');
  });

  const webImages = [...root.querySelectorAll('[data-web-icon]')];
  webImages.forEach(async (image) => {
    const targetUrl = image.dataset.webIcon;
    if (!targetUrl) return;
    if (image.dataset.hydrated === '1') return;
    image.dataset.hydrated = '1';
    try {
      const icon = await resolveWebIcon(targetUrl, requestWebIcon);
      if (!image.isConnected) return;
      if (icon) {
        image.src = icon;
        image.addEventListener('load', () => {
          image.hidden = false;
          image.nextElementSibling?.setAttribute('hidden', '');
        }, { once: true });
        image.addEventListener('error', () => {
          image.hidden = true;
          image.nextElementSibling?.removeAttribute('hidden');
        }, { once: true });
      } else {
        image.hidden = true;
        image.nextElementSibling?.removeAttribute('hidden');
      }
    } catch {
      if (image.isConnected) {
        image.hidden = true;
        image.nextElementSibling?.removeAttribute('hidden');
      }
    }
  });

  const webFallbackImages = [...root.querySelectorAll('[data-web-fallback]')];
  webFallbackImages.forEach(async (image) => {
    const targetUrl = image.dataset.webFallback;
    if (!targetUrl) return;
    if (image.dataset.hydrated === '1') return;
    image.dataset.hydrated = '1';
    image.addEventListener('load', () => {
      image.hidden = false;
      image.nextElementSibling?.setAttribute('hidden', '');
    }, { once: true });
    image.addEventListener('error', () => {
      image.hidden = true;
      image.nextElementSibling?.removeAttribute('hidden');
    }, { once: true });
    image.src = targetUrl;
  });
}

export function hydrateWebPreview(previewImg, fallbackEl, targetUrl) {
  if (!previewImg || !fallbackEl) return;

  const origin = parseOrigin(targetUrl);
  if (!origin) {
    fallbackEl.removeAttribute('hidden');
    previewImg.hidden = true;
    return;
  }

  previewImg.hidden = true;
  fallbackEl.removeAttribute('hidden');

  const url25 = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(targetUrl).hostname)}&sz=64`;

  previewImg.src = '';
  previewImg.dataset.webFallback = url25;
  previewImg.addEventListener('load', () => {
    fallbackEl.setAttribute('hidden', '');
    previewImg.hidden = false;
  }, { once: true });
  previewImg.addEventListener('error', () => {
    previewImg.hidden = true;
    fallbackEl.removeAttribute('hidden');
  }, { once: true });
  previewImg.src = url25;
}
