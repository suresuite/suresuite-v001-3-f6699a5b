/**
 * §4 D278 — an open session learns that its account changed.
 *
 * `useAuth` used to re-read the account once, on mount, and `useCapabilities` re-read the
 * capability set only when the user id changed, so a role changed on /admin/users reached
 * no signed-in tab. This pins the watcher both hooks rely on, the one-time notice, the
 * capability reload key — and that the hooks actually use them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROFILE_REFRESH_MIN_GAP_MS,
  PROFILE_REFRESH_MS,
  capabilitiesReloadKey,
  roleChangeNotice,
  watchProfileFreshness,
  type FreshnessTargets,
} from '../sessionRefresh';

function fakeTargets() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextHandle = 1;
  let clock = 1_000_000;
  const targets: FreshnessTargets = {
    win: win as unknown as FreshnessTargets['win'],
    doc: doc as unknown as FreshnessTargets['doc'],
    setInterval: (fn, ms) => { const h = nextHandle++; intervals.set(h, { fn, ms }); return h; },
    clearInterval: (h) => { intervals.delete(h as number); },
    now: () => clock,
  };
  return {
    targets, win, doc, intervals,
    advance: (ms: number) => { clock += ms; },
    tick: () => intervals.forEach((i) => i.fn()),
  };
}

describe('D278 · watchProfileFreshness', () => {
  it('re-reads on focus and when the tab becomes visible, not while hidden', () => {
    const t = fakeTargets();
    let n = 0;
    watchProfileFreshness(() => { n++; }, PROFILE_REFRESH_MS, t.targets);
    t.win.dispatchEvent(new Event('focus'));
    expect(n).toBe(1);
    t.advance(PROFILE_REFRESH_MIN_GAP_MS);
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(n).toBe(1);
    t.doc.visibilityState = 'visible';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(n).toBe(2);
  });

  it('answers focus and visibilitychange firing together with one read', () => {
    const t = fakeTargets();
    let n = 0;
    watchProfileFreshness(() => { n++; }, PROFILE_REFRESH_MS, t.targets);
    t.win.dispatchEvent(new Event('focus'));
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(n).toBe(1);
  });

  it('re-reads every five minutes while signed in', () => {
    const t = fakeTargets();
    let n = 0;
    watchProfileFreshness(() => { n++; }, undefined, t.targets);
    expect([...t.intervals.values()].map((i) => i.ms)).toEqual([5 * 60 * 1000]);
    t.tick();
    t.tick();
    expect(n).toBe(2);
  });

  it('cleans up both listeners and the interval', () => {
    const t = fakeTargets();
    let n = 0;
    const stop = watchProfileFreshness(() => { n++; }, PROFILE_REFRESH_MS, t.targets);
    stop();
    t.win.dispatchEvent(new Event('focus'));
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(n).toBe(0);
    expect(t.intervals.size).toBe(0);
  });
});

describe('D278 · the notice and the reload key', () => {
  it('says a changed role once, and nothing otherwise', () => {
    expect(roleChangeNotice('user', 'admin')).toBe('Your role changed to Admin');
    expect(roleChangeNotice('admin', 'admin')).toBeNull();
    expect(roleChangeNotice(undefined, 'admin')).toBeNull();
  });

  it('keys the capability read on the role as well as the user', () => {
    expect(capabilitiesReloadKey({ id: 'u1', role: 'user' })).not.toBe(capabilitiesReloadKey({ id: 'u1', role: 'admin' }));
    expect(capabilitiesReloadKey({ id: 'u1', role: 'user' })).toBe(capabilitiesReloadKey({ id: 'u1', role: 'user' }));
    expect(capabilitiesReloadKey(null)).toBeNull();
  });
});

describe('D278 · the hooks use them', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  it('useCapabilities reloads on the role, not only the user id', () => {
    const src = read('hooks/useCapabilities.tsx');
    expect(src).toMatch(/const reloadKey = capabilitiesReloadKey\(user\)/);
    // The effect that loads the set — not `refresh`, which rightly stays keyed on the id.
    const effect = src.match(/useEffect\(\(\) => \{\s*if \(userId\) \{\s*load\(userId\);[\s\S]*?\}, \[([^\]]*)\]\);/);
    expect(effect?.[1]).toBe('reloadKey, load');
  });

  it('useAuth refreshes the profile on focus, visibility and the interval, and says a role change', () => {
    const src = read('hooks/useAuth.tsx');
    expect(src).toMatch(/watchProfileFreshness\(/);
    expect(src).toMatch(/roleChangeNotice\(user\.role, updated\.role\)/);
    // Installed per signed-in user, and cleaned up: the effect returns the watcher's cleanup.
    expect(src).toMatch(/if \(!user\?\.id\) return;\s*\n\s*return watchProfileFreshness\(/);
  });
});
