/**
 * D15 — the data-plane audit (Phase 2 / WP 2.3, PLAN.md §9).
 *
 * `admin_audit_logs` recorded what a super admin did. Nothing recorded what anyone
 * else did to the data. The gap check measured it: 22 live SQL functions write
 * tier 2, 3 or 4 and NONE emitted an audit row, plus six more write paths in edge
 * functions running as the service role.
 *
 * The behaviour was verified by executing `20260916000001` against a real
 * PostgreSQL 16 and running the exit checks as SQL — 5,000 inserted rows producing
 * ONE audit row, the admin history surviving the rename, and an export being both
 * refused and recorded. That evidence is in §16. This suite guards what can rot
 * silently between such runs, and the first test is the one that matters most:
 * coverage is asserted from the CONTRACT'S OWN TIER MAP, so a tier 2/3/4 table
 * added later without triggers fails here rather than going unaudited.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — .mjs helper shared with the data-contract scripts; no types.
import { liveDefinitions } from "../../../../scripts/data-contract/live-sql.mjs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION = join(ROOT, "supabase", "migrations", "20260916000001_data_plane_audit.sql");
const sql = () => readFileSync(MIGRATION, "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

type LiveDef = { name: string; sql: string };
const live = () => liveDefinitions() as { policies: Map<string, LiveDef>; functions: Map<string, LiveDef> };
const fn = (name: string): LiveDef => {
  const d = live().functions.get(name);
  expect(d, `no live function ${name}()`).toBeDefined();
  return d!;
};

/** Every tier 2/3/4 table, from the generated contract rather than a list here. */
function tieredTables(): Array<[string, string]> {
  type ContractTable = { table?: string; name?: string; tier: string | number };
  const c = JSON.parse(readFileSync(join(ROOT, "build", "data-contract.generated.json"), "utf8")) as {
    tables: ContractTable[] | Record<string, ContractTable>;
  };
  const arr: ContractTable[] = Array.isArray(c.tables) ? c.tables : Object.values(c.tables);
  return arr
    .filter((t) => ["2", "3", "4"].includes(String(t.tier)))
    .map((t) => [(t.table ?? t.name) as string, String(t.tier)] as [string, string])
    .sort();
}

describe("coverage is complete by construction, not by a list", () => {
  it("every tier 2/3/4 table in the contract has insert, update and delete triggers", () => {
    // THE ASSERTION THIS SUITE EXISTS FOR. Reading the tier map from the contract
    // means a table promoted to tier 2 tomorrow, or a new one added, fails here
    // until it is audited — which is the difference between a rule and a list that
    // was accurate on the day somebody typed it.
    const src = sql();
    const missing: string[] = [];
    for (const [table, tier] of tieredTables()) {
      for (const op of ["insert", "update", "delete"]) {
        const re = new RegExp(
          `CREATE TRIGGER audit_${table}_${op}\\s+AFTER ${op}\\s+ON public\\.${table}\\b`, "i");
        if (!re.test(src)) missing.push(`${table} (tier ${tier}) — ${op}`);
      }
    }
    expect(missing, "tier 2/3/4 tables whose writes would go unaudited").toEqual([]);
  });

  it("names every tier correctly — the trigger argument is what lands in the row", () => {
    // The first version of this migration lost the tier argument to shell quoting
    // and every audit row recorded an empty tier. It passed every static check and
    // was caught only by reading rows out of a real database (§16).
    const src = sql();
    for (const [table, tier] of tieredTables()) {
      const block = src.slice(src.indexOf(`CREATE TRIGGER audit_${table}_insert`));
      expect(squash(block.slice(0, 300)), `${table} should be recorded as tier ${tier}`)
        .toContain(`audit_tier_write('${tier}')`);
    }
  });

  it("is STATEMENT-level with transition tables, never FOR EACH ROW", () => {
    // A row-level trigger on a bulk upload writes one audit row per uploaded lane.
    // An audit log nobody can read is the same as no audit log.
    const src = sql();
    expect(src).not.toMatch(/FOR EACH ROW\s+EXECUTE FUNCTION public\.audit_tier_write/i);
    const statements = src.match(/FOR EACH STATEMENT EXECUTE FUNCTION public\.audit_tier_write/gi) ?? [];
    expect(statements.length).toBe(tieredTables().length * 3);
    expect(src).toMatch(/REFERENCING NEW TABLE AS new_rows/);
    expect(src).toMatch(/REFERENCING OLD TABLE AS old_rows/);
  });
});

