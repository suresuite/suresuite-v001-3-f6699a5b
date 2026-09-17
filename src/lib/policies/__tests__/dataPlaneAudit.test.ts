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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — .mjs helper shared with the data-contract scripts; no types.
import { liveDefinitions } from "../../../../scripts/data-contract/live-sql.mjs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const MIGRATION = join(MIGRATIONS, "20260916000001_data_plane_audit.sql");

/**
 * EVERY migration, not just WP 2.3's.
 *
 * This used to read `20260916000001_data_plane_audit.sql` alone, and the
 * contradiction took one new table to surface: the suite's own heading says
 * coverage is asserted "from the CONTRACT'S OWN TIER MAP, not a list", and the
 * SQL it compared against was a list of one file. WP 3.0 adopted `customers`
 * (tier 2, D43) with its three triggers in the adoption migration — where they
 * belong, beside the CREATE TABLE — and all three tests here failed on a table
 * that is correctly audited.
 *
 * A trigger installed by a later migration is the normal case for every table
 * added after WP 2.3, so the source has to be the whole directory.
 */
const sql = () =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");

/** WP 2.3's own file, for the assertions that are about THAT migration. */
const auditMigration = () => readFileSync(MIGRATION, "utf8");
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
    expect(auditMigration()).toMatch(/ALTER TABLE IF EXISTS public\.admin_audit_logs RENAME TO audit_logs/);
    expect(sql(), "a second table would strand the old rows").not.toMatch(/CREATE TABLE[^;]*\baudit_logs\b/);
  });

  it("constrains plane to the three planes", () => {
    expect(squash(auditMigration())).toMatch(/CHECK \(plane IN \('admin','data','access'\)\)/);
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

/**
 * WP 4.1 — THE RATCHET, AND WHY IT IS A RATCHET RATHER THAN A GATE.
 *
 * D36 was scoped to SIX PostgREST writers, because that is where WP 2.3 looked.
 * WP 3.3 then found `assign_material_supplier` — a SECURITY DEFINER SQL function
 * that had taken the actor as a parameter all along and never told the trigger —
 * and D36's own evidence says it "was never in the list of six because nothing
 * had looked at it". WP 4.1 found a second, `snapshot_dataset`, the same way.
 *
 * So the gap check looked at the whole class, and the class is not six:
 *
 *     26 SECURITY DEFINER functions write a tier-2/3/4 table.
 *     TWO of them set `app.current_user_id`.
 *     SIXTEEN of the rest already TAKE an actor parameter.
 *     SEVENTEEN have at least one live caller in src/ or supabase/functions/.
 *
 * Every one is the one-line fix D36 correctly says is NOT one for a PostgREST
 * call — a SECURITY DEFINER function runs in a transaction it controls. It is
 * not this package's (§11 scopes WP 4.1 to D36's six) and the honest
 * consequence is stated in §16: **`audit-actor` (G4) is NOT met after WP 4.1.**
 * The data plane still records `actor_known: false` for most of what writes it.
 *
 * A gate would be red on arrival, which is unlandable, so this is a RATCHET:
 * the set of unattributed writers may SHRINK and may not GROW. A 27th fails
 * here, on the commit that adds it, which is the property the plan keeps
 * discovering it needs two months late.
 */
describe("the actor reaches the trigger — a ratchet on the class D36 was one slice of", () => {
  /**
   * Known, measured, and owned by WP 6.2. Shrinking this list is the work.
   *
   * WP 4.3 SHRANK IT BY TEN WITHOUT WRITING A LINE OF SQL, and that is a
   * correction rather than an achievement: the ten below all call
   * `set_current_user_context`, which has set `app.current_user_id` LOCAL since
   * 2025-08-20, and the scan above could not follow the call. They were never
   * unattributed. See the comment on `guc` — and §4 D71, corrected in the same
   * commit, because "26 write, TWO attribute" was this scan's reading and the
   * honest figures are 31 writers (four more tables are described now) of which
   * 15 attribute.
   *
   *   bulk_insert_bom_multi_level · bulk_insert_bom_single_level
   *   bulk_insert_inbound_logistics · bulk_insert_multi_tier_supply_chain
   *   bulk_insert_outbound_logistics · bulk_insert_tier2_suppliers
   *   bulk_insert_tier3_suppliers · combine_project_into_supply_chain
   *   delete_project · delete_project_dataset
   */
  const UNATTRIBUTED = [
    "analysis_mark_critical_nodes", "apply_policy_bundle", "assign_bom_line",
    "assign_outbound_customer",
    "bulk_upsert_materials", "bulk_upsert_policy_overrides", "bulk_upsert_products",
    "bulk_upsert_suppliers", "clear_policy_preset",
    "create_default_policy_defaults", "delete_policy_override",
    "ensure_item_masters", "etl_replace_supply_chain",
    "mrp_apply_staged_products", "restore_policy_version", "save_policy_defaults",
  ];

  /**
   * Three of the names above DO set the GUC — through
   * `assert_writer_may_act`, which WP 4.1 wrote so three RPCs share one
   * preamble instead of three copies of it. They stay on the list because a
   * text scan cannot follow a call, and quietly special-casing them here would
   * make the ratchet lie about its own method. The rehearsal is what proves
   * those three: `supabase/rehearsal/110` §7 performs each write and reads the
   * audit row back, with the GUC deliberately POISONED first so a row naming
   * the right actor can only have come from the RPC.
   */
  const VIA_SHARED_PREAMBLE = new Set([
    "analysis_mark_critical_nodes", "etl_replace_supply_chain", "mrp_apply_staged_products",
  ]);

  const writers = () => {
    const tier = new Set(tieredTables().map(([t]) => t));
    const out: Array<{ name: string; guc: boolean; actor: boolean }> = [];
    for (const [name, def] of live().functions) {
      const body = def.sql;
      if (!/SECURITY DEFINER/i.test(body)) continue;
      const writes = [...tier].some((t) =>
        new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${t}\\b`, "i").test(body),
      );
      if (!writes) continue;
      out.push({
        name,
        // WP 4.3 · `set_current_user_context` JOINS `assert_writer_may_act` HERE,
        // AND THE REASON IS A CORRECTION RATHER THAN AN ACCOMMODATION.
        //
        // Describing the four deep-tier tables (WP 4.3) brought five more
        // writers into the scan's scope — `bulk_insert_network_nodes`,
        // `..._edges`, `..._summary`, `rebuild_node_list`,
        // `upload_node_list_data` — and every one of them opens with
        // `PERFORM public.set_current_user_context(p_user_id, p_user_email)`,
        // whose body is `set_config('app.current_user_id', user_id::text, true)`
        // (`20250820165722`). They have named their actor since 2025-08-20. The
        // scan could not see it because a text scan cannot follow a call, which
        // is the same limitation `VIA_SHARED_PREAMBLE` was written for one
        // package earlier.
        //
        // SO D71's HEADLINE NUMBER OVER-COUNTS. "26 SECURITY DEFINER functions
        // write a tier-2/3/4 table and TWO set `app.current_user_id`" was
        // measured with this scan, and the second figure counts the two that set
        // the GUC IN THEIR OWN BODY rather than the ones that attribute. §4 D71
        // and §16 are corrected in the same commit.
        //
        // Special-casing a helper is only honest if something PROVES it, so
        // `supabase/rehearsal/130` §10 performs a `bulk_insert_network_nodes`
        // with `app.current_user_id` deliberately POISONED first and reads the
        // audit row back. Widening a scan without that is how a ratchet starts
        // lying about its own method.
        guc: /set_config\s*\(\s*'app\.current_user_id'/i.test(body)
          || /assert_writer_may_act/.test(body)
          || /set_current_user_context/.test(body),
        actor: /_actor|_user_id|p_user_id|_by_user/i.test(body),
      });
    }
    return out;
  };

  it("finds the writers at all — a scan that finds none is a green test that checks nothing", () => {
    expect(writers().length).toBeGreaterThanOrEqual(25);
  });

  it("no NEW tier-2/3/4 writer may be added without setting app.current_user_id", () => {
    const known = new Set(UNATTRIBUTED);
    const found = writers().filter((w) => !w.guc).map((w) => w.name).sort();
    const added = found.filter((n) => !known.has(n));
    expect(
      added,
      `these SECURITY DEFINER functions write a tier-2/3/4 table without setting ` +
        `app.current_user_id, so their audit rows will say actor_known: false. A ` +
        `SECURITY DEFINER function runs in a transaction it controls — unlike a ` +
        `PostgREST call (D36), one line closes it: ` +
        `PERFORM set_config('app.current_user_id', <actor>::text, true).`,
    ).toEqual([]);
  });

  it("the list shrinks honestly — a name that is now attributed must leave it", () => {
    // Otherwise the ratchet records a debt that is already paid and the next
    // reader budgets for work that does not exist.
    const found = new Set(writers().filter((w) => !w.guc).map((w) => w.name));
    const stale = UNATTRIBUTED.filter((n) => !found.has(n) && !VIA_SHARED_PREAMBLE.has(n));
    expect(stale, `no longer unattributed — remove from UNATTRIBUTED`).toEqual([]);
  });

  it("the two that DO name their actor still do", () => {
    // `assign_material_supplier` (WP 3.3) and `snapshot_dataset` (WP 4.1) are
    // the whole of the attributed SQL surface. A regression in either is the
    // invariant going backwards.
    for (const name of ["assign_material_supplier", "snapshot_dataset"]) {
      expect(fn(name).sql, `${name} stopped setting the actor GUC`).toMatch(
        /set_config\s*\(\s*'app\.current_user_id'/i,
      );
    }
  });
});
