/**
 * WP 7.1 stage 1b — the client half, and it is OFF.
 *
 * `session-mint` returns a token whose `sub` is the `approved_users.id`, so `auth.uid()`
 * starts resolving to the person this application authenticated. This module asks for that
 * token after a successful login and then does exactly one thing with it: asks the database
 * who it thinks is acting, and reports the answer.
 *
 * ── WHY IT IS OFF BY DEFAULT, AND WHAT TURNING IT ON MEANS ──
 *
 * Stage 1b cannot be verified before production: minting a token PostgREST accepts needs
 * the live project's JWT secret, and the rehearsal harness is a bare `postgres:16` with no
 * PostgREST and no GoTrue. So this module ships INERT — `SESSION_MINT_DEFAULT` is `false`
 * and nothing calls `session-mint` until somebody says so. Merging it changes no login.
 *
 * Two ways to turn it on, in the order they should be used:
 *
 *   1. ONE BROWSER, no deploy: `localStorage.setItem('session_mint', 'on')`. That person's
 *      next login mints a token and reports whether the database agreed. This is how the
 *      unverifiable part gets verified — by one person, in production, reversibly.
 *   2. EVERYBODY: flip `SESSION_MINT_DEFAULT` to `true` and deploy.
 *
 * Neither does anything until `SUPABASE_JWT_SECRET` is set as a function secret, which no
 * session in this repository can do; without it `session-mint` answers 501 and this module
 * records `not_configured` and returns.
 *
 * ── WHAT IT DOES NOT DO ──
 *
 * It does NOT touch `supabase.auth` and it does not re-route any existing request. Every
 * call the application already makes still goes out as `anon` with the GUC, exactly as
 * today, which is what "beside the existing one" means in §14's stage 1. The token is held
 * in memory only — never in `localStorage`, because a bearer token that outlives the tab
 * is a bearer token somebody else can find. It buys one thing: evidence that the session
 * path works, taken from the only place that can produce it.
 */

import { supabase } from "@/integrations/supabase/client";

/** Flip to `true` to mint for everybody. See the header before you do. */
export const SESSION_MINT_DEFAULT = false;

export type SessionMintOutcome =
  | { state: "disabled" }
  | { state: "not_configured" }
  | { state: "refused"; status: number }
  | { state: "error"; detail: string }
  /** The token was minted AND the database resolved it to the expected person. */
  | { state: "confirmed"; sub: string; resolved: string; expiresAt: number }
  /** Minted, but the database resolved somebody else — or nobody. The interesting failure. */
  | { state: "mismatch"; sub: string; resolved: string | null };

let memoryToken: { access_token: string; expires_at: number; sub: string } | null = null;

/** The in-memory token, if one has been minted and has not expired. */
export function currentMintedToken(): string | null {
  if (!memoryToken) return null;
  if (memoryToken.expires_at <= Math.floor(Date.now() / 1000)) {
    memoryToken = null;
    return null;
  }
  return memoryToken.access_token;
}

export function clearMintedToken(): void {
  memoryToken = null;
}

function enabled(): boolean {
  if (SESSION_MINT_DEFAULT) return true;
  try {
    return localStorage.getItem("session_mint") === "on";
  } catch {
    // A private window or blocked site data throws rather than returning null. The answer
    // is the default, not a crash in the login path.
    return false;
  }
}

/**
 * Mints a session and checks it. NEVER throws: the login path calls this and a failure
 * here must not cost somebody their login, which is the whole reason stage 1a and 1b are
 * additive.
 */
export async function mintAndVerifySession(
  email: string,
  password: string,
  expectedUserId: string,
): Promise<SessionMintOutcome> {
  if (!enabled()) return { state: "disabled" };

  try {
    const { data, error } = await supabase.functions.invoke("session-mint", {
      body: { email, password },
    });

    if (error) {
      // `invoke` surfaces a non-2xx as an error with the status on the context. 501 is the
      // declared "no secret" answer and is not a fault.
      const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
      if (status === 501) return { state: "not_configured" };
      return { state: "refused", status };
    }

    const token = data as { access_token?: string; expires_at?: number; sub?: string } | null;
    if (!token?.access_token || !token?.sub) return { state: "error", detail: "no token in response" };

    memoryToken = {
      access_token: token.access_token,
      expires_at: token.expires_at ?? 0,
      sub: token.sub,
    };

    // THE ONE CALL THAT USES IT, and the only evidence this stage can produce: ask the
    // database who it thinks is acting, with the token attached and no GUC set on this
    // connection. `get_current_user_id()` prefers a session that names an approved user
    // (WP 7.1 stage 2), so a correct token comes back as the person who just logged in.
    const resolved = await resolveWithToken(token.access_token);

    if (resolved && resolved === expectedUserId) {
      return {
        state: "confirmed",
        sub: token.sub,
        resolved,
        expiresAt: token.expires_at ?? 0,
      };
    }
    return { state: "mismatch", sub: token.sub, resolved };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Calls `get_current_user_id()` over a plain `fetch` with the minted token as the bearer.
 *
 * A separate `fetch` rather than the shared client on purpose: the shared client carries
 * the anon key and the GUC, and pointing it at this token would change every other request
 * the application makes. This asks the question without moving anything.
 */
async function resolveWithToken(accessToken: string): Promise<string | null> {
  // The url and the anon key are read OFF THE CLIENT rather than restated here.
  // `src/integrations/supabase/client.ts` holds them as constants and opens with "This
  // file is automatically generated. Do not edit it directly", so there is nowhere to add
  // an export — and copying two literals into a second module is the duplication
  // `single-source` (I1) exists to prevent. These two fields are supabase-js internals, so
  // they are read through a narrow type and their absence is handled: this returns null and
  // the caller reports `error`, which is a worse outcome than a crash only if nobody reads
  // it, and the outcome is the thing this module exists to report.
  const internals = supabase as unknown as { supabaseUrl?: string; supabaseKey?: string };
  const url = internals.supabaseUrl;
  const anon = internals.supabaseKey;
  if (!url || !anon) return null;

  const res = await fetch(`${url}/rest/v1/rpc/get_current_user_id`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return typeof body === "string" ? body : null;
}
