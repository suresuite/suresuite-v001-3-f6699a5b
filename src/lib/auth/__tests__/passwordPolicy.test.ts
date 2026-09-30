/**
 * D206 — the password-expiry state every account surface reads. The day count is a
 * CALENDAR count so it agrees with the date printed beside it; the expiry itself is an
 * instant, and the server's `password_expired` wins over a browser clock that is behind.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPIRY_WARNING_DAYS,
  calendarDaysBetween,
  describeExpiry,
  passwordStatus,
  relativeDay,
  shouldWarn,
} from '../passwordPolicy';

/** Local wall-clock time, so the tests mean the same thing in every time zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (d: Date) => d.toISOString();
const fmt = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe('calendarDaysBetween', () => {
  it('counts calendar dates, not 24-hour blocks', () => {
    // 23:30 → 00:30 the next day is one hour, and it is "tomorrow".
    expect(calendarDaysBetween(at(2026, 9, 29, 23, 30), at(2026, 9, 30, 0, 30))).toBe(1);
    // 00:30 → 23:30 the same day is 23 hours, and it is "today".
    expect(calendarDaysBetween(at(2026, 9, 29, 0, 30), at(2026, 9, 29, 23, 30))).toBe(0);
  });

  it('is the same count at any hour of the day (the old Math.ceil was not)', () => {
    const expires = at(2026, 10, 12, 9, 0);
    const counts = [0, 6, 9, 12, 18, 23].map((h) => calendarDaysBetween(at(2026, 9, 29, h), expires));
    expect(new Set(counts)).toEqual(new Set([13]));
  });

  it('is not shifted by a daylight-saving change in between', () => {
    // Spans both the EU (last Sunday of Oct / Mar) and US (Nov / Mar) transitions.
    expect(calendarDaysBetween(at(2026, 10, 20), at(2026, 11, 10))).toBe(21);
    expect(calendarDaysBetween(at(2027, 3, 1), at(2027, 4, 5))).toBe(35);
  });

  it('counts across a month and a year end', () => {
    expect(calendarDaysBetween(at(2026, 12, 20), at(2027, 3, 20))).toBe(90);
  });
});

describe('passwordStatus', () => {
  const now = at(2026, 9, 29, 10, 0);

  it('is not expired before the instant and expired at it', () => {
    const exp = at(2026, 9, 29, 10, 1);
    expect(passwordStatus({ password_expires_at: iso(exp) }, now).expired).toBe(false);
    expect(passwordStatus({ password_expires_at: iso(exp) }, exp).expired).toBe(true);
  });

  it('trusts the server when the browser clock is behind', () => {
    const s = passwordStatus({ password_expires_at: iso(at(2026, 10, 1)), password_expired: true }, now);
    expect(s.expired).toBe(true);
    expect(s.mustChange).toBe(true);
  });

  it('requires a change when an administrator forced one, even far from expiry', () => {
    const s = passwordStatus({ password_expires_at: iso(at(2026, 12, 1)), force_password_change: true }, now);
    expect(s.forced).toBe(true);
    expect(s.expired).toBe(false);
    expect(s.mustChange).toBe(true);
  });

  it('requires nothing and warns about nothing when the row said nothing', () => {
    const s = passwordStatus({}, now);
    expect(s.mustChange).toBe(false);
    expect(s.daysLeft).toBeNull();
    expect(shouldWarn(s)).toBe(false);
    expect(describeExpiry(s)).toBeNull();
  });

  it('reads the policy from the row and nowhere else', () => {
    expect(passwordStatus({ password_max_age_days: 90 }, now).maxAgeDays).toBe(90);
    expect(passwordStatus({}, now).maxAgeDays).toBeNull();
  });
});

describe('the warning window', () => {
  const now = at(2026, 9, 29, 10, 0);
  const status = (days: number) =>
    passwordStatus({ password_expires_at: iso(at(2026, 9, 29 + days, 9, 0)) }, now);

  it(`warns from ${EXPIRY_WARNING_DAYS} calendar days before, not before that`, () => {
    expect(shouldWarn(status(EXPIRY_WARNING_DAYS + 1))).toBe(false);
    expect(shouldWarn(status(EXPIRY_WARNING_DAYS))).toBe(true);
    expect(shouldWarn(status(1))).toBe(true);
  });

  it('stops warning once a change is required — /profile says so instead', () => {
    expect(shouldWarn(passwordStatus({ password_expires_at: iso(at(2026, 9, 1)) }, now))).toBe(false);
  });
});

describe('describeExpiry', () => {
  const now = at(2026, 9, 29, 10, 0);
  const say = (exp: Date, extra = {}) =>
    describeExpiry(passwordStatus({ password_expires_at: iso(exp), ...extra }, now), fmt);

  it('names the date and the calendar count together', () => {
    expect(say(at(2026, 10, 12, 8, 0))).toBe('Your password expires on 2026-10-12 — in 13 days.');
    expect(say(at(2026, 9, 30, 8, 0))).toBe('Your password expires tomorrow (2026-9-30).');
    expect(say(at(2026, 9, 29, 22, 0))).toBe('Your password expires today (2026-9-29).');
  });

  it('says how long ago an expired password expired', () => {
    expect(say(at(2026, 9, 29, 9, 0))).toBe('Your password expired today (2026-9-29).');
    expect(say(at(2026, 9, 28, 23, 0))).toBe('Your password expired on 2026-9-28 (1 day ago).');
    // 2026-05-27 + 90 days — the date every never-changed password reads (see D206).
    expect(say(at(2026, 8, 25, 12, 0))).toBe('Your password expired on 2026-8-25 (35 days ago).');
  });
});

describe('relativeDay', () => {
  const now = at(2026, 9, 29, 10, 0);
  const rel = (exp: Date, extra = {}) => relativeDay(passwordStatus({ password_expires_at: iso(exp), ...extra }, now));

  it('agrees with describeExpiry', () => {
    expect(rel(at(2026, 10, 12))).toBe('in 13 days');
    expect(rel(at(2026, 9, 30))).toBe('tomorrow');
    expect(rel(at(2026, 9, 29, 22))).toBe('today');
    expect(rel(at(2026, 9, 29, 8))).toBe('today');
    expect(rel(at(2026, 9, 28))).toBe('1 day ago');
    expect(rel(at(2026, 8, 25))).toBe('35 days ago');
  });

  it('gives no count when only the server knows it expired', () => {
    expect(rel(at(2026, 10, 1), { password_expired: true })).toBeNull();
  });
});
