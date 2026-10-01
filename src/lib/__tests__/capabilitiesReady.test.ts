/**
 * `useCapabilities().ready`: whether access decisions may be made yet. Until a
 * user's set is read, the only answer is the role fallback — a guess that knows
 * nothing of organization or user overrides — and gating on it mounted pages a
 * restricted account may not open and bounced accounts off pages they were
 * granted. The hook keeps ONE keyed answer; these pin what that buys.
 */
import { describe, expect, it } from 'vitest';
import {
  capabilitiesReady,
  roleFallbackCapabilities,
  serverCapabilitiesFor,
  settleCapabilities,
  type EffectiveCapabilities,
} from '../capabilities';

const caps = (pages: Record<string, boolean>): EffectiveCapabilities => ({
  ...roleFallbackCapabilities('user'),
  pages,
});
const X = 'user-x';
const Y = 'user-y';

describe('capabilitiesReady', () => {
  it('a hard load is not ready: the user is restored, the set is not read yet', () => {
    expect(capabilitiesReady(null, X)).toBe(false);
  });

  it('nobody signed in is ready — there is nothing to wait for', () => {
    expect(capabilitiesReady(null, null)).toBe(true);
  });

  it('ready once THIS user’s read has settled', () => {
    expect(capabilitiesReady(settleCapabilities(null, X, caps({ '/': false })), X)).toBe(true);
  });

  it('a switch from X to Y waits for Y, and never serves X’s set to Y', () => {
    const resolved = settleCapabilities(null, X, caps({ '/admin': true }));
    expect(capabilitiesReady(resolved, Y)).toBe(false);
    expect(serverCapabilitiesFor(resolved, Y)).toBeNull();
  });

  it('a failed or timed-out first read is ready, with the role fallback', () => {
    const resolved = settleCapabilities(null, X, null);
    expect(capabilitiesReady(resolved, X)).toBe(true);
    expect(serverCapabilitiesFor(resolved, X)).toBeNull();
  });
});

describe('settleCapabilities', () => {
  it('a failed refresh keeps the last good set rather than dropping to the guess', () => {
    const good = settleCapabilities(null, X, caps({ '/policies': true }));
    const after = settleCapabilities(good, X, null);
    expect(serverCapabilitiesFor(after, X)?.pages['/policies']).toBe(true);
  });

  it('a successful refresh replaces it', () => {
    const good = settleCapabilities(null, X, caps({ '/policies': true }));
    const after = settleCapabilities(good, X, caps({ '/policies': false }));
    expect(serverCapabilitiesFor(after, X)?.pages['/policies']).toBe(false);
  });

  it('a failed read for a different user does not inherit the previous user’s set', () => {
    const good = settleCapabilities(null, X, caps({ '/admin': true }));
    expect(serverCapabilitiesFor(settleCapabilities(good, Y, null), Y)).toBeNull();
  });
});
