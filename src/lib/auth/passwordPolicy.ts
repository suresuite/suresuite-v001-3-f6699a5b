/**
 * The password-expiry state of the signed-in user, computed once for every surface
 * that shows or enforces it — `RoleGuard`, `PasswordExpiryBanner` and /profile.
 *
 * The POLICY (how many days a password lives) is the database's: `password_max_age()`,
 * returned by `get_my_profile` as `password_max_age_days` (PLAN.md §4 D206). This module
 * only reads what the account row says and counts days against it.
 *
 * Two different questions, answered two different ways on purpose:
 *   - IS IT EXPIRED is an INSTANT comparison — `now >= password_expires_at` — OR'd with
 *     the server's own `password_expired`, computed on the database clock at sign-in, so
 *     a browser whose clock is behind cannot read an expired password as valid.
 *   - HOW MANY DAYS ARE LEFT is a CALENDAR count in the viewer's time zone, so it agrees
 *     with the date printed beside it: a password expiring "on 12 Oct" is "in 13 days"
 *     on 29 Sep at any hour, rather than 13 in the morning and 14 in the evening, as the
 *     previous `Math.ceil(ms / 86 400 000)` said. Dates are compared through `Date.UTC`
 *     of their local calendar parts, so a 23- or 25-hour DST day cannot shift the count.
 */

export interface PasswordFields {
  force_password_change?: boolean | null;
  password_expires_at?: string | null;
  password_changed_at?: string | null;
  password_expired?: boolean | null;
  password_max_age_days?: number | null;
}

export interface PasswordStatus {
  expiresAt: Date | null;
  changedAt: Date | null;
  /** An administrator created or reset the account and set "must change". */
  forced: boolean;
  /** The expiry instant has passed (by the browser's clock or the server's). */
  expired: boolean;
  /** Either of the above: every page but /profile is closed until it is changed. */
  mustChange: boolean;
  /** Calendar days from today to the expiry date, local time; negative once past. */
  daysLeft: number | null;
  /** The policy, from the database. `null` when the account row did not say. */
  maxAgeDays: number | null;
}

/** The banner starts warning this many calendar days before expiry. */
export const EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;

function parse(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days since the epoch of the LOCAL calendar date of `d` — DST-proof. */
function calendarDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

export function calendarDaysBetween(from: Date, to: Date): number {
  return calendarDay(to) - calendarDay(from);
}

export function passwordStatus(user: PasswordFields | null | undefined, now: Date = new Date()): PasswordStatus {
  const expiresAt = parse(user?.password_expires_at);
  const changedAt = parse(user?.password_changed_at);
  const forced = user?.force_password_change === true;
  const expired =
    user?.password_expired === true || (expiresAt !== null && now.getTime() >= expiresAt.getTime());
  const maxAge = user?.password_max_age_days;
  return {
    expiresAt,
    changedAt,
    forced,
    expired,
    mustChange: forced || expired,
    daysLeft: expiresAt ? calendarDaysBetween(now, expiresAt) : null,
    maxAgeDays: typeof maxAge === 'number' && maxAge > 0 ? maxAge : null,
  };
}

/** Whether the pre-expiry warning banner should show. Not once a change is required —
 *  `RoleGuard` has already sent the user to /profile, which says so itself. */
export function shouldWarn(status: PasswordStatus): boolean {
  return !status.mustChange && status.daysLeft !== null && status.daysLeft <= EXPIRY_WARNING_DAYS;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** The calendar distance to the expiry date, for display beside that date. */
export function relativeDay(status: PasswordStatus): string | null {
  const { daysLeft, expired } = status;
  if (daysLeft === null) return null;
  if (daysLeft < 0) return `${plural(-daysLeft)} ago`;
  if (daysLeft === 0) return 'today';
  if (expired) return null; // the server says expired while this clock is behind: no count to give
  return daysLeft === 1 ? 'tomorrow' : `in ${plural(daysLeft)}`;
}

/** One sentence about the expiry, always carrying the date it counts to. */
export function describeExpiry(status: PasswordStatus, fmt: (d: Date) => string = formatDate): string | null {
  const { expiresAt, daysLeft, expired } = status;
  if (!expiresAt || daysLeft === null) return null;
  const date = fmt(expiresAt);
  if (expired) {
    if (daysLeft >= 0) return `Your password expired today (${date}).`;
    return `Your password expired on ${date} (${plural(-daysLeft)} ago).`;
  }
  if (daysLeft <= 0) return `Your password expires today (${date}).`;
  if (daysLeft === 1) return `Your password expires tomorrow (${date}).`;
  return `Your password expires on ${date} — in ${plural(daysLeft)}.`;
}
