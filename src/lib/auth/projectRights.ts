/**
 * D230 — the signed-in account's rights on ONE project, as the app applies them.
 *
 * `get_my_project_rights` returns `project_rights_for_user`, the same answer /profile's
 * "My organization" tab and both admin pages list for every person — so a button this
 * app enables and the right a page shows cannot disagree. The account-wide set
 * (`get_my_capabilities`, `useCapabilities`) has no project layer: a Viewer member whose
 * account is a modeler holds `simulation_lab` there and not here.
 *
 * The user is NAMED on the call: the browser calls as `anon` (PLAN.md §4 D155).
 */
import { supabase } from '@/integrations/supabase/client';

/** The four capabilities the project layer decides (`project_role_capabilities`). */
export type ProjectRight = 'simulation_lab' | 'data_edit_inputs' | 'data_edit_policies' | 'export';

export const PROJECT_RIGHT_LABELS: Record<ProjectRight, string> = {
  simulation_lab: 'Run Simulations',
  data_edit_inputs: 'Edit Input Data',
  data_edit_policies: 'Edit Policies',
  export: 'Export',
};

/**
 * D273 — which layer of the rule decided a right (`project_right_decide`, plus the two
 * gates `project_rights_for_user` applies after it). One vocabulary for /admin/roles,
 * the refusal sentences and the manual.
 */
export type RightDecider =
  | 'super_admin' | 'person_override' | 'account_role' | 'project_role'
  | 'account_ceiling' | 'upload_gate' | 'suspended';

export const RIGHT_DECIDER_LABELS: Record<RightDecider, string> = {
  super_admin: 'Super admin',
  person_override: 'Person override',
  account_role: 'Account role (no project role)',
  project_role: 'Project role',
  account_ceiling: 'Capped by account role',
  upload_gate: 'Upload gate (owner or app admin)',
  suspended: 'Account suspended',
};

/** One right's inputs and answer, as `project_right_decisions` returns them (D273). */
export interface RightDecision {
  allowed: boolean;
  decided_by: RightDecider;
  project_role: string | null;
  project_grant: boolean | null;
  account_role: string;
  account_allows: boolean;
  account_source: 'organization' | 'account_role' | 'default';
  person_override: boolean | null;
}

export interface ProjectRights {
  account_active: boolean;
  /** Sees the project while working in its organization (D231): a member of it, or a super admin. */
  visible: boolean;
  /** The account is working in the project's organization right now (D210's active one). */
  working_in_project_org?: boolean;
  /** "Projects: org update by owner or admin". */
  can_edit_project: boolean;
  /** The upload gate (`has_project_access`): the project's owner or an app admin. */
  may_land_uploads: boolean;
  /** What the account may do here. */
  capabilities: Partial<Record<ProjectRight, boolean>>;
  /** What the four-layer resolver alone says, before the upload gate and suspension. */
  resolved_capabilities: Partial<Record<ProjectRight, boolean>>;
  effective_role: string | null;
  is_modeler: boolean;
  /** D273 — why each right holds or not. Absent before `20261002000001` deploys. */
  decisions?: Partial<Record<ProjectRight, RightDecision>>;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as RpcClient;

/** Why the read failed: a refusal the page must honour, or a read that did not happen. */
export type RightsReadFailure = 'refused' | 'unavailable';

export async function getMyProjectRights(
  userId: string,
  projectId: string,
): Promise<{ data: ProjectRights | null; failure: RightsReadFailure | null; error: string | null }> {
  const { data, error } = await db.rpc('get_my_project_rights', { p_project_id: projectId, p_user_id: userId });
  if (error) {
    const m = error.message ?? '';
    const refused = /forbidden|account_inactive|not_authenticated/.test(m);
    return { data: null, failure: refused ? 'refused' : 'unavailable', error: m };
  }
  return { data: data as ProjectRights, failure: null, error: null };
}

/** A write this account may not make on this project (D230). The hook that refused it
 *  has already said why, so a caller's catch should not say it again. */
export class ProjectRightRefused extends Error {}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const roleName = (s: string) => s.split('_').map(cap).join(' ');

/**
 * Why `right` is not held, in words — for a disabled button or a refused action. Null
 * when it is held.
 */
export function projectRightRefusal(right: ProjectRight, rights: ProjectRights | null): string | null {
  if (!rights) return `Your rights on this project could not be checked, so ${PROJECT_RIGHT_LABELS[right]} is off.`;
  if (rights.capabilities[right]) return null;
  const label = PROJECT_RIGHT_LABELS[right];
  if (!rights.account_active) return 'Your account has been deactivated.';
  // D273 — the database says which layer decided; say that, not a guess.
  const d = rights.decisions?.[right];
  if (d) {
    switch (d.decided_by) {
      case 'account_ceiling':
        return d.account_source === 'organization'
          ? `Your role on this project (${cap(d.project_role ?? '')}) includes ${label}, but this project's organization has it switched off.`
          : `Your role on this project (${cap(d.project_role ?? '')}) includes ${label}, but your account role (${roleName(d.account_role)}) does not allow it on any project.`;
      case 'person_override':
        return `${label} has been switched off for your account by an administrator.`;
      case 'account_role':
        return `You hold no role on this project, and your account role (${roleName(d.account_role)}) does not include ${label}.`;
      case 'project_role':
        return `Your role on this project (${cap(d.project_role ?? '')}) does not include ${label}.`;
      default:
        break;
    }
  }
  if (right === 'data_edit_inputs' && rights.resolved_capabilities[right] && !rights.may_land_uploads) {
    return `Your role allows ${label}, but uploads to this project are accepted only from its owner or an app admin.`;
  }
  if (rights.effective_role) {
    return `Your role on this project (${cap(rights.effective_role)}) does not include ${label}.`;
  }
  return `${label} isn't enabled for your account on this project. Contact an administrator.`;
}

/**
 * The sentences a row listing someone's rights owes its reader when the ticks alone would
 * mislead (D230): a suspended account holds none of them, and a role's "Edit Input Data"
 * does not hold where the upload gate refuses the person. /profile, /admin/projects and
 * /admin/users/:userId all say these, from the same read.
 */
export function projectRightsNotes(p: {
  account_active?: boolean;
  may_land_uploads?: boolean;
  capabilities: Record<string, boolean>;
  resolved_capabilities?: Record<string, boolean>;
}): string[] {
  if (p.account_active === false) {
    return ['Suspended: cannot sign in, so holds none of these rights until reactivated.'];
  }
  const notes: string[] = [];
  if (p.resolved_capabilities?.data_edit_inputs && !p.capabilities.data_edit_inputs && p.may_land_uploads === false) {
    notes.push(`${PROJECT_RIGHT_LABELS.data_edit_inputs}: the role allows it, but uploads to this project are accepted only from its owner or an app admin.`);
  }
  return notes;
}
