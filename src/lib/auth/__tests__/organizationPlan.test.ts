/**
 * D207 — the organization plan's choices are authored in the migrations' CHECKs and
 * offered by `organizationPlan.ts`, which cannot import each other. This compares them.
 * A later migration may restate a list (D218 widened the limits in `20260930000012`),
 * so each list is read from the LATEST migration that states it — the one in force.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_PERIODS, COUNT_LIMITS, NONE, atLimit, limitFromSelect, limitLabel, limitToSelect,
  periodFromSelect, periodLabel, planRefusal, usage,
} from '../organizationPlan';

const MIGRATIONS = path.resolve(__dirname, '../../../../supabase/migrations');
/** Every migration's text, oldest first (the file names sort by timestamp). */
const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ file: f, sql: readFileSync(path.join(MIGRATIONS, f), 'utf8') }));
const sql = readFileSync(path.join(MIGRATIONS, '20260929000004_organization_plan.sql'), 'utf8');

/** The latest migration whose text matches `re`, and the match. */
function latest(re: RegExp): { file: string; sql: string; match: RegExpExecArray } {
  for (let i = migrations.length - 1; i >= 0; i--) {
    const match = re.exec(migrations[i].sql);
    if (match) return { ...migrations[i], match };
  }
  throw new Error(`no migration matches ${re}`);
}

const parseList = (text: string) => text.split(',').map((t) => t.trim().replace(/^'|'$/g, ''));

function checkList(column: string): string[] {
  return parseList(latest(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`)).match[1]);
}

/** Every `p_<param> NOT IN (...)` list in the latest body of `fn`. */
function rpcLists(fn: string, param: string): string[][] {
  const { sql: text, match } = latest(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(`));
  const start = match.index;
  const body = text.slice(start, text.indexOf('END; $$', start));
  return [...body.matchAll(new RegExp(`${param} NOT IN \\(([^)]*)\\)`, 'g'))].map((m) => parseList(m[1]));
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

  it('has the verbs refuse exactly what the CHECKs refuse', () => {
    for (const fn of ['admin_set_org_limits', 'admin_create_organization']) {
      for (const [param, column] of [['p_project_limit', 'project_limit'], ['p_user_limit', 'user_limit']]) {
        const lists = rpcLists(fn, param);
        expect(lists.length, `${fn} validates ${param}`).toBe(1);
        expect(lists[0].sort(), `${fn}.${param}`).toEqual(checkList(column).sort());
      }
    }
  });

  it('offers the D218 list, ascending', () => {
    expect([...COUNT_LIMITS]).toEqual([1, 2, 3, 5, 10, 20, 50, 100]);
  });

  it('labels the choices the way the owner asked for them', () => {
    expect(ACCESS_PERIODS.map((p) => p.label)).toEqual(['1 week', '1 month', '1 quarter', '1 year']);
    expect(periodLabel(null)).toBe('No expiry');
    expect(limitLabel(1, 'project')).toBe('1 project');
    expect(limitLabel(5, 'user')).toBe('5 users');
    expect(limitLabel(100, 'project')).toBe('100 projects');
    expect(limitLabel(null, 'user')).toBe('Unlimited');
  });

  it('maps the Select token for "none" to null and refuses anything off the list', () => {
    expect(periodFromSelect(NONE)).toBeNull();
    expect(periodFromSelect('quarter')).toBe('quarter');
    expect(periodFromSelect('decade')).toBeNull();
    expect(limitFromSelect(NONE)).toBeNull();
    expect(limitFromSelect('3')).toBe(3);
    expect(limitFromSelect('4')).toBeNull();
    expect(limitFromSelect('50')).toBe(50);
    expect(limitFromSelect('1000')).toBeNull();
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
