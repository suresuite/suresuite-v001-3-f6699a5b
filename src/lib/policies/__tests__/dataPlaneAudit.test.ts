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
  // WP 6.2 slices 11 + 12 · SIXTEEN → FOUR, AND THE FOUR ARE NOT DEBT.
  //
  // Slice 11 closed the three that already took `p_user_id` and never passed it
  // on (`20260918000002`). Slice 12 closed the nine that took no actor at all,
  // in ONE migration (`20260918000003`): `_actor_user_id uuid DEFAULT NULL`
  // appended, so every existing caller kept working unchanged, plus the eleven
  // client call sites that now pass it.
  //
  // WHAT IS LEFT IS NOT WORK, AND THAT IS THE WHOLE POINT OF KEEPING THE LIST:
  //
  //   · three attribute through `assert_writer_may_act` and are here only
  //     because a text scan cannot follow a call (VIA_SHARED_PREAMBLE);
  //   · one is a TRIGGER function (TRIGGER_FUNCTIONS).
  //
  // So the ratchet has become a GATE. `no NEW tier-2/3/4 writer may be added
  // without setting app.current_user_id` no longer tolerates a backlog, because
  // there is none.
  const UNATTRIBUTED = [
    "analysis_mark_critical_nodes", "create_default_policy_defaults",
    "etl_replace_supply_chain", "mrp_apply_staged_products",
    // WP 6.4 — describing the six decision tables brought SIX more writers into this
    // scan's scope, which is D54's lesson for the third time: a deferral hides a
    // table's WRITERS from every rule scoped to the contract. Five of the six took
    // the line in `20260919000007`; this is the sixth.
    "sync_disruption_to_sim_scenario",
  ];

  /**
   * `create_default_policy_defaults` CANNOT take the actor and does not need to.
   *
   * It `RETURNS trigger` and runs `FOR EACH ROW` on `projects`
   * (`20260609040000`). PostgreSQL REFUSES a trigger function with declared
   * arguments, so slice 12's change is not merely unnecessary for it — it is
   * impossible; the generator asserted on `RETURNS trigger` and stopped.
   *
   * Nor is it needed: a trigger fires INSIDE someone else's statement, so
   * `app.current_user_id` already holds whatever that statement established.
   * Naming the actor is the caller's job and never the trigger's.
   *
   * Slice 11 also called this one "reachable from nothing", which was wrong for
   * a related reason: the call-site counter looks for RPC names, and a trigger
   * is wired by `EXECUTE FUNCTION` rather than called by name.
   */
  /**
   * `sync_disruption_to_sim_scenario` joins it for the same reason, found the same
   * way. It `RETURNS trigger`, so PostgreSQL refuses it declared arguments, and it
   * fires inside someone else's statement where `app.current_user_id` already holds
   * whatever that statement established. The rule is not "a trigger is exempt" — it
   * is that naming the actor is the CALLER's job, and a trigger has no caller of its
   * own to take it from.
   */
  const TRIGGER_FUNCTIONS = new Set([
    "create_default_policy_defaults", "sync_disruption_to_sim_scenario",
  ]);

  const VIA_SHARED_PREAMBLE = new Set([
    "analysis_mark_critical_nodes", "etl_replace_supply_chain", "mrp_apply_staged_products",
  ]);

  /**
   * How many places the application can reach this RPC — `src/` and
   * `supabase/functions/`, excluding this test, the generated modules and the
   * agent eval harnesses, none of which is a caller a user can reach.
   *
   * IT COUNTS THE NAME AS A WHOLE STRING LITERAL, NOT `rpc('<name>')`, AND THE
   * FIRST DRAFT COUNTED THE LATTER. `useItemMasters.tsx` dispatches through
   * `sb.rpc(UPSERT_RPC[table], …)` against a lookup table whose VALUES are the
   * RPC names, so a `rpc(` regex reported `bulk_upsert_materials` and
   * `bulk_upsert_products` as having no caller at all while the upload path
   * calls both. A name in quotes is a call or a dispatch entry; a name in prose
   * or in backticks inside a comment is neither, and single/double quotes
   * separate the two without a parser.
   */
  const callSites = (name: string) => {
    const roots = [join(ROOT, "src"), join(ROOT, "supabase", "functions")];
    const re = new RegExp(`(['"])${name}\\1`);
    let n = 0;
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "__tests__" || e.name === "eval" || e.name === "generated") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
        for (const line of readFileSync(full, "utf8").split("\n")) if (re.test(line)) n++;
      }
    };
    for (const r of roots) walk(r);
    return n;
  };

  it("every function the ARTIFACT records is visible to this scan (D100)", () => {
    // THE SCAN CAN ONLY JUDGE WHAT IT CAN SEE, and for a year it could not see
    // five live functions. `live-sql.mjs` keys its function map by NAME and its
    // `DROP FUNCTION` branch deleted the name outright — so a DROP naming ONE
    // overload's signature removed every overload from the map.
    //
    // `create_disruption_scenario_v2` writes four tier-4 tables and was
    // invisible here; `get_network_nodes`, `_edges` and `_summary` were too.
    // Both `create_disruption_scenario_v2` overloads happen to attribute, so the
    // invariant did not move — but "happens to" is not a gate, and this is.
    //
    // `net.http_post` is excluded because it is not in `public`: the map is the
    // public surface, and a wrapper around a pg_net extension function is not
    // this contract's to describe.
    const art = JSON.parse(
      readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
    ) as { functions: { name: string }[] };
    const seen = live().functions;
    const missing = [...new Set(art.functions.map((f) => f.name))]
      .filter((n) => n !== "http_post")
      .filter((n) => !seen.has(n))
      .sort();
    expect(
      missing,
      "these functions exist in the introspected schema and are invisible to every " +
        "rule scoped to `liveDefinitions()` — the writer scan below included.",
    ).toEqual([]);
  });

  it("the overloaded names are known, and collapsing them is a STATED limit", () => {
    // The half of D100 that is NOT fixed: the map still holds one body per name,
    // so for an overloaded name a rule reads the last CREATE and no other. Nine
    // names carry more than one live overload. Pinned so the number cannot grow
    // quietly, and so a future rule that needs per-overload bodies has a count
    // to argue with rather than a comment claiming the repo never overloads.
    const art = JSON.parse(
      readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
    ) as { functions: { name: string }[] };
    const counts = new Map<string, number>();
    for (const f of art.functions) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
    const overloaded = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n).sort();
    expect(overloaded).toEqual([
      "analysis_mark_critical_nodes",
      "capabilities_for_user",
      "create_disruption_scenario_v2",
      "create_project",
      "get_project_dataset_status",
      // `get_supply_chain_data_multi_tier` stood here until WP 8.2. It had a
      // five-argument and a three-argument form projecting the SAME table, so
      // D134's fix would have landed in one and been false of the other under one
      // name — and a three-argument positional call raised `function … is not
      // unique`, which is how `rehearsal/310` found it. The duplicate is dropped;
      // THIS LIST MAY SHRINK AND MAY NOT GROW, so removing the name here is the
      // record of that (§4 D145's class).
      "refresh_node_list_for_project",
      "update_project",
      "update_project_completion_status",
    ]);
  });

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

  it("there is no remaining one-line or signature-change debt — the class is closed", () => {
    // §4 D71 carried a budget figure twice — "seventeen live", then "six" — and
    // both were wrong when slice 11 measured them (twelve of thirteen were
    // reachable). A number in prose goes stale the moment a caller moves and
    // nothing notices, which is the defect the two orphan tables were (D3, D4).
    //
    // It is now ZERO, and derived rather than remembered: every name left on the
    // list is either attributing through a shared preamble or a trigger
    // function, and both are justified above rather than owed.
    const owed = UNATTRIBUTED.filter(
      (n) => !VIA_SHARED_PREAMBLE.has(n) && !TRIGGER_FUNCTIONS.has(n),
    );
    expect(
      owed,
      `these SECURITY DEFINER writers still name no actor and have no reason not ` +
        `to. \`audit-actor\` (G4) is not met while this list is non-empty, and §4 ` +
        `D71 must state the same count.`,
    ).toEqual([]);
  });

  it("a name may only sit on the list for a REASON, not as a backlog", () => {
    // The list is no longer a ratchet, so the way it could rot is a future name
    // being parked on it. Every entry must be in one of the two justified
    // categories — which is the assertion above stated from the other side, and
    // it is what stops the next writer being added to the list instead of fixed.
    const unjustified = UNATTRIBUTED.filter(
      (n) => !VIA_SHARED_PREAMBLE.has(n) && !TRIGGER_FUNCTIONS.has(n),
    );
    expect(unjustified).toEqual([]);
    expect(
      [...VIA_SHARED_PREAMBLE, ...TRIGGER_FUNCTIONS].every((n) => UNATTRIBUTED.includes(n)),
      "a justification names a function that is no longer on the list — delete the justification too",
    ).toBe(true);
  });

  it("the trigger function is still a trigger function", () => {
    // Its exemption rests entirely on that. If it ever becomes an ordinary
    // SECURITY DEFINER RPC, it owes the actor like every other one.
    const def = fn("create_default_policy_defaults");
    expect(def, "create_default_policy_defaults is gone — remove it from TRIGGER_FUNCTIONS").toBeDefined();
    expect(
      /RETURNS\s+trigger/i.test(def!.sql),
      "it no longer RETURNS trigger, so the exemption above no longer applies",
    ).toBe(true);
  });

  it("the FOURTEEN that name their actor still do", () => {
    // `assign_material_supplier` (WP 3.3), `snapshot_dataset` (WP 4.1), the
    // three slice 11 closed and the nine slice 12 closed. A regression in any is
    // the invariant going backwards, and `supabase/rehearsal/200` and `/210`
    // prove them against a real database with the GUC poisoned first.
    for (const name of [
      "assign_material_supplier", "snapshot_dataset",
      "apply_policy_bundle", "assign_bom_line", "assign_outbound_customer",
      "bulk_upsert_materials", "bulk_upsert_policy_overrides", "bulk_upsert_products",
      "bulk_upsert_suppliers", "clear_policy_preset", "delete_policy_override",
      "ensure_item_masters", "restore_policy_version", "save_policy_defaults",
    ]) {
      expect(fn(name).sql, `${name} stopped setting the actor GUC`).toMatch(
        /set_config\s*\(\s*'app\.current_user_id'/i,
      );
    }
  });
});
