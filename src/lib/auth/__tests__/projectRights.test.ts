/**
 * D230 — a person's rights on a project, as the app applies them. The database states
 * them once (`project_rights_for_user`, `rehearsal/550`); this pins the two things the
 * browser authors about them: the keys the gates ask for are the keys the function
 * returns, and the words a refused button or a misleading tick owes its reader.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The client reads browser storage when it loads; nothing here calls it.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  PROJECT_RIGHT_LABELS, projectRightRefusal, projectRightsNotes, type ProjectRights,
} from '../projectRights';

const root = path.resolve(__dirname, '../../../..');
const sql = readFileSync(path.join(root, 'supabase/migrations/20261001000003_project_rights_one_answer.sql'), 'utf8');
const seed = readFileSync(path.join(root, 'supabase/migrations/20260915000005_project_membership_and_delegation.sql'), 'utf8');

const rights = (over: Partial<ProjectRights> = {}): ProjectRights => ({
  account_active: true, visible: true, can_edit_project: false, may_land_uploads: false,
  capabilities: {}, resolved_capabilities: {}, effective_role: null, is_modeler: false,
  ...over,
});

describe('D230 · the keys', () => {
  it('names exactly the capabilities the project layer seeds', () => {
    const seeded = new Set([...seed.matchAll(/\('viewer',\s*'([a-z_]+)'/g)].map((m) => m[1]));
    expect([...seeded].sort()).toEqual(Object.keys(PROJECT_RIGHT_LABELS).sort());
  });

  it('reads every top-level key the SQL function returns', () => {
    const body = /FUNCTION public\.project_rights_for_user[\s\S]*?END; \$\$;/.exec(sql)?.[0] ?? '';
    for (const key of ['account_active', 'visible', 'can_edit_project', 'may_land_uploads', 'capabilities', 'resolved_capabilities']) {
      expect(body).toContain(`'${key}'`);
    }
  });
});

describe('D230 · why a right is not held', () => {
  it('is silent when it is held', () => {
    expect(projectRightRefusal('export', rights({ capabilities: { export: true } }))).toBeNull();
  });

  it('names the role that does not include it', () => {
    expect(projectRightRefusal('simulation_lab', rights({ effective_role: 'viewer' })))
      .toBe('Your role on this project (Viewer) does not include Run Simulations.');
  });

  it('names the upload gate when the role allows input edits and the gate refuses them', () => {
    const r = rights({ effective_role: 'editor', resolved_capabilities: { data_edit_inputs: true } });
    expect(projectRightRefusal('data_edit_inputs', r)).toMatch(/only from its owner or an app admin/);
  });

  it('refuses when the rights could not be read', () => {
    expect(projectRightRefusal('export', null)).toMatch(/could not be checked/);
  });
});

describe('D230 · what a row of ticks owes its reader', () => {
  it('says a suspended account holds nothing, and nothing else', () => {
    expect(projectRightsNotes({ account_active: false, capabilities: {}, resolved_capabilities: { data_edit_inputs: true } }))
      .toEqual(['Suspended: cannot sign in, so holds none of these rights until reactivated.']);
  });

  it('explains an Editor refused by the upload gate', () => {
    const notes = projectRightsNotes({
      account_active: true, may_land_uploads: false,
      capabilities: { data_edit_inputs: false }, resolved_capabilities: { data_edit_inputs: true },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^Edit Input Data: the role allows it/);
  });

  it('says nothing when the ticks are the whole story', () => {
    expect(projectRightsNotes({ account_active: true, may_land_uploads: true, capabilities: { data_edit_inputs: true }, resolved_capabilities: { data_edit_inputs: true } })).toEqual([]);
    expect(projectRightsNotes({ account_active: true, may_land_uploads: false, capabilities: {}, resolved_capabilities: {} })).toEqual([]);
  });
});
