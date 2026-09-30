/**
 * §4 D211 — reading and setting roles at the organization and project levels. The RPCs
 * return facts only (who holds what); what those facts let someone do is written once,
 * in `accessLevels.ts`.
 *
 * The admin verbs name their actor and the self-service read names its user: the browser
 * calls as `anon` (PLAN.md §4 D155).
 */
import { supabase } from '@/integrations/supabase/client';
import { projectRoleRefusal } from '@/lib/auth/accessLevels';

/** One account's standing on one project, from `admin_project_access`. */
export interface ProjectAccessRow {
  user_id: string;
  name: string | null;
  email: string | null;
  account_role: string;
  is_active: boolean | null;
  /** Its role in the PROJECT's organization; null when it is not a member there. */
  org_role: string | null;
  in_project_org: boolean;
  is_creator: boolean;
  member_role: string | null;
  member_expires_at: string | null;
  delegated_role: string | null;
  delegation_expires_at: string | null;
  /** What `effective_project_role()` returns. */
  effective_role: string | null;
}

/** One project an account holds a role on, from `admin_user_project_roles`. */
export interface UserProjectRoleRow {
  project_id: string;
  project_name: string;
  organization_id: string | null;
  organization: string | null;
  in_project_org: boolean;
  is_creator: boolean;
  member_role: string | null;
  member_expires_at: string | null;
  delegated_role: string | null;
  delegation_expires_at: string | null;
  effective_role: string | null;
}

/** The signed-in account's role on each project of its current organization. */
export interface MyProjectRoleRow {
  project_id: string;
  project_name: string;
  is_creator: boolean;
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

export const adminUserProjectRoles = (actor: Actor, userId: string) =>
  rows<UserProjectRoleRow>('admin_user_project_roles', { ...actorArgs(actor), p_user_id: userId });

async function verb(fn: string, args: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await db.rpc(fn, args);
  return { error: error ? projectRoleRefusal(error.message) : null };
}

export const adminSetProjectMember = (actor: Actor, projectId: string, userId: string, role: string, rationale?: string) =>
  verb('admin_set_project_member', {
    ...actorArgs(actor), p_project_id: projectId, p_target_user_id: userId, p_project_role: role,
    p_rationale: rationale?.trim() || null,
  });

export const adminRemoveProjectMember = (actor: Actor, projectId: string, userId: string) =>
  verb('admin_remove_project_member', { ...actorArgs(actor), p_project_id: projectId, p_target_user_id: userId });

export const adminSetOrgMemberRole = (actor: Actor, userId: string, orgId: string, orgRole: string) =>
  verb('admin_set_org_member_role', { ...actorArgs(actor), p_target_user_id: userId, p_org_id: orgId, p_org_role: orgRole });
