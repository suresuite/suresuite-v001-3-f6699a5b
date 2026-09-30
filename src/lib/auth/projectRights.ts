/**
 * D219 — the signed-in account's rights on ONE project, as the app applies them.
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

export interface ProjectRights {
  account_active: boolean;
  /** "Projects: org-wide view" — the project's organization is the one the account works in. */
  visible: boolean;
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

/** A write this account may not make on this project (D219). The hook that refused it
 *  has already said why, so a caller's catch should not say it again. */
export class ProjectRightRefused extends Error {}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Why `right` is not held, in words — for a disabled button or a refused action. Null
 * when it is held.
 */
export function projectRightRefusal(right: ProjectRight, rights: ProjectRights | null): string | null {
  if (!rights) return `Your rights on this project could not be checked, so ${PROJECT_RIGHT_LABELS[right]} is off.`;
  if (rights.capabilities[right]) return null;
  const label = PROJECT_RIGHT_LABELS[right];
  if (!rights.account_active) return 'Your account has been deactivated.';
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
 * mislead (D219): a suspended account holds none of them, and a role's "Edit Input Data"
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
