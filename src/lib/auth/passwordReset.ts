/**
 * "Forgot password?" — the person asks, a super admin resets (PLAN.md §4 D251).
 *
 * Sign-in here is against `approved_users`, not Supabase Auth, so there is no reset
 * e-mail. A request is a note for a super admin and changes nothing about the account;
 * the reset is `admin_reset_user_password`, which forces a change at the next sign-in
 * and closes the request. Every function here is a call to an RPC in
 * `20261001000011_password_reset_requests.sql`.
 */
import { supabase } from '@/integrations/supabase/client';

type RpcResult = { data: unknown; error: { message: string } | null };
// These RPCs postdate the generated client types.
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

export interface ActorArgs { p_actor_id?: string; p_actor_email?: string }

export interface ResetRequest {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  organization: string | null;
  requested_at: string;
}

/**
 * Record a request for this email. Resolves the same way whether or not the email is an
 * account, so the page must not say which — only a transport failure is an error.
 */
export async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
  const { error } = await rpc('request_password_reset', { p_email: email.trim() });
  return { error: error?.message ?? null };
}

export async function listResetRequests(actor: ActorArgs): Promise<{ data: ResetRequest[]; error: string | null }> {
  const { data, error } = await rpc('admin_list_password_reset_requests', { ...actor });
  return { data: (data ?? []) as ResetRequest[], error: error?.message ?? null };
}

export async function dismissResetRequest(actor: ActorArgs, requestId: string): Promise<{ error: string | null }> {
  const { error } = await rpc('admin_dismiss_password_reset_request', { ...actor, p_request_id: requestId });
  return { error: error?.message ?? null };
}

/** Set a temporary password; the person must change it at their next sign-in. */
export async function resetUserPassword(actor: ActorArgs, userId: string, temporaryPassword: string): Promise<{ error: string | null }> {
  const { error } = await rpc('admin_reset_user_password', {
    ...actor, p_target_user_id: userId, p_new_password: temporaryPassword,
  });
  return { error: error?.message ?? null };
}
