/**
 * §4 D213 — reading and setting roles at the organization and project levels. The RPCs
 * return facts only (who holds what); what those facts let someone do is written once,
 * in `accessLevels.ts`.
 *
 * The admin verbs name their actor and the self-service read names its user: the browser
 * calls as `anon` (PLAN.md §4 D155).
 */
import { supabase } from '@/integrations/supabase/client';
import { projectRoleRefusal } from '@/lib/auth/accessLevels';

/** One account's standing on one project, from `admin_project_access` (D213). */
export interface ProjectAccessRow {
  user_id: string;
  name: string | null;
  email: string | null;
  account_role: string;
  is_active: boolean | null;
  /** Its role in the PROJECT's organization; null when it is not a member there. */
  org_role: string | null;
  in_project_org: boolean;
  is_modeler: boolean;
  member_role: string | null;
  member_expires_at: string | null;
  delegated_role: string | null;
  delegation_expires_at: string | null;
  /** What `effective_project_role()` returns. */
  effective_role: string | null;
}

/** The signed-in account's role on each project of its current organization. */
export interface MyProjectRoleRow {
  project_id: string;
  project_name: string;
  /** The account owns the project (`projects.modeler_id`). */
  is_modeler: boolean;
  member_role: string | null;
  member_expires_at: string | null;
  delegated_role: string | null;
  delegation_expires_at: string | null;
  effective_role: string | null;
}

/** These RPCs are not in the generated client types yet; this is their shape. */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as RpcClient;

export interface Actor { id?: string; email?: string }
const actorArgs = (a: Actor) => ({ p_actor_id: a.id, p_actor_email: a.email });

async function rows<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T[]; error: string | null }> {
  const { data, error } = await db.rpc(fn, args);
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as T[], error: null };
}

export const listMyProjectRoles = (userId: string) =>
  rows<MyProjectRoleRow>('list_my_project_roles', { p_user_id: userId });

export const adminProjectAccess = (actor: Actor, projectId: string) =>
  rows<ProjectAccessRow>('admin_project_access', { ...actorArgs(actor), p_project_id: projectId });

async function verb(fn: string, args: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await db.rpc(fn, args);
  return { error: error ? projectRoleRefusal(error.message) : null };
}

// The writers are D211's (`20260930000005`); this module names only their arguments.
export const adminSetProjectMember = (actor: Actor, projectId: string, userId: string, role: string) =>
  verb('admin_set_project_member', {
    ...actorArgs(actor), p_target_user_id: userId, p_project_id: projectId, p_project_role: role,
    p_expires_at: null, p_rationale: null,
  });

export const adminRemoveProjectMember = (actor: Actor, projectId: string, userId: string) =>
  verb('admin_remove_project_member', { ...actorArgs(actor), p_target_user_id: userId, p_project_id: projectId });

export const adminSetOrgRole = (actor: Actor, userId: string, orgId: string, orgRole: string) =>
  verb('admin_set_user_org_role', { ...actorArgs(actor), p_target_user_id: userId, p_org_id: orgId, p_org_role: orgRole });
