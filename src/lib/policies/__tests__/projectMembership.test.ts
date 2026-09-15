/**
 * D14 — project membership, the resolver, and subtractive delegation
 * (Phase 2 / WP 2.2, PLAN.md §9).
 *
 * Access had two levels: your global `app_role` and your organization. Nothing in
 * between, so "let Dana read this one project" could only be granted by putting
 * Dana in the org — which grants every project in it. `subtractive-delegation`
 * (§2.1 G3) had nowhere to attach.
 *
 * WHAT THIS SUITE IS AND IS NOT. The BEHAVIOUR of WP 2.2 was verified by executing
 * `20260915000005` against a real PostgreSQL 16 and running the exit checks and the
 * four-case truth table as SQL — that evidence is in PLAN.md §16, because a
 * resolver is a database object and reading it is not the same as running it.
 * This suite guards the things that can rot silently between such runs: the
 * signature property the whole access layer depends on, the enforcement POINT
 * (D28 makes a policy unable to subtract, so the check must be in the RPC), the
 * resolution ORDER, and the TS/SQL catalog agreeing. Each assertion below is one
 * a future edit could plausibly break without noticing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — .mjs helper shared with the data-contract scripts; no types.
import { liveDefinitions } from "../../../../scripts/data-contract/live-sql.mjs";
import { FEATURE_CAPABILITIES } from "../../capabilities";

const ROOT = join(__dirname, "..", "..", "..", "..");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

type LiveDef = { name: string; migration: string; sql: string };
const live = () => liveDefinitions() as { policies: Map<string, LiveDef>; functions: Map<string, LiveDef> };
const fn = (name: string): LiveDef => {
  const d = live().functions.get(name);
  expect(d, `no live function ${name}()`).toBeDefined();
  return d!;
};

describe("the resolver keeps the property the access layer is built on", () => {
  it("both forms take their user id explicitly and read no session GUC", () => {
    // get_current_user_org() reads current_setting('app.current_user_id'), and a
    // GUC on a pooled PostgREST connection is the one thing here that cannot be
    // relied on. capabilities_for_user has always taken _user_id instead. The
    // project-aware form must not quietly undo that.
    const project = squash(fn("capabilities_for_user").sql);
    expect(project).toMatch(/capabilities_for_user\s*\(\s*_user_id\s+uuid\s*,\s*_project_id\s+uuid\s*\)/i);
    expect(project, "the resolver reads a session GUC").not.toMatch(/current_setting\s*\(/);
    expect(squash(fn("effective_project_role").sql), "effective_project_role reads a session GUC")
      .not.toMatch(/current_setting\s*\(/);
  });

  it("the one-argument form still exists — the overload adds, it does not replace", () => {
    // Every existing caller passes one argument. Replacing rather than overloading
    // would change all of them at once, silently.
    const all = readFileSync(
      join(ROOT, "supabase", "migrations", "20260915000005_project_membership_and_delegation.sql"), "utf8");
    expect(all).toMatch(/v_base\s*:=\s*public\.capabilities_for_user\(_user_id\)/);
  });

  it("/profile is still non-deniable", () => {
    // A deniable /profile is a self-lockout loop: the page you would use to fix
    // your own permissions is the page the permissions took away.
    expect(squash(fn("capabilities_for_user").sql)).toMatch(/c\.key = '\/profile' THEN true/);
  });

  it("resolves role -> org -> project -> user, most specific first", () => {
    // As a COALESCE the order reverses: user, project, org, role, false. Getting
    // this backwards would make a role default beat a user's explicit grant.
    const body = squash(fn("capabilities_for_user").sql);
    // `public.` qualified on purpose: "role_capabilities" is a SUBSTRING of
    // "project_role_capabilities", so an unqualified indexOf finds the wrong one.
    const order = ["user_capabilities", "project_role_capabilities", "org_capabilities", "role_capabilities"]
      .map((t) => body.indexOf(`public.${t} `));
    expect(order.every((i) => i > -1), "a layer is missing from the resolver").toBe(true);
    expect(order, "layers are not in most-specific-first order").toEqual([...order].sort((a, b) => a - b));
  });
});

describe("delegation is subtractive and expiring, enforced where it can be", () => {
  it("subtraction is checked in the RPC, because a permissive policy cannot subtract (D28)", () => {
    const body = squash(fn("grant_project_delegation").sql);
    expect(body).toMatch(/project_role_rank\(_project_role\)\s*>\s*public\.project_role_rank\(v_grantor_role\)/);
    expect(body).toMatch(/may not exceed the grantor/i);
  });

  it("a grant with no expiry, or an expiry in the past, is refused", () => {
    const body = squash(fn("grant_project_delegation").sql);
    expect(body).toMatch(/_expires_at IS NULL THEN RAISE EXCEPTION/i);
    expect(body).toMatch(/_expires_at <= now\(\) THEN RAISE EXCEPTION/i);
  });

  it("expires_at is NOT NULL in the table, not merely checked in the RPC", () => {
    // A delegation without an end is a membership, and there is a table for those.
    const sql = readFileSync(
      join(ROOT, "supabase", "migrations", "20260915000005_project_membership_and_delegation.sql"), "utf8");
    const table = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.delegation_grants"));
    expect(squash(table.slice(0, table.indexOf(");")))).toMatch(/expires_at\s+timestamptz NOT NULL/i);
  });

  it("expiry is applied in effective_project_role, so no caller can forget it", () => {
    const body = squash(fn("effective_project_role").sql);
    expect(body).toMatch(/dg\.revoked_at IS NULL AND dg\.expires_at > now\(\)/);
    expect(body).toMatch(/pm\.expires_at IS NULL OR pm\.expires_at > now\(\)/);
  });

  it("neither new table has a write policy — absence of a policy IS the enforcement", () => {
    // D28: a deny-all policy beside an allow policy denies nothing, because
    // permissive policies OR. With NO write policy, RLS denies by default and the
    // RPCs are the only way in. Adding a "deny" policy here would be a regression
    // dressed as a safeguard.
    for (const table of ["project_members", "delegation_grants"]) {
      const writes = [...live().policies]
        .filter(([k, v]) => k.startsWith(`${table}::`) && !/FOR\s+SELECT/i.test(v.sql));
      expect(writes.map(([k]) => k), `${table} gained a write policy`).toEqual([]);
    }
  });

  it("the role ordering is written exactly once", () => {
    // Both the subtraction check and the capability gating read project_role_rank.
    // A second copy of the ordering is how "is this grant bigger than mine" starts
    // being answered two different ways (§2.1 single-source).
    const sql = readFileSync(
      join(ROOT, "supabase", "migrations", "20260915000005_project_membership_and_delegation.sql"), "utf8");
    expect((sql.match(/WHEN 'analyst'\s+THEN 2/g) ?? []).length).toBe(1);
  });
});

describe("the data_editing split", () => {
  it("TypeScript and the migration agree on both new keys", () => {
    const sql = readFileSync(
      join(ROOT, "supabase", "migrations", "20260915000005_project_membership_and_delegation.sql"), "utf8");
    for (const key of ["data_edit_inputs", "data_edit_policies"]) {
      expect(sql, `${key} is not seeded in SQL`).toMatch(new RegExp(`'${key}',\\s*'feature'`));
      expect(FEATURE_CAPABILITIES.map((c) => c.key), `${key} is missing from the TS catalog`).toContain(key);
    }
  });

  it("data_editing is KEPT — removing it would revoke access from every caller still asking", () => {
    // Eight call sites still name it. The DB seeds both new keys FROM it, so
    // effective access on deploy day is identical to the day before; the old key
    // goes when the last caller has moved, not before (same discipline as WP 2.1's
    // org text branch).
    expect(FEATURE_CAPABILITIES.map((c) => c.key)).toContain("data_editing");
  });

  it("an analyst may edit policies and NOT inputs — the whole point of splitting", () => {
    const sql = readFileSync(
      join(ROOT, "supabase", "migrations", "20260915000005_project_membership_and_delegation.sql"), "utf8");
    const seed = squash(sql.slice(sql.indexOf("INSERT INTO public.project_role_capabilities")));
    expect(seed).toMatch(/\('analyst',\s*'data_edit_inputs',\s*false\)/);
    expect(seed).toMatch(/\('analyst',\s*'data_edit_policies',\s*true\)/);
    expect(seed).toMatch(/\('viewer',\s*'data_edit_policies',\s*false\)/);
  });
});
