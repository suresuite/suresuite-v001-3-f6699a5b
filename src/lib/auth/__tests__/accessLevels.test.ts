/**
 * §4 D211 — the three access levels. `accessLevels.ts` RESTATES the database's rules in
 * words, for /profile and /admin; a restatement nothing compares is how a screen comes to
 * say something false (D103). So this reads each rule back out of the schema — the
 * policies from the introspected artifact, a function's body from the migration that
 * defines it LAST — and fails when one moves.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  ACCOUNT_TIERS, ORG_ROLES, PROJECT_ROLES, PROJECT_ROLE_INFO, projectRights, projectRoleRefusal,
  roleSource, tierOrgMismatch,
} from '../accessLevels';

const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const schema = JSON.parse(read('build/schema.introspected.json'));
const tables: Array<{ name: string; rls: { policies: Array<{ name: string; command: string; using: string | null; with_check: string | null }> } }> =
  Array.isArray(schema.tables) ? schema.tables : Object.values(schema.tables);
const functions: Array<{ name: string; defined_by: string }> =
  Array.isArray(schema.functions) ? schema.functions : Object.values(schema.functions);
const squash = (s: string) => s.replace(/\s+/g, ' ');

/** The body of `name` as the migration that defines it last writes it. */
function body(name: string): string {
  const fn = functions.find((f) => f.name === name);
  if (!fn) throw new Error(`${name} is not in the introspected schema`);
  const sql = read(`supabase/migrations/${fn.defined_by}`);
  const creates = [...sql.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g'))];
  if (!creates.length) throw new Error(`${name} not found in ${fn.defined_by}`);
  const start = creates[creates.length - 1].index!;
  const tag = /AS (\$[A-Za-z0-9_]*\$)/.exec(sql.slice(start));
  if (!tag) throw new Error(`${name} has no dollar-quoted body in ${fn.defined_by}`);
  const open = start + tag.index + tag[0].length;
  return squash(sql.slice(start, sql.indexOf(tag[1], open) + tag[1].length));
}

function policies(table: string) {
  const t = tables.find((x) => x.name === table);
  if (!t) throw new Error(`${table} is not in the introspected schema`);
  return t.rls.policies;
}

const ADMIN_TIER = /user_role FROM public\.get_current_approved_user\(\) LIMIT 1\) = 'admin'/;

describe('the rules accessLevels.ts restates', () => {
  it('see a project: its organization is the current one, and nothing else', () => {
    const view = policies('projects').filter((p) => p.command === 'SELECT');
    expect(view.map((p) => squash(p.using ?? ''))).toEqual([
      'public.org_is_current_user_org(organization_id, organization)',
    ]);
  });

  it('edit a project: its creator or the Admin tier — not a project role, not Super admin', () => {
    for (const p of policies('projects').filter((x) => x.command === 'UPDATE' || x.command === 'DELETE')) {
      const u = squash(p.using ?? '');
      expect(u).toContain('modeler_id = public.get_current_user_id()');
      expect(u).toMatch(ADMIN_TIER);
      expect(u).not.toMatch(/super_admin|effective_project_role|project_members/);
    }
    const create = policies('projects').find((x) => x.command === 'INSERT');
    expect(squash(create?.with_check ?? '')).not.toMatch(/super_admin/);
    // The CSV landing reads the same two things, with no project role.
    const landing = body('has_project_access');
    expect(landing).toContain('p.modeler_id = public.get_current_user_id()');
    expect(landing).toContain("= 'admin'");
    expect(landing).not.toMatch(/effective_project_role|super_admin/);
  });

  it('project data follows the same rule: no write policy on a project table reads a project role', () => {
    const readers: string[] = [];
    for (const t of tables) {
      for (const p of t.rls.policies) {
        if (p.command === 'SELECT') continue;
        if (/effective_project_role|project_members|project_role/.test(`${p.using ?? ''} ${p.with_check ?? ''}`)) {
          readers.push(`${t.name}: ${p.name}`);
        }
      }
    }
    // When WP 7.1 makes a policy read the project role, this fails and PROJECT_LEVEL_NOTE
    // and the Editor's "cannot" have to change with it.
    expect(readers).toEqual([]);
  });

  it('promote an upload: effective_project_role at least editor', () => {
    const b = body('ingest_apply_run');
    expect(b).toContain('effective_project_role(_actor_user_id, v_run.project_id)');
    expect(b).toContain("project_role_rank('editor')");
  });

  it('export: a held project role decides; the account default otherwise', () => {
    expect(body('record_export')).toContain('capabilities_for_user(_actor_user_id, _project_id)');
    // The Viewer's export is refused and the Analyst's is not — as PROJECT_ROLE_INFO says.
    const exportAllowed = (role: string) => projectRights({ accountRole: 'user', inProjectOrg: true, isCreator: false, effectiveRole: role })
      .find((r) => r.key === 'export')!.allowed;
    expect(exportAllowed('viewer')).toBe(false);
    expect(exportAllowed('analyst')).toBe(true);
    expect(PROJECT_ROLE_INFO.viewer.cannot).toContain('Export from the project');
  });

  it('the organization role is read by the API-key verbs, and they are the only reader', () => {
    expect(body('_api_key_management_org')).toContain("m.org_role IN ('owner','admin')");
  });

  it('a super admin counts as owner of every project', () => {
    expect(body('effective_project_role')).toContain('is_super_admin(_user_id)');
  });
});

