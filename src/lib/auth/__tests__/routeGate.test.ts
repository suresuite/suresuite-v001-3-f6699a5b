/**
 * `RoleGuard`'s decision, as a table. The rule this file exists for: a page is
 * never rendered or denied on the role fallback — the guard WAITS for the
 * server's capability set. Deciding early mounted pages a restricted account
 * may not open and bounced accounts off pages they were granted.
 */
import { describe, expect, it } from 'vitest';
import { routeGate, type RouteGateInput } from '../routeGate';

const base: RouteGateInput = {
  signedIn: true,
  mustChangePassword: false,
  pathname: '/policies',
  role: 'user',
  ready: true,
  canAccess: true,
};
const gate = (over: Partial<RouteGateInput>) => routeGate({ ...base, ...over });

describe('routeGate', () => {
  it('signed out goes to /auth, before anything else', () => {
    expect(gate({ signedIn: false, ready: false, mustChangePassword: true })).toEqual({
      kind: 'redirect',
      to: '/auth',
    });
  });

  it('a password that must change goes to /profile even before the set is read', () => {
    expect(gate({ mustChangePassword: true, ready: false })).toEqual({
      kind: 'redirect',
      to: '/profile?tab=password&forced=1',
    });
  });

  it('…but not when already on /profile', () => {
    expect(gate({ mustChangePassword: true, pathname: '/profile', ready: false })).toEqual({ kind: 'render' });
  });

  it('WAITS while the set is unread — neither renders nor denies on the guess', () => {
    expect(gate({ ready: false, canAccess: true })).toEqual({ kind: 'wait' });
    expect(gate({ ready: false, canAccess: false })).toEqual({ kind: 'wait' });
  });

  it('once read: render when granted, /forbidden when not', () => {
    expect(gate({ canAccess: true })).toEqual({ kind: 'render' });
    expect(gate({ canAccess: false })).toEqual({ kind: 'redirect', to: '/forbidden' });
  });

  it('pages the answer cannot change never wait: /profile, and paths no capability governs', () => {
    expect(gate({ pathname: '/profile', ready: false })).toEqual({ kind: 'render' });
    expect(gate({ pathname: '/help', ready: false })).toEqual({ kind: 'render' });
  });

  it('a managed sub-path waits like its page', () => {
    expect(gate({ pathname: '/admin/users', ready: false })).toEqual({ kind: 'wait' });
    expect(gate({ pathname: '/app', ready: false })).toEqual({ kind: 'wait' });
  });

  it('an explicit role allow-list is decided by the role alone, so it never waits', () => {
    expect(gate({ allow: ['admin', 'user'], ready: false, canAccess: false })).toEqual({ kind: 'render' });
    expect(gate({ allow: ['admin'], ready: false, canAccess: true })).toEqual({
      kind: 'redirect',
      to: '/forbidden',
    });
    expect(gate({ allow: ['admin'], role: null })).toEqual({ kind: 'redirect', to: '/forbidden' });
  });
});
