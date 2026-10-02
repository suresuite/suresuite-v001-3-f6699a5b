// §4 D278 — an open session learns that its account changed.
//
// `useAuth` re-read the account row once, on mount, and `useCapabilities` re-read the
// capability set only when the user id changed. So a role a super admin changed on
// /admin/users reached nobody who was already signed in: the browser kept the role (and
// every gate keyed on it) from the sign-in until the next reload. Nothing in the database
// can push to a browser, so the browser asks: when the tab regains focus or becomes
// visible, and on an interval while signed in.
import { accountRoleLabel } from './roleGloss';

/** How often a signed-in tab re-reads its account while it stays open. */
export const PROFILE_REFRESH_MS = 5 * 60 * 1000;
/** Focus and visibilitychange usually fire together; one read answers both. */
export const PROFILE_REFRESH_MIN_GAP_MS = 10 * 1000;

type Listen = {
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
};

export interface FreshnessTargets {
  win: Listen;
  doc: Listen & { visibilityState?: string };
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
}

const browserTargets = (): FreshnessTargets => ({
  win: window,
  doc: document,
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
  now: () => Date.now(),
});

/**
 * Calls `refresh` when the tab regains focus, when it becomes visible, and every
 * `intervalMs` — never twice within `PROFILE_REFRESH_MIN_GAP_MS` from the first two.
 * Returns the cleanup, which removes both listeners and the interval.
 */
export function watchProfileFreshness(
  refresh: () => void,
  intervalMs: number = PROFILE_REFRESH_MS,
  targets: FreshnessTargets = browserTargets(),
): () => void {
  let last = -Infinity;
  const soon = () => {
    const t = targets.now();
    if (t - last < PROFILE_REFRESH_MIN_GAP_MS) return;
    last = t;
    refresh();
  };
  const onFocus = () => soon();
  const onVisibility = () => {
    if (targets.doc.visibilityState === undefined || targets.doc.visibilityState === 'visible') soon();
  };
  targets.win.addEventListener('focus', onFocus);
  targets.doc.addEventListener('visibilitychange', onVisibility);
  const handle = targets.setInterval(() => {
    last = targets.now();
    refresh();
  }, intervalMs);
  return () => {
    targets.win.removeEventListener('focus', onFocus);
    targets.doc.removeEventListener('visibilitychange', onVisibility);
    targets.clearInterval(handle);
  };
}

/** The one-time notice when a refresh finds a different role; null when nothing changed. */
export function roleChangeNotice(before: string | null | undefined, after: string | null | undefined): string | null {
  if (!before || !after || before === after) return null;
  return `Your role changed to ${accountRoleLabel(after)}`;
}

/**
 * What the capability set is keyed on: the user AND their role. A role change is a new
 * question for `get_my_capabilities`, even for the same user.
 */
export const capabilitiesReloadKey = (user: { id?: string | null; role?: string | null } | null | undefined): string | null =>
  user?.id ? `${user.id}:${user.role ?? ''}` : null;
