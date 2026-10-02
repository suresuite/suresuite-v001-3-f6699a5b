/**
 * §4 D278 — an account-role change says what it did and what still decides instead, and
 * the role picker and the manual read ONE gloss.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeRoleChange, parseRoleChangeSummary } from '../roleChange';
import { ACCOUNT_ROLES, ACCOUNT_ROLE_GLOSS, ACCOUNT_ROLE_PICKER_LINE } from '../roleGloss';

const summary = {
  role_before: 'user',
  role_after: 'admin',
  org: { org_id: 'o1', name: 'Acme', org_role_before: 'member', org_role_after: 'admin' },
  overrides: [
    { key: 'simulation_lab', label: 'Run Simulations', kind: 'feature', layer: 'person', allowed: false, role_default: true },
    { key: 'export', label: 'Export', kind: 'feature', layer: 'organization', allowed: false, role_default: true },
  ],
  narrowed_projects: [
    { project_id: 'p1', name: 'Alpha', project_role: 'viewer', keys: [{ key: 'data_edit_policies', label: 'Edit Policies' }] },
    { project_id: 'p2', name: 'Beta', project_role: 'viewer', keys: [{ key: 'data_edit_policies', label: 'Edit Policies' }] },
  ],
};

describe('D278 · the summary, worded', () => {
  it('names the organization move, each override and each limiting project role', () => {
    const lines = describeRoleChange(parseRoleChangeSummary(summary)!);
    expect(lines.org).toBe('Organization role in Acme: member → admin.');
    expect(lines.overrides).toEqual([
      'Run Simulations: off by person override (Admin default: on).',
      'Export: off by organization override (Admin default: on).',
    ]);
    expect(lines.projects).toEqual(['Viewer on 2 projects (Alpha, Beta): Edit Policies stay off there.']);
  });

  it('says an owner stays owner', () => {
    const lines = describeRoleChange(parseRoleChangeSummary({
      ...summary, org: { ...summary.org, org_role_before: 'owner', org_role_after: 'owner' },
    })!);
    expect(lines.org).toMatch(/stays owner/);
  });

  it('reads a pre-D278 server (no summary) as nothing to show', () => {
    expect(parseRoleChangeSummary(null)).toBeNull();
    expect(parseRoleChangeSummary('')).toBeNull();
  });
});

describe('D278 · one gloss, read by the picker and the manual', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  it('says admin does NOT open the administration area, in both forms', () => {
    expect(ACCOUNT_ROLE_PICKER_LINE.admin).toMatch(/does not open the administration area/i);
    expect(ACCOUNT_ROLE_GLOSS.admin).toMatch(/does not open the administration area/i);
    expect(ACCOUNT_ROLE_GLOSS.super_admin).toMatch(/only role that opens the administration area/);
    for (const r of ACCOUNT_ROLES) expect(ACCOUNT_ROLE_PICKER_LINE[r].length).toBeGreaterThan(0);
  });

  it('the role picker on /admin/users reads the shared gloss', () => {
    const src = read('pages/admin/AdminUsers.tsx');
    expect(src).toMatch(/from '@\/lib\/auth\/roleGloss'/);
    expect(src).toMatch(/const ROLES = \[\.\.\.ACCOUNT_ROLES\]\.reverse\(\)/);
    expect(src).toMatch(/pickerLine\(role\)/);
    expect(src).not.toMatch(/const ROLES = \['user'/);
  });

  it('the manual reads it too, and authors no second copy', () => {
    const src = read('components/docs/bodies/RolesAndCapabilities.tsx');
    expect(src).toMatch(/from "@\/lib\/auth\/roleGloss"/);
    expect(src).not.toMatch(/const GLOBAL_GLOSS/);
    expect(src).not.toMatch(/The full working surface/);
  });
});
