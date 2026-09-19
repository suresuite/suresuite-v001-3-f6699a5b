/**
 * WP 7.1 stage 1b — sign a Supabase-shaped session token over an id that already exists.
 *
 * WHY THIS IS SIGNED HERE RATHER THAN OBTAINED FROM GoTrue. This application
 * authenticates against `public.approved_users`, not Supabase Auth, and §15 run
 * `35466925117` measured what that means: `auth.users` holds ONE row, `approved_users`
 * holds fourteen, and the overlap is ZERO (PLAN.md §4 D130). So there is no Auth identity
 * to sign in as, and importing fourteen would mean inventing a credential for each —
 * `approved_users.password_hash` is this application's own scheme and GoTrue cannot take
 * it. `auth.uid()` reads the JWT claim rather than the table, so a token signed with the
 * project's own JWT secret makes every predicate that names `auth.uid()` resolve to the
 * person this application already authenticated, with nothing added to `auth.users`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It mints no refresh token. A refresh needs GoTrue to
 * recognise the subject, which it does not, so the token simply expires and the caller
 * mints another after verifying the password again. Claiming a refresh path that cannot
 * work would be exactly the fallback `declared-fallback` (I6) forbids.
 *
 * NO DEPENDENCY, AND THAT IS ALSO A TEST DECISION. HS256 over Web Crypto is available in
 * both Deno and Node 18+, so the signing lives in one module that the edge function
 * imports and `vitest` can also import — which is the only part of stage 1b any gate in
 * this repository can check. Minting a token that PostgREST accepts needs the live
 * project secret and cannot be rehearsed at all (§16 · WP 7.1 stage 2 · F).
 */

export interface MintedToken {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  /** Echoed so a caller can assert the database resolved the same person. */
  sub: string;
}

export interface MintInput {
  userId: string;
  email: string;
  /** The project's JWT secret. The caller is responsible for its absence. */
  secret: string;
  /** `https://<ref>.supabase.co` — the issuer becomes `<supabaseUrl>/auth/v1`. */
  supabaseUrl: string;
  /** Seconds. Kept short: there is no refresh, so a long life is a long exposure. */
  ttlSeconds?: number;
  /** Injectable for tests; seconds since the epoch. */
  now?: number;
}

const b64url = (bytes: Uint8Array): string => {
  // Indexed rather than `for…of`: iterating a Uint8Array needs downlevelIteration under
  // an ES5 target, and this module is compiled by three different toolchains (Deno for the
  // edge function, Vite for the test, and a bare `tsc` if anybody checks it in isolation).
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlText = (text: string): string => b64url(new TextEncoder().encode(text));

/** The default life of a minted token, in seconds. One hour, matching GoTrue's default. */
export const DEFAULT_TTL_SECONDS = 3600;

export async function mintSessionToken(input: MintInput): Promise<MintedToken> {
  if (!input.secret) throw new Error("mintSessionToken: no JWT secret");
  if (!input.userId) throw new Error("mintSessionToken: no user id");

  const iat = Math.floor(input.now ?? Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const exp = iat + ttl;

  // `role` and `aud` are what make PostgREST treat the request as authenticated rather
  // than anonymous, and `sub` is what `auth.uid()` returns. The other claims are GoTrue's
  // shape, included so the token is indistinguishable in structure from a real one —
  // anything that inspects it (PostgREST, the Realtime server, `auth.jwt()`) sees what it
  // expects instead of a minimal token that happens to work today.
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: `${input.supabaseUrl.replace(/\/+$/, "")}/auth/v1`,
    sub: input.userId,
    aud: "authenticated",
    role: "authenticated",
    email: input.email,
    iat,
    exp,
    // States where the subject came from. This is not a GoTrue claim and is not read by
    // anything — it is here so that a token found in a log can be traced to this path
    // rather than mistaken for one GoTrue issued.
    app_identity: "approved_users",
  };

  const signingInput = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));

  return {
    access_token: `${signingInput}.${b64url(new Uint8Array(sig))}`,
    token_type: "bearer",
    expires_in: ttl,
    expires_at: exp,
    sub: input.userId,
  };
}

/**
 * Verifies a token this module produced. Present so the test suite can check the
 * signature with the same primitive rather than eyeballing three base64 segments, and so
 * the edge function can assert its own output before returning it — a token it cannot
 * verify is one it should not hand out.
 */
export async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return b64url(new Uint8Array(expected)) === parts[2];
}

/** Decodes the payload without verifying. For tests and for logging, never for a decision. */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const pad = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4)));
  } catch {
    return null;
  }
}
