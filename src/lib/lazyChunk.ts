import { lazy } from 'react';

/**
 * `React.lazy` that survives a deploy.
 *
 * Every signed-in page, and a few heavy components inside pages, are lazy
 * chunks named by content hash. Vercel serves only the newest build, and
 * `vercel.json` rewrites every unknown path to `index.html` — so a tab opened
 * before a deploy that asks for `/assets/<old-hash>.js` gets HTML back, the
 * dynamic import rejects, and the lazy component throws into
 * `RouteErrorBoundary` ("This page hit a snag"). `React.lazy` also caches the
 * rejection, so the same page fails on every later visit until a full reload.
 *
 * The recovery is that full reload, done for the user, once: the new
 * `index.html` names the new chunks. A sessionStorage stamp allows at most one
 * automatic reload per window per tab, so a chunk that is genuinely missing
 * from the CURRENT build reaches the boundary instead of looping. Offline, the
 * same browser error means "no network", and reloading would swap the app for
 * the browser's offline page — so it never reloads then.
 *
 * Retrying `import()` in place is not an option: browsers may cache the failed
 * module fetch, and a cache-busting query would load a second copy of the
 * module.
 *
 * A `vite:preloadError` listener is deliberately NOT used: Vite's preload
 * helper rethrows into the importer, so this wrapper already sees every
 * failure, and a global listener would also reload the page under the
 * non-route dynamic imports (`runSeries.ts`, `QuestionsAndAnswers.tsx`) in the
 * middle of someone's work.
 */

/** What Chromium, Firefox and Safari say when a module script cannot be fetched or is not JS. */
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|is not a valid JavaScript MIME type|Expected a JavaScript module script/i;

export const CHUNK_RELOAD_KEY = 'suresuite:chunk-reload-at';
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return CHUNK_ERROR_RE.test(msg);
}

/** One automatic reload per window. A stamp from the future (clock moved back) reloads nothing. */
export function shouldReloadForChunk(last: number | null, now: number, online: boolean): boolean {
  if (!online) return false;
  if (last === null) return true;
  if (!Number.isFinite(last)) return false;
  return now - last >= CHUNK_RELOAD_WINDOW_MS;
}

export interface ChunkReloadEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: number;
  online: boolean;
  reload: () => void;
}

// A route and the chat bubble can fail in the same tick; they share one reload.
let reloadStarted = false;

/** Reloads the tab if the guard allows it. True when a reload is under way. */
export function reloadForStaleChunk(env: ChunkReloadEnv = browserEnv()): boolean {
  if (reloadStarted) return true;
  // No storage, no loop guard — so no automatic reload at all.
  if (!env.storage) return false;
  try {
    const raw = env.storage.getItem(CHUNK_RELOAD_KEY);
    if (!shouldReloadForChunk(raw === null ? null : Number(raw), env.now, env.online)) return false;
    env.storage.setItem(CHUNK_RELOAD_KEY, String(env.now));
  } catch {
    return false;
  }
  reloadStarted = true;
  env.reload();
  return true;
}

function browserEnv(): ChunkReloadEnv {
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Blocked storage (private mode, sandboxed frame): no guard, so no reload.
  }
  return {
    storage,
    now: Date.now(),
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    reload: () => window.location.reload(),
  };
}

/** Never settles while the reload happens (Suspense keeps its spinner); otherwise rethrows. */
export function recoverFromChunkError(err: unknown, env?: ChunkReloadEnv): Promise<never> {
  if (isChunkLoadError(err) && reloadForStaleChunk(env)) return new Promise<never>(() => {});
  return Promise.reject(err);
}

/** Drop-in for `React.lazy`. Every lazy import in `src/` goes through this. */
export const lazyChunk: typeof lazy = (factory) =>
  lazy(() => factory().catch((err: unknown) => recoverFromChunkError(err)));
