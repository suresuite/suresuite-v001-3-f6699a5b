/**
 * WP 7.1 stage 1b — `session-mint`: the login path's second half.
 *
 * The client verifies a password by calling `authenticate_approved_user`, and has done
 * since this application was written. What it has never had is a SESSION: the browser
 * presents the anon key, `auth.uid()` returns NULL for everybody, and the acting user is
 * carried in the `app.current_user_id` GUC — which `set_current_user_context` sets on a
 * POOLED CONNECTION that PostgREST does not promise to hand back on the next request.
 * That is D28, and §14 calls it the single most important line of the plan.
 *
 * This function closes it. It verifies the password ITSELF — server-side, with the service
 * role, never trusting a client's claim to have already done so — and returns a token
 * signed with the project's JWT secret whose `sub` is the `approved_users.id`. From then
 * on `auth.uid()` returns the person this application authenticated, and
 * `get_current_user_id()` prefers it (WP 7.1 stage 2, `20260919000011`).
 *
 * ── IT FAILS CLOSED, AND THE ONE THING IT NEEDS IS NOT IN THIS REPOSITORY ──
 *
 * `SUPABASE_JWT_SECRET` must be set as a function secret. It is NOT set today and no
 * session here can set it — it lives in the project's API settings. Without it this
 * function returns **501** and mints nothing, and the client falls back to exactly today's
 * login. So deploying this changes nobody's login until somebody provisions the secret,
 * which is the property that makes stage 1b safe to merge: the blast radius of the merge
 * is zero and the blast radius of the secret is a decision somebody takes deliberately.
 *
 * ── WHAT IT DOES NOT DO ──
 *
 * No refresh token (see `_shared/mintSessionToken.ts`): GoTrue cannot refresh a subject it
 * has never heard of, and a refresh path that cannot work is the fallback I6 forbids. No
 * `auth.users` row is created — this is the route that leaves the identity store alone.
 * And it does NOT authorize anything: the token says who, and every policy still decides
 * what, which is the division stages 3-6 rest on.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_TTL_SECONDS,
  mintSessionToken,
  verifySessionToken,
} from "../_shared/mintSessionToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ?? "";

  // THE FAIL-CLOSED BRANCH, and the reason it is 501 rather than 500: the function is
  // correct and the deployment is incomplete. A client reading this should log in the old
  // way and say nothing to the user, because nothing is wrong from their side.
  if (!JWT_SECRET) {
    return json({
      error: "not_configured",
      detail:
        "SUPABASE_JWT_SECRET is not set for this function, so no session can be minted. " +
        "The caller should fall back to the GUC path. PLAN.md §14, WP 7.1 stage 1b.",
    }, 501);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "not_configured" }, 501);

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!email || !password) return json({ error: "bad_request" }, 400);

  // VERIFIED HERE, NOT TAKEN ON TRUST. The client has already called this RPC to log the
  // user in, and that is irrelevant: a caller of this endpoint is an unauthenticated
  // request that has asked for a token, so the password is checked again on this side of
  // the wire. Calling it with the service role also means the check does not depend on
  // whatever `anon` may currently execute.
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await svc.rpc("authenticate_approved_user", {
    user_email: email,
    user_password: password,
  });

  if (error) return json({ error: "auth_failed" }, 500);
  if (!Array.isArray(data) || data.length === 0) {
    // Deliberately identical to a wrong password: this endpoint must not say whether an
    // address is registered.
    return json({ error: "invalid_credentials" }, 401);
  }

  const row = data[0] as { user_id?: string };
  if (!row?.user_id) return json({ error: "auth_failed" }, 500);

  const token = await mintSessionToken({
    userId: row.user_id,
    email,
    secret: JWT_SECRET,
    supabaseUrl: SUPABASE_URL,
    ttlSeconds: DEFAULT_TTL_SECONDS,
  });

  // A token this function cannot verify is one it should not hand out. Cheap, and it turns
  // a silent signing bug into a 500 here rather than an unexplained 401 at PostgREST.
  if (!(await verifySessionToken(token.access_token, JWT_SECRET))) {
    return json({ error: "mint_failed" }, 500);
  }

  return json(token);
});
