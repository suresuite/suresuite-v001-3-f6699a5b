/**
 * §4 D303 — the New Project button reads the database's `project_creation_right`, which
 * admits an organization Admin or Owner whatever the account role. The rule itself is
 * proved against a database (`rehearsal/860`); this pins the browser's half: the answer is
 * carried through `get_my_capabilities` intact, the fallback is the old account-role gate,
 * and the form says where the project goes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCapabilities, roleFallbackCapabilities } from '@/lib/capabilities';
import {
  adminsProjectOrganization, normalizeProjectCreation, projectCreationFromRole, projectCreationNote, type ProjectCreationRight,
} from '../projectCreation';

const orgAdmin: ProjectCreationRight = {
  allowed: true, decided_by: 'organization_role', account_role: 'user',
  organization_id: 'org-a', organization_name: 'ACCURATE-AA', org_role: 'admin',
};

describe('project_creation (D303)', () => {
  it('reaches the browser through get_my_capabilities', () => {
    const caps = normalizeCapabilities({ role: 'user', pages: { '/project-manager': true }, project_creation: orgAdmin });
    expect(caps?.project_creation).toEqual(orgAdmin);
  });

  it('is null when the server sends none or a malformed one, so the account role decides', () => {
    expect(normalizeCapabilities({ role: 'user' })?.project_creation).toBeNull();
    expect(normalizeProjectCreation({ allowed: 'yes', decided_by: 'organization_role' })).toBeNull();
    expect(normalizeProjectCreation({ allowed: true, decided_by: 'guess' })).toBeNull();
  });

  it('falls back to the account role alone — what the button read before D303', () => {
    expect(projectCreationFromRole('user').allowed).toBe(false);
    expect(projectCreationFromRole('modeler')).toMatchObject({ allowed: true, decided_by: 'account_role' });
    expect(projectCreationFromRole('admin')).toMatchObject({ allowed: true, decided_by: 'account_role' });
    expect(projectCreationFromRole('super_admin')).toMatchObject({ allowed: true, decided_by: 'super_admin' });
    expect(roleFallbackCapabilities('user').project_creation?.allowed).toBe(false);
  });

  it('names the organization the project goes to, and why an organization admin may create it', () => {
    expect(projectCreationNote(orgAdmin)).toBe(
      'The project is created in ACCURATE-AA, the organization you are working in. You may create it as an admin of it.');
    expect(projectCreationNote({ ...orgAdmin, org_role: 'owner' })).toMatch(/as its owner\.$/);
    expect(projectCreationNote({ ...orgAdmin, decided_by: 'account_role', org_role: 'member' })).toBe(
      'The project is created in ACCURATE-AA, the organization you are working in.');
    expect(projectCreationNote({ ...orgAdmin, allowed: false, decided_by: 'none' })).toBeNull();
    expect(projectCreationNote(null)).toBeNull();
  });

  it('every decider the migration can return is one the browser accepts', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/20261008000001_org_admin_creates_projects.sql'), 'utf8');
    const body = sql.slice(sql.indexOf('FUNCTION public.project_creation_right'), sql.indexOf('COMMENT ON FUNCTION public.project_creation_right'));
    const returned = [...body.matchAll(/v_by := '([a-z_]+)'|'decided_by', '([a-z_]+)'/g)].map((m) => m[1] ?? m[2]);
    expect(returned.length).toBeGreaterThanOrEqual(5);
    for (const by of returned) {
      expect(normalizeProjectCreation({ ...orgAdmin, decided_by: by }), by).not.toBeNull();
    }
  });

  it('the New Project button reads the answer, not the account role', () => {
    const page = readFileSync(path.resolve(__dirname, '../../../pages/DataManager.tsx'), 'utf8');
    expect(page).toMatch(/const newProjectAction = canCreate &&/);
    expect(page).toMatch(/isCreating && canCreate &&/);
    expect(page).not.toMatch(/const newProjectAction = canModify &&/);
  });
});

describe('deleting as an organization admin (D304)', () => {
  it('is an Owner or Admin of the organization the project belongs to, while working in it', () => {
    expect(adminsProjectOrganization(orgAdmin, 'org-a')).toBe(true);
    expect(adminsProjectOrganization({ ...orgAdmin, org_role: 'owner' }, 'org-a')).toBe(true);
    expect(adminsProjectOrganization({ ...orgAdmin, org_role: 'member' }, 'org-a')).toBe(false);
    expect(adminsProjectOrganization(orgAdmin, 'org-b')).toBe(false);
    expect(adminsProjectOrganization(orgAdmin, null)).toBe(false);
    expect(adminsProjectOrganization(null, 'org-a')).toBe(false);
  });

  it('the Delete project action and the dataset trash button read it', () => {
    const card = readFileSync(path.resolve(__dirname, '../../../components/ProjectCard.tsx'), 'utf8');
    expect(card).toMatch(/const owns = project\.modeler_id === userId\s*\|\| \(canModify && \(role === 'admin' \|\| role === 'super_admin'\)\)\s*\|\| orgAdmin;/);
    const viewer = readFileSync(path.resolve(__dirname, '../../../components/ProjectDataViewer.tsx'), 'utf8');
    expect(viewer).toMatch(/const mayDelete = rights\.can\('data_edit_inputs'\) \|\| orgAdmin;/);
    const page = readFileSync(path.resolve(__dirname, '../../../pages/DataManager.tsx'), 'utf8');
    expect(page.match(/orgAdmin=\{orgAdminOf\(project\)\}/g)?.length).toBe(2);
  });

  it('the database answer the buttons mirror is read by both deleting writers', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/20261009000001_org_admin_deletes_projects.sql'), 'utf8');
    const body = (name: string) => sql.slice(sql.indexOf(`FUNCTION public.${name}(`), sql.indexOf('$$;', sql.indexOf(`FUNCTION public.${name}(`)));
    expect(body('delete_project')).toMatch(/public\.project_org_admin\(p_user_id, p_project_id\)/);
    expect(body('delete_project_dataset')).toMatch(/public\.project_org_admin\(public\.get_current_user_id\(\), p_project_id\)/);
  });
});
