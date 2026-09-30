/**
 * D217 — /profile's "My organization" tab: who else is in the account's ACTIVE
 * organization (D210) and on its projects, and what each of them may do.
 *
 * `get_my_organization_access` lists the organization's members and projects;
 * `get_my_project_access` reads ONE project through `project_access_read`, the same read
 * /admin/projects shows (D215), so the two pages cannot disagree about one person on one
 * project. Every right in it is the database's answer — nothing here recomputes one — and
 * it is the answer the app's gates read (`project_rights_for_user`, D230).
 *
 * The user is NAMED on both calls: the browser calls as `anon` (PLAN.md §4 D155).
 */
import { supabase } from '@/integrations/supabase/client';

export interface OrgMember {
  user_id: string;
  name: string | null;
  email: string | null;
  /** The account's application role (`approved_users.role`). */
  role: string;
  is_super_admin: boolean;
  account_active: boolean;
  /** Role in this organization: owner, admin or member. */
  org_role: string;
  joined_at: string | null;
  is_you: boolean;
  /** This organization is the one the account is working in now. */
  working_here: boolean;
  /** The account's DEFAULT organization (D216); null when none is set. */
  default_org_id: string | null;
  default_org_name: string | null;
}

export interface OrgProject {
  project_id: string;
  name: string;
  owner_id: string | null;
  owner_name: string | null;
  /** The reader's own effective project role; null = sees it through the organization only. */
  my_role: string | null;
  /** The owner, unexpired members and live delegates, each counted once. */
  role_holders: number;
}

export interface MyOrganizationAccess {
  organization: { id: string; name: string; my_org_role: string | null; is_my_default: boolean } | null;
  members: OrgMember[];
  projects: OrgProject[];
}

export interface ProjectPerson {
  user_id: string;
  name: string | null;
  email: string | null;
  account_active: boolean;
  role: string;
  is_super_admin: boolean;
  is_modeler: boolean;
  org_role: string | null;
  in_project_org: boolean;
  active_in_project_org: boolean;
  default_org_id: string | null;
  default_org_name: string | null;
  visible: boolean;
  can_edit_project: boolean;
  /** D230 — the upload gate: the project's owner or an app admin. */
  may_land_uploads?: boolean;
  member: {
    project_role: string; expires_at: string | null; expired: boolean;
    rationale: string | null; granted_by: string | null; updated_at: string;
  } | null;
  delegations: { id: string; project_role: string; expires_at: string; rationale: string; grantor: string | null }[];
  effective_role: string | null;
  /** D230 — what the person may do here, as the app's gates apply it. */
  capabilities: Record<string, boolean>;
  /** D230 — what the role alone would give, before the upload gate and suspension. */
  resolved_capabilities?: Record<string, boolean>;
}

export interface ProjectAccess {
  project_id: string;
  name: string;
  organization_id: string | null;
  organization_name: string | null;
  modeler_id: string | null;
  people: ProjectPerson[];
  project_capabilities: { key: string; label: string }[];
  role_matrix: Record<string, Record<string, boolean>>;
}

/** The two RPCs are not in the generated client types yet; this is their shape. */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as RpcClient;

/** The server's refusals, in words. */
export function accessReadError(message: string | null | undefined): string {
  const m = message ?? '';
  if (m.includes('forbidden')) return 'You cannot see who has access to this project.';
  if (m.includes('account_inactive')) return 'Your account has been deactivated. Contact your administrator.';
  if (m.includes('not_authenticated')) return 'Your session could not be verified. Please sign out and sign in again.';
  if (/get_my_(organization|project)_access|schema cache|does not exist/.test(m)) {
    return 'This view is not available yet — the database has not been updated. Try again later.';
  }
  return m || 'Unknown error.';
}

export async function getMyOrganizationAccess(userId: string): Promise<{ data: MyOrganizationAccess | null; error: string | null }> {
  const { data, error } = await db.rpc('get_my_organization_access', { p_user_id: userId });
  if (error) return { data: null, error: accessReadError(error.message) };
  return { data: data as MyOrganizationAccess, error: null };
}

export async function getMyProjectAccess(userId: string, projectId: string): Promise<{ data: ProjectAccess | null; error: string | null }> {
  const { data, error } = await db.rpc('get_my_project_access', { p_project_id: projectId, p_user_id: userId });
  if (error) return { data: null, error: accessReadError(error.message) };
  return { data: data as ProjectAccess, error: null };
}

/** Holds a role on the project (owner, member or delegate), as opposed to seeing it through the organization. */
export const holdsProjectRole = (p: ProjectPerson) => p.is_modeler || !!p.member || p.delegations.length > 0;
