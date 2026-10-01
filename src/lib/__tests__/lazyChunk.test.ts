/**
 * "This page hit a snag" after a deploy: a tab asks for a route chunk the new
 * build no longer has, the import rejects, and React.lazy throws (and keeps
 * throwing). `lazyChunk` reloads the tab once instead. These pin the three
 * things that make that safe — it recognises only a failed module fetch, it
 * cannot loop, and it never reloads without a guard — and that nothing in
 * `src/` calls `React.lazy` around it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('../lazyChunk');

// `reloadStarted` is module state: each test gets a fresh copy.
async function fresh(): Promise<Mod> {
  vi.resetModules();
  return import('../lazyChunk');
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => {
  vi.resetModules();
});

describe('isChunkLoadError', () => {
  it('matches what each browser says when a module script cannot be fetched', async () => {
    const { isChunkLoadError } = await fresh();
    for (const msg of [
      'Failed to fetch dynamically imported module: https://app.example/assets/Forbidden-abc123.js',
      'error loading dynamically imported module: https://app.example/assets/Policies-1.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/index-9f.css',
      "'text/html' is not a valid JavaScript MIME type.",
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    ]) {
      expect(isChunkLoadError(new TypeError(msg)), msg).toBe(true);
      expect(isChunkLoadError(msg), msg).toBe(true);
    }
  });

  it('does not match an ordinary render error', async () => {
    const { isChunkLoadError } = await fresh();
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError({ message: 'Failed to fetch dynamically imported module' })).toBe(false);
  });
});

describe('shouldReloadForChunk', () => {
  it('allows one reload per window', async () => {
    const { shouldReloadForChunk, CHUNK_RELOAD_WINDOW_MS: W } = await fresh();
    expect(shouldReloadForChunk(null, 1_000_000, true)).toBe(true);
    expect(shouldReloadForChunk(1_000_000, 1_000_000 + W - 1, true)).toBe(false);
    expect(shouldReloadForChunk(1_000_000, 1_000_000 + W, true)).toBe(true);
  });

  it('never reloads offline — the same error means "no network" there', async () => {
    const { shouldReloadForChunk } = await fresh();
    expect(shouldReloadForChunk(null, 1_000_000, false)).toBe(false);
  });

  it('a stamp it cannot read, or one from the future, reloads nothing', async () => {
    const { shouldReloadForChunk } = await fresh();
    expect(shouldReloadForChunk(Number.NaN, 1_000_000, true)).toBe(false);
    expect(shouldReloadForChunk(2_000_000, 1_000_000, true)).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  it('stamps the guard and reloads once', async () => {
    const { reloadForStaleChunk, CHUNK_RELOAD_KEY } = await fresh();
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadForStaleChunk({ storage, now: 5_000, online: true, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get(CHUNK_RELOAD_KEY)).toBe('5000');
  });

  it('two failures in the same tick share one reload', async () => {
    const { reloadForStaleChunk } = await fresh();
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadForStaleChunk({ storage, now: 5_000, online: true, reload });
    expect(reloadForStaleChunk({ storage, now: 5_001, online: true, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('after a reload inside the window, the failure is real: no second reload', async () => {
    const { reloadForStaleChunk, CHUNK_RELOAD_KEY } = await fresh();
    const storage = memoryStorage({ [CHUNK_RELOAD_KEY]: '5000' });
    const reload = vi.fn();
    expect(reloadForStaleChunk({ storage, now: 20_000, online: true, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('no storage, or storage that throws, means no guard — so no automatic reload', async () => {
    const { reloadForStaleChunk } = await fresh();
    const reload = vi.fn();
    expect(reloadForStaleChunk({ storage: null, now: 5_000, online: true, reload })).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(reloadForStaleChunk({ storage: throwing, now: 5_000, online: true, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('recoverFromChunkError', () => {
  const PENDING = Symbol('pending');
  const settle = (p: Promise<unknown>) =>
    Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r(PENDING), 0))]);

  it('stays pending while the tab reloads, so Suspense keeps its spinner', async () => {
    const { recoverFromChunkError } = await fresh();
    const reload = vi.fn();
    const p = recoverFromChunkError(new TypeError('Failed to fetch dynamically imported module: x.js'), {
      storage: memoryStorage(),
      now: 5_000,
      online: true,
      reload,
    });
    expect(await settle(p)).toBe(PENDING);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rethrows the SAME error when it is not a chunk failure, or the guard is spent', async () => {
    const { recoverFromChunkError, CHUNK_RELOAD_KEY } = await fresh();
    const boom = new Error('boom');
    await expect(
      recoverFromChunkError(boom, { storage: memoryStorage(), now: 5_000, online: true, reload: vi.fn() }),
    ).rejects.toBe(boom);
    const stale = new TypeError('Importing a module script failed.');
    await expect(
      recoverFromChunkError(stale, {
        storage: memoryStorage({ [CHUNK_RELOAD_KEY]: '4000' }),
        now: 5_000,
        online: true,
        reload: vi.fn(),
      }),
    ).rejects.toBe(stale);
  });
});

describe('every lazy import goes through lazyChunk', () => {
  const src = path.resolve(__dirname, '../..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(src);

  it('no bare React.lazy outside lazyChunk.ts', () => {
    const offenders = files
      .filter((f) => !f.endsWith(path.join('lib', 'lazyChunk.ts')))
      .filter((f) => /(^|[^\w.])lazy\(|React\.lazy\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual([]);
  });

  it('the routes still use it', () => {
    const app = readFileSync(path.join(src, 'App.tsx'), 'utf8');
    expect((app.match(/lazyChunk\(/g) ?? []).length).toBeGreaterThanOrEqual(29);
  });
});
