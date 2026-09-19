/**
 * WP 7.1 stage 1b — what CAN be checked about a minted session, and what cannot.
 *
 * Stage 1b is the one stage in §14's sequence that no gate in this repository can verify
 * end to end: a token PostgREST accepts needs the live project's JWT secret, and
 * `contract:rehearse` builds a bare `postgres:16` with no GoTrue and no PostgREST at all.
 * What IS checkable is the token itself — its signature, its claims, and the two decisions
 * that make it safe — and that is what this file pins.
 *
 * Read the boundary honestly: these assertions prove the token is well formed and signed
 * with the secret it was given. They do not prove that the live project accepts it. That
 * remains a production observation, and §14 says so rather than implying a green suite
 * settles it.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_TTL_SECONDS,
  decodeTokenPayload,
  mintSessionToken,
  verifySessionToken,
} from "../../../../supabase/functions/_shared/mintSessionToken";

const SECRET = "test-secret-not-a-real-one-0123456789";
const URL = "https://wckdrutwkytwcomrlpib.supabase.co";
const USER = "11111111-2222-3333-4444-555555555555";
const NOW = 1_800_000_000;

const mint = (over: Partial<Parameters<typeof mintSessionToken>[0]> = {}) =>
  mintSessionToken({
    userId: USER,
    email: "someone@example.invalid",
    secret: SECRET,
    supabaseUrl: URL,
    now: NOW,
    ...over,
  });

describe("the minted token is a JWT, and it verifies", () => {
  it("has three base64url segments and no padding", async () => {
    const { access_token } = await mint();
    const parts = access_token.split(".");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifies against the secret it was signed with", async () => {
    const { access_token } = await mint();
    await expect(verifySessionToken(access_token, SECRET)).resolves.toBe(true);
  });

  it("does NOT verify against a different secret — the signature is load-bearing", async () => {
    const { access_token } = await mint();
    await expect(verifySessionToken(access_token, SECRET + "x")).resolves.toBe(false);
  });

  it("does not verify once a claim is edited", async () => {
    // The whole point of signing: somebody who alters `sub` cannot re-sign it. This is the
    // assertion that separates a token from a cookie.
    const { access_token } = await mint();
    const [h, , s] = access_token.split(".");
    const forged = JSON.stringify({ ...decodeTokenPayload(access_token), sub: "00000000-0000-0000-0000-000000000000" });
    const tampered = `${h}.${btoa(forged).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${s}`;
    await expect(verifySessionToken(tampered, SECRET)).resolves.toBe(false);
  });

  it("declares HS256 in the header", async () => {
    const { access_token } = await mint();
    const header = JSON.parse(atob(access_token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
  });
});

describe("the claims are the ones PostgREST and auth.uid() read", () => {
  it("`sub` is the approved_users id — which is what auth.uid() returns", async () => {
    const { access_token, sub } = await mint();
    expect(decodeTokenPayload(access_token)?.sub).toBe(USER);
    expect(sub).toBe(USER);
  });

  it("`role` and `aud` are `authenticated`, which is what stops the request being anonymous", async () => {
    const p = decodeTokenPayload((await mint()).access_token)!;
    expect(p.role).toBe("authenticated");
    expect(p.aud).toBe("authenticated");
  });

  it("the issuer is the project's auth endpoint, with no doubled slash", async () => {
    const p = decodeTokenPayload((await mint({ supabaseUrl: URL + "/" })).access_token)!;
    expect(p.iss).toBe(`${URL}/auth/v1`);
  });

  it("says where the subject came from, so a token in a log is traceable", async () => {
    // Not a GoTrue claim and read by nothing. It exists so that a token found later is
    // identifiable as this path's rather than mistaken for one GoTrue issued.
    expect(decodeTokenPayload((await mint()).access_token)?.app_identity).toBe("approved_users");
  });
});

describe("expiry — short, because there is no refresh", () => {
  it("expires one hour after issue by default", async () => {
    const t = await mint();
    expect(t.expires_in).toBe(DEFAULT_TTL_SECONDS);
    expect(t.expires_at).toBe(NOW + DEFAULT_TTL_SECONDS);
    expect(decodeTokenPayload(t.access_token)?.iat).toBe(NOW);
    expect(decodeTokenPayload(t.access_token)?.exp).toBe(NOW + DEFAULT_TTL_SECONDS);
  });

  it("mints NO refresh token, and that is deliberate", async () => {
    // GoTrue cannot refresh a subject it has never heard of — `auth.users` holds one row
    // and it is nobody this application knows (§4 D130). A refresh field would be a
    // fallback that cannot work, which is what `declared-fallback` (I6) forbids.
    expect(Object.keys(await mint())).toEqual(
      ["access_token", "token_type", "expires_in", "expires_at", "sub"],
    );
  });

  it("honours a shorter ttl", async () => {
    const t = await mint({ ttlSeconds: 60 });
    expect(t.expires_at).toBe(NOW + 60);
  });
});

describe("it refuses to mint what it cannot sign", () => {
  it("rejects an empty secret rather than signing with one", async () => {
    await expect(mint({ secret: "" })).rejects.toThrow(/no JWT secret/);
  });

  it("rejects an empty user id", async () => {
    await expect(mint({ userId: "" })).rejects.toThrow(/no user id/);
  });
});

describe("what this suite does NOT establish", () => {
  it("cannot show that the live project accepts the token", () => {
    // Stated as a test so it is read rather than skipped. Verifying acceptance needs the
    // real JWT secret and a real PostgREST; the rehearsal harness has neither, and stage
    // 1b's own §16 entry names this as the boundary.
    const checkable = ["signature", "claims", "expiry", "refusals"];
    const notCheckable = ["PostgREST accepts it", "auth.uid() resolves in production"];
    expect(checkable.length).toBeGreaterThan(0);
    expect(notCheckable).toHaveLength(2);
  });
});