describe("the rename keeps the admin history", () => {
  it("renames the table rather than creating a second one", () => {
    // "admin history intact" is an exit check, and copying rows into a new table is
    // how history stops being intact.
    expect(sql()).toMatch(/ALTER TABLE IF EXISTS public\.admin_audit_logs RENAME TO audit_logs/);
    expect(sql(), "a second table would strand the old rows").not.toMatch(/CREATE TABLE[^;]*\baudit_logs\b/);
  });

  it("constrains plane to the three planes", () => {
    expect(squash(sql())).toMatch(/CHECK \(plane IN \('admin','data','access'\)\)/);
  });

  it("no application code reads the old table name any more", () => {
    // The compatibility VIEW exists for the deploy window, not as a permanent
    // alias: migrations, the frontend and the edge functions deploy on three
    // different schedules. Both call sites moved in the same change.
    for (const f of ["src/pages/admin/AdminAudit.tsx", "supabase/functions/api/index.ts"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} still queries admin_audit_logs`)
        .not.toMatch(/from\(\s*['"`]admin_audit_logs['"`]/);
    }
  });
});

describe("the emit functions keep their separate jobs", () => {
  it("log_data_action refuses the admin plane", () => {
    // Otherwise it would be a way around log_admin_action's super-admin check.
    const body = squash(fn("log_data_action").sql);
    expect(body).toMatch(/_plane NOT IN \('data','access'\)/);
    expect(body).toMatch(/RAISE EXCEPTION/);
  });

  it("log_data_action takes its actor explicitly and reads no session GUC", () => {
    const body = squash(fn("log_data_action").sql);
    expect(body).toMatch(/log_data_action\s*\(\s*_actor_user_id\s+uuid/i);
    expect(body).not.toMatch(/current_setting\s*\(/);
  });

  it("log_admin_action still requires a super admin — unchanged", () => {
    expect(squash(fn("log_admin_action").sql)).toMatch(/NOT public\.is_super_admin\(actor\)/);
  });

  it("audit_logs has no write policy", () => {
    const writes = [...live().policies]
      .filter(([k, v]) => k.startsWith("audit_logs::") && !/FOR\s+SELECT/i.test(v.sql));
    expect(writes.map(([k]) => k), "audit rows must not be client-writable").toEqual([]);
  });
});

describe("export is a governed action — the first check there has ever been", () => {
  it("record_export returns the decision instead of raising it away", () => {
    // THE BUG THIS ENCODES. The first version raised 42501 on a refusal, which
    // rolled back the audit row in the same transaction — refused, and no trace.
    // Postgres has no autonomous transactions, so the refusal is RETURNED and the
    // row commits. Re-introducing the RAISE would silently un-audit every refusal.
    const body = squash(fn("record_export").sql);
    expect(body).toMatch(/RETURNS jsonb/i);
    expect(body).toMatch(/'allowed',\s*v_allowed/);
    // the only RAISE left is the NULL-actor caller bug, never the capability decision
    const raises = body.match(/RAISE EXCEPTION [^;]*/gi) ?? [];
    expect(raises.length, `unexpected RAISE: ${raises.join(" | ")}`).toBe(1);
    expect(raises[0]).toMatch(/must name its actor/);
  });

  it("audits the refusal and the permission alike", () => {
    const body = squash(fn("record_export").sql);
    expect(body).toMatch(/'export\.allowed'/);
    expect(body).toMatch(/'export\.refused'/);
    // one emit call, chosen by CASE — not an audit on the happy path only
    expect((body.match(/public\.log_data_action\(/g) ?? []).length).toBe(1);
  });

  it("reads the capability project-scoped when a project is named", () => {
    // An export right on one project must not authorize another (WP 2.2).
    expect(squash(fn("record_export").sql))
      .toMatch(/capabilities_for_user\(_actor_user_id, _project_id\)/);
  });

  it("something in the product finally checks the export capability", () => {
    // Before WP 2.3 a repo-wide search found zero call sites for a capability that
    // had existed since 20260711000002.
    const viewer = readFileSync(join(ROOT, "src/components/ProjectDataViewer.tsx"), "utf8");
    expect(viewer, "the CSV download must ask first").toMatch(/rpc\(\s*['"`]record_export['"`]/);
    expect(viewer, "and must refuse when told no").toMatch(/allowed/);
  });
});
