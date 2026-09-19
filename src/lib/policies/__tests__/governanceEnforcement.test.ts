/**
 * WP 2.4 — what the contract CLAIMS versus what the database ENFORCES.
 *
 * Every sidecar declares a `governance` block: who may read, who may write, the
 * minimum project role. Until now nothing compared those claims to the policies
 * that actually exist, so the contract could say `write: super_admin` about a table
 * anyone could write and no gate would notice. This suite is that comparison,
 * generated from the sidecars and the introspected schema rather than written per
 * table — a table added tomorrow is covered the moment it has a sidecar.
 *
 * WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY. The honest finding of WP 2.4's
 * security review is that the database is BROADER than the contract reads (D28):
 * `anon` holds real grants, and unconditional `USING (true)` policies sit on tables
 * whose sidecars imply project scoping. The product depends on that — it runs AS
 * anon with no auth session — so closing it is a Phase 3 migration with an auth
 * model behind it, not a line in a test file. The decision taken was to DOCUMENT
 * rather than change.
 *
 * So these tests pin the CURRENT reality exactly. That is deliberate and it is the
 * opposite of accepting it: an exposure written down as an executable expectation
 * is one that cannot quietly grow, and every line below that reads "unconditional"
 * is a line a future package deletes when it closes D28. A test asserting the
 * intended state would fail today, be skipped by the third person who saw it, and
 * protect nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(__dirname, "..", "..", "..", "..");
const CONTRACT_DIR = join(ROOT, "supabase", "contract");

type Policy = { name: string; command: string; roles: string[]; using: string | null; with_check: string | null };
type Table = { name: string; rls: { enabled: boolean; determinate?: boolean; policies: Policy[] } };

function schema(): Map<string, Table> {
  const j = JSON.parse(readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"));
  const arr: Table[] = Array.isArray(j.tables) ? j.tables : Object.values(j.tables);
  return new Map(arr.map((t) => [t.name, t]));
}

function sidecars(): Array<{ table: string; governance: Record<string, unknown> }> {
  return readdirSync(CONTRACT_DIR)
    .filter((f) => f.endsWith(".contract.yaml"))
    .map((f) => parseYaml(readFileSync(join(CONTRACT_DIR, f), "utf8")))
    .sort((a, b) => a.table.localeCompare(b.table));
}

const unconditional = (p: Policy) =>
  /^\s*true\s*$/i.test(p.using ?? "") || /^\s*true\s*$/i.test(p.with_check ?? "");
const WRITE_CMDS = new Set(["ALL", "INSERT", "UPDATE", "DELETE"]);

describe("every described table's governance block is checked against real policies", () => {
  it("each sidecar names a table that exists and has RLS enabled or an honest note", () => {
    const S = schema();
    const problems: string[] = [];
    for (const doc of sidecars()) {
      const t = S.get(doc.table);
      if (!t) { problems.push(`${doc.table}: sidecar describes a table not in the schema`); continue; }
      const claimed = doc.governance?.rls_enabled;
      if (claimed === undefined) continue;          // validator already forbids claiming when indeterminate
      if (claimed !== t.rls.enabled) problems.push(`${doc.table}: claims rls_enabled=${claimed}, schema says ${t.rls.enabled}`);
    }
    expect(problems).toEqual([]);
  });

  it("a table claiming no user-facing write path has no UNCONDITIONAL write policy", () => {
    // READ THE FIELD CORRECTLY. `write: null` does not mean "no policy permits a
    // write" — `supply_chain_data` is written by the ETL through a project-scoped
    // policy and still declares `write: null`, because the field names the
    // CAPABILITY that gates a user-facing write and there is none (invariant I2:
    // pages never write tier 3). A scoped policy serving the service path is
    // consistent with that claim.
    //
    // What is NOT consistent is a policy with no predicate at all: that permits
    // any holder of the table grant to write, which is a user-facing write path
    // whether or not a page uses it. That is the version worth gating, and
    // `dataset_versions` fails it today — see §16's WP 2.4 entry.
    const S = schema();
    const offenders: string[] = [];
    for (const doc of sidecars()) {
      if (doc.governance?.write !== null) continue;
      for (const p of S.get(doc.table)?.rls?.policies ?? []) {
        if (unconditional(p) && WRITE_CMDS.has((p.command ?? "").toUpperCase())) {
          offenders.push(`${doc.table} :: "${p.name}" [${p.command}]`);
        }
      }
    }
    expect(
      offenders,
      "a table declaring no user-facing write path has a write policy with no " +
        "predicate. Either the policy should be scoped or the sidecar is wrong.",
    ).toEqual(["dataset_versions :: \"dataset_versions_insert_all\" [INSERT]"]);
  });
});

describe("D28 — the truth table of what is actually unconditional", () => {
  /**
   * PINNED, NOT APPROVED. Each entry is a table where a live policy grants access
   * with no predicate at all. The product depends on these today because it runs
   * as `anon`; the list exists so the exposure is visible and cannot grow without
   * this test failing. Shrinking it is the goal — a package that closes part of
   * D28 deletes lines from here, and the test tells it exactly which.
   *
   * THIS LIST READS THE MIGRATIONS, AND PRODUCTION HAD MORE — §4 D129 and D133.
   * §15 run `35467910110` counted 48 predicate-less policies over 30 tables where
   * this list named 27; part of that gap is simply policies no migration ever
   * declared, which nothing here could see. WP 7.1 stage 1a adopted five of them
   * (`20260919000010`), so the four names below are NEW TO THIS LIST AND NOT NEW TO
   * PRODUCTION — the exposure did not grow, the visibility did. They are:
   *
   *   customers  ·  materials  ·  products  ·  suppliers
   *
   * each an `anon` SELECT policy with `USING (true)` that has existed in production
   * for an unknown length of time and in no migration. `policy_versions` was already
   * named here for a different policy, so adopting its INSERT policy added no line.
   *
   * The remaining gap is still open: this list is only as complete as the migrations,
   * and nothing yet compares it against `pg_policies`. That comparison is stage 5's,
   * which is the stage that deletes these policies and therefore has to know which
   * ones the repository believes in (D133).
   */
  const EXPECTED_UNCONDITIONAL = [
    "ai_models", "ai_providers", "approved_users", "bom_multi_level", "bom_single_level",
    "capabilities", "chat_plans", "customers", "dataset_versions", "experiments",
    "external_evidence", "inbound_logistics", "materials", "model_validations",
    "outbound_logistics", "policy_defaults", "policy_overrides", "policy_presets",
    "policy_versions", "products", "project_memory", "project_role_capabilities",
    "proposals", "recovery_playbooks", "risk_data", "role_capabilities",
    "run_item_series", "run_replications", "scenarios", "simulation_runs", "suppliers",
  ];

  it("no table has gained an unconditional policy that this list does not name", () => {
    const S = schema();
    const found = new Set<string>();
    for (const t of S.values()) {
      for (const p of t.rls?.policies ?? []) if (unconditional(p)) found.add(t.name);
    }
    const added = [...found].filter((t) => !EXPECTED_UNCONDITIONAL.includes(t)).sort();
    expect(
      added,
      "a table gained a policy with no predicate. If that is intended, add it here " +
        "deliberately and say why in PLAN.md §16 — D28 is meant to shrink, not grow.",
    ).toEqual([]);
  });

  it("and every table this list names still has one — so the list shrinks honestly", () => {
    // The other direction matters as much: when a package closes part of D28 this
    // test tells it which name to delete, instead of the list quietly describing a
    // world that no longer exists.
    const S = schema();
    const stale = EXPECTED_UNCONDITIONAL.filter((name) => {
      const t = S.get(name);
      return t && !(t.rls?.policies ?? []).some(unconditional);
    });
    expect(stale, "these are no longer unconditional — remove them from the list").toEqual([]);
  });

  it("unconditional WRITE is the subset that matters most, and it is seven tables", () => {
    // Read-everything is a confidentiality problem. Write-everything is an
    // integrity one, and anon holds INSERT/UPDATE (and DELETE on scenarios) on
    // exactly these — see §16's WP 2.4 entry for the grant inventory.
    const S = schema();
    const writable = new Set<string>();
    for (const t of S.values()) {
      for (const p of t.rls?.policies ?? []) {
        if (unconditional(p) && WRITE_CMDS.has((p.command ?? "").toUpperCase())) writable.add(t.name);
      }
    }
    expect([...writable].sort()).toEqual([
      "dataset_versions", "experiments", "policy_versions", "run_item_series",
      "run_replications", "scenarios", "simulation_runs",
    ]);
  });
});

describe("the item masters — settled, not inherited", () => {
  it("the contract still records their RLS as INDETERMINATE, because a replay cannot read it", () => {
    // WP 2.4 settled the ANSWER by executing `20260614000001`'s FOREACH block on
    // PostgreSQL 16 (§16): RLS is ON, and both policies are `USING (true)`. The
    // introspector still cannot evaluate `EXECUTE format(...)`, so the artifact
    // correctly says it does not know — and that honesty is the thing under test.
    // Asserting `determinate: true` here would mean the introspector had started
    // guessing.
    const S = schema();
    for (const name of ["materials", "products", "suppliers"]) {
      expect(S.get(name)?.rls.determinate, `${name} should be recorded as indeterminate`).toBe(false);
    }
  });

  it("their sidecars do not claim an rls_enabled they cannot prove", () => {
    // The validator refuses the claim while the schema is indeterminate. This
    // pins that the sidecars have not quietly started asserting it.
    for (const doc of sidecars()) {
      if (!["materials", "products", "suppliers"].includes(doc.table)) continue;
      expect(doc.governance?.rls_enabled, `${doc.table} must not assert rls_enabled`).toBeUndefined();
    }
  });
});
