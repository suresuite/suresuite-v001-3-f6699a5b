/**
 * D210 — an account may belong to several organizations and works in ONE of them at a
 * time: its active organization, `approved_users.organization_id`, which is what RLS
 * reads and what a new project is stamped with. The memberships are
 * `organization_members`; `list_my_organizations` returns them and marks the active one,
 * and `switch_my_organization` changes it (refusing an organization the account is not
 * in, and one whose access period has ended).
 *
 * The user is NAMED on both calls: the browser calls as `anon` (PLAN.md §4 D155).
 */
import { supabase } from '@/integrations/supabase/client';

export interface MyOrganization {
  org_id: string;
  name: string;
  slug: string;
  status: string;
  org_role: string;
  /** The active organization — the one the app is showing. */
  is_current: boolean;
  joined_at: string;
  access_period: string | null;
  access_valid_until: string | null;
  /** The period has ended for this account (a super admin is exempt). */
  access_expired: boolean;
}

/** The two RPCs are not in the generated client types yet; this is their shape. */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as RpcClient;

export async function listMyOrganizations(userId: string): Promise<{ data: MyOrganization[]; error: string | null }> {
  const { data, error } = await db.rpc('list_my_organizations', { p_user_id: userId });
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as MyOrganization[], error: null };
}

/**
 * Browser state that names a project of the organization being left. After a switch the
 * old organization's projects are unreadable (RLS), so a remembered selection would open
 * on a project that no longer resolves.
 */
export const PROJECT_SELECTION_KEYS = ['globalSelectedProjectId', 'suresuite.dataManager.lastOpenedProject'];

export function forgetProjectSelection() {
  for (const key of PROJECT_SELECTION_KEYS) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable: nothing remembered */ }
  }
}

/** The server's refusal as a sentence: `not_a_member: …`, `org_access_ended: …`. */
export function switchRefusal(message: string | null | undefined): string {
  const m = /(?:not_a_member|org_access_ended|account_inactive):?\s*(.*)$/s.exec(message ?? '');
  if (!m) return message || 'Could not switch organization.';
  const text = m[1] || 'This account is not active.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Makes `orgId` the account's active organization, then reloads the app on the home
 * page so every page reads the new organization's projects from scratch — cached reads
 * and the remembered project selection belong to the organization just left.
 */
export async function switchMyOrganization(userId: string, orgId: string): Promise<{ error: string | null }> {
  const { error } = await db.rpc('switch_my_organization', { p_org_id: orgId, p_user_id: userId });
  if (error) return { error: switchRefusal(error.message) };
  forgetProjectSelection();
  window.location.assign('/');
  return { error: null };
}