describe('the vocabularies match the database', () => {
  it('organization roles are the CHECK constraint', () => {
    const sql = read('supabase/migrations/20260709000002_super_admin_phase1.sql');
    expect(sql).toContain(`CHECK (org_role IN (${ORG_ROLES.map((r) => `'${r}'`).join(',')}))`);
  });

  it('project roles are project_role_rank\'s', () => {
    expect([...PROJECT_ROLES].sort()).toEqual(['analyst', 'editor', 'owner', 'viewer']);
  });

  it('account tiers plus super_admin are the app_role enum', () => {
    const enumValues: string[] = schema.enums.app_role.values;
    expect([...Object.keys(ACCOUNT_TIERS), 'super_admin'].sort()).toEqual([...enumValues].sort());
  });

  it('every refusal the D211 verbs raise is turned into a sentence', () => {
    const sql = read('supabase/migrations/20260930000005_three_access_levels.sql');
    for (const token of ['not_in_organization', 'creator_is_owner', 'last_owner', 'not_a_member']) {
      expect(sql).toContain(`'${token}:`);
    }
    expect(projectRoleRefusal("not_in_organization: the account is not a member of this project's organization"))
      .toBe("The account is not a member of this project's organization");
    expect(projectRoleRefusal('forbidden')).toBe('forbidden');
  });
});

describe('projectRights', () => {
  const right = (s: Parameters<typeof projectRights>[0], key: string) => projectRights(s).find((r) => r.key === key)!;

  it('an Editor who did not create the project cannot edit it, and can promote', () => {
    const s = { accountRole: 'modeler', inProjectOrg: true, isCreator: false, effectiveRole: 'editor' };
    expect(right(s, 'edit').allowed).toBe(false);
    expect(right(s, 'edit').because).toContain('does not count yet');
    expect(right(s, 'promote').allowed).toBe(true);
  });

  it('an Admin-tier account with no project role edits and cannot promote (D66)', () => {
    const s = { accountRole: 'admin', inProjectOrg: true, isCreator: false, effectiveRole: null };
    expect(right(s, 'edit')).toMatchObject({ allowed: true, because: 'Admin account tier' });
    expect(right(s, 'promote').allowed).toBe(false);
  });

  it('the creator edits and promotes', () => {
    const s = { accountRole: 'user', inProjectOrg: true, isCreator: true, effectiveRole: 'owner' };
    expect(right(s, 'edit')).toMatchObject({ allowed: true, because: 'created the project' });
    expect(right(s, 'promote').allowed).toBe(true);
  });

  it('a super admin promotes as owner but does not edit someone else\'s project', () => {
    const s = { accountRole: 'super_admin', inProjectOrg: true, isCreator: false, effectiveRole: 'owner' };
    expect(right(s, 'edit').allowed).toBe(false);
    expect(right(s, 'promote')).toMatchObject({ allowed: true, because: 'Super admin counts as Owner' });
  });

  it('outside the organization nothing but a stale role remains', () => {
    const s = { accountRole: 'admin', inProjectOrg: false, isCreator: false, effectiveRole: 'editor' };
    expect(right(s, 'see').allowed).toBe(false);
    expect(right(s, 'edit').allowed).toBe(false);
  });
});

describe('tierOrgMismatch', () => {
  it('flags the two combinations the tier overrides', () => {
    expect(tierOrgMismatch('admin', 'member')).toMatch(/can edit every project here/);
    expect(tierOrgMismatch('user', 'owner')).toMatch(/cannot edit other people/);
    expect(tierOrgMismatch('modeler', 'admin')).toMatch(/only adds API keys/);
    expect(tierOrgMismatch('user', 'admin', 'you')).toMatch(/^Your role here is Admin, but your account tier is User: you cannot/);
  });
  it('is quiet when they agree, and for a super admin', () => {
    expect(tierOrgMismatch('admin', 'owner')).toBeNull();
    expect(tierOrgMismatch('modeler', 'member')).toBeNull();
    expect(tierOrgMismatch('super_admin', 'member')).toBeNull();
  });
});

describe('roleSource', () => {
  it('says where the effective role came from', () => {
    expect(roleSource({ isCreator: true, memberRole: 'owner', delegatedRole: null, effectiveRole: 'owner' })).toBe('creator');
    expect(roleSource({ isCreator: false, memberRole: 'viewer', delegatedRole: 'editor', effectiveRole: 'editor' })).toBe('delegated');
    expect(roleSource({ isCreator: false, memberRole: null, delegatedRole: null, accountRole: 'super_admin', effectiveRole: 'owner' })).toBe('super admin');
    expect(roleSource({ isCreator: false, memberRole: null, delegatedRole: null, effectiveRole: null })).toBe('');
  });
});
