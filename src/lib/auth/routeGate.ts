import { ALWAYS_ON_PAGES, pageKeyForPath } from '@/lib/capabilities';

/** What `RoleGuard` does with a route: show it, hold a spinner, or send the user elsewhere. */
export type RouteGate = { kind: 'render' } | { kind: 'wait' } | { kind: 'redirect'; to: string };

export interface RouteGateInput {
  signedIn: boolean;
  /** Forced by an administrator or expired (`passwordStatus`, PLAN.md §4 D206). */
  mustChangePassword: boolean;
  pathname: string;
  role: string | null;
  /** A route's explicit role allow-list, when it has one. */
  allow?: readonly string[];
  /** The server's capability set has been read (`useCapabilities().ready`). */
  ready: boolean;
  /** `canAccessPage(pathname)` under whatever set is current. */
  canAccess: boolean;
}

/**
 * The order matters, and each step is a rule:
 * 1. signed out → /auth;
 * 2. a password that must change → /profile, wherever else they were going;
 * 3. an explicit role allow-list is decided by the role alone, so it never waits;
 * 4. otherwise WAIT for the server's set — until it lands, `canAccess` comes
 *    from the role fallback, a guess that knows nothing of org or user
 *    overrides. Deciding on it mounted pages the server denies and bounced
 *    users off pages the server grants;
 * 5. then render, or /forbidden.
 * A path no page capability governs, and the always-on /profile, cannot be
 * changed by the server's answer, so they never wait.
 */
export function routeGate(i: RouteGateInput): RouteGate {
  if (!i.signedIn) return { kind: 'redirect', to: '/auth' };
  if (i.mustChangePassword && !i.pathname.startsWith('/profile')) {
    return { kind: 'redirect', to: '/profile?tab=password&forced=1' };
  }
  if (i.allow) {
    return i.role !== null && i.allow.includes(i.role)
      ? { kind: 'render' }
      : { kind: 'redirect', to: '/forbidden' };
  }
  const key = pageKeyForPath(i.pathname);
  const answerCannotChangeIt = key === null || ALWAYS_ON_PAGES.has(key);
  if (!i.ready && !answerCannotChangeIt) return { kind: 'wait' };
  return i.canAccess ? { kind: 'render' } : { kind: 'redirect', to: '/forbidden' };
}
