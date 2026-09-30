/**
 * D207 — the organization plan's choices are authored in the migration's CHECKs and
 * offered by `organizationPlan.ts`, which cannot import each other. This compares them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_PERIODS, COUNT_LIMITS, NONE, atLimit, limitFromSelect, limitLabel, limitToSelect,
  periodFromSelect, periodLabel, planRefusal, usage,
} from '../organizationPlan';

const MIGRATION = path.resolve(
  __dirname, '../../../../supabase/migrations/20260929000004_organization_plan.sql');
const sql = readFileSync(MIGRATION, 'utf8');

function checkList(column: string): string[] {
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(sql);
  if (!m) throw new Error(`no \`${column} IN (...)\` CHECK found in the migration`);
  return m[1].split(',').map((t) => t.trim().replace(/^'|'$/g, ''));
}

describe('organization plan choices', () => {
  it('offers exactly the periods the database accepts', () => {
    expect(ACCESS_PERIODS.map((p) => p.value).sort()).toEqual(checkList('access_period').sort());
  });

  it('gives every period a length in the one interval function', () => {
    for (const { value } of ACCESS_PERIODS) {
      expect(sql).toMatch(new RegExp(`WHEN '${value}'\\s+THEN interval '`));
    }
  });

  it('offers exactly the project and user limits the database accepts', () => {
    const offered = [...COUNT_LIMITS].map(String).sort();
    expect(offered).toEqual(checkList('project_limit').sort());
    expect(offered).toEqual(checkList('user_limit').sort());
  });

  it('labels the choices the way the owner asked for them', () => {
    expect(ACCESS_PERIODS.map((p) => p.label)).toEqual(['1 week', '1 month', '1 quarter', '1 year']);
    expect(periodLabel(null)).toBe('No expiry');
    expect(limitLabel(1, 'project')).toBe('1 project');
    expect(limitLabel(5, 'user')).toBe('5 users');
    expect(limitLabel(null, 'user')).toBe('Unlimited');
  });

  it('maps the Select token for "none" to null and refuses anything off the list', () => {
    expect(periodFromSelect(NONE)).toBeNull();
    expect(periodFromSelect('quarter')).toBe('quarter');
    expect(periodFromSelect('decade')).toBeNull();
    expect(limitFromSelect(NONE)).toBeNull();
    expect(limitFromSelect('3')).toBe(3);
    expect(limitFromSelect('4')).toBeNull();
    expect(limitToSelect(null)).toBe(NONE);
    expect(limitToSelect(5)).toBe('5');
  });

  it('measures usage against the limit', () => {
    expect(usage(2, 3)).toBe('2 of 3');
    expect(usage(7, null)).toBe('7 of unlimited');
    expect(atLimit(3, 3)).toBe(true);
    expect(atLimit(4, 3)).toBe(true);
    expect(atLimit(2, 3)).toBe(false);
    expect(atLimit(99, null)).toBe(false);
  });

  it('reads the triggers\' refusals, and only those', () => {
    for (const token of ['org_project_limit_reached', 'org_user_limit_reached', 'org_access_ended']) {
      expect(sql).toContain(`'${token}: `);
    }
    expect(planRefusal('org_project_limit_reached: acme may hold 1 project(s) and already holds 1'))
      .toBe('Acme may hold 1 project(s) and already holds 1');
    expect(planRefusal('org_user_limit_reached: acme may have 2 user(s)')).toBe('Acme may have 2 user(s)');
    expect(planRefusal('org_access_ended: the access period ended')).toBe('The access period ended');
    expect(planRefusal('duplicate key value violates unique constraint "uq_modeler_project"')).toBeNull();
    expect(planRefusal(undefined)).toBeNull();
  });
});
