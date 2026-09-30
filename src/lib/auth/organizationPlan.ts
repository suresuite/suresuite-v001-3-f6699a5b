/**
 * D207 — an organization's plan as the pages offer it: how long it may be used, and
 * how many projects and user accounts it may have.
 *
 * The database is the authority: the CHECKs on `organizations.access_period`,
 * `project_limit` and `user_limit`, and `org_access_period_interval()` for what each
 * period means (`20260929000004`; the limit list widened by `20260930000012`, D218).
 * These lists cannot import the migrations, so `organizationPlan.test.ts` compares
 * them with the latest migration that states each one — a choice offered here and refused
 * there fails on save, and one allowed there and missing here could not be shown.
 *
 * `null` is a real choice in every list: no expiry, unlimited. Every organization that
 * existed before D207 has all three.
 */

export type AccessPeriod = 'week' | 'month' | 'quarter' | 'year';

export const ACCESS_PERIODS: ReadonlyArray<{ value: AccessPeriod; label: string }> = [
  { value: 'week', label: '1 week' },
  { value: 'month', label: '1 month' },
  { value: 'quarter', label: '1 quarter' },
  { value: 'year', label: '1 year' },
];

/** The same list for projects and for users (D207; 10–100 added by D218). */
export const COUNT_LIMITS: ReadonlyArray<number> = [1, 2, 3, 5, 10, 20, 50, 100];

/** A Select cannot carry `null`, so "no expiry" / "unlimited" travel as this token. */
export const NONE = 'none';

export const NO_EXPIRY_LABEL = 'No expiry';
export const UNLIMITED_LABEL = 'Unlimited';

export function periodLabel(period: string | null | undefined): string {
  if (!period) return NO_EXPIRY_LABEL;
  return ACCESS_PERIODS.find((p) => p.value === period)?.label ?? period;
}

export function limitLabel(limit: number | null | undefined, noun: 'project' | 'user'): string {
  if (limit == null) return UNLIMITED_LABEL;
  return `${limit} ${noun}${limit === 1 ? '' : 's'}`;
}

/** Select value ⇄ RPC argument. Anything not in the list maps to `null`. */
export function periodFromSelect(value: string): AccessPeriod | null {
  return ACCESS_PERIODS.some((p) => p.value === value) ? (value as AccessPeriod) : null;
}

export function limitFromSelect(value: string): number | null {
  const n = Number(value);
  return COUNT_LIMITS.includes(n) ? n : null;
}

export const limitToSelect = (limit: number | null | undefined) => (limit == null ? NONE : String(limit));

/** "3 of 5", "3 of unlimited" — the count a limit is measured against. */
export function usage(used: number | null | undefined, limit: number | null | undefined): string {
  return `${Number(used ?? 0)} of ${limit == null ? 'unlimited' : limit}`;
}

/** True when the count is at or past the limit. */
export function atLimit(used: number | null | undefined, limit: number | null | undefined): boolean {
  return limit != null && Number(used ?? 0) >= limit;
}

/** "12 Oct 2026", in the viewer's zone; the instant itself is the server's. */
export function formatPlanDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/**
 * The allowance triggers' refusals carry a token before the sentence
 * (`org_project_limit_reached: …`, `org_user_limit_reached: …`, `org_access_ended: …`).
 * Returns the sentence, or `null` for any other error so the caller keeps its own.
 */
export function planRefusal(message: string | null | undefined): string | null {
  const m = /(?:org_project_limit_reached|org_user_limit_reached|org_access_ended):\s*(.+)$/s.exec(message ?? '');
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : null;
}
