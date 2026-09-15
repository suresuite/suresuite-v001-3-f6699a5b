/**
 * D13 / D27 — ONE organization identity (Phase 2 / WP 2.1, PLAN.md §9).
 *
 * The platform carries two names for the same organization: a uuid
 * (`organizations.id`, copied to `projects.organization_id` and
 * `approved_users.organization_id`) and a free-text string (`projects.organization`,
 * `approved_users.organization`). RLS authorizes on the text one; the public /v1
 * API authorizes on the uuid one. A displayable name is being used as a join key,
 * which is `uuid-identity` (PLAN.md §2.1 G1) inverted.
 *
 * WHAT MAKES THIS TESTABLE WITHOUT A DATABASE. Every fact the suite reasons from is
 * READ OUT OF THE MIGRATIONS at run time — which policy the database actually has
 * (`live-sql.mjs` replays the log, because a policy is dropped and recreated across
 * many files and only the last one runs), which planes the predicate consults, and
 * what the product's own rename button does. Nothing about the schema is restated
 * here; a migration that changes any of it changes this suite's inputs, which is
 * the point. The one thing the suite MODELS rather than reads is Postgres's
 * evaluation of a boolean expression — and `evaluateAtoms` throws on any term it
 * does not recognise rather than guessing, so the model can never quietly widen.
 *
 * THE SCENARIO IS THE PRODUCT'S OWN. `admin_update_organization` is what the Rename
 * button in AdminOrganizations.tsx calls, and it updates `organizations.name` and
 * nothing else — no trigger, no cascade, no second UPDATE. The suite asserts that
 * too, so the scenario stays honest if the RPC ever starts propagating.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — .mjs helper shared with the data-contract scripts; no types.
import { liveDefinitions } from "../../../../scripts/data-contract/live-sql.mjs";
import { sameOrganization } from "../../../../supabase/functions/_shared/orgIdentity";
import type { OrgBearing } from "../../../../supabase/functions/_shared/orgIdentity";

const ROOT = join(__dirname, "..", "..", "..", "..");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

type LiveDef = { table?: string; name: string; migration: string; sql: string };
type Live = { policies: Map<string, LiveDef>; functions: Map<string, LiveDef> };

const live = (): Live => liveDefinitions() as Live;

/** The USING expression of a live policy, by "table::name". */
function usingOf(key: string): string {
  const def = live().policies.get(key);
  expect(def, `no live policy "${key}" — it was dropped, or renamed`).toBeDefined();
  const m = /\bUSING\s*\(/i.exec(def!.sql);
  expect(m, `policy "${key}" has no USING clause`).not.toBeNull();
  let depth = 0, i = m!.index + m![0].length - 1;
  const start = i;
  for (; i < def!.sql.length; i++) {
    if (def!.sql[i] === "(") depth++;
    else if (def!.sql[i] === ")" && --depth === 0) break;
  }
  return squash(def!.sql.slice(start + 1, i));
}

// ── the world ────────────────────────────────────────────────────────────────

type World = {
  org: { id: string; name: string; slug: string };
  /** the row in approved_users for the user whose session this is */
  user: { organization: string; organization_id: string | null };
  /** the row in projects being authorized */
  project: { organization: string; organization_id: string | null };
};

const ORG_UUID = "11111111-1111-1111-1111-111111111111";

const baseline = (): World => ({
  org: { id: ORG_UUID, name: "Acme", slug: "acme" },
  user: { organization: "Acme", organization_id: ORG_UUID },
  project: { organization: "Acme", organization_id: ORG_UUID },
});

/**
 * What the Rename button does, read from the RPC rather than assumed.
 * `admin_update_organization` updates `organizations.name`; the denormalized text
 * copies on `projects` and `approved_users` are left where they were.
 */
function renameOrganization(w: World, newName: string): World {
  return { ...w, org: { ...w.org, name: newName } };
}

/** A user approved into the org AFTER the rename gets the org's current name. */
function memberJoiningNow(w: World): World {
  return { ...w, user: { organization: w.org.name, organization_id: w.org.id } };
}

// ── evaluating a policy expression ───────────────────────────────────────────

/**
 * Which planes `org_is_current_user_org` consults, read from its own live body.
 * Absent (as it is before this work package) it consults neither.
 */
function predicatePlanes(): { uuid: boolean; text: boolean } {
  const fn = live().functions.get("org_is_current_user_org");
  if (!fn) return { uuid: false, text: false };
  const body = squash(fn.sql);
  return {
    uuid: /_org_id\s*=\s*public\.get_current_user_org_id\s*\(/.test(body),
    text: /_org_name\s*=\s*public\.get_current_user_org\(\)/.test(body),
  };
}

/** `get_current_user_org()` — the text function reads approved_users.organization. */
const currentUserOrgText = (w: World) => w.user.organization;
/** `get_current_user_org_id(_user_id)` — reads approved_users.organization_id. */
const currentUserOrgId = (w: World) => w.user.organization_id;

/**
 * Replace every atom this suite understands with TRUE/FALSE, then evaluate.
 * Anything left over throws: an expression the model cannot read is never
 * assumed to be permissive (the `loudFailure` discipline).
 */
function evaluateAtoms(expr: string, w: World, cols: "projects" | "organizations"): boolean {
  const planes = predicatePlanes();
  const dualRead = (id: string | null, text: string) =>
    (planes.uuid && id !== null && id === currentUserOrgId(w)) ||
    (planes.text && text === currentUserOrgText(w));

  const atoms: Array<[RegExp, boolean]> = cols === "projects"
    ? [
        [/public\.org_is_current_user_org\(\s*organization_id\s*,\s*organization\s*\)/gi,
          dualRead(w.project.organization_id, w.project.organization)],
        [/\borganization\s*=\s*(?:public\.)?get_current_user_org\(\)/gi,
          w.project.organization === currentUserOrgText(w)],
      ]
    : [
        [/\bid\s*=\s*public\.get_current_user_org_id\(\s*public\.get_current_user_id\(\)\s*\)/gi,
          w.org.id === currentUserOrgId(w)],
        [/\bname\s*=\s*(?:public\.)?get_current_user_org\(\)/gi,
          w.org.name === currentUserOrgText(w)],
        [/\bslug\s*=\s*(?:public\.)?get_current_user_org\(\)/gi,
          w.org.slug === currentUserOrgText(w)],
      ];

  let e = expr;
  for (const [re, value] of atoms) e = e.replace(re, value ? "TRUE" : "FALSE");

  // What is left must be a boolean expression over TRUE/FALSE.
  const leftover = e.replace(/\b(TRUE|FALSE|AND|OR|NOT)\b|[()\s]/gi, "");
  if (leftover !== "") {
    throw new Error(
      `evaluateAtoms cannot read "${leftover}" in: ${expr}\n` +
      `Add the term to this suite deliberately — do not let an unknown term ` +
      `evaluate as permissive.`,
    );
  }
  return Function(`"use strict";return(${e.replace(/\bAND\b/gi, "&&").replace(/\bOR\b/gi, "||").replace(/\bNOT\b/gi, "!").replace(/\bTRUE\b/g, "true").replace(/\bFALSE\b/g, "false")})`)();
}

const canSeeProject = (w: World) =>
  evaluateAtoms(usingOf("projects::Projects: org-wide view"), w, "projects");
const canSeeOwnOrgRow = (w: World) =>
  evaluateAtoms(usingOf("organizations::orgs: members read own"), w, "organizations");

// ── the suite ────────────────────────────────────────────────────────────────

describe("D13 — renaming an organization must not change who can see what", () => {
  it("the scenario is the product's: the Rename RPC updates organizations.name alone", () => {
    // If this fails, renameOrganization() above is modelling something the
    // product no longer does, and every assertion below is about a fiction.
    const fn = live().functions.get("admin_update_organization");
    expect(fn, "admin_update_organization no longer exists").toBeDefined();
    const updates = [...squash(fn!.sql).matchAll(/UPDATE\s+(?:public\.)?([a-z_]+)\s+SET\s+([^;]+?)\s+WHERE/gi)]
      .map((m) => `${m[1]}(${m[2]})`);
    expect(updates).toEqual(["organizations(name = btrim(p_name))"]);
  });

  it("baseline — a member sees their organization's project", () => {
    expect(canSeeProject(baseline())).toBe(true);
  });

  it("after the rename, a member joining the org can still see its projects", () => {
    // THE DEFECT. Rename 'Acme' to 'Acme Corp'. projects.organization still says
    // 'Acme' — nothing updates it. The next user approved into the org carries
    // the org's CURRENT name, so the text comparison can never match, and every
    // project in the org is invisible to them.
    const renamed = memberJoiningNow(renameOrganization(baseline(), "Acme Corp"));
    expect(renamed.user.organization).toBe("Acme Corp");
    expect(renamed.project.organization).toBe("Acme");   // the stale copy
    expect(renamed.project.organization_id).toBe(renamed.user.organization_id);
    expect(canSeeProject(renamed)).toBe(true);
  });

  it("after the rename, a member can still read their own organization row", () => {
    // The self-bridge: `name = get_current_user_org() OR slug = ...`. The rename
    // changes `name` and leaves the user's text copy alone, so the member loses
    // read on the very row the rename was performed against.
    expect(canSeeOwnOrgRow(renameOrganization(baseline(), "Acme Corp"))).toBe(true);
  });

  it("a member of another organization still sees nothing", () => {
    // The dual read must widen nothing. Same shape as above, different org.
    const other: World = {
      org: { id: ORG_UUID, name: "Acme", slug: "acme" },
      user: { organization: "Globex", organization_id: "22222222-2222-2222-2222-222222222222" },
      project: { organization: "Acme", organization_id: ORG_UUID },
    };
    expect(canSeeProject(other)).toBe(false);
    expect(canSeeOwnOrgRow(other)).toBe(false);
  });

  it("a project whose uuid never got stamped is still reachable by text (dual read)", () => {
    // D27's rows: organization_id IS NULL, organization correct. The text branch
    // is what keeps them visible, which is why this WP does not remove it.
    const w = baseline();
    w.project.organization_id = null;
    expect(canSeeProject(w)).toBe(true);
  });
});

describe("D27 — the two org planes must not diverge on insert", () => {
  it("set_project_defaults stamps organization_id, not only organization", () => {
    const fn = live().functions.get("set_project_defaults");
    expect(fn, "set_project_defaults no longer exists").toBeDefined();
    const body = squash(fn!.sql);
    expect(body, "the text plane is still stamped").toMatch(/NEW\.organization\s*:=/);
    expect(body, "D27: the uuid plane is never stamped, so every new project is NULL there")
      .toMatch(/NEW\.organization_id\s*:=/);
  });

  it("the uuid it stamps comes from the user, not from a name lookup", () => {
    // Resolving the text org back to a uuid would re-introduce the name as a join
    // key — the defect, one level down.
    const body = squash(live().functions.get("set_project_defaults")!.sql);
    expect(body).toMatch(/NEW\.organization_id\s*:=\s*public\.get_current_user_org_id\(/);
  });
});

describe("I1 single-source — the dual read is authored exactly once", () => {
  it("get_current_user_org_id takes the user id explicitly, like capabilities_for_user", () => {
    // capabilities_for_user() takes _user_id explicitly so it never depends on a
    // pooled session GUC. The new function must not undo that.
    const fn = live().functions.get("get_current_user_org_id");
    expect(fn, "get_current_user_org_id does not exist").toBeDefined();
    expect(squash(fn!.sql)).toMatch(/get_current_user_org_id\s*\(\s*_user_id\s+uuid\s*\)/i);
    expect(squash(fn!.sql), "it reads a session GUC instead of its argument")
      .not.toMatch(/current_setting\s*\(/);
  });

  it("no live policy or function compares a project's org text outside the predicate", () => {
    // The exit check, as a test: after this package the text branch survives in
    // exactly one place, so the follow-up that removes it edits one function.
    const { policies, functions } = live();
    const offenders: string[] = [];
    for (const [key, def] of [...policies, ...functions]) {
      if (def.name === "org_is_current_user_org") continue;
      for (const line of def.sql.split("\n")) {
        if (/\b(?:p|proj)\.organization\s*=\s*(?:public\.)?get_current_user_org\(\)/.test(line) ||
            /(?<![._a-z])organization\s*=\s*(?:public\.)?get_current_user_org\(\)/.test(line)) {
          offenders.push(`${key} — ${squash(line)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the migrations still define the text function — it is kept, not replaced", () => {
    // Dual read means BOTH. Dropping get_current_user_org() would strand every
    // row D27 left with a NULL uuid.
    expect(live().functions.get("get_current_user_org")).toBeDefined();
  });
});

describe("D13 in the edge-function plane — the service role has no RLS to fall back on", () => {
  it("sameOrganization() and the SQL predicate agree on every case", () => {
    // Two languages, one access rule. The SQL is
    //   COALESCE(_org_id = <caller's org id>, false) OR COALESCE(_org_name = <caller's org>, false)
    // and this table is that expression, evaluated both ways.
    const A = "aaaaaaaa-0000-0000-0000-000000000000";
    const B = "bbbbbbbb-0000-0000-0000-000000000000";
    const cases: Array<[OrgBearing, OrgBearing, boolean, string]> = [
      [{ organization_id: A, organization: "Acme" }, { organization_id: A, organization: "Acme" }, true, "both planes agree"],
      [{ organization_id: A, organization: "Acme Corp" }, { organization_id: A, organization: "Acme" }, true, "renamed: uuid carries it"],
      [{ organization_id: null, organization: "Acme" }, { organization_id: A, organization: "Acme" }, true, "un-backfilled: text carries it"],
      [{ organization_id: null, organization: "Acme" }, { organization_id: null, organization: "Acme" }, true, "neither backfilled"],
      [{ organization_id: B, organization: "Globex" }, { organization_id: A, organization: "Acme" }, false, "different tenant"],
      // THE CASE THAT PINS THE SEMANTICS, and it is an OR rather than a
      // uuid-first preference. `organizations.name` is NOT unique, so two real
      // tenants may share a display name, and the text branch then admits one
      // to the other. That is the PRE-EXISTING behaviour — the old check was
      // text-only — and WP 2.1 deliberately does not change it: reading the
      // uuid first would DENY where the old rule granted, which is a new way to
      // revoke access inside the package whose job is to stop revoking it. The
      // exposure closes when the text branch goes, once §15 verifies the
      // backfill (PLAN.md §16, WP 2.1 handoff). Flipping this to `false` is a
      // deliberate act, not a tidy-up.
      [{ organization_id: B, organization: "Acme" }, { organization_id: A, organization: "Acme" }, true, "name collision: text still admits (pre-existing)"],
      [{ organization_id: null, organization: "Globex" }, { organization_id: A, organization: "Acme" }, false, "different tenant, no uuid"],
      [{ organization_id: null, organization: null }, { organization_id: A, organization: "Acme" }, false, "nothing to match on"],
    ];
    for (const [a, b, expected, why] of cases) {
      expect(sameOrganization(a, b), why).toBe(expected);
      // the same row through the SQL predicate's own shape
      const sql =
        (a.organization_id != null && a.organization_id === b.organization_id) ||
        (a.organization != null && a.organization === b.organization);
      expect(sql, `SQL and TS disagree on: ${why}`).toBe(expected);
    }
  });

  it("no edge function compares an organization string directly any more", () => {
    // The plane `grep get_current_user_org()` cannot see. Both offenders ran as
    // the service role, which bypasses RLS — so their TypeScript comparison was
    // the entire authorization, and neither was recorded anywhere before WP 2.1.
    const dir = join(ROOT, "supabase", "functions");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "eval") walk(p); continue; }
        if (!e.name.endsWith(".ts") || p.endsWith("orgIdentity.ts")) continue;
        for (const line of readFileSync(p, "utf8").split("\n")) {
          if (/\.organization\s*(?:===|!==|==|!=)\s*[a-zA-Z_$][\w$]*\.organization\b/.test(line)) {
            offenders.push(`${p.slice(ROOT.length + 1)} — ${squash(line)}`);
          }
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
