#!/usr/bin/env node
/**
 * PLAN.md §15 — the verification SQL, executed.
 *
 * WHY THIS FILE EXISTS. §15 says "run against one project before Phase 0 and
 * after each phase; record counts in §16". It had never been run when Phase 2
 * closed, because no work-package session can open a database connection — the
 * egress proxy denies CONNECT — and §15 is written as a psql script nobody in
 * this repo is positioned to paste anywhere. So §15 sat as prose through two
 * phases while four decisions accumulated behind it (§16 PHASE BOUNDARY).
 *
 * The route is the one §16's WP 2.1 follow-up and `seed-project.yml` already
 * prove: CI holds `SUPABASE_ACCESS_TOKEN`, and the Supabase Management API's
 * `/database/query` endpoint runs SQL against the live project. This script is
 * the §15 queries against that endpoint, and `verification-sql.yml` is the
 * dispatcher.
 *
 * READ-ONLY BY CONSTRUCTION, not by discipline. Every statement below is a
 * single `select`. There is no transaction to leave open, no DDL, and no
 * write path to get wrong — which matters because this is the one script in
 * the repo pointed at PRODUCTION DATA. `assertReadOnly()` refuses to send
 * anything whose first keyword is not `select` or `with`, so a later edit that
 * adds a write fails before it reaches the wire rather than after.
 *
 * WHAT IT PRINTS is counts and bounded samples, because counts are what §16
 * records and because a full dump of `material_id` spellings into a git branch
 * is a data export nobody asked for. Sample lists are capped at SAMPLE_CAP.
 *
 * Usage:  SUPABASE_ACCESS_TOKEN=… node scripts/data-contract/verification-sql.mjs [--project <uuid>] [--out report.md]
 */

import { readFileSync, writeFileSync } from "node:fs";

const SAMPLE_CAP = 8;
const API = "https://api.supabase.com/v1/projects";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const outPath = argOf("--out");
let forcedProject = argOf("--project");

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set — this script only runs in CI.");
  process.exit(2);
}

// The project ref is read from the client the app itself ships, so this script
// can never be pointed at a different project by an environment variable.
const clientTs = readFileSync(new URL("../../src/integrations/supabase/client.ts", import.meta.url), "utf8");
const ref = clientTs.match(/SUPABASE_URL\s*=\s*"https:\/\/([^.]+)\./)?.[1];
if (!ref) {
  console.error("could not read the project ref from src/integrations/supabase/client.ts");
  process.exit(2);
}

const lines = [];
const out = (...parts) => {
  // `table()` returns an ARRAY of lines, and the first version of this spread it
  // into `out(...)` against a single-parameter signature — which printed the
  // header and silently dropped every data row. A reporting script that loses
  // its own rows is the §5 T1 defect in miniature, so out() takes many.
  for (const s of parts.length ? parts : [""]) {
    lines.push(s);
    console.log(s);
  }
};

function assertReadOnly(sql) {
  const first = sql.replace(/^\s*(--[^\n]*\n|\s)+/g, "").slice(0, 12).trim().toLowerCase();
  if (!first.startsWith("select") && !first.startsWith("with")) {
    throw new Error(`refusing to send a non-SELECT statement: ${sql.slice(0, 80)}…`);
  }
}

let queryCount = 0;
async function q(sql) {
  assertReadOnly(sql);
  queryCount += 1;
  const res = await fetch(`${API}/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** Run a query that may reference a table production does not have. */
async function tryQ(sql) {
  try {
    return { rows: await q(sql) };
  } catch (err) {
    return { error: String(err.message ?? err) };
  }
}

const sample = (arr) => {
  const a = arr ?? [];
  return a.length <= SAMPLE_CAP ? a : [...a.slice(0, SAMPLE_CAP), `…+${a.length - SAMPLE_CAP} more`];
};

function table(rows, cols) {
  if (!rows || rows.length === 0) return ["  (no rows)"];
  const head = cols ?? Object.keys(rows[0]);
  const body = rows.map((r) => head.map((c) => String(r[c] ?? "")));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const fmt = (cells) => "  | " + cells.map((c, i) => c.padEnd(w[i])).join(" | ") + " |";
  return [fmt(head), "  |" + w.map((n) => "-".repeat(n + 2)).join("|") + "|", ...body.map(fmt)];
}

function section(title) {
  out("");
  out(`### ${title}`);
  out(`<!-- at ${new Date().toISOString()} -->`);
  out("");
}

function report(label, res, render) {
  if (res.error) {
    out(`- **${label}** — QUERY FAILED: \`${res.error.replace(/\n/g, " ").slice(0, 300)}\``);
    return null;
  }
  render(res.rows);
  return res.rows;
}

// THE PROBE IS NOW A GATE (D43). Anything pushed here makes the run exit
// non-zero, so `verification-sql.yml` goes red and the report still publishes.
// §15 is the only instrument in this repo that can see production; a finding it
// can only ever REPORT is a finding nothing enforces, which is how `customers`
// and `product_code_map` sat untracked long enough for R4 to lose sight of them.
const gateFailures = [];

// ── schema probe: what does production ACTUALLY have? (D32, D43) ───────────
// ── THE MIGRATION FENCE (D128) ──────────────────────────────────────────────
//
// §15 must not race a deploy, and the rule for that has always been a HABIT: do
// not put a probe in the same push as a migration. That habit is satisfiable on a
// feature branch and **unsatisfiable at the merge**, which is where both workflows
// actually fire — `supabase-migrations.yml` is `branches: [main]` and this workflow
// has no branch filter at all, so a branch that touched a migration AND one of the
// three §15 doors fires both on its merge commit, at the same second, by
// construction. Run `35466205199` is that: the report is stamped 20:03:28 and the
// seven migrations applied at 20:04:11–13, in the middle of its 74 statements.
//
// So the instrument detects it instead of the author remembering. `max(version)` of
// the migration ledger is read BEFORE the first probe and again AFTER the last one.
// If it moved, the database changed underneath the report and every count in it is of
// an unknown shape — which is a GATE FAILURE, not a footnote, because a number nobody
// can date is the thing this whole file exists to replace.
//
// Each `### ` heading also carries an HTML-comment timestamp, so a raced report can
// still be read: the sections before the deploy are of the old shape and those after
// are of the new one, and the boundary is visible rather than guessed.
let fenceBefore = null;

async function migrationFenceOpen() {
  const res = await tryQ(
    `select max(version) as version, count(*)::int as applied
       from supabase_migrations.schema_migrations`);
  fenceBefore = res.rows?.[0] ?? null;
  out(
    `- migration ledger at start: **${fenceBefore?.version ?? "unreadable"}** ` +
      `(${fenceBefore?.applied ?? "?"} applied)`,
  );
}

async function migrationFenceClose() {
  const res = await tryQ(
    `select max(version) as version, count(*)::int as applied
       from supabase_migrations.schema_migrations`);
  const after = res.rows?.[0] ?? null;
  section("The migration fence — did the database change under this report?");
  if (!fenceBefore || !after) {
    out("- **UNREADABLE.** `supabase_migrations.schema_migrations` could not be read at",
        "  one or both ends, so this run cannot say whether a deploy landed during it.");
    gateFailures.push(
      "the migration fence could not be read, so no count in this report can be " +
        "dated against the schema it describes (PLAN.md §4 D128).",
    );
    return;
  }
  const moved = String(fenceBefore.version) !== String(after.version) ||
    Number(fenceBefore.applied) !== Number(after.applied);
  out(`  | end | version | applied |`,
      `  |-----|---------|---------|`,
      `  | before | ${fenceBefore.version} | ${fenceBefore.applied} |`,
      `  | after  | ${after.version} | ${after.applied} |`);
  if (moved) {
    out(
      "- **A DEPLOY LANDED WHILE THIS REPORT WAS BEING WRITTEN.** The counts above",
      "  describe two different databases and the report cannot say which section got",
      "  which. Use the per-section timestamps against the deploy log to find the",
      "  boundary, then request a fresh run in a push that carries no migration.",
    );
    gateFailures.push(
      `the migration ledger moved from ${fenceBefore.version} to ${after.version} ` +
        `during this run (${fenceBefore.applied} → ${after.applied} applied): the report ` +
        `straddles a deploy and every count in it is of an unknown shape. Request a ` +
        `fresh run from a push carrying no migration (PLAN.md §4 D128).`,
    );
  } else {
    out(
      `- **Unmoved at \`${after.version}\`.** No migration was applied between the first`,
      "  probe and the last, so every count in this report is of one schema.",
    );
  }
}

async function schemaProbe() {
  section("Schema probe — production vs. the migrations (D32, D43)");

  const live = await q(`
    select table_name, table_type
    from information_schema.tables
    where table_schema = 'public'
    order by table_name`);
  const liveNames = new Set(live.map((r) => r.table_name));

  const art = JSON.parse(readFileSync(new URL("../../build/schema.introspected.json", import.meta.url), "utf8"));
  // `tables` is an ARRAY of records; `views` is an OBJECT keyed by name. Reading
  // both the same way made every table look missing AND every relation look
  // untracked — 76 and 78 on the first run, which is how this bug announced
  // itself: a divergence report whose two halves are both "everything".
  const artTables = (art.tables ?? []).map((t) => t.name);
  const artViews = Object.keys(art.views ?? {});

  const missingTables = artTables.filter((t) => !liveNames.has(t));
  const missingViews = artViews.filter((t) => !liveNames.has(t));
  const extra = [...liveNames].filter((t) => !artTables.includes(t) && !artViews.includes(t));

  out(`- migrations create **${artTables.length} tables** and **${artViews.length} views**; production's \`public\` schema holds **${live.length} relations**.`);
  out(`- **created by a migration, ABSENT from production: ${missingTables.length} tables, ${missingViews.length} views**`);
  if (missingTables.length) out(...table(missingTables.map((t) => ({ missing_table: t }))));
  if (missingViews.length) out(...table(missingViews.map((t) => ({ missing_view: t }))));
  out(`- **present in production, created by NO migration: ${extra.length}**`);
  if (extra.length) {
    // The shape, not just the name. Adopting a relation means writing a
    // `CREATE TABLE IF NOT EXISTS` that matches what is already there (WP 1.4's
    // `risk_data` pattern), and that cannot be written from a name alone — the
    // reason D43 sat open is that nobody could see the columns from a session.
    for (const name of extra) {
      const cols = await tryQ(`
        select column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public' and table_name = '${name}'
        order by ordinal_position`);
      const n = await tryQ(`select count(*)::int as rows from public.${name}`);
      const kind = live.find((r) => r.table_name === name)?.table_type ?? "?";
      out("");
      out(`**\`${name}\`** — ${kind}, **${n.rows?.[0]?.rows ?? "?"} rows**`);
      report(`${name} columns`, cols, (rows) => out(...table(rows)));
    }
    gateFailures.push(
      `${extra.length} relation(s) exist in production that no migration creates: ` +
        `${extra.join(", ")}. Adopt each with a CREATE TABLE IF NOT EXISTS migration ` +
        `(WP 1.4's risk_data is the pattern) or drop it. PLAN.md §4 D43.`,
    );
  }

  return liveNames;
}

// ── D38: the declared exception, asked of PRODUCTION rather than of a rehearsal
//
// The Supabase database linter reports `v_admin_user_usage` as
// `security_definer_view`, ERROR, EXTERNAL — and it is RIGHT that the view runs
// as its owner. That is the one declared exception to D38: `approved_users` is
// REVOKEd from `authenticated` (20250826015629), so `security_invoker = true`
// raises "permission denied" for every reader including the super admins whose
// two pages are its only consumers. `20260916000009` proved that by executing it.
//
// The exception is safe for exactly one reason: the view states its own
// authorization, `WHERE public.current_is_super_admin()`, the same predicate
// `ai_usage_logs`'s own policy enforces. Without that line an owner-run view
// hands every user's month-to-date AI SPEND to anyone who can select from it.
//
// WHAT WAS MISSING IS THE HALF §15 EXISTS FOR. `supabase/rehearsal/030` asserts
// both clauses — no seventh owner-view, and this one keeps its predicate — but
// against a database built from the migrations ON THE BRANCH. Nothing had ever
// asked PRODUCTION. The schema probe above compares relation NAMES, so a view
// that exists under the right name with the wrong `reloptions`, or one replaced
// from the SQL editor, is invisible to it. That is D45's lesson with a different
// object in it: WP 2.3 claimed the data-plane audit worked on the strength of a
// migration that landed, and §15 found zero rows. This is the same claim about
// views, made against the database the linter is actually looking at.
//
// A GATE, not a report (D43): either half failing is a live disclosure of
// per-person cost data, which is not a finding to read in a branch later.
async function viewSecurity() {
  section("D38 — every view runs as its caller, or is the declared exception");

  // `pg_options_to_table` yields (option_name, option_value); a view with no
  // reloptions at all yields no row, which is `security_invoker` OFF — Postgres
  // defaults it off, which is the whole of why D38 was a class rather than a bug.
  const res = await tryQ(`
    select c.relname as view_name,
           coalesce((select o.option_value = 'true'
                       from pg_options_to_table(c.reloptions) o
                      where o.option_name = 'security_invoker'), false) as security_invoker,
           pg_get_viewdef(c.oid, true) like '%current_is_super_admin()%' as states_own_rule
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
    order by c.relname`);

  if (res.error) {
    out(`- **view security** — QUERY FAILED: \`${res.error.replace(/\n/g, " ").slice(0, 300)}\``);
    gateFailures.push(
      "the D38 view-security probe could not run, so nothing in this repository " +
        "has checked production's views. PLAN.md §4 D38.",
    );
    return;
  }

  // The Management API renders a boolean as JSON `true` on some paths and as the
  // string `"t"`/`"true"` on others; reading only one of the two would report
  // every view as owner-run and fail this gate on all seven.
  const truthy = (v) => v === true || v === "t" || v === "true";
  const rows = res.rows.map((r) => ({
    view_name: r.view_name,
    security_invoker: truthy(r.security_invoker),
    states_own_rule: truthy(r.states_own_rule),
  }));

  out(`- production's \`public\` schema holds **${rows.length} view${rows.length === 1 ? "" : "s"}**.`);
  out(...table(rows.map((r) => ({
    view: r.view_name,
    runs_as: r.security_invoker ? "caller" : "OWNER",
    states_own_rule: r.states_own_rule ? "yes" : "—",
  }))));

  const EXCEPTION = "v_admin_user_usage";

  // 1 · a SEVENTH owner-view. The rehearsal fails on this against the branch;
  //     this fails on it against the database, which is where a view created
  //     outside a migration actually appears.
  const ownerRun = rows.filter((r) => !r.security_invoker && r.view_name !== EXCEPTION);
  if (ownerRun.length) {
    gateFailures.push(
      `${ownerRun.length} view(s) in production run as their OWNER and bypass their ` +
        `base tables' RLS: ${ownerRun.map((r) => r.view_name).join(", ")}. Set ` +
        `security_invoker = true in a migration, or — if the view cannot take it — ` +
        `give it its own authorization predicate and declare it the way ` +
        `20260916000009 declares v_admin_user_usage. PLAN.md §4 D38.`,
    );
  }

  // 2 · the exception without the thing that makes it one.
  const exc = rows.find((r) => r.view_name === EXCEPTION);
  if (!exc) {
    out(`- \`${EXCEPTION}\` is ABSENT from production — the schema probe above should already have failed this run.`);
  } else if (!exc.security_invoker && !exc.states_own_rule) {
    gateFailures.push(
      `${EXCEPTION} runs as its OWNER in production and its definition does NOT ` +
        `contain current_is_super_admin(). An owner-run view with no predicate of ` +
        `its own returns every user's month-to-date AI requests, tokens and ` +
        `cost_usd to any reader who can select from it — the disclosure ` +
        `20260916000009 closed. Restore the WHERE clause. PLAN.md §4 D38.`,
    );
  } else if (exc.security_invoker) {
    // Not a disclosure — the opposite failure, and it takes the admin area down
    // rather than leaking from it. A gate because both admin pages break.
    gateFailures.push(
      `${EXCEPTION} carries security_invoker = true in production. approved_users ` +
        `is REVOKEd from authenticated (20250826015629), so this view now raises ` +
        `"permission denied for table approved_users" for EVERY reader — ` +
        `AdminDashboard and AdminUsers are both broken. PLAN.md §4 D38.`,
    );
  } else {
    out(`- \`${EXCEPTION}\` runs as its owner AND states its own rule — the declared exception is intact in production.`);
  }
}

// ── D30: which of the two migrations actually ran? ─────────────────────────
//
// `20250913085427` creates the view/modify policy pair on `simulation_cache`,
// `simulation_jobs` and `simulation_performance_metrics`; `20250914113723`
// creates all six AGAIN, verbatim apart from `public.` qualification, and
// neither drops first. `CREATE POLICY` on an existing name raises 42710, so
// exactly one of two things is true and NO STATIC REPLAY CAN SAY WHICH: either
// the earlier file never took effect, or the later one aborted at its first
// duplicate and every statement after it never ran.
//
// It is decidable, and it does not need a `db push` to decide it. The two files
// end with DIFFERENTLY NAMED triggers — `20250913085427` writes
// `simulation_jobs_defaults` / `simulation_job_timing_trigger` and the function
// `cleanup_simulation_cache()`; `20250914113723` writes
// `set_simulation_jobs_defaults` / `update_simulation_job_timing`. Whichever
// set production holds is the file that ran past its policy block.
async function d30() {
  section("D30 — which of the two duplicate-policy migrations ran");

  const trigs = await tryQ(`
    select t.tgname as trigger_name, c.relname as on_table
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal
      and t.tgname in (
        'simulation_jobs_defaults','simulation_cache_defaults',
        'simulation_performance_metrics_defaults','simulation_job_timing_trigger',
        'set_simulation_jobs_defaults','set_simulation_cache_defaults',
        'set_simulation_performance_metrics_defaults','update_simulation_job_timing')
    order by 1`);
  report("the triggers each file would have left behind", trigs, (rows) => {
    const names = new Set(rows.map((r) => r.trigger_name));
    const early = ['simulation_jobs_defaults', 'simulation_cache_defaults',
      'simulation_performance_metrics_defaults', 'simulation_job_timing_trigger']
      .filter((n) => names.has(n));
    const late = ['set_simulation_jobs_defaults', 'set_simulation_cache_defaults',
      'set_simulation_performance_metrics_defaults', 'update_simulation_job_timing']
      .filter((n) => names.has(n));
    out(...table(rows));
    out(`- from \`20250913085427\`: **${early.length} of 4**; from \`20250914113723\`: **${late.length} of 4**.`);
    if (early.length === 4 && late.length === 0)
      out("- **SETTLED: `20250913085427` ran to completion and `20250914113723` ABORTED at its first duplicate `CREATE POLICY` (42710).** Everything after statement 155 of the later file — two functions and four triggers — never reached production. What the tables have is the EARLIER file's set.");
    else if (late.length === 4 && early.length === 0)
      out("- **SETTLED the other way: `20250914113723` ran and `20250913085427` did not**, so the earlier file's policy block never took effect and the later one found nothing to collide with.");
    else if (early.length === 4 && late.length === 4)
      out("- **BOTH ran.** That is only possible if something dropped the six policies between them; look for it before assuming either file is safe to re-run.");
    else
      out("- **Neither pattern is clean.** Record the exact set above in §16 rather than inferring; a partial set means a third migration has been at these objects.");
  });

  const fns = await tryQ(`
    select p.proname as function_name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('cleanup_simulation_cache','set_simulation_tables_defaults','update_simulation_job_timing')
    order by 1`);
  report("and the functions", fns, (rows) => out(...table(rows)));

  // D44/D45 · the remediation's own audit row, read back out of production.
  // The `db push` log drops RAISE NOTICE (§16 · WP 2.1 follow-up), so the
  // counts the migration printed are invisible — but it wrote them into the
  // audit row on purpose, which is what an audit row is for. This is also the
  // first `plane='data'` row production has ever been asked to show.
  const remediation = await tryQ(`
    select created_at, action, target_type,
           before ->> 'rows_carrying_zero'  as rows_carrying_zero,
           before ->> 'distinct_targets'    as distinct_targets,
           after  ->> 'keys_removed'        as keys_removed,
           after  ->> 'rows_deleted_empty'  as rows_deleted_empty,
           after  ->> 'rows_still_zero'     as rows_still_zero,
           after  ->> 'actor_known'         as actor_known
    from public.audit_logs
    where plane = 'data' and action = 'remediate'
      and after ->> 'defect' = 'D1 via D44'
    order by created_at desc limit 5`);
  report("D44's remediation, as the audit log recorded it", remediation, (rows) => {
    out("");
    out("**D44 · what the unseed actually did**, read back from the audit row rather than from a NOTICE the `db push` log discards:");
    out(...table(rows));
    const r = rows[0];
    if (r) out(`- \`rows_deleted_empty = ${r.rows_deleted_empty}\` is the number that judges the SHAPE of the fix: every row it did NOT delete is a row a row-level \`DELETE\` would have taken, along with whatever else its patch held.`);
  });

  const planeRows = await tryQ(`
    select plane, count(*)::int as rows, min(created_at)::text as first_row
    from public.audit_logs group by 1 order by 1`);
  report("audit_logs by plane", planeRows, (rows) => {
    out("");
    out("**D45 · the data plane, in production** — 18 rows and all of them `admin` was the measurement that opened D45:");
    out(...table(rows));
  });

  const dupes = await tryQ(`
    select schemaname, tablename, policyname, count(*)::int as copies
    from pg_policies group by 1,2,3 having count(*) > 1 order by 4 desc`);
  report("duplicate policy names anywhere in the database", dupes, (rows) => {
    out(rows.length
      ? `- **${rows.length}** policy name(s) exist more than once on the same table — Postgres does not permit this, so read the query, not the database.`
      : "- No policy name is duplicated. WP 2.1's drop-and-recreate left one of each, which is the END STATE D30 says was already deterministic.");
    if (rows.length) out(...table(rows));
  });
}

// ── WP 3.1: the ingestion tables, after the rename ─────────────────────────
//
// The schema probe above already fails the run if `ingest_runs` and friends are
// missing from production, which is the rename's structural proof. This is the
// other half: a rename moves ROWS, and nothing in the repository can see whether
// any arrived. It also answers a question WP 3.1 could not: how much connector
// traffic production has ever had, which is what makes the "MRP behaviour must
// not change" exit check worth what it costs.
async function ingestTables() {
  section("WP 3.1 — the ingestion tables, after the rename");

  const counts = await tryQ(`
    select (select count(*) from public.ingest_runs)::int              as runs,
           (select count(*) from public.ingest_runs
             where source_kind = 'orbit-mrp')::int                     as runs_connector,
           (select count(*) from public.ingest_runs
             where link_id is null)::int                               as runs_without_link,
           (select count(*) from public.ingest_runs
             where project_id is null)::int                            as runs_without_project,
           (select count(*) from public.ingest_staged_products)::int    as staged_products,
           (select count(*) from public.ingest_staged_bom_versions)::int as staged_bom_versions,
           (select count(*) from public.ingest_staged_bom_lines)::int   as staged_bom_lines,
           (select count(*) from public.ingest_files)::int              as landed_files,
           (select count(*) from public.project_erp_links)::int         as links`);
  report("row counts under the new names", counts, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    if (Number(r.runs_without_project) > 0) {
      out(`- **${r.runs_without_project} run(s) carry no \`project_id\`**, which the NOT NULL should have made impossible. Read the migration before anything else.`);
    }
    if (Number(r.runs) === 0) {
      out("- The connector has never run in production. The rename therefore moved an EMPTY table, and `supabase/rehearsal/050` — which runs against rows — is the only evidence that the path still works. That is the right way round, and it is why the assertion exists.");
    }
  });

  // WP 3.2 — the CSV path's own tables. Production had never run an ingestion of
  // any kind when this was written (§16 · WP 3.1), so the first non-zero here is
  // the first row `ingest_files` or `ingest_staged_rows` has ever held, and it is
  // the only corroboration the landing will ever get that is not a rehearsal.
  section("WP 3.2 — the CSV landing, and whether it has ever run");
  const csv = await tryQ(`
    select (select count(*) from public.ingest_runs
             where source_kind = 'csv')::int                            as csv_runs,
           (select count(*) from public.ingest_runs
             where source_kind = 'csv' and status = 'applied')::int     as csv_runs_applied,
           (select count(*) from public.ingest_staged_rows)::int         as staged_rows,
           (select count(*) from public.ingest_staged_rows
             where findings @> '[{"level": "error"}]'::jsonb)::int       as staged_rows_rejected,
           (select count(*) from public.ingest_files
             where source_kind = 'csv')::int                            as csv_files,
           (select count(*) from public.audit_logs
             where action = 'ingest_file_landed')::int                   as landing_audit_rows`);
  report("the CSV path", csv, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    if (Number(r.csv_runs) === 0) {
      out("- **No CSV has been uploaded through `ingest-file` yet.** Every claim WP 3.2 makes rests on `supabase/rehearsal/070`. Do not read an empty staging table as evidence that anything works (§16 · WP 3.1).");
    } else if (Number(r.landing_audit_rows) !== Number(r.csv_files)) {
      out(`- **${r.csv_files} landed CSV file(s) but ${r.landing_audit_rows} landing audit row(s)** — they are written in the same transaction, so a difference means something writes \`ingest_files\` outside \`ingest_land_file\`. That is invariant \`audit-actor\` failing, not a counting quirk.`);
    }
    if (Number(r.staged_rows_rejected) > 0) {
      out(`- ${r.staged_rows_rejected} staged row(s) carry an \`error\` finding and were never promoted. That is the feature, not a fault — each one is a row the old parser would have written to tier 2 as a null.`);
    }
  });

  // ── WP 3.4 ────────────────────────────────────────────────────────────────
  //
  // THREE THINGS §15 HAS BEEN ASSERTING WITHOUT MEASURING. §16 · WP 3.3 · L
  // says "`ingest_run_id` is NULL on all 1 691 surviving arcs" — true, and it
  // was read off the absence of runs rather than off the columns. The same for
  // `diff_state`: the claim that every staged row says `new` was a reading of
  // the DDL, and the staging table was empty, so neither number had ever come
  // back from the database that holds it.
  section("WP 3.4 — provenance on tier 2, and what `diff_state` actually holds");

  const prov = await tryQ(`
    select t.tbl,
           t.total,
           t.with_run,
           t.with_row
      from (
        select 'inbound_logistics'::text as tbl, count(*)::int as total,
               count(ingest_run_id)::int as with_run, count(source_row_id)::int as with_row
          from public.inbound_logistics
        union all select 'outbound_logistics', count(*)::int, count(ingest_run_id)::int, count(source_row_id)::int from public.outbound_logistics
        union all select 'bom_single_level',   count(*)::int, count(ingest_run_id)::int, count(source_row_id)::int from public.bom_single_level
        union all select 'bom_multi_level',    count(*)::int, count(ingest_run_id)::int, count(source_row_id)::int from public.bom_multi_level
        union all select 'materials',          count(*)::int, count(ingest_run_id)::int, count(source_row_id)::int from public.materials
        union all select 'products',           count(*)::int, count(ingest_run_id)::int, count(source_row_id)::int from public.products
        union all select 'suppliers',          count(*)::int, count(ingest_run_id)::int, count(source_row_id)::int from public.suppliers
      ) t
     order by t.tbl`);
  report("tier-2 rows that can name the line they came from (A4)", prov, (rows) => {
    out(...table(rows));
    const traced = rows.reduce((a, r) => a + Number(r.with_row || 0), 0);
    const total = rows.reduce((a, r) => a + Number(r.total || 0), 0);
    out(
      `- **${traced} of ${total} canonical rows trace to a source line.** A NULL means the ` +
        "provenance is UNKNOWN, never that there was none: both columns are `ON DELETE SET " +
        "NULL`, and every row predating the CSV landing path carries neither because the " +
        "files were never stored. Nothing can backfill it.",
    );
  });

  const diffs = await tryQ(`
    select coalesce(diff_state, '(not computed)') as diff_state, count(*)::int as rows
      from public.ingest_staged_rows group by 1 order by 2 desc`);
  report("`diff_state`, as the rows actually hold it (D62)", diffs, (rows) => {
    if (!rows.length) {
      out("- No staged row exists, so the column holds nothing. The claim that WP 3.3 left every row saying `new` is about the DDL, not about data — there is none.");
      return;
    }
    out(...table(rows));
  });

  const runCounts = await tryQ(`
    select r.id, r.source_kind, r.status,
           (select count(*)::int from public.ingest_staged_rows s where s.ingest_run_id = r.id) as staged,
           r.rows_new, r.rows_changed, r.rows_unchanged, r.rows_superseded, r.rows_held, r.rows_removed
      from public.ingest_runs r
     where exists (select 1 from public.ingest_staged_rows s where s.ingest_run_id = r.id)
     order by r.created_at desc
     limit 25`);
  report("do a run's five counts add up to the rows it staged?", runCounts, (rows) => {
    if (!rows.length) {
      out("- No run stages `ingest_staged_rows`. The partition the review screen renders has never been exercised on real data.");
      return;
    }
    out(...table(rows));
    const bad = rows.filter(
      (r) =>
        Number(r.rows_new) + Number(r.rows_changed) + Number(r.rows_unchanged) +
          Number(r.rows_superseded) + Number(r.rows_held) !== Number(r.staged),
    );
    out(
      bad.length
        ? `- **${bad.length} run(s) whose counts do not account for every staged row.** The review screen says so where it renders them, and this is the same check against production.`
        : "- Every run's five counts partition its staged rows exactly.",
    );
  });

  // D61 — the number this package CHANGES in production, so it needs a before.
  const members = await tryQ(`
    select (select count(*)::int from public.projects)                              as projects,
           (select count(*)::int from public.projects p
             where not exists (select 1 from public.project_members m where m.project_id = p.id))
                                                                                    as projects_with_no_member,
           (select count(*)::int from public.projects p
             where p.modeler_id is not null
               and exists (select 1 from public.approved_users au where au.id = p.modeler_id)
               and not exists (select 1 from public.project_members m
                                where m.project_id = p.id and m.user_id = p.modeler_id))
                                                                                    as modeler_not_a_member,
           (select count(*)::int from public.project_members)                       as memberships`);
  report("D61 — can a project's own creator promote into it?", members, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    out(
      Number(r.modeler_not_a_member) > 0
        ? `- **${r.modeler_not_a_member} project(s) whose modeler holds no membership row**, so \`effective_project_role\` returns NULL for them and the WP 3.4 promotion gate refuses them. WP 2.2's backfill ran once and left no writer; WP 3.4's trigger is the writer.`
        : "- Every project's modeler is a member of it. The role gate resolves for the person who created the project, which is the precondition WP 3.4's exit check stands on.",
    );
  });
}

// ── WP 4.1: the graph_hash blast radius, measured before the bump ──────────
// `schema_version` is not a local change. `current_graph_hash` wraps
// `_build_dataset_snapshot`, is granted to `anon`, and the readers below do
// more than display: `expire_agent_proposals` WRITES `status='expired'` with
// `status_reason='grounding_drift'` on the next read after the deploy, and
// nothing un-expires a proposal when the hash comes back. So the bump's cost
// is a number, and this is where the number comes from. Run BEFORE the
// migration and again after.
async function graphHashBlastRadius() {
  section("WP 4.1 — what the `schema_version` bump costs, counted before it happens");

  const versions = await tryQ(`
    select (select count(*)::int from public.dataset_versions)                        as dataset_versions,
           (select count(distinct project_id)::int from public.dataset_versions)      as projects_with_a_version,
           (select count(distinct graph_hash)::int from public.dataset_versions)      as distinct_graph_hashes,
           (select count(*)::int from public.projects)                                as projects`);
  report("`dataset_versions` — what exists to be re-hashed", versions, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    out(
      `- Every one of these ${r.dataset_versions ?? "?"} rows is IMMUTABLE and keeps its stored ` +
        "`snapshot` and `graph_hash`. The bump does not rewrite them; it means the NEXT " +
        "`snapshot_dataset` call inserts a new version instead of deduping against the latest, " +
        "which is the intended behaviour and not the cost. The cost is below.",
    );
  });

  const runs = await tryQ(`
    select (select count(*)::int from public.simulation_runs)                                as runs,
           (select count(*)::int from public.simulation_runs where dataset_version_id is not null) as runs_bound_to_a_version,
           (select count(*)::int from public.simulation_runs where graph_hash is not null)   as runs_with_a_graph_hash,
           (select count(*)::int from public.simulation_runs r
              where r.dataset_version_id is not null
                and not exists (select 1 from public.dataset_versions v where v.id = r.dataset_version_id))
                                                                                            as runs_whose_version_is_gone`);
  report("§11 exit check — do existing runs still resolve their `dataset_version_id`?", runs, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    out(
      Number(r.runs_whose_version_is_gone) > 0
        ? `- **${r.runs_whose_version_is_gone} run(s) point at a \`dataset_versions\` row that is gone.** The column is ` +
          "`ON DELETE SET NULL`, so this can only be a row written outside the FK — investigate before the bump."
        : "- Every bound run resolves its version. The bump cannot change this: `dataset_versions` rows are " +
          "never updated and never deleted by any path this package touches, and the FK is `ON DELETE SET NULL`.",
    );
  });

  // The reader that WRITES. This is the blast radius proper.
  const props = await tryQ(`
    select (select count(*)::int from public.proposals)                                   as proposals,
           (select count(*)::int from public.proposals
             where status in ('draft','proposed','approved'))                             as live,
           (select count(*)::int from public.proposals
             where status in ('draft','proposed','approved') and grounding ? 'graph_hash') as live_grounded_on_graph_hash,
           (select count(*)::int from public.proposals
             where status in ('draft','proposed','approved') and grounding ? 'graph_hash'
               and grounding->>'graph_hash' = public.current_graph_hash(project_id))       as live_and_fresh_today,
           (select count(*)::int from public.proposals where status = 'expired')           as already_expired`);
  report(
    "**the reader that writes** — `expire_agent_proposals` flips `status` to `expired`/`grounding_drift`",
    props,
    (rows) => {
      out(...table(rows));
      const r = rows[0] ?? {};
      const n = Number(r.live_grounded_on_graph_hash ?? 0);
      out(
        n > 0
          ? `- **${n} live proposal(s) carry a v1 \`graph_hash\` in \`grounding\`.** A v1 hash cannot equal a v2 ` +
            "hash, so on the first `list_agent_proposals` call after the deploy every one of them is UPDATEd to " +
            "`status='expired'`, `status_reason='grounding_drift'` — including any in `approved`. **Nothing " +
            "un-expires a proposal**: the predicate is one-way and `supersede_agent_proposal` does not reverse it. " +
            "This is the number the §11 decision has to be made against."
          : "- No live proposal is grounded on a `graph_hash`, so the bump expires nothing. The write path exists " +
            "and is unexercised; the decision costs nothing today and would cost `live_grounded_on_graph_hash` " +
            "proposals on any day it is not zero.",
      );
    },
  );

  const cards = await tryQ(`
    select (select count(*)::int from public.model_validations)                        as validation_cards,
           (select count(*)::int from public.model_validations where status = 'active') as active_cards,
           (select count(*)::int from public.model_validations c
             where c.status = 'active'
               and c.graph_hash = public.current_graph_hash(c.project_id))             as active_and_data_fresh_today`);
  report("`model_validations` — cards that stop reading fresh", cards, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    out(
      `- ${r.active_and_data_fresh_today ?? "?"} active card(s) match their project's hash today and will report ` +
        '`drift: ["data"]` from the deploy onward. **This one is display-only and reversible** — the badge is ' +
        "derived at read time (`useModelValidation`), no column is written, and re-validating clears it.",
    );
  });

  const mem = await tryQ(`
    select (select count(*)::int from public.project_memory)                       as memories,
           (select count(*)::int from public.project_memory where grounding ? 'graph_hash') as grounded_on_graph_hash`);
  report("`project_memory` — grounding shown as stale", mem, (rows) => {
    out(...table(rows));
    out("- Display-only and reversible, same as the cards: `useProjectMemory` compares at read time.");
  });

  section("WP 4.1 — the tables the hash starts covering, and the three that hold nothing");

  const covered = await tryQ(`
    select t.tbl, t.rows, t.projects
      from (
        select 'bom_multi_level'::text as tbl, count(*)::int as rows, count(distinct project_id)::int as projects from public.bom_multi_level
        union all select 'customers',              count(*)::int, count(distinct project_id)::int from public.customers
        union all select 'tier2_suppliers',        count(*)::int, count(distinct project_id)::int from public.tier2_suppliers
        union all select 'tier3_suppliers',        count(*)::int, count(distinct project_id)::int from public.tier3_suppliers
        union all select 'multi_tier_supply_chain',count(*)::int, count(distinct project_id)::int from public.multi_tier_supply_chain
      ) t order by t.tbl`);
  report("the five tier-2 tables v1 did not hash", covered, (rows) => {
    out(...table(rows));
    const net = (rows ?? []).filter((r) =>
      ["tier2_suppliers", "tier3_suppliers", "multi_tier_supply_chain"].includes(r.tbl),
    );
    const netRows = net.reduce((a, r) => a + Number(r.rows || 0), 0);
    out(
      netRows === 0
        ? "- **`hash_network`'s three tables hold ZERO rows in every project**, which is the settled decision's " +
          "second clause measured rather than asserted. The half is free to add and is UNEXERCISED until " +
          "somebody uploads one: a green test on it is not a working path."
        : `- **\`hash_network\`'s three tables hold ${netRows} row(s)** — the settled decision recorded ZERO. ` +
          "Re-read §11 before assuming the network half is unexercised.",
    );
  });

  // DID THE MIGRATION ACTUALLY LAND? Nothing above can say.
  //
  // Read the after-run against the before-run and every WP 4.1 count is
  // IDENTICAL — which is the correct result for the data and says nothing about
  // the deploy. The counts are about rows; the migration changed FUNCTIONS and
  // added two COLUMNS, and the schema probe compares RELATIONS, not columns. So
  // a failed deploy and a successful one produced the same report, and the
  // "after" would have been a measurement of nothing.
  //
  // These three are the difference, read off production rather than off a green
  // workflow badge.
  section("WP 4.1 — did the bump actually reach production?");

  const landed = await tryQ(`
    select (select count(*)::int from information_schema.columns
             where table_schema = 'public' and table_name = 'dataset_versions'
               and column_name in ('hash_inputs','hash_network'))              as domain_columns,
           -- DISTINCT proname, because pg_proc has one row PER OVERLOAD and this
           -- probe asks whether nine FUNCTIONS exist. It read count(*) and
           -- reported 10/9 the moment WP 4.3 added the three-argument
           -- analysis_mark_critical_nodes beside the two-argument one: an
           -- overload that exists on purpose, to cover the window between a
           -- migration deploy and an edge-function deploy. Three such shims are
           -- live right now, so the bug would have recurred twice more.
           (select count(distinct p.proname)::int from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('current_hash_inputs','current_hash_network',
                                 '_dataset_domain_hashes','_dataset_graph_hash',
                                 'ingest_legacy_upsert_lane','mrp_apply_staged_products',
                                 'etl_replace_supply_chain','analysis_mark_critical_nodes',
                                 'assert_writer_may_act'))                     as wp41_functions`);
  report("the two columns and the nine functions this package adds", landed, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    const ok = Number(r.domain_columns) === 2 && Number(r.wp41_functions) === 9;
    if (!ok) {
      gateFailures.push(
        `WP 4.1's migrations are NOT fully present in production: ${r.domain_columns ?? "?"}/2 ` +
        `domain columns and ${r.wp41_functions ?? "?"}/9 functions. Every count above is ` +
        `therefore a measurement of the PRE-migration database wearing an after-run's label.`,
      );
      out("- **NOT LANDED.** See the GATE section at the end of this report.");
      return;
    }
    out("- Landed: both domain columns and all nine functions are present.");
  });

  // The snapshot is at the CURRENT schema_version AND the hash moved. Two
  // separate claims: the function could be replaced and still return a
  // v1-shaped object if a later definition shadowed it, and the shape could be
  // right while the composite was not recomputed. `schema_version` is read from
  // the live snapshot, not asserted.
  //
  // THE EXPECTED VERSION IS A NAMED CONSTANT BECAUSE THIS GATE WENT STALE (D101).
  // It was written pinned to the literal "2". `20260917000009_topology_in_the_anchor.sql`
  // folded the deep-tier topology into `hash_network` and bumped 2 -> 3 — a bump
  // §15 itself had asked for and measured the blast radius of — and the gate was
  // not moved with it. Every run after that migration reported five correct
  // projects as a GATE FAILURE, which is the failure mode a gate exists to
  // prevent: production was right and the check called it red. One name, one
  // place to change at the next bump.
  const SNAPSHOT_SCHEMA_VERSION = "3"; // 20260917000009_topology_in_the_anchor.sql
  const shape = await tryQ(`
    select p.id::text as project_id,
           public._build_dataset_snapshot(p.id) -> 'schema_version'          as schema_version,
           (public._build_dataset_snapshot(p.id) ? 'inputs')                 as has_inputs,
           (public._build_dataset_snapshot(p.id) ? 'network')                as has_network,
           (public.current_hash_inputs(p.id) is not null)                    as inputs_hash,
           (public.current_hash_network(p.id) is not null)                   as network_hash
      from public.projects p order by p.created_at limit 5`);
  report("the live snapshot's own shape, on real projects", shape, (rows) => {
    if (!rows?.length) { out("- No project to build a snapshot for."); return; }
    out(...table(rows));
    const bad = rows.filter(
      (r) => String(r.schema_version) !== SNAPSHOT_SCHEMA_VERSION || r.has_inputs !== true,
    );
    if (bad.length) {
      gateFailures.push(
        `WP 4.1: ${bad.length} project(s) build a snapshot that is not ` +
        `v${SNAPSHOT_SCHEMA_VERSION}. \`_build_dataset_snapshot\` was not replaced, ` +
        `or a later definition shadows it.`,
      );
      out(`- **NOT v${SNAPSHOT_SCHEMA_VERSION}.** See the GATE section.`);
    } else {
      out(
        `- Every project builds a v${SNAPSHOT_SCHEMA_VERSION} snapshot with both domains, ` +
        `and both domain hashes compute.`,
      );
    }
  });

  // THE DIRTY READ, AND ITS PREMISE HAS AN EXPIRY DATE THAT HAS NOW PASSED.
  //
  // WP 4.1 wrote this as "every stored version predates v2, so no stored
  // `graph_hash` may still equal its project's current one". True on the day of
  // the bump and FALSE from the first version frozen after it: a v2 version on a
  // project nobody has edited since SHOULD equal the current hash — that is the
  // anchor working, not the deploy failing.
  //
  // Production now holds 7 versions, 6 of them v1 (`hash_inputs IS NULL`) and one
  // v2, and the one that matched was the v2 one. The gate was reporting correct
  // behaviour as "THE BUMP DID NOT TAKE".
  //
  // So the check is scoped to the rows the premise is actually about: a PRE-BUMP
  // version whose stored hash still equals the current one is the real defect,
  // because a v1 hash cannot equal a v2 hash unless the composite is unversioned.
  const dirty = await tryQ(`
    select count(*)::int as versions,
           count(*) filter (where v.hash_inputs is null
                              and v.graph_hash = public.current_graph_hash(v.project_id))::int
             as pre_bump_still_matching,
           count(*) filter (where v.hash_inputs is not null
                              and v.graph_hash = public.current_graph_hash(v.project_id))::int
             as post_bump_matching_expected,
           count(*) filter (where v.hash_inputs is null)::int as without_domain_hashes
      from public.dataset_versions v`);
  report("every pre-bump version now reads dirty (§16 · WP 4.1 · C)", dirty, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    if (Number(r.post_bump_matching_expected) > 0) {
      out(
        `- ${r.post_bump_matching_expected} POST-bump version(s) match their project's current`,
        `  hash, which is correct: a v2 version on a project nobody has edited since`,
        `  should match. This row used to be counted as a failure.`,
      );
    }
    if (Number(r.versions) > 0 && Number(r.pre_bump_still_matching) > 0) {
      gateFailures.push(
        `WP 4.1: ${r.pre_bump_still_matching} PRE-BUMP dataset version(s) still match ` +
        `current_graph_hash. Every one was frozen under v1 and a v1 hash cannot equal a v2 ` +
        `hash, so either the bump did not deploy or the composite is not versioned.`,
      );
      out("- **THE BUMP DID NOT TAKE.** See the GATE section.");
      return;
    }
    out(
      `- All ${r.versions ?? 0} version(s) read dirty against the live project, and ` +
        `${r.without_domain_hashes ?? 0} carry no domain hashes — correct and not backfillable: ` +
        "a v1 snapshot has no `network` domain. The next freeze on each project writes all three.",
    );
  });

  section("WP 4.1 — D36's six PostgREST writers, as the audit log holds them");

  const unattributed = await tryQ(`
    select a.target_type, a.action,
           count(*)::int as rows,
           count(*) filter (where coalesce((a.after->>'actor_known')::boolean, false))::int as actor_known,
           count(*) filter (where not coalesce((a.after->>'actor_known')::boolean, false))::int as actor_unknown
      from public.audit_logs a
     where a.plane = 'data'
     group by 1,2 order by 5 desc, 1, 2 limit 40`);
  report("data-plane audit rows that name their actor, by table (D36)", unattributed, (rows) => {
    if (!rows?.length) {
      out("- The data plane holds no audit row at all, so D36 has nothing to measure yet: the six writers have not run since WP 2.3 created the triggers.");
      return;
    }
    out(...table(rows));
    const unknown = rows.reduce((a, r) => a + Number(r.actor_unknown || 0), 0);
    out(
      `- **${unknown} data-plane row(s) record \`actor_known: false\`.** That is honest and it is not attribution ` +
        "(§2.1 `audit-actor`). This package moves the six PostgREST writes into RPCs that take the actor as a " +
        "parameter; the after-run is how we find out whether the number moved for a path anyone actually ran.",
    );
  });
}

// ── WP 4.2: the smear, as a quantity ───────────────────────────────────────
//
// TWO THINGS NOTHING HAS EVER MEASURED, and they are this package's to measure
// FIRST, before the store exists to change them.
//
//  1. The four DERIVED tables' row counts. WP 4.1's probes did not touch them
//     (§16 · WP 4.1 · I lists them as deferred and stops), so "how big is the
//     smear" has never had a number — only the adjective in D19.
//  2. How many rows carry a COMPUTED column with no input hash. No tier-3 table
//     has `computed_from_hash` yet (that is WP 4.3's), so today the answer is
//     "every one of them" — and the point of writing it down as a count is that
//     WP 4.3 needs a before-number to show it moved.
//
// EVERY project, never one (D42): the largest project here is the one
// `seed-project.yml` seeds, and reading it alone reports a clean data layer.
async function wp42Smear() {
  section("WP 4.2 — the four DERIVED tables, and D19 as a quantity");

  // `network_nodes` is the table D56 has deferred three times, and the reason
  // is visible in its own column list: the INPUT half is what a user uploaded
  // (`name`, `country`, `industry`, `revenue`, `lat`, `long`, `is_seed`), the
  // COMPUTED half is what an analysis wrote. The counts are kept apart here
  // because a single row count cannot tell those two apart, which is D19.
  const derived = await tryQ(`
    select 'node_list'       as tbl,
           count(*)::int     as rows,
           count(distinct project_id)::int as projects,
           count(*) filter (where is_critical_node is not null
                               or critical_node_score is not null
                               or prediction_timestamp is not null)::int as rows_with_computed,
           count(*) filter (where longitude is not null or latitude is not null)::int as rows_geocoded
      from public.node_list
    union all
    select 'network_nodes', count(*)::int, count(distinct project_id)::int,
           count(*) filter (where degree_centrality is not null
                               or weighted_degree_centrality is not null
                               or eigenvector_centrality is not null
                               or betweenness_centrality is not null
                               or closeness_centrality is not null
                               or prominence is not null)::int,
           count(*) filter (where lat is not null or long is not null)::int
      from public.network_nodes
    union all
    select 'network_edges', count(*)::int, count(distinct project_id)::int, 0, 0
      from public.network_edges
    union all
    select 'network_summary', count(*)::int, count(distinct project_id)::int,
           count(*) filter (where nodes_count is not null or edges_count is not null
                               or tiers_data is not null)::int, 0
      from public.network_summary`);
  report("the four tables WP 4.1 deferred, counted for the first time", derived, (rows) => {
    if (!rows?.length) { out("- No rows returned."); return; }
    out(...table(rows));
    const total = rows.reduce((a, r) => a + Number(r.rows || 0), 0);
    const computed = rows.reduce((a, r) => a + Number(r.rows_with_computed || 0), 0);
    out("");
    out(
      `- **${total} row(s) across the four tables, ${computed} of them carrying at least one COMPUTED column ` +
        `and NONE of them carrying an input hash** — no tier-3 table has \`computed_from_hash\` yet. That is D19 ` +
        "as a number rather than an adjective, and it is WP 4.3's before-figure.",
    );
    if (total === 0) {
      out(
        "- **Zero rows is itself the finding**, and it is the honest caveat stated as data: the analyses this " +
          "package caches have produced nothing in production, so every claim about a cache hit is a claim " +
          "about `supabase/rehearsal/` fixtures and must not be reported as adoption.",
      );
    }
  });

  // Per project, because a total hides which projects are affected (D42).
  const perProject = await tryQ(`
    select p.name as project,
           (select count(*)::int from public.node_list       t where t.project_id = p.id) as node_list,
           (select count(*)::int from public.network_nodes   t where t.project_id = p.id) as network_nodes,
           (select count(*)::int from public.network_edges   t where t.project_id = p.id) as network_edges,
           (select count(*)::int from public.network_summary t where t.project_id = p.id) as network_summary,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.network_metrics_updated_at is not null)      as nodes_with_metrics
      from public.projects p order by p.created_at`);
  report("the same four, per project (D42 — never just the seeded one)", perProject, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
  });

  // D54 AS A NUMBER. The rule this package adds is that a deferral must SAY
  // whether the table is audited; this is the measurement that says what the
  // coverage list has been deciding silently.
  const deferredAudit = await tryQ(`
    select c.relname::text as tbl,
           count(t.tgname) filter (where not t.tgisinternal)::int as audit_triggers
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_trigger t on t.tgrelid = c.oid
                            and not t.tgisinternal
                            and t.tgname like '%audit_tier_write%'
     where n.nspname = 'public'
       and c.relname in ('node_list','network_nodes','network_edges','network_summary',
                         'model_validations','external_evidence')
     group by 1 order by 1`);
  report("D54 — the six DEFERRED tables this package owns, and their audit triggers", deferredAudit, (rows) => {
    if (!rows?.length) { out("- None of the six exist in production."); return; }
    out(...table(rows));
    const unaudited = rows.filter((r) => Number(r.audit_triggers) === 0);
    out("");
    out(
      `- **${unaudited.length} of ${rows.length} carry no \`audit_tier_write\` trigger.** They are outside the ` +
        "contract, therefore outside `dataPlaneAudit.test.ts`'s rule, therefore their writes are unattributable " +
        "with nothing to notice. That is D54 measured rather than described.",
    );
  });
}

// ── WP 4.2: did the store actually reach production? ───────────────────────
//
// WP 4.1's after-run could not tell a landed deploy from a failed one: every
// count came back identical to the before-run, which was correct for the data
// and is also exactly what a failed deploy prints, because the counts are about
// ROWS and the migration changed FUNCTIONS and COLUMNS (§16 · WP 4.1 · K).
//
// WP 4.2's migration creates TABLES, so the schema probe would catch a total
// failure — but not a PARTIAL one, and the counts below would again be the same
// on both sides of it because nothing has called the store. These assertions are
// therefore about the SCHEMA, not the data, and they push to `gateFailures` so a
// half-landed deploy turns the run red instead of publishing a report that looks
// like the previous one.
/**
 * WP 4.3 + WP 4.4 — THE THREE COUNTS TWO PACKAGES OWED AND NEITHER COULD TAKE.
 *
 * Both carried a migration, and a push with a migration must not touch any of
 * the three doors that fire `verification-sql.yml` (§4 D31, and the fourth loss
 * that added the third door). WP 5.1 changes no schema, so it can carry them.
 *
 * MEASURE EVERY PROJECT. §4 D42: the largest project here is the one the seeder
 * creates, and reading it alone reports a clean data layer that is not clean.
 */
/**
 * WP 6.2 / 6.4 — the BEFORE numbers for two changes this branch makes, and one
 * question a sidecar could not answer.
 *
 * READ AGAINST PRODUCTION WITHOUT THIS BRANCH'S MIGRATIONS. `supabase-migrations.yml`
 * is `branches: [main]`, so the seven migrations here deploy on MERGE — which makes
 * this the BEFORE half of two readings that straddle it, rather than a measurement of
 * something already done.
 *
 * SELECT ONLY, like every probe in this file (`assertReadOnly`).
 */
/**
 * WP 7.1 STAGE 0 — the access-control surface, read from the LIVE database.
 *
 * The plan in §14 counts 27 predicate-less policies, 7 predicate-less write policies
 * and 7 write grants to `anon`. **Those numbers come from MIGRATION HISTORY**, and
 * `no-orphan-table`'s lesson (§4 D43) is that production can differ from what the
 * migrations say: a policy dropped by hand, a grant added in the dashboard, a role
 * that does not exist here. Stage 0 exists because every stage after it is sized by
 * these figures, and a plan sized from history is a plan sized from a guess.
 *
 * SELECT ONLY. `pg_policies`, `information_schema.role_table_grants` and `pg_roles`
 * are catalog reads; nothing here changes anything.
 *
 * WHAT A PREDICATE-LESS POLICY IS, precisely, because the whole stage turns on it:
 * `qual` is the USING clause and `with_check` is the WITH CHECK clause. A policy with
 * neither, or with one that is literally `true`, permits every row for every caller
 * holding the table grant. That is not "permissive RLS" in the PostgreSQL sense of
 * `AS PERMISSIVE` — it is RLS that refuses nothing.
 */
async function wp71Stage0() {
  section("§15 · WP 7.1 stage 0 — the access surface, from the live database");

  // 1 · Every policy, classified. `roles` is a name[] so it is unnested for the
  // report: "which ROLE can do this without a predicate" is the question, and a
  // policy granted to `{public}` answers it differently from one granted to `{anon}`.
  const policies = await tryQ(`
    select count(*)::int as policies,
           count(distinct tablename)::int as tables,
           count(*) filter (where coalesce(qual, '') in ('', 'true')
                              and coalesce(with_check, '') in ('', 'true'))::int as no_predicate,
           count(*) filter (where cmd in ('INSERT','UPDATE','DELETE','ALL')
                              and coalesce(qual, '') in ('', 'true')
                              and coalesce(with_check, '') in ('', 'true'))::int as no_predicate_write,
           count(*) filter (where qual ilike '%get_current_user_id%'
                               or with_check ilike '%get_current_user_id%'
                               or qual ilike '%app.current_user_id%'
                               or with_check ilike '%app.current_user_id%')::int as via_guc,
           count(*) filter (where qual ilike '%auth.uid%' or with_check ilike '%auth.uid%')::int as via_auth_uid
      from pg_policies where schemaname = 'public'`);
  report("stage 0.1 — every policy in `public`, classified", policies, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    out(
      `- **${r.no_predicate ?? "?"} of ${r.policies ?? "?"}** policies refuse nothing: no USING and no`,
      "  WITH CHECK, or one that is literally `true`. Those are what makes the product",
      "  work while it runs as `anon`, and stage 3 is what replaces them.",
      `- **${r.via_guc ?? "?"}** name the GUC path (\`get_current_user_id\` /`,
      `  \`app.current_user_id\`) and **${r.via_auth_uid ?? "?"}** name \`auth.uid()\`. The first`,
      "  number is the size of what stage 2's re-ordering has to keep working; the",
      "  second is how much of the schema already speaks the language stage 1 issues.",
      "- **Compare all of these with §14's counts from migration history.** A difference",
      "  is not an error in either place — it is a policy or grant that moved outside a",
      "  migration, and it is the reason this stage exists (D43's class).",
    );
  });

  // 2 · The tables whose policies refuse nothing, by name, so stage 3 has its list
  // from the database rather than from a test fixture.
  const uncond = await tryQ(`
    select tablename,
           count(*)::int as no_predicate_policies,
           string_agg(distinct cmd, ', ' order by cmd) as commands
      from pg_policies
     where schemaname = 'public'
       and coalesce(qual, '') in ('', 'true')
       and coalesce(with_check, '') in ('', 'true')
     group by tablename
     order by tablename`);
  report("stage 0.2 — the tables stage 3 has to cover, from `pg_policies`", uncond, (rows) => {
    out(...table(rows));
    out(
      `- **${rows.length} table(s).** \`governanceEnforcement.test.ts\` pins a list of 27 read`,
      "  from the migrations; this is the same question asked of production.",
      "- Stage 3 adds ONE restrictive policy per table here. A restrictive policy ANDs",
      "  with whatever is already present, so `DROP POLICY` is an exact undo — which is",
      "  why the plan prefers it to rewriting each permissive policy in place.",
    );
  });

  // 3 · The grants, per role. A policy that refuses nothing only matters to a role
  // that holds the table grant, so these two reads are halves of one answer.
  const grants = await tryQ(`
    select grantee,
           count(*) filter (where privilege_type = 'SELECT')::int as select_on,
           count(*) filter (where privilege_type in ('INSERT','UPDATE','DELETE'))::int as write_privs,
           count(distinct table_name) filter (where privilege_type in ('INSERT','UPDATE','DELETE'))::int as writable_tables
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee in ('anon','authenticated','service_role','PUBLIC')
     group by grantee
     order by grantee`);
  report("stage 0.3 — table grants per role", grants, (rows) => {
    out(...table(rows));
    out(
      "- `anon` is the role this product runs as. Its `writable_tables` is what stage 4",
      "  revokes, one table per push, with a read either side.",
      "- A `PUBLIC` row here would be the widest finding on the page: a grant to PUBLIC",
      "  reaches every role including `anon`, and revoking it from `anon` alone would",
      "  change nothing at all.",
    );
  });

  // 4 · The writable tables by name, which is stage 4's worklist.
  const writable = await tryQ(`
    select table_name,
           string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and privilege_type in ('INSERT','UPDATE','DELETE')
     group by table_name
     order by table_name`);
  report("stage 0.4 — what `anon` may write, by name (stage 4's worklist)", writable, (rows) => {
    out(...table(rows));
    out(
      `- **${rows.length} table(s).** §14 counts 7 from migration history; a difference here`,
      "  changes stage 4's size and is the kind of thing only a live read can say.",
    );
  });

  // 5 · Does the database have anybody to be? Stage 1 issues real sessions, and this
  // says whether `auth.users` is populated at all today — if it is empty, stage 1 is
  // creating identities rather than attaching to them, which is a bigger change than
  // the plan's wording implies.
  const authUsers = await tryQ(`
    select (select count(*) from auth.users)::int as auth_users,
           (select count(*) from public.approved_users)::int as approved_users,
           (select count(*) from public.approved_users a
              where exists (select 1 from auth.users u where u.id = a.id))::int as approved_with_matching_auth_row`);
  report("stage 0.5 — is there an identity to attach a session to?", authUsers, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    const a = Number(r.auth_users ?? 0);
    const m = Number(r.approved_with_matching_auth_row ?? 0);
    const ap = Number(r.approved_users ?? 0);
    out(...(m === ap && ap > 0
      ? ["- **Every `approved_users` row has an `auth.users` row with the SAME uuid.** So",
         "  stage 1 can mint a session whose `sub` is the id every predicate already uses,",
         "  and `auth.uid()` will equal `get_current_user_id()` without a mapping table."]
      : [`- **${m} of ${ap}** approved users have a matching \`auth.users\` row (\`auth.users\``,
         `  holds ${a}). Where they do not, stage 1 cannot simply mint a session for the`,
         "  existing uuid — it has to create the auth identity first, which is a larger",
         "  change than the plan's stage 1 describes and must be re-planned before stage 2."]));
  });

  // 6 · THE BLAST RADIUS OF STAGE 1 ITSELF, which nothing above asks.
  //
  // Stage 1 issues a real Supabase session. The moment it does, a request stops
  // arriving as `anon` and starts arriving as `authenticated` — and a policy whose
  // `roles` is `{anon}` STOPS APPLYING to it. RLS denies by default when no policy
  // applies, so a policy that today permits everything would, after stage 1, refuse
  // everything: the product breaks on the read path, not on the write path, and it
  // breaks for the users who logged in rather than for the ones who did not.
  //
  // The same question for grants: `authenticated` must hold the table privilege too,
  // or the role change is a permission error before RLS is ever consulted.
  const byRole = await tryQ(`
    select array_to_string(roles, ',') as granted_to,
           count(*)::int as policies,
           count(distinct tablename)::int as tables
      from pg_policies where schemaname = 'public'
     group by 1 order by 2 desc`);
  report("stage 0.6 — which ROLE each policy is granted to (stage 1's own blast radius)", byRole, (rows) => {
    out(...table(rows));
    const anonOnly = rows.filter((r) => String(r.granted_to ?? "") === "anon");
    const n = anonOnly.reduce((s, r) => s + Number(r.policies ?? 0), 0);
    out(...(n === 0
      ? ["- **No policy is granted to `anon` alone**, so switching a request from `anon` to",
         "  `authenticated` takes no policy away from it. Stage 1 is safe on this axis."]
      : [`- **${n} policy/policies are granted to \`anon\` ALONE.** After stage 1 a logged-in`,
         "  request arrives as `authenticated`, those policies stop applying to it, and RLS",
         "  denies by default — so stage 1 would break reads for exactly the users who",
         "  authenticated. Each must be widened to include `authenticated` BEFORE stage 1,",
         "  which is work the plan's stage 1 does not currently contain."]));
    out(
      "- A `public` row is the benign case: `TO public` covers every role, so the role",
      "  change is invisible to it.",
    );
  });

  // 7 · …and the grant half of the same question.
  const grantGap = await tryQ(`
    select table_name,
           string_agg(distinct privilege_type, ', ' order by privilege_type) as anon_has
      from information_schema.role_table_grants g
     where table_schema = 'public' and grantee = 'anon'
       and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
       and not exists (
         select 1 from information_schema.role_table_grants h
          where h.table_schema = g.table_schema and h.table_name = g.table_name
            and h.grantee = 'authenticated' and h.privilege_type = g.privilege_type)
     group by table_name order by table_name`);
  report("stage 0.7 — privileges `anon` holds that `authenticated` does not", grantGap, (rows) => {
    out(...table(rows));
    out(...(rows.length === 0
      ? ["- **None.** Every privilege `anon` holds, `authenticated` holds too, so the role",
         "  change stage 1 causes cannot produce a permission error before RLS is reached."]
      : [`- **${rows.length} table(s).** A request that becomes \`authenticated\` loses these`,
         "  privileges outright — a `permission denied for table` error, which RLS never",
         "  gets to soften. Grant them to `authenticated` before stage 1, not after."]));
  });

  // 8 · THE REAL EXPOSURE, which 0.2–0.4 each see only half of.
  //
  // A write grant matters only where RLS lets the statement through, and a
  // predicate-less policy matters only where the role holds the grant. Neither probe
  // above is the answer on its own, and the gap between them is large: `anon` holds
  // write privileges on 86 tables (0.4) while only 16 predicate-less WRITE policies
  // exist (0.1). **The third term is RLS itself** — a table with `relrowsecurity =
  // false` has no policies to consult, so the grant is the whole of its protection.
  // This probe is the intersection, and it is the list stages 3 and 4 actually work.
  const exposure = await tryQ(`
    with anon_write as (
      select distinct table_name
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
         and privilege_type in ('INSERT','UPDATE','DELETE')),
    rls as (
      select c.relname, c.relrowsecurity, c.relkind
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p','v')),
    wp as (
      select tablename,
             count(*) filter (where coalesce(qual,'') in ('','true')
                                and coalesce(with_check,'') in ('','true'))::int as open_write_policies,
             count(*)::int as write_policies
        from pg_policies
       where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
       group by tablename)
    select case
             when r.relkind = 'v' then 'view (grant only; RLS lives on the base table)'
             when r.relrowsecurity is not true then 'RLS OFF — the grant is the only gate'
             when coalesce(w.write_policies,0) = 0 then 'RLS on, NO write policy — denied today'
             when coalesce(w.open_write_policies,0) > 0 then 'RLS on, a write policy that refuses nothing'
             else 'RLS on, every write policy has a predicate'
           end as state,
           count(*)::int as tables,
           string_agg(a.table_name, ', ' order by a.table_name) as which
      from anon_write a
      join rls r on r.relname = a.table_name
      left join wp w on w.tablename = a.table_name
     group by 1 order by 2 desc`);
  report("stage 0.8 — grant × RLS × policy: what `anon` can ACTUALLY write", exposure, (rows) => {
    for (const r of rows) {
      out("", `**${r.state}** — ${r.tables} table(s)`, "", `  ${r.which}`);
    }
    const bad = rows.filter((r) => /RLS OFF|refuses nothing/.test(String(r.state)));
    const n = bad.reduce((s, r) => s + Number(r.tables ?? 0), 0);
    out(
      "",
      `- **${n} table(s) are genuinely writable by an anonymous caller today.** That is the`,
      "  number stages 3 and 4 are sized by — not the 86 grants (most are held behind a",
      "  policy that refuses the write) and not the 16 open write policies (some sit on",
      "  tables `anon` cannot reach anyway).",
      "- A row reading `RLS OFF` is the sharpest case in this report: there is no policy to",
      "  add a restrictive clause to, so stage 3's mechanism does not apply and the only",
      "  fix is the grant. Those tables belong at the FRONT of stage 4, not in its middle.",
      "- `denied today` is the benign large group: the grant exists and RLS refuses every",
      "  write for want of a permissive policy, which is why revoking is tidying rather",
      "  than repair.",
    );
  });

  // 9 · THE IDENTITY SPLIT, from `pg_constraint` rather than from the artifact.
  //
  // `build/schema.introspected.json` records nine columns as `REFERENCES auth.users(id)`
  // — and at least one of them is WRONG: `20260613000001_fix_snapshot_created_by.sql`
  // DROPPED `policy_versions_created_by_fkey` in June, for exactly the reason 0.5 just
  // measured. Its header is the clearest statement of this problem in the repository:
  // *"The app authenticates against public.approved_users (custom auth), so the user id
  // passed to snapshot_policy is NOT an auth.users id. The legacy FK … therefore rejects
  // every snapshot with a real user."*
  //
  // So the question is which of those keys production STILL has, and it cannot be
  // answered from the repository — the artifact is demonstrably behind on at least one.
  // It matters beyond bookkeeping: `ingest_land_file` RAISES when its actor is NULL
  // (deliberately — `audit-actor`) and writes that actor into
  // `ingest_runs.triggered_by_user_id`. If that FK still points at `auth.users`, then
  // with 0 of 14 approved users present there the two requirements are mutually
  // unsatisfiable and **every CSV landing by a real user aborts** — under WP 6.5 (a),
  // which is the package that publishes `ingest-file`.
  const authFks = await tryQ(`
    select con.conname as constraint_name,
           rel.relname as table_name,
           (select string_agg(att.attname, ', ' order by att.attnum)
              from unnest(con.conkey) k
              join pg_attribute att on att.attrelid = rel.oid and att.attnum = k) as columns
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_class fre on fre.oid = con.confrelid
      join pg_namespace fns on fns.oid = fre.relnamespace
     where con.contype = 'f' and ns.nspname = 'public'
       and fns.nspname = 'auth' and fre.relname = 'users'
     order by rel.relname, con.conname`);
  report("stage 0.9 — which foreign keys to `auth.users` production STILL has", authFks, (rows) => {
    out(...table(rows));
    out(
      `- **${rows.length} key(s)**. Expected **6** since \`20260919000012\` re-keyed`,
      "  `ingest_runs`' two actor columns to `approved_users` (D131); the artifact records",
      "  seven, and the one it is still wrong about is `policy_versions.created_by`, dropped",
      "  in June and not followed by the introspector (D132).",
      "  A difference is a defect in the artifact, not in the database (D49/D52's class):",
      "  a constraint dropped by a later `ALTER TABLE` that the introspector did not",
      "  follow, and therefore a foreign key this repository believes in and production",
      "  does not — or the reverse, which is worse.",
    );
    const t = rows.map((r) => r.table_name);
    // `ingest_runs` must NOT be here any more. Until `20260919000012` it was, and the gate
    // below is what made that visible rather than a footnote; it stays because a migration
    // that reverted the re-key would otherwise put the CSV landing path back into a state
    // where it cannot run, silently.
    if (t.includes("ingest_runs")) {
      out(
        "- **`ingest_runs` IS IN THIS LIST, AND THAT BLOCKS WP 6.5 (a).**",
        "  `ingest_land_file` raises when `_actor_user_id` is NULL and writes it into",
        "  `triggered_by_user_id`; 0 of 14 approved users exist in `auth.users` (0.5). So a",
        "  real CSV upload cannot satisfy both, and publishing `ingest-file` would make",
        "  every landing fail. Every rehearsal passes because each one INSERTs its actor",
        "  into `auth.users` first — a world production does not have.",
      );
      gateFailures.push(
        "`ingest_runs` still carries a foreign key to `auth.users` while 0 of the " +
          "approved users exist there, and `ingest_land_file` both requires a non-NULL " +
          "actor and writes it into that column, so the CSV landing path cannot run in " +
          "production (PLAN.md §4 D131). It is LATENT, not an outage: `ingest-file` is " +
          "not deployed (D123), so nothing reaches the path today. This run is red " +
          "because WP 6.5 (a) publishes that function, and publishing it over these two " +
          "keys turns every upload into a foreign-key error — drop them first, the " +
          "pattern being `20260613000001_fix_snapshot_created_by.sql`. Red until then, " +
          "deliberately.",
      );
    } else {
      out(
        "- **`ingest_runs` is NOT in this list**, so its actor columns take an",
        "  `approved_users` id without complaint and the landing path is not blocked by",
        "  this. Then the artifact is wrong about it, which is its own finding.",
      );
    }
  });

  // 10 · THE SIXTEEN, BY NAME — stage 1's first migration, written from the database.
  //
  // 0.6 counted them. Stage 1 has to RECREATE each one `TO anon, authenticated`, and
  // that needs the name, the table, the command and both expressions — because
  // PostgreSQL has no `ALTER POLICY … ADD ROLE`: widening a policy's roles means
  // `ALTER POLICY … TO anon, authenticated`, which keeps the predicates, and getting
  // the list from `grep 'TO anon'` is exactly the mistake D129 was.
  //
  // The expressions are printed so the migration can be checked against them rather
  // than trusted: `ALTER POLICY … TO` preserves USING and WITH CHECK, and this is what
  // they must still be afterwards.
  const anonOnly = await tryQ(`
    select tablename, policyname, cmd, permissive,
           coalesce(qual, '—') as using_expr,
           coalesce(with_check, '—') as with_check_expr
      from pg_policies
     where schemaname = 'public' and roles = '{anon}'
     order by tablename, policyname`);
  report("stage 0.10 — the sixteen `anon`-only policies, by name (stage 1's worklist)", anonOnly, (rows) => {
    out(...table(rows, ["tablename", "policyname", "cmd", "permissive"]));
    out("");
    out("**The predicates each one must still have afterwards:**");
    for (const r of rows) {
      out(
        "",
        `- \`${r.tablename}\` · \`${r.policyname}\` (${r.cmd})`,
        `  - USING: \`${String(r.using_expr).replace(/`/g, "'").slice(0, 300)}\``,
        `  - WITH CHECK: \`${String(r.with_check_expr).replace(/`/g, "'").slice(0, 300)}\``,
      );
    }
    out(
      "",
      `- **${rows.length} policy/policies.** Each becomes \`ALTER POLICY <name> ON <table>`,
      "  TO anon, authenticated\\` — additive, since a policy gaining a role takes none",
      "  away, and revertible by the same statement with `TO anon`.",
      "- **This must land BEFORE stage 1 issues a session.** Until it does, every one of",
      "  these reads is available to an anonymous caller and refused to an authenticated",
      "  one, which is the inversion nothing in §14 had pointed at (D130).",
    );
  });
}

async function wp62and64Before() {
  section("§15 · WP 6.2 / 6.4 — before the cascade, and the catalog nothing reads");

  // 1 · D117's orphans. `20260919000005` DELETES exactly these rows before it can
  // add each foreign key, and prints every count on deploy. This is the number to
  // compare that output against — and if it is large, it is also the answer to
  // "how long has deleting a project not deleted the project".
  const orphans = await tryQ(`
    select 'customers' as tbl, count(*)::int as orphan_rows from public.customers t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
    union all select 'network_summary', count(*)::int from public.network_summary t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
    union all select 'policy_defaults', count(*)::int from public.policy_defaults t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
    union all select 'policy_overrides', count(*)::int from public.policy_overrides t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
    union all select 'simulation_job_magnitudes', count(*)::int from public.simulation_job_magnitudes t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
    union all select 'tier2_suppliers', count(*)::int from public.tier2_suppliers t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
    union all select 'tier3_suppliers', count(*)::int from public.tier3_suppliers t
      where not exists (select 1 from public.projects p where p.id = t.project_id)
     order by 1`);
  report("§4 D117 — rows whose project no longer exists (the cascade's before number)", orphans, (rows) => {
    out(...table(rows));
    const total = rows.reduce((n, r) => n + Number(r.orphan_rows ?? 0), 0);
    out(
      `- **${total} row(s)** belong to a project that has been deleted. No screen can`,
      `  reach them — every read is \`WHERE project_id = <a project you can open>\` —`,
      `  and nothing has ever removed them.`,
      `- \`policy_defaults\` and \`policy_overrides\` are the sharp ones: those rows are`,
      `  the decisions a user typed into the grid.`,
      `- \`20260919000005\` deletes exactly these and then adds seven \`ON DELETE CASCADE\``,
      `  keys, so the same query must return 0 everywhere after the merge.`,
    );
  });

  // 2 · D126. A seeded catalog nothing reads is a different finding from an empty
  // table nothing reads, and only the database can say which this is.
  const presets = await tryQ(`
    select count(*)::int as rows,
           count(*) filter (where is_system)::int as system_rows,
           count(distinct slug)::int as slugs,
           count(*) filter (where owner_id is not null)::int as user_rows
      from public.policy_presets`);
  report("§4 D126 — `policy_presets`: is there a catalog nobody reads?", presets, (rows) => {
    out(...table(rows));
    const n = Number(rows[0]?.rows ?? 0);
    // Two different findings, and the report says which rather than printing a
    // number and leaving the reader to decide what it means.
    out(...(n === 0
      ? ["- The table is EMPTY. Nothing reads it and nothing ever filled it, so D126 is",
         "  a dead table rather than an unread catalog — which makes deleting it the",
         "  cheaper of the two answers."]
      : [`- **${n} row(s)** are seeded here and NO code reads them: not \`src/\`, not an`,
         "  RPC, not an edge function. The presets a user applies are compiled into the",
         "  bundle under `src/lib/policies/presets/`, so this catalog cannot be edited",
         "  into effect — changing a preset needs a deploy."]));
  });

  // 3 · The six tables WP 6.4 describes, as rows. A described table with no rows is
  // still described — but the reader of this report deserves to know which of the
  // six the product has actually been using.
  const decisions = await tryQ(`
    select 'policy_versions' as tbl, count(*)::int as rows from public.policy_versions
    union all select 'policy_presets', count(*)::int from public.policy_presets
    union all select 'scenarios', count(*)::int from public.scenarios
    union all select 'scenario_templates', count(*)::int from public.scenario_templates
    union all select 'recovery_playbooks', count(*)::int from public.recovery_playbooks
    union all select 'external_evidence', count(*)::int from public.external_evidence
     order by 1`);
  report("WP 6.4 — the decision plane, as rows", decisions, (rows) => {
    out(...table(rows));
    out(
      "- Every one of these is now described, governed and audited by three triggers.",
      "- A table with 0 rows here is not a finding on its own: `external_evidence` fills",
      "  only when an agent has run, and `policy_presets` is D126's subject.",
    );
  });
}

async function wp43and44Counts() {
  section("WP 4.3 / 4.4 — provenance coverage, and D70's realised damage");

  // 1 · I5 as a quantity. `computed_from_hash IS NULL` is the size of what
  // WP 5.3 cannot migrate: a row that cannot say which data produced it.
  const prov = await tryQ(`
    select 'network_nodes' as tbl,
           count(*)::int as rows,
           count(*) filter (where computed_from_hash is null)::int as no_provenance,
           count(distinct project_id)::int as projects
      from public.network_nodes
    union all
    select 'node_list', count(*)::int,
           count(*) filter (where computed_from_hash is null)::int,
           count(distinct project_id)::int
      from public.node_list
    union all
    select 'supply_chain_data', count(*)::int,
           count(*) filter (where computed_from_hash is null)::int,
           count(distinct project_id)::int
      from public.supply_chain_data
    union all
    select 'network_summary', count(*)::int,
           count(*) filter (where computed_from_hash is null)::int,
           count(distinct project_id)::int
      from public.network_summary
     order by 1`);
  report("`computed_from_hash IS NULL` per derived table — I5 as a number", prov, (rows) => {
    out(...table(rows));
    const total = rows.reduce((n, r) => n + Number(r.rows ?? 0), 0);
    const none = rows.reduce((n, r) => n + Number(r.no_provenance ?? 0), 0);
    out(
      `- **${none} of ${total}** derived row(s) carry NO input hash. Those are rows`,
      `  written before WP 4.3, and nothing can say whether they are current — the`,
      `  freshness badge reports them as \`unknown\`, which is not the same as stale.`,
      `- This is the size of what WP 5.3 cannot migrate: dropping the entity columns`,
      `  loses these values with no \`analysis_results\` row to replace them.`,
    );
  });

  // 2 · D70's realised damage. UNRECOVERABLE by construction — `expired`
  // overwrote the prior status and the row does not record it — so the only
  // honest thing left is to know the number.
  const drift = await tryQ(`
    select count(*)::int as expired_for_drift,
           count(distinct project_id)::int as projects,
           min(updated_at) as earliest,
           max(updated_at) as latest
      from public.proposals
     where status = 'expired' and status_reason = 'grounding_drift'`);
  report("proposals a READ expired for grounding drift (§4 D70)", drift, (rows) => {
    out(...table(rows));
    const n = Number(rows[0]?.expired_for_drift ?? 0);
    if (n === 0) {
      out("- **Zero.** D70 was closed before it cost anything, which is what WP 4.1's");
      out("  measure-before-the-bump discipline bought.");
    } else {
      out(
        `- **${n} proposal(s) were expired by somebody opening a page**, not by any`,
        `  decision. Each said \`draft\`, \`proposed\` or \`approved\` and \`expired\``,
        `  overwrote it; the row does not record which, so THEY CANNOT BE RESTORED.`,
        `  The number is the point: it is the realised cost of D70 and it can only`,
        `  ever grow smaller by somebody re-authoring those proposals by hand.`,
      );
    }
  });

  // 3 · what a `schema_version` bump would cost TODAY. WP 5.3 folds the network
  // topology into `hash_network` (D75) and WP 4.1's rule is to count first.
  const bump = await tryQ(`
    select count(*)::int as live_grounded_on_graph_hash,
           count(distinct project_id)::int as projects
      from public.proposals
     where status in ('draft','proposed','approved')
       and grounding ? 'graph_hash'`);
  report("what WP 5.3's hash bump would land on (D75) — count before, not after", bump, (rows) => {
    out(...table(rows));
    const n = Number(rows[0]?.live_grounded_on_graph_hash ?? 0);
    out(
      n === 0
        ? "- **Zero.** WP 5.3 can take the bump for the same reason WP 4.1 could."
        : `- **${n} live proposal(s)** are grounded on a graph hash. Since WP 4.4 a bump `
          + `no longer EXPIRES them — drift is computed now — so they will read as `
          + `\`stale\` and come back if the hash does. That is the whole value of D70 `
          + `being closed before this bump rather than after it.`,
    );
  });

  // 4 · D72's index, re-measured against the constraint that now exists.
  const key = await tryQ(`
    select (select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
             where c.relname = 'network_nodes_natural_key' and i.indisunique) as key_present,
           (select count(*)::int from public.network_nodes where uid is null)  as null_uid`);
  report("D72's `(project_id, uid)` key, after the fact", key, (rows) => {
    out(...table(rows));
    if (Number(rows[0]?.key_present ?? 0) !== 1) {
      gateFailures.push(
        "WP 4.3's `network_nodes_natural_key` is NOT in production, so " +
        "`calculate-network-science-metrics`'s fallback upsert is still failing with " +
        "42P10 on every run (§4 D72).",
      );
    }
  });
}

async function wp42Landed() {
  section("WP 4.2 — did the analysis store reach production?");

  const landed = await tryQ(`
    select (select count(*)::int from information_schema.tables
             where table_schema = 'public'
               and table_name in ('analysis_runs','analysis_results'))            as store_tables,
           (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('analysis_get_or_start','analysis_complete_run',
                                 'analysis_fail_run','analysis_results_are_immutable',
                                 'analysis_runs_identity_is_immutable'))          as store_functions,
           (select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
             where c.relname = 'analysis_runs_key_uniq'
               and i.indisunique and i.indpred is not null)                       as partial_unique_key,
           (select count(*)::int from pg_trigger t
             where not t.tgisinternal
               and t.tgname like 'audit_analysis_%')                              as audit_triggers`);
  report("the two tables, five functions, the partial key and the six audit triggers", landed, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    const want = { store_tables: 2, store_functions: 5, partial_unique_key: 1, audit_triggers: 6 };
    const bad = Object.entries(want).filter(([k, v]) => Number(r[k]) !== v);
    if (bad.length) {
      gateFailures.push(
        `WP 4.2's migration is NOT fully present in production: ` +
        bad.map(([k, v]) => `${k} ${r[k] ?? "?"}/${v}`).join(", ") +
        `. Every WP 4.2 count in this report is therefore a measurement of the ` +
        `PRE-migration database wearing an after-run's label (§16 · WP 4.1 · K).`,
      );
      out("- **NOT LANDED.** See the GATE section at the end of this report.");
      return;
    }
    out("- Landed: both tables, all five functions, the partial unique key and all six audit triggers.");
  });

  // THE KEY IS PARTIAL, and that is the deviation from §11 this package had to
  // make (§16 · WP 4.2 · I). A full index would let the first FAILED run own a
  // cache key forever, so the shape is asserted rather than assumed — a later
  // migration that "tidied" it into a plain unique index would be silent.
  const keydef = await tryQ(`
    select pg_get_indexdef(i.indexrelid) as definition
      from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'analysis_runs_key_uniq'`);
  report("the key index, as production actually holds it", keydef, (rows) => {
    if (!rows?.length) { out("- The key index does not exist."); return; }
    out(...table(rows));
    if (!/WHERE .*status/i.test(String(rows[0].definition))) {
      gateFailures.push(
        "WP 4.2: `analysis_runs_key_uniq` is not partial in production. A failed run " +
        "then owns its cache key permanently and that analysis can never be retried " +
        "on that input (§11's flat key, and why this package deviated from it).",
      );
    }
  });

  // NOT ADOPTION, AND THIS REPORT MUST NOT BE READ AS IF IT WERE. Nothing has
  // called the store outside a rehearsal; the row count is expected to be zero
  // and zero is the honest answer rather than a failure.
  const usage = await tryQ(`
    select (select count(*)::int from public.analysis_runs)                        as runs,
           (select count(*)::int from public.analysis_results)                     as results,
           (select count(distinct project_id)::int from public.analysis_runs)      as projects,
           (select count(*)::int from public.analysis_runs where actor_user_id is null) as runs_with_no_actor`);
  report("what the store holds (expected: nothing — this is NOT adoption)", usage, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    if (Number(r.runs) === 0) {
      out(
        "- Zero runs, as expected. The analyzers do not call the store until WP 4.3 " +
          "dual-writes, so every claim this package makes about a cache hit is a claim " +
          "about `supabase/rehearsal/` fixtures. **A future non-zero count here is not " +
          "adoption either until an analyzer is the caller.**",
      );
    }
    if (Number(r.runs_with_no_actor) > 0) {
      gateFailures.push(
        `WP 4.2: ${r.runs_with_no_actor} run(s) carry no actor, which the NOT NULL ` +
        "column should make impossible. `audit-actor` (G4) is failing in a new place.",
      );
    }
  });

  // D72's BEFORE-NUMBER, which WP 4.3 needs and cannot take after it has acted.
  // `calculate-network-science-metrics` upserts `network_nodes` on
  // `(project_id, uid)` and that index does not exist, so the statement fails
  // every time it runs. Before the index can be created the duplicates have to be
  // counted — exactly the way D5's before-number was taken for the seven lanes.
  const d72 = await tryQ(`
    select count(*)::int as rows,
           count(*) filter (where uid is null)::int as null_uid,
           (select coalesce(sum(copies - 1), 0)::int from (
              select count(*)::int as copies from public.network_nodes
               group by project_id, uid having count(*) > 1) d)
             as rows_a_unique_index_would_reject,
           (select count(*)::int from (
              select 1 from public.network_nodes
               group by project_id, uid having count(*) > 1) d)
             as duplicated_keys
      from public.network_nodes`);
  report("D72 — `network_nodes (project_id, uid)` before any index is attempted", d72, (rows) => {
    out(...table(rows));
    const r = rows[0] ?? {};
    out("");
    out(
      `- **${r.rows_a_unique_index_would_reject ?? "?"} row(s) across ` +
        `${r.duplicated_keys ?? "?"} duplicated key(s)** would be rejected by the unique index ` +
        "`calculate-network-science-metrics:115` already names in its `onConflict`. " +
        "Until it exists that upsert raises `42P10` on every run, the handler logs and " +
        "carries on, and the per-node update loop then matches nothing (D72). " +
        `\`null_uid\` is ${r.null_uid ?? "?"} — a nullable key column means the index must be ` +
        "`NULLS NOT DISTINCT` or it constrains every row except those (D5).",
    );
  });
}

// ── WP 4.3: the two T3 tables nothing has counted, and the before-figures ──
//
// THREE THINGS NOTHING HAS EVER MEASURED, and every one of them is a number
// WP 4.3 cannot take after it has acted:
//
//  1. `supply_chain_data` and `supply_chain_data_multi_tier` row counts. They
//     are the two ETL outputs in the contract, they are the tier-3 tables that
//     GAIN `computed_from_hash` here, and WP 5.3 needs today's figure as its
//     own before-number. WP 4.1's probes did not touch them and WP 4.2's four
//     derived tables are a different set — so "how many derived rows carry no
//     input hash" has only ever been answered for the network group.
//
//  2. `analysis_runs` BY KIND. WP 4.2 shipped with the count at zero and said
//     so in three places. This package is the first real caller, so the
//     after-run is the first time a non-zero count means anything at all — and
//     it means ANALYZERS RAN, never adoption (§16 · WP 4.2 · N).
//
//  3. `network_nodes.uid`'s NULLABILITY, read from production rather than from
//     the migration. D72's row asserts `uid` is NULLABLE and the creating
//     migration says `uid text NOT NULL`; D43's whole class is production
//     disagreeing with the migrations, so the only way to know which is true of
//     the database the index will be created on is to ask it.
//
// EVERY project, never one (D42).
async function wp43Before() {
  section("WP 4.3 — the T3 tables that gain `computed_from_hash`, counted before the dual-write");

  const t3 = await tryQ(`
    select 'supply_chain_data'            as tbl,
           count(*)::int                  as rows,
           count(distinct project_id)::int as projects,
           0::int                         as rows_with_input_hash
      from public.supply_chain_data
    union all
    select 'supply_chain_data_multi_tier', count(*)::int, count(distinct project_id)::int, 0::int
      from public.supply_chain_data_multi_tier`);
  report("the two ETL outputs in the contract, counted for the first time", t3, (rows) => {
    if (!rows?.length) { out("- No rows returned."); return; }
    out(...table(rows));
    const total = rows.reduce((a, r) => a + Number(r.rows || 0), 0);
    out("");
    out(
      `- **${total} row(s) across the two tables, NONE carrying an input hash** — neither table has a ` +
        "`computed_from_hash` column before this package. `rows_with_input_hash` is a literal `0` and not a " +
        "count, because there is no column to count: that is the honest spelling of a before-figure for a " +
        "column that does not exist yet, and the after-run replaces the literal with a real count.",
    );
    out(
      "- These two are `combine-project`'s output. They are what `analysis_kind='combine_etl'` will key, and " +
        "they are WP 5.3's before-number as much as this package's.",
    );
  });

  const t3PerProject = await tryQ(`
    select p.name as project,
           (select count(*)::int from public.supply_chain_data t            where t.project_id = p.id) as supply_chain_data,
           (select count(*)::int from public.supply_chain_data_multi_tier t where t.project_id = p.id) as multi_tier
      from public.projects p order by p.created_at`);
  report("the same two, per project (D42 — never just the seeded one)", t3PerProject, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
  });

  // WHICH PROJECT THE GAP CHECK CAN RUN AGAINST, and which field CLASSES have
  // no real data in it. §11's gap check is a field-by-field numeric comparison
  // old-vs-new, and a comparison that silently covers nothing is this plan's
  // recurring failure mode — so the field classes are counted SEPARATELY and the
  // report says which of them is empty rather than reporting a clean comparison
  // over zero values.
  const fieldClasses = await tryQ(`
    select p.name as project,
           (select count(*)::int from public.network_nodes t where t.project_id = p.id) as nn_rows,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.degree_centrality is not null)             as degree,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.weighted_degree_centrality is not null)    as weighted_degree,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.eigenvector_centrality is not null)        as eigenvector,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.betweenness_centrality is not null)        as betweenness,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.closeness_centrality is not null)          as closeness,
           (select count(*)::int from public.network_nodes t
             where t.project_id = p.id and t.prominence is not null)                    as prominence,
           (select count(*)::int from public.node_list t
             where t.project_id = p.id and t.is_critical_node is not null)              as is_critical_node,
           (select count(*)::int from public.node_list t
             where t.project_id = p.id and t.critical_node_score is not null)           as critical_node_score
      from public.projects p order by p.created_at`);
  report("**the gap check's own coverage** — which project has real values, per FIELD CLASS", fieldClasses, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
    const cols = ["degree", "weighted_degree", "eigenvector", "betweenness", "closeness",
                  "prominence", "is_critical_node", "critical_node_score"];
    const totals = Object.fromEntries(cols.map((c) => [c, rows.reduce((a, r) => a + Number(r[c] || 0), 0)]));
    const empty = cols.filter((c) => totals[c] === 0);
    out("");
    out(`- Per-class totals across every project: ${cols.map((c) => `\`${c}\` ${totals[c]}`).join(", ")}.`);
    out(
      empty.length
        ? `- **${empty.length} field class(es) have NO real value in ANY project**: ${empty.map((c) => `\`${c}\``).join(", ")}. ` +
          "§11's gap check cannot compare them against `analysis_results` on real data, and the gap check must SAY " +
          "so rather than reporting a comparison that covered nothing."
        : "- Every field class has at least one real value somewhere, so the gap check can cover all of them.",
    );
  });

  // `analysis_runs` BY KIND. Zero before; a non-zero after means the analyzers
  // ran, which is not the same sentence as adoption.
  const kinds = await tryQ(`
    select coalesce(r.analysis_kind, '(none)') as analysis_kind,
           count(*)::int                        as runs,
           count(*) filter (where r.status = 'succeeded')::int as succeeded,
           count(*) filter (where r.status = 'running')::int   as still_running,
           count(*) filter (where r.status = 'failed')::int    as failed,
           (select count(*)::int from public.analysis_results ar where ar.run_id in
              (select id from public.analysis_runs r2 where r2.analysis_kind = r.analysis_kind)) as result_rows
      from public.analysis_runs r group by r.analysis_kind order by 1`);
  report("`analysis_runs` by kind — WP 4.2 shipped this at ZERO", kinds, (rows) => {
    if (!rows?.length) {
      out(
        "- **No runs at all.** WP 4.2 said so in three places and this re-measures it: every claim about a " +
          "cache hit is still a claim about `supabase/rehearsal/` fixtures. WP 4.3 is the first real caller, so " +
          "the after-run is the first time a non-zero count here means anything — and what it will mean is " +
          "**ANALYZERS RUN**, never adoption.",
      );
      return;
    }
    out(...table(rows));
  });

  // D72, RE-MEASURED, and the nullability read from the database.
  //
  // The re-measure matters because the earlier figure is four weeks stale the
  // moment an analyzer runs. The nullability matters because D72's row and the
  // creating migration DISAGREE, and only production can settle which schema the
  // index will actually be created on (D43's class).
  const uidShape = await tryQ(`
    select a.attname::text                                  as column_name,
           a.attnotnull                                     as not_null,
           (select count(*)::int from public.network_nodes)  as rows,
           (select count(*)::int from public.network_nodes where uid is null) as null_uid,
           (select coalesce(sum(copies - 1), 0)::int from (
              select count(*)::int as copies from public.network_nodes
               group by project_id, uid having count(*) > 1) d)
                                                            as rows_a_unique_index_would_reject,
           (select count(*)::int from (
              select 1 from public.network_nodes
               group by project_id, uid having count(*) > 1) d)
                                                            as duplicated_keys
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'network_nodes'
       and a.attname in ('uid', 'project_id') and a.attnum > 0
     order by a.attname`);
  report("D72 — re-measured, with `uid`'s NULLABILITY read from production and not from the migration", uidShape, (rows) => {
    if (!rows?.length) { out("- `network_nodes` does not exist in production."); return; }
    out(...table(rows));
    const uid = rows.find((r) => r.column_name === "uid") ?? {};
    const reject = Number(uid.rows_a_unique_index_would_reject ?? 0);
    const notNull = uid.not_null === true || String(uid.not_null) === "true";
    out("");
    out(
      `- **${reject} row(s) across ${uid.duplicated_keys ?? "?"} duplicated key(s)** would be rejected by the ` +
        "unique index `calculate-network-science-metrics` already names in its `onConflict`. " +
        (reject === 0
          ? "So the fix is ONE `CREATE UNIQUE INDEX` with no dedup migration and no rows lost."
          : "**A dedup migration IS needed**, on D5's shape (most complete copy, then the later one), before the index."),
    );
    out(
      `- \`uid\` is **${notNull ? "NOT NULL" : "NULLABLE"}** in production, and \`null_uid\` is ${uid.null_uid ?? "?"}. ` +
        (notNull
          ? "**D72's row says `uid` is NULLABLE and that is wrong** — the creating migration declares " +
            "`uid text NOT NULL` and production agrees. The row's CONCLUSION still holds: the index is spelled " +
            "`NULLS NOT DISTINCT` anyway, because nullability is a schema property a later `ALTER` can change and " +
            "the spelling is a no-op while there are no NULLs (D5's half nobody writes down). What changes is that " +
            "it is defensive against a future `DROP NOT NULL` rather than corrective of a present NULL."
          : "So the `NULLS NOT DISTINCT` spelling is load-bearing today, exactly as D5 says."),
    );
  });
}

// ── D29: is organizations.name unique in practice? ─────────────────────────
async function d29() {
  section("D29 — `organizations.name` collisions (the dual read's text branch)");
  const dupes = await tryQ(`
    select lower(btrim(name)) as norm, count(*) as orgs
    from public.organizations
    group by 1 having count(*) > 1 order by 2 desc`);
  report("name collisions", dupes, (rows) => {
    out(`- **${rows.length}** normalized organization names are held by more than one organization.`);
    if (rows.length) out(...table(rows.slice(0, SAMPLE_CAP)));
    out(rows.length
      ? "- The text branch of `org_is_current_user_org` admits one tenant to another on these names. D29 is LIVE."
      : "- No collision today. D29 is latent, not live — nothing prevents the next one (`name` has no unique constraint).");
  });
  const total = await tryQ(`select count(*)::int as organizations from public.organizations`);
  report("organization count", total, (rows) => out(`- organizations: **${rows[0]?.organizations ?? "?"}**`));

  // WHAT THE TEXT BRANCH IS ACTUALLY CARRYING. §15's sweep found exactly one
  // project with `organization_id IS NULL`, and "resolve that project" is D29's
  // whole remaining cost — but a project cannot be resolved from its uuid. It
  // needs the org TEXT it carries and whether any organization answers to it.
  // Assigning a project to the wrong tenant is not a defect to be fixed later,
  // so this prints the evidence rather than letting a migration guess.
  const unresolved = await tryQ(`
    select p.id::text as project_id, p.name as project_name,
           p.organization as org_text,
           (select count(*)::int from public.organizations o
             where lower(btrim(o.name)) = lower(btrim(p.organization))) as orgs_matching_text,
           (select string_agg(o.id::text || ' = ' || o.name, ' | ')
              from public.organizations o
             where lower(btrim(o.name)) = lower(btrim(p.organization))) as candidates,
           p.modeler_id::text as modeler_id,
           (select count(*)::int from public.approved_users a where a.id = p.modeler_id) as modeler_rows
    from public.projects p
    where p.organization_id is null`);
  report("the unresolved project, in full", unresolved, (rows) => {
    out("");
    out("**D29 · the one project the text branch is load-bearing for.** Removing the branch is gated on this row:");
    out(...table(rows));
    out(rows.every((r) => Number(r.orgs_matching_text) === 1)
      ? "- Each row's org text matches EXACTLY ONE organization, so the backfill's own ambiguity rule resolves it. The branch can go once it is applied."
      : "- At least one row's org text matches zero or several organizations. A migration must not choose; say so in §16 instead.");
  });

  const orgs = await tryQ(`
    select id::text as id, name, slug, status from public.organizations order by name`);
  report("every organization", orgs, (rows) => out(...table(rows)));

  // WHO WOULD LOSE ACCESS IF THE TEXT BRANCH WENT. This is the only question
  // that decides D29, and asking it is cheaper than arguing about it.
  // `org_is_current_user_org(NULL, 'default_org')` can only be true for a
  // reader whose OWN `approved_users.organization` text is `default_org` — the
  // column default, which names no organization. If nobody's is, dropping the
  // branch revokes nothing from anybody, and WP 2.1's rule ("a package whose
  // job is to stop revoking access must not add a new way to revoke it") is
  // satisfied rather than argued around.
  const defaultOrgUsers = await tryQ(`
    select count(*)::int as users_with_default_org_text,
           count(*) FILTER (WHERE is_active)::int as active,
           (select count(*)::int from public.approved_users
             where organization is null or btrim(organization) = '') as users_with_blank_org_text
    from public.approved_users
    where lower(btrim(coalesce(organization,''))) = 'default_org'`);
  report("who the text branch still admits", defaultOrgUsers, (rows) => {
    out("");
    out("**D29 · who would lose access if the text branch were removed.** The branch can only admit a reader whose own org TEXT matches a project's:");
    out(...table(rows));
    out(Number(rows[0]?.users_with_default_org_text ?? -1) === 0
      ? "- Nobody carries the `default_org` text, so the NULL-org project is reachable by no ordinary user today. Removing the branch revokes nothing."
      : "- At least one account still carries `default_org`. Removing the branch WOULD revoke their access to the NULL-org project; resolve the account first.");
  });
}

// ── the four decisions §16's PHASE BOUNDARY parked behind §15 ──────────────
async function boundaryDecisions() {
  section("The four decisions §15 gates (§16 PHASE BOUNDARY, condition 2)");

  const orgCov = await tryQ(`
    select
      (select count(*)::int from public.projects)                                   as projects,
      (select count(*)::int from public.projects where organization_id is null)     as projects_org_null,
      (select count(*)::int from public.projects where organization is null or btrim(organization) = '') as projects_org_text_blank,
      (select count(*)::int from public.approved_users)                             as approved_users,
      (select count(*)::int from public.approved_users where organization_id is null) as users_org_null`);
  report("1 · org backfill coverage (WP 2.1)", orgCov, (rows) => {
    out("**1 · The org backfill's real coverage** — WP 2.1's unverifiable exit check.");
    out(...table(rows));
  });

  const modeler = await tryQ(`
    select count(*)::int as projects_with_modeler,
           count(*) filter (where a.id is null)::int as modeler_without_account
    from public.projects p
    left join public.approved_users a on a.id = p.modeler_id
    where p.modeler_id is not null`);
  report("2 · projects whose modeler has no account", modeler, (rows) => {
    out("");
    out("**2 · Projects whose `modeler_id` resolves to no `approved_users` row** — WP 2.2's owner backfill.");
    out(...table(rows));
  });

  const planes = await tryQ(`
    select plane, count(*)::int as rows
    from public.audit_logs group by 1 order by 2 desc`);
  report("3 · audit_logs plane distribution", planes, (rows) => {
    out("");
    out("**3 · Production's audit rows against WP 2.3's new `plane` CHECK.**");
    out(...table(rows));
    const bad = rows.filter((r) => !["admin", "data", "access"].includes(r.plane));
    out(bad.length
      ? `- **${bad.length} plane value(s) outside (admin, data, access)** — the CHECK would have rejected them.`
      : "- Every row's `plane` is inside `(admin, data, access)`. The generalization migrated cleanly.");
  });
}

// ── §15 proper, for one project ───────────────────────────────────────────
async function pickProject() {
  // The NAME matters as much as the id. `seed-project.yml` seeds "Project TRON -
  // ver2" through the app's own RPC lifecycle, and that project is the biggest
  // one in the database — so "the project with the most rows is clean" can mean
  // "the seeder writes clean rows" rather than anything about real uploads. A
  // reader cannot tell those apart from a uuid.
  if (forcedProject) {
    const [row] = await q(`select name from public.projects where id = '${forcedProject}'::uuid`);
    return { id: forcedProject, name: row?.name ?? "(unknown)", why: "passed with --project" };
  }
  const rows = await q(`
    select i.project_id as id, p.name, count(*)::int as inbound_rows
    from public.inbound_logistics i
    left join public.projects p on p.id = i.project_id
    group by 1, 2 order by 3 desc limit 1`);
  if (!rows.length) return null;
  return { id: rows[0].id, name: rows[0].name ?? "(no projects row)", why: `most inbound_logistics rows (${rows[0].inbound_rows})` };
}

async function section15(pid) {
  const P = `'${pid}'::uuid`;

  section("§15 · D8 — blank / untrimmed / case-variant ids");
  report("blank or untrimmed ids", await tryQ(`
    select count(*)::int as offending_rows,
           count(*) filter (where supplier_id is null or btrim(supplier_id) = '')::int as blank_supplier,
           count(*) filter (where material_id is null or btrim(material_id) = '')::int as blank_material,
           count(*) filter (where supplier_id is distinct from btrim(supplier_id))::int as untrimmed_supplier,
           count(*) filter (where material_id is distinct from btrim(material_id))::int as untrimmed_material
    from public.inbound_logistics where project_id = ${P}
      and (supplier_id is null or btrim(supplier_id) = ''
        or material_id is null or btrim(material_id) = ''
        or supplier_id is distinct from btrim(supplier_id)
        or material_id is distinct from btrim(material_id))`),
    (rows) => out(...table(rows)));

  report("case-variant material ids", await tryQ(`
    select lower(btrim(material_id)) as norm, count(distinct material_id)::int as variants,
           array_agg(distinct material_id) as spellings
    from public.inbound_logistics where project_id = ${P}
    group by 1 having count(distinct material_id) > 1 order by 2 desc`),
    (rows) => {
      out(`- **${rows.length}** normalized material ids carry more than one spelling.`);
      if (rows.length) out(...table(rows.slice(0, SAMPLE_CAP).map((r) => ({ ...r, spellings: sample(r.spellings).join(" · ") }))));
    });

  section("§15 · D6 — field-shift signature from an unquoted comma");
  report("embedded quote characters", await tryQ(`
    select count(*)::int as rows_with_quote_char
    from public.inbound_logistics where project_id = ${P}
      and (supplier_id like '%"%' or material_id like '%"%' or time_unit like '%"%')`),
    (rows) => {
      out(...table(rows));
      out(Number(rows[0]?.rows_with_quote_char) > 0
        ? "- The client-side split-on-comma parser shifted fields on at least one row. D6 is LIVE in this project's data."
        : "- No row carries the field-shift signature. D6 is unexercised here — it is a parser defect, not a data defect, and WP 3.2 still owns it.");
    });

  section("§15 · D7 — blank numerics that passed validation");
  report("null / non-positive numerics", await tryQ(`
    select count(*) filter (where volume     is null)::int as null_volume,
           count(*) filter (where lead_time  is null)::int as null_lead_time,
           count(*) filter (where unit_price is null)::int as null_price,
           count(*) filter (where unit_price <= 0)::int    as nonpositive_price,
           count(*)::int as total
    from public.inbound_logistics where project_id = ${P}`),
    (rows) => out(...table(rows)));

  section("§15 · D5 — duplicate arcs (WP 3.3's before number)");
  report("duplicate inbound arcs", await tryQ(`
    select count(*)::int as duplicated_groups,
           coalesce(sum(copies - 1), 0)::int as surplus_rows,
           coalesce(max(copies), 0)::int as worst_group
    from (
      select count(*)::int as copies
      from public.inbound_logistics where project_id = ${P}
      group by supplier_id, material_id, volume, unit_price having count(*) > 1) d`),
    (rows) => out(...table(rows)));

  // The natural key WP 3.3 will actually enforce is narrower than §15's
  // value-equality grouping above: two rows with the same key and DIFFERENT
  // volumes are a key violation that the §15 query does not see.
  report("duplicates by `natural_key_intended`", await tryQ(`
    select count(*)::int as duplicated_keys,
           coalesce(sum(copies - 1), 0)::int as rows_the_unique_index_would_reject,
           coalesce(max(copies), 0)::int as worst_key
    from (
      select count(*)::int as copies
      from public.inbound_logistics where project_id = ${P}
      group by project_id, plant_name, supplier_id, material_id having count(*) > 1) d`),
    (rows) => {
      out("");
      out("Against `inbound_logistics`'s `natural_key_intended` (`project_id + plant_name + supplier_id + material_id`) — this is the number WP 3.3's `CREATE UNIQUE INDEX` has to survive:");
      out(...table(rows));
    });

  section("§15 · D2 / D10 — mixed and unrecognized `time_unit`");
  report("materials with more than one time_unit", await tryQ(`
    select count(*)::int as materials_with_mixed_units from (
      select material_id from public.inbound_logistics where project_id = ${P}
      group by 1 having count(distinct lower(btrim(coalesce(time_unit,'<null>')))) > 1) m`),
    (rows) => {
      out(...table(rows));
      out(Number(rows[0]?.materials_with_mixed_units) > 0
        ? "- `sourcing_ratio` is meaningless for these materials — shares are summed across incommensurable periods."
        : "- No material mixes time units in this project, so `sourcing_ratio` is at least internally comparable here.");
    });

  report("unrecognized time_unit tokens", await tryQ(`
    select coalesce(time_unit, '<null>') as time_unit, count(*)::int as rows
    from public.inbound_logistics where project_id = ${P}
      and lower(btrim(coalesce(time_unit,''))) not in
        ('day','days','d','daily','week','weeks','wk','w','weekly','month','months','mo','m',
         'monthly','quarter','quarters','quarterly','year','years','yr','y','yearly',
         'annual','annually')
    group by 1 order by 2 desc`),
    (rows) => {
      out(`- **${rows.length}** distinct token(s) fall outside the recognized set and are silently read as weekly.`);
      if (rows.length) out(...table(rows.slice(0, SAMPLE_CAP)));
    });

  section("§15 · D3 — `plant_name` drift between arcs and BOM");
  report("arcs whose plant matches no BOM row", await tryQ(`
    select count(distinct i.plant_name)::int as orphan_plants,
           count(*)::int as affected_arcs
    from public.inbound_logistics i where i.project_id = ${P}
      and not exists (select 1 from public.bom_single_level b
                      where b.project_id = i.project_id and b.plant_name = i.plant_name)
      and not exists (select 1 from public.bom_multi_level m
                      where m.project_id = i.project_id and m.plant_name = i.plant_name)`),
    (rows) => out(...table(rows)));

  section("§15 · D2 / D3 headline — rows that reached the grid weighted 0");
  report("supply_chain_data weighting", await tryQ(`
    select data_source, count(*)::int as total,
           count(*) filter (where weighted = 0 or weighted is null)::int as zero_weighted
    from public.supply_chain_data where project_id = ${P} group by 1 order by 1`),
    (rows) => out(...table(rows)));

  report("sourcing shares that do not sum to 1", await tryQ(`
    select count(*)::int as materials_off_one from (
      select to_location from public.supply_chain_data
      where project_id = ${P} and data_source = 'inbound'
      group by 1 having abs(sum(sourcing_ratio) - 1.0) > 0.0001) s`),
    (rows) => out(...table(rows)));

  section("§15 · masters missing for multi-level BOM materials");
  report("unmastered BOM materials", await tryQ(`
    select count(distinct m.material_id)::int as materials_without_master
    from public.bom_multi_level m where m.project_id = ${P}
      and not exists (select 1 from public.materials mm
                      where mm.project_id = m.project_id and mm.material_id = m.material_id)`),
    (rows) => out(...table(rows)));

  section("§15 · D17 — suppliers the grid renders as capacity 0");
  report("supplier capacity", await tryQ(`
    select count(*) filter (where capacity_per_week is null)::int as shown_as_zero_but_unlimited,
           count(*)::int as total
    from public.suppliers where project_id = ${P}`),
    (rows) => out(...table(rows)));

  section("§15 · D1 — auto-seeded zero safety stock");
  report("zero safety_stock_days overrides", await tryQ(`
    select count(*)::int as zero_safety_stock_patches
    from public.policy_overrides
    where family = 'inventory' and patch ? 'safety_stock_days'
      and (patch->>'safety_stock_days')::numeric = 0`),
    (rows) => {
      out(...table(rows));
      out("- Project-scoped filtering is deliberately omitted: WP 0.1 closed the WRITE path, so the question is whether any seeded zeros survive anywhere.");
    });

  // The two names have OPPOSITE expectations and the first version of this
  // report printed one verdict for both, so a correct result read as a finding:
  // `risk_data` is EXPECTED — WP 1.4 adopted it and §15's own text says so —
  // while `product_code_map` is expected to be gone (WP 3.0 dropped it). A
  // report whose green case reads like an accusation is D42's lesson in
  // miniature, so each name is judged against its own expectation.
  section("§15 · D3 / D4 — the two adopted-or-dropped tables, each against its own expectation");
  report("orphan tables", await tryQ(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('product_code_map','risk_data')`),
    (rows) => {
      const present = new Set(rows.map((r) => r.table_name));
      out(present.has("risk_data")
        ? "- `risk_data` is present, which is CORRECT: WP 1.4 adopted it (`20260915000003_risk_data.sql`) and it is in the contract."
        : "- **`risk_data` is MISSING from production** and a migration creates it — the schema probe above should already have failed this run.");
      out(present.has("product_code_map")
        ? "- **`product_code_map` is STILL PRESENT**, and WP 3.0's migration dropped it. Read `20260916000003` before anything else."
        : "- `product_code_map` is gone, which is CORRECT: WP 3.0 dropped it (0 rows, no writer had ever existed).");
    });
}

/**
 * §15 measures ONE project. Phase 3's scope depends on how much D5/D7/D8 damage
 * exists AT ALL, and a single clean project is not that answer — least of all if
 * it is the seeded one. This sweep runs the three counting defects across every
 * project in the database, which is what makes a clean result mean something.
 */
async function allProjectsSweep() {
  section("Across EVERY project — what one project cannot tell you");

  for (const [label, lane, key] of [
    ["inbound_logistics", "inbound_logistics", "supplier_id, material_id"],
    ["outbound_logistics", "outbound_logistics", "customer_id, product_id"],
    ["bom_single_level", "bom_single_level", "product_id, material_id"],
    ["bom_multi_level", "bom_multi_level", "material_id, higher_level_component_id, level"],
  ]) {
    const res = await tryQ(`
      select count(*)::int as rows,
             count(distinct project_id)::int as projects,
             (select coalesce(sum(copies - 1), 0)::int from (
                select count(*)::int as copies from public.${lane}
                group by project_id, plant_name, ${key} having count(*) > 1) d)
               as rows_the_unique_index_would_reject
      from public.${lane}`);
    report(label, res, (rows) => {
      out(`**\`${label}\`** — natural key \`project_id + plant_name + ${key}\`:`);
      table(rows).forEach((l) => out(l));
      out("");
    });
  }

  // WP 3.2 described these three, which is what brought them inside the rules.
  // `tier2_suppliers` and `tier3_suppliers` are now promotion targets, so their
  // duplicate counts are WP 3.3's before-numbers exactly as the four lanes' are.
  // `multi_tier_supply_chain` is here for a different reason: its sidecar says no
  // code in `src/` or `supabase/functions/` reads or writes it, and whoever
  // decides whether to drop it should be deciding against a row count.
  for (const [label, lane, key] of [
    ["tier2_suppliers", "tier2_suppliers", "supplier_id, upstream_supplier_id, material_id"],
    ["tier3_suppliers", "tier3_suppliers", "supplier_id, upstream_supplier_id, material_id"],
    ["multi_tier_supply_chain", "multi_tier_supply_chain", "from_firm_id, to_firm_id"],
  ]) {
    const res = await tryQ(`
      select count(*)::int as rows,
             count(distinct project_id)::int as projects,
             (select coalesce(sum(copies - 1), 0)::int from (
                select count(*)::int as copies from public.${lane}
                group by project_id, plant_name, ${key} having count(*) > 1) d)
               as rows_the_unique_index_would_reject
      from public.${lane}`);
    report(label, res, (rows) => {
      out(`**\`${label}\`** (described in WP 3.2) — natural key \`project_id + plant_name + ${key}\`:`);
      table(rows).forEach((l) => out(l));
      out("");
    });
  }

  // The sidecar for `bom_multi_level` said `integer >= 1` and both live parsers
  // admitted 0 as the root level. WP 3.2 resolved it in favour of the parsers and
  // this is the measurement that says whether that was the right call: every
  // level-0 row is a row the stricter reading would have rejected.
  report("bom_multi_level rows at level 0 (WP 3.2's contract contradiction)", await tryQ(`
    select count(*) filter (where level = 0)::int as level_0,
           count(*) filter (where level < 0)::int as level_negative,
           min(level)::int as min_level,
           count(*)::int as total
    from public.bom_multi_level`),
    (rows) => { out(""); table(rows).forEach((l) => out(l)); });

  report("untrimmed / blank ids across every project", await tryQ(`
    select count(*)::int as rows_with_untrimmed_or_blank_ids
    from public.inbound_logistics
    where supplier_id is null or btrim(supplier_id) = ''
       or material_id is null or btrim(material_id) = ''
       or supplier_id is distinct from btrim(supplier_id)
       or material_id is distinct from btrim(material_id)`),
    (rows) => table(rows).forEach((l) => out(l)));

  report("null numerics across every project", await tryQ(`
    select count(*) filter (where volume is null)::int as null_volume,
           count(*) filter (where lead_time is null)::int as null_lead_time,
           count(*) filter (where unit_price is null)::int as null_price,
           count(*)::int as total
    from public.inbound_logistics`),
    (rows) => { out(""); table(rows).forEach((l) => out(l)); });

  report("unrecognized time_unit across every project", await tryQ(`
    select coalesce(time_unit,'<null>') as time_unit, count(*)::int as rows
    from public.inbound_logistics
    where lower(btrim(coalesce(time_unit,''))) not in
      ('day','days','d','daily','week','weeks','wk','w','weekly','month','months','mo','m',
       'monthly','quarter','quarters','quarterly','year','years','yr','y','yearly',
       'annual','annually')
    group by 1 order by 2 desc`),
    (rows) => {
      out("");
      out(`- **${rows.length}** unrecognized \`time_unit\` token(s) database-wide, each silently read as weekly.`);
      if (rows.length) table(rows.slice(0, SAMPLE_CAP)).forEach((l) => out(l));
    });

  report("the row the dual read's text branch still carries", await tryQ(`
    select p.id as project_id, (p.organization_id is null) as org_uuid_missing,
           (a.id is null) as modeler_has_no_account
    from public.projects p
    left join public.approved_users a on a.id = p.modeler_id
    where p.organization_id is null or (p.modeler_id is not null and a.id is null)`),
    (rows) => {
      out("");
      out(`**Which rows are actually unresolved** — D29's text branch cannot be removed while any \`org_uuid_missing\` row exists:`);
      table(rows).forEach((l) => out(l));
    });

  report("D1 — auto-seeded zeros, by project", await tryQ(`
    select count(distinct target_key)::int as distinct_targets,
           count(*)::int as rows
    from public.policy_overrides
    where family = 'inventory' and patch ? 'safety_stock_days'
      and (patch->>'safety_stock_days')::numeric = 0`),
    (rows) => {
      out("");
      out("**D1's surviving damage.** WP 0.1 closed the WRITE path; it did not clean what the path had already written:");
      table(rows).forEach((l) => out(l));
    });
}

// ── WP 8.0: the graph layer, measured BEFORE anything is changed ───────────
//
// WHY THIS PROBE EXISTS, and it is the whole of WP 8.0. The diagnosis of the
// Process- and Product-level network pages BRANCHES on a number nothing in this
// repository knows: how deep the BOM of the project a user is looking at is.
//
// `ProcessLevelNetwork.tsx`'s classifier is a fixed ladder — level 5 means
// supplier, 2–4 mean material, 1 means "work station" — and the ETL writes
// `supply_chain_data_multi_tier.level` as BOM TREE DEPTH on the bom lane and as
// that depth PLUS ONE on the inbound lane (§4 D112). So the ladder is correct on
// exactly one shape of data: a BOM four levels deep. On any other shape every
// supplier lands at a level the ladder calls a material, and the page renders
// and LABELS it as one. Whether that is what a given user is seeing, or a latent
// defect on their project and something else on their screen, is a fact about
// production and not about the code — so it is measured here first.
//
// Six questions, each one sized rather than described:
//
//   1. `projects.bom_level` for EVERY project. `single` writes no multi-tier
//      rows at all (D115), so a Process page that is empty needs no further
//      explanation, and one that is full rules the defect out.
//   2. the `level` histogram per lane. `max(level) = 5` means the ladder
//      happens to be right; anything else means D112 is live.
//   3. `to_location = ''` in the multi-tier table — D114, the severed BOM root,
//      as a row count.
//   4. one node id at more than one `level` — the blast radius of D113, the
//      dedup guard that tests a key it never writes.
//   5. one node id in more than one lane ROLE — D116, the firm that is both a
//      supplier and a customer and collapses into one node.
//   6. `node_list` against the multi-tier node set — how much of the graph the
//      typed projection WP 8.1 extends cannot currently see.
//
// Every one is a `select`. None of them needs the project §15 measures, because
// D42's lesson is that the largest project is the seeded one: all six run across
// every project in the database and print per-project rows.
async function graphLayerBefore() {
  section("WP 8.0 — the graph layer, measured before it is changed (D127–D133)");

  // 1 ── the shape the ladder depends on, per project.
  const shape = await tryQ(`
    select p.name as project,
           coalesce(p.bom_level, '(null)') as bom_level,
           (select count(*)::int from public.bom_single_level t where t.project_id = p.id) as bom_single,
           (select count(*)::int from public.bom_multi_level  t where t.project_id = p.id) as bom_multi,
           (select coalesce(max(t.level), 0)::int from public.bom_multi_level t where t.project_id = p.id) as max_bom_depth,
           (select count(*)::int from public.inbound_logistics  t where t.project_id = p.id) as inbound,
           (select count(*)::int from public.outbound_logistics t where t.project_id = p.id) as outbound,
           (select count(*)::int from public.supply_chain_data t where t.project_id = p.id) as scd_rows,
           (select count(*)::int from public.supply_chain_data_multi_tier t where t.project_id = p.id) as scdmt_rows
      from public.projects p order by p.created_at`);
  report("the shape every classifier depends on, per project (D130, D127)", shape, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
    const single = rows.filter((r) => r.bom_level === "single");
    const singleWithTier = single.filter((r) => Number(r.scdmt_rows) > 0);
    const singleNoTier = single.filter((r) => Number(r.scdmt_rows) === 0);
    out("");
    out(
      `- **${single.length} of ${rows.length} project(s) are \`bom_level = 'single'\`**, and ${singleNoTier.length} ` +
        "of those hold ZERO `supply_chain_data_multi_tier` rows. That was **D130**: the edge function built the " +
        "multi-tier lanes only inside its multi-level branch, so a single-level project's Process-level page was " +
        "permanently empty and no error said why. **WP 8.2 CLOSED IT IN THE WRITER, AND A NON-ZERO COUNT HERE IS " +
        "NOT THE EXIT CHECK** — the surviving ETL never reads `projects.bom_level` and builds both lanes from " +
        "whichever BOM rows exist, but it changed what a combine WRITES and backfilled nothing. A single-level " +
        "project still reads ZERO here until somebody presses Combine on it. **This line measures ADOPTION, not " +
        "the fix**, which is the distinction §4 D88 cost three packages to learn.",
    );
    if (singleWithTier.length) {
      out(
        `- **${singleWithTier.length} single-level project(s) DO hold multi-tier rows**, which the current ETL ` +
          "cannot produce — they predate a change, or were written by another path. Read them before WP 8.2 " +
          "backfills the lane, because a backfill that assumes the table is empty would double the graph.",
      );
    }
    // THE LADDER'S PRECONDITION, stated per project rather than in general.
    const deep = rows.filter((r) => Number(r.bom_multi) > 0);
    const ladderHolds = deep.filter((r) => Number(r.max_bom_depth) === 4);
    out(
      `- **${deep.length} project(s) have a multi-level BOM at all; ${ladderHolds.length} of them are exactly ` +
        "4 levels deep.** `ProcessLevelNetwork.tsx`'s ladder calls level 5 a supplier and the inbound lane writes " +
        "`max BOM depth + 1`, so the ladder is right on the 4-deep ones and wrong on every other one — suppliers " +
        "there are rendered and labelled `material level N`. That is **D127** as a count of affected projects.",
    );
  });

  // 2 ── the histogram itself, because "max is not 5" does not say what a
  //      reader would see; the level a supplier actually lands on does.
  const levels = await tryQ(`
    select p.name as project, t.data_source, t.level,
           count(*)::int as rows,
           count(distinct t.from_location)::int as distinct_from,
           count(distinct t.to_location)::int   as distinct_to
      from public.supply_chain_data_multi_tier t
      join public.projects p on p.id = t.project_id
     group by 1, 2, 3 order by 1, 2, 3`);
  report("the `level` histogram per lane — what the ladder is actually reading", levels, (rows) => {
    if (!rows?.length) { out("- `supply_chain_data_multi_tier` is empty in every project."); return; }
    out(...table(rows));
    const inboundLevels = [...new Set(rows.filter((r) => r.data_source === "inbound").map((r) => r.level))].sort();
    out("");
    out(
      `- The inbound lane — every row of which is a SUPPLIER edge by construction — occupies level(s) ` +
        `**${inboundLevels.join(", ") || "(none)"}**. The ladder recognises a supplier at 5 and above only. Any ` +
        "other value in that list is a supplier the page types as a material.",
    );
  });

  // 3 ── D129, the severed BOM root, in both edge tables. `''` and NULL are
  //      counted apart because the page's own falsiness test cannot tell them
  //      apart and a migration would have to.
  const blanks = await tryQ(`
    select 'supply_chain_data_multi_tier' as tbl, p.name as project,
           count(*) filter (where t.to_location = '')::int   as to_empty,
           count(*) filter (where t.to_location is null)::int as to_null,
           count(*) filter (where t.from_location = '')::int  as from_empty,
           count(*) filter (where t.from_location is null)::int as from_null,
           count(*) filter (where t.data_source = 'bom' and t.level = 1)::int as bom_level_1_rows
      from public.supply_chain_data_multi_tier t
      join public.projects p on p.id = t.project_id
     group by 1, 2
    union all
    select 'supply_chain_data', p.name,
           count(*) filter (where t.to_location = '')::int,
           count(*) filter (where t.to_location is null)::int,
           count(*) filter (where t.from_location = '')::int,
           count(*) filter (where t.from_location is null)::int,
           count(*) filter (where t.data_source = 'bom')::int
      from public.supply_chain_data t
      join public.projects p on p.id = t.project_id
     group by 1, 2
     order by 1, 2`);
  report("D129 — edges pointing at the empty string, where the BOM root should be", blanks, (rows) => {
    if (!rows?.length) { out("- Both edge tables are empty."); return; }
    out(...table(rows));
    const empties = rows.reduce((a, r) => a + Number(r.to_empty || 0) + Number(r.from_empty || 0), 0);
    out("");
    out(
      empties > 0
        ? `- **${empties} edge endpoint(s) are the empty string.** \`bom_multi_level.higher_level_component_id\` is ` +
          "blank at the top of the tree, where the parent IS the finished product, and the ETL writes that blank " +
          "straight through. The page treats `''` as falsy, so it creates no node and skips the edge: every " +
          "material→finished-product edge is dropped, which is **D129**."
        : "- **No empty endpoints.** Either the BOM roots reach the product already, or no project has a level-1 " +
          "BOM row for the defect to act on — the `bom_level_1_rows` column above says which, and a zero there " +
          "makes D129 latent rather than absent.",
    );
  });

  // 4 ── D128. The dedup guard computes `nodeId::level::data_source` and tests
  //      `nodeMap[dedupKey]` while writing `nodeMap[nodeId]`, so the guard never
  //      fires and the LAST row read wins the node's level, type and lane. This
  //      counts the nodes for which "last row wins" is a real choice.
  const multiLevel = await tryQ(`
    with per_node as (
      select t.project_id, n.node_id,
             count(distinct t.level)::int       as levels,
             count(distinct t.data_source)::int as lanes,
             count(*)::int                      as rows
        from public.supply_chain_data_multi_tier t
        cross join lateral (values (t.from_location), (t.to_location)) as n(node_id)
       where n.node_id is not null and n.node_id <> ''
       group by 1, 2
    )
    select p.name as project,
           count(*)::int                                     as nodes,
           count(*) filter (where levels > 1)::int            as nodes_at_many_levels,
           count(*) filter (where lanes  > 1)::int            as nodes_in_many_lanes,
           sum(rows) filter (where levels > 1)::int           as rows_behind_them,
           max(levels)::int                                   as worst_level_spread
      from per_node
      join public.projects p on p.id = per_node.project_id
     group by 1 order by 1`);
  report("D128 — nodes whose level depends on which row was read last", multiLevel, (rows) => {
    if (!rows?.length) { out("- No multi-tier nodes to count."); return; }
    out(...table(rows));
    const affected = rows.reduce((a, r) => a + Number(r.nodes_at_many_levels || 0), 0);
    out("");
    out(
      `- **${affected} node(s) appear at more than one \`level\`.** For every one of them the page's node map is ` +
        "written by whichever row the loop reached last — its level, its type, its lane and its colour. The guard " +
        "meant to prevent that tests a key the map is never keyed by, so it has never fired once. `levelNodeCounts` " +
        "is incremented in the same unreachable-guard block, which is why the legend counts and the \"BOM levels\" " +
        "tile count ROWS rather than nodes: **D128**.",
    );
  });

  // 5 ── D131. Node identity is a bare string shared by three lanes, so a role
  //      is not part of it. The pairs that matter are the ones a supply-chain
  //      reader would refuse to merge: a firm that sells to the plant and buys
  //      from it is two roles on one legal entity, not one node.
  const roles = await tryQ(`
    with roles as (
      select t.project_id,
             case when t.data_source = 'inbound'  then t.from_location end as supplier,
             case when t.data_source = 'outbound' then t.to_location   end as customer,
             case when t.data_source = 'inbound'  then t.to_location   end as material_in,
             case when t.data_source = 'bom'      then t.from_location end as material_bom,
             case when t.data_source = 'bom'      then t.to_location   end as product_bom,
             case when t.data_source = 'outbound' then t.from_location end as product_out
        from public.supply_chain_data t
    ), per_node as (
      select project_id, node_id,
             bool_or(is_supplier) as is_supplier, bool_or(is_customer) as is_customer,
             bool_or(is_material) as is_material, bool_or(is_product)  as is_product
        from (
          select project_id, supplier    as node_id, true  as is_supplier, false as is_customer, false as is_material, false as is_product from roles where supplier    is not null and supplier    <> ''
          union all
          select project_id, customer,               false, true,  false, false from roles where customer    is not null and customer    <> ''
          union all
          select project_id, material_in,            false, false, true,  false from roles where material_in is not null and material_in <> ''
          union all
          select project_id, material_bom,           false, false, true,  false from roles where material_bom is not null and material_bom <> ''
          union all
          select project_id, product_bom,            false, false, false, true  from roles where product_bom is not null and product_bom <> ''
          union all
          select project_id, product_out,            false, false, false, true  from roles where product_out is not null and product_out <> ''
        ) u
       group by 1, 2
    )
    select p.name as project,
           count(*)::int as nodes,
           count(*) filter (where is_supplier and is_customer)::int as supplier_and_customer,
           count(*) filter (where is_supplier and is_material)::int as supplier_and_material,
           count(*) filter (where is_material and is_product)::int  as material_and_product,
           count(*) filter (where (is_supplier::int + is_customer::int + is_material::int + is_product::int) > 1)::int as any_dual_role
      from per_node
      join public.projects p on p.id = per_node.project_id
     group by 1 order by 1`);
  report("D131 / D127 — nodes holding more than one lane role, which eight classifiers resolve eight ways", roles, (rows) => {
    if (!rows?.length) { out("- `supply_chain_data` is empty in every project."); return; }
    out(...table(rows));
    const dual = rows.reduce((a, r) => a + Number(r.any_dual_role || 0), 0);
    const bothFirm = rows.reduce((a, r) => a + Number(r.supplier_and_customer || 0), 0);
    const supMat = rows.reduce((a, r) => a + Number(r.supplier_and_material || 0), 0);
    const matProd = rows.reduce((a, r) => a + Number(r.material_and_product || 0), 0);
    out("");
    out(
      `- **${dual} node(s) hold more than one lane role**, and each one is where the classifiers diverge by ` +
        "construction: `classify_node_type` resolves a supplier-and-material node to `material` by its priority " +
        "order, `ProductLevelNetwork` resolves it to A or B depending on which row it read last, " +
        "`ProcessLevelNetwork` resolves it to `supplier` through its `inbound` override, and `MapView`'s binary " +
        "supplier-else-customer test drops it from the map. Same node, four answers, one screen apart (**D127**).",
    );
    out(
      `- ${bothFirm} are BOTH a supplier and a customer — **D131**: identity is a bare string with no role in it, ` +
        `so the two collapse into one node. ${supMat} are a supplier and a material; ${matProd} are a material and ` +
        "a product, which is the `subassembly` the SQL classifier has no value for and WP 8.1 adds.",
    );
  });

  // 6 ── the projection WP 8.1 extends, against the graph it is meant to type.
  //      `rebuild_node_list` reads `supply_chain_data` ONLY, so every node that
  //      exists just in the multi-tier lane is outside the typed projection —
  //      which is why Process-level has nothing to read and infers instead.
  const projection = await tryQ(`
    with scdmt_nodes as (
      select distinct t.project_id, n.node_id
        from public.supply_chain_data_multi_tier t
        cross join lateral (values (t.from_location), (t.to_location)) as n(node_id)
       where n.node_id is not null and n.node_id <> ''
    ), scd_nodes as (
      select distinct t.project_id, n.node_id
        from public.supply_chain_data t
        cross join lateral (values (t.from_location), (t.to_location)) as n(node_id)
       where n.node_id is not null and n.node_id <> ''
    )
    select p.name as project,
           (select count(*)::int from public.node_list l where l.project_id = p.id) as node_list_rows,
           (select count(*)::int from scd_nodes   s where s.project_id = p.id)      as scd_nodes,
           (select count(*)::int from scdmt_nodes m where m.project_id = p.id)      as scdmt_nodes,
           (select count(*)::int from scdmt_nodes m
             where m.project_id = p.id
               and not exists (select 1 from public.node_list l
                                where l.project_id = m.project_id and l.node_id = m.node_id)) as scdmt_nodes_untyped,
           (select count(*)::int from public.node_list l
             where l.project_id = p.id and (l.node_type is null or l.node_type = 'unknown')) as node_list_untyped
      from public.projects p order by p.created_at`);
  report("D132 — how much of the graph the typed projection cannot see", projection, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
    const missing = rows.reduce((a, r) => a + Number(r.scdmt_nodes_untyped || 0), 0);
    const unknown = rows.reduce((a, r) => a + Number(r.node_list_untyped || 0), 0);
    out("");
    out(
      `- **${missing} multi-tier node(s) have no \`node_list\` row.** \`rebuild_node_list\` reads ` +
        "`supply_chain_data` and nothing else, so the deep-tier half of the graph — the half Process-level renders " +
        "— is outside the one typed projection this repository has. That is **D132**, and it is why WP 8.1's " +
        "derivation has to read both edge tables before WP 8.3 can make a page read a type instead of guessing one.",
    );
    out(
      `- ${unknown} \`node_list\` row(s) are typed \`unknown\` or NULL. \`classify_node_type\` returns \`unknown\` ` +
        "when a node appears in no lane it recognises, and `ProductLevelNetwork.tsx` defaults an unrecognised " +
        "group to **Supplier** rather than rendering it as unknown — a value displayed for data that does not " +
        "carry it, which is T1.",
    );
  });

  // 7 ── the two columns a page filters on and a report reads, both measured
  //      rather than assumed: `data_source_group` (D133) and a NULL `level`,
  //      which `COALESCE(level, 0)` serves to the ladder as a PRODUCT (D134).
  //
  // WRITTEN FOR BOTH SHAPES, DELIBERATELY. WP 8.2 DROPS `data_source_group` and
  // ADDS `bom_depth`, and its migrations deploy on MERGE — so this probe must
  // answer against production before that deploy and after it, and a §15 report
  // taken from a branch measures the shape WITHOUT the branch's migrations. A
  // probe that names a column unconditionally is a probe that errors on one side
  // of a deploy and reports nothing, which is the state the answer cannot be read
  // out of. The two columns are detected first and the report SAYS WHICH SHAPE IT
  // MEASURED.
  const columnShape = await tryQ(`
    select (select count(*)::int from information_schema.columns
             where table_schema = 'public' and table_name = 'supply_chain_data'
               and column_name = 'data_source_group')            as has_group,
           (select count(*)::int from information_schema.columns
             where table_schema = 'public' and table_name = 'supply_chain_data_multi_tier'
               and column_name = 'bom_depth')                    as has_bom_depth`);
  const hasGroup = Number(columnShape.rows?.[0]?.has_group ?? 0) > 0;
  const hasDepth = Number(columnShape.rows?.[0]?.has_bom_depth ?? 0) > 0;

  const columns = await tryQ(`
    select (select count(*)::int from public.supply_chain_data)                               as scd_rows,
           ${hasGroup
             ? "(select count(*)::int from public.supply_chain_data where data_source_group is not null)"
             : "null::int"}                                                                   as scd_group_written,
           (select count(*)::int from public.supply_chain_data_multi_tier)                     as scdmt_rows,
           (select count(*)::int from public.supply_chain_data_multi_tier where level is null) as scdmt_level_null,
           (select count(*)::int from public.supply_chain_data_multi_tier where level = 0)     as scdmt_level_zero,
           ${hasDepth
             ? "(select count(*)::int from public.supply_chain_data_multi_tier where bom_depth is distinct from level)"
             : "null::int"}                                                                   as depth_alias_broken`);
  report("D133 / D134 — the documented filter column, and the NULL level the RPC types as a product", columns, (rows) => {
    if (!rows?.length) { out("- No rows returned."); return; }
    out(...table(rows));
    const r = rows[0];
    out("");
    out(
      `- **Shape measured:** \`data_source_group\` ${hasGroup ? "EXISTS" : "is GONE"}, ` +
        `\`bom_depth\` ${hasDepth ? "EXISTS" : "is ABSENT"}. WP 8.2 drops the first and adds the second, ` +
        "and its migrations deploy on MERGE — so a report taken from a feature branch measures the schema " +
        "WITHOUT them, and this line says which one this run saw rather than leaving it to be inferred.",
    );
    out(
      !hasGroup
        ? "- **`data_source_group` is gone, with its contract claim, and that closes D133.** It was written on 0 " +
          "of 5 445 rows while its sidecar told readers the network pages filter on it. Writing it was the worse " +
          "of the two outcomes D133 allowed: `data_source` holds three values and a \"coarser grouping\" of three " +
          "is not a grouping."
        : Number(r.scd_group_written) === 0
          ? `- **\`data_source_group\` is written on 0 of ${r.scd_rows} rows.** Its sidecar says the network pages ` +
            "filter on it and no writer anywhere sets it, so the filter is a documented fact about a column that is " +
            "always NULL — **D133**. WP 8.2 deletes it and its contract claim together; this run predates that deploy."
          : `- \`data_source_group\` is written on ${r.scd_group_written} of ${r.scd_rows} rows — the sidecar's ` +
            "claim is partly true, and WP 8.2 owns which rows it is false for.",
    );
    out(
      `- **${r.scdmt_level_null} row(s) carry a NULL \`level\`** and ${r.scdmt_level_zero} carry 0. ` +
        (hasDepth
          ? "The read path no longer substitutes 0 for a NULL (D134 closed by WP 8.2), so a NULL here now reaches " +
            "the page as a NULL. **A non-zero count is no longer a defect — it is an unknown depth arriving as " +
            "unknown**, which is what the column is for."
          : "`COALESCE(scdmt.level, 0)` in the multi-tier RPC serves a NULL as 0, and the ladder calls 0 a " +
            "**product**: an unknown depth is answered with a confident wrong type rather than with `unknown` " +
            "(**D134**). A zero count makes it latent, not closed — nothing stops the next NULL."),
    );
    if (hasDepth) {
      out(
        Number(r.depth_alias_broken) === 0
          ? "- `level` and `bom_depth` agree on every row, which is what a DEPRECATED ALIAS means: the same value, " +
            "NULLs included, for one release. **This is the number to watch while the readers move** — the day it " +
            "is non-zero, `level` has stopped being an alias and started being a second authoring."
          : `- **${r.depth_alias_broken} row(s) have \`level\` different from \`bom_depth\`.** ` +
            "`level` is supposed to be a deprecated ALIAS carrying the same value. Something wrote one without the " +
            "other, and every page still reading `level` is reading a value the honest column disagrees with.",
      );
      out(
        "- **AND THE ROWS THIS DEPLOY DID NOT FIX ARE THE POINT.** WP 8.2 changed what a combine WRITES, not what " +
          "is stored: every project still holds the graph its last combine produced, at whatever `level` that " +
          "writer meant. `Project AA - ver3` needs Combine re-run. Probe 8's histogram is where to check it.",
      );
    }
  });
}

// ── WP 8.0, probes 8–11: WHICH ETL wrote this project's graph? ──────────────
//
// THE FIRST SEVEN PROBES ANSWERED A QUESTION THAT TURNED OUT TO BE THE WRONG ONE,
// and the report is what said so. Run 35433237514 read the `level` histogram and
// two projects with the SAME 396-row, 4-deep `bom_multi_level` disagreed about
// their own lane: one held bom levels 1, 2, 3 and 4 as the ETL's `row.level || 1`
// would write them, and the other held **397 bom rows all at level 2**, with its
// inbound lane split across levels 1 and 5.
//
// No reading of `combine-project/index.ts` can produce that, because a second
// ETL exists. `combine_project_into_supply_chain` is a SQL RPC called from three
// client sites, it writes BOTH edge tables, and it writes `level` by a fourth
// rule that is nothing like the edge function's: outbound `0`, `bom_single_level`
// a literal `1`, **`bom_multi_level` a literal `2` — ignoring `b.level`
// entirely** — and inbound `GREATEST(1, max_level + 1)` per material. That is
// D140, and it is the ninth classifier of the eight D127 counts, one layer down:
// two live writers disagreeing about what the column MEANS, where D127 is eight
// live readers disagreeing about what it SAYS.
//
// It also changes D129 from "an edge is dropped" to something worse. The RPC
// writes `COALESCE(b.higher_level_component_id, 'ROOT')` — so where the BOM root
// has no parent it does not drop the edge, it **invents a node called `ROOT`** and
// points every root material at it. The first seven probes found zero empty
// endpoints and read that as D129 being latent. It is not latent; it is a
// different shape, and a count of `''` could never have seen it.
//
// So: four more probes, all `select`, all every-project. Which writer wrote each
// lane (probe 8), whether `ROOT` is in the data (probe 9), whether the lane still
// agrees with the tables it was derived from (probe 10), and how many BOM roots
// there are for the defect to act on (probe 11).
async function graphLayerWhoWroteIt() {
  section("WP 8.0 — WHICH ETL wrote this graph, and what it invented (D140, D141)");

  // 8 ── the signature. The two writers leave different fingerprints in the bom
  //      lane, and the BOM's own depth is the control.
  const signature = await tryQ(`
    select p.name as project,
           (select coalesce(max(b.level), 0)::int from public.bom_multi_level b where b.project_id = p.id) as bom_table_max_depth,
           (select count(distinct b.level)::int    from public.bom_multi_level b where b.project_id = p.id) as bom_table_depths,
           (select string_agg(distinct t.level::text, ',' order by t.level::text)
              from public.supply_chain_data_multi_tier t
             where t.project_id = p.id and t.data_source = 'bom')      as lane_bom_levels,
           (select string_agg(distinct t.level::text, ',' order by t.level::text)
              from public.supply_chain_data_multi_tier t
             where t.project_id = p.id and t.data_source = 'inbound')  as lane_inbound_levels
      from public.projects p order by p.created_at`);
  report("D140 — the bom lane's levels against the BOM table's own depths", signature, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
    const withLane = rows.filter((r) => r.lane_bom_levels);
    const flattened = withLane.filter((r) => Number(r.bom_table_depths) > 1 && r.lane_bom_levels === "2");
    const laddered = withLane.filter((r) => (r.lane_bom_levels ?? "").includes(","));
    out("");
    out(
      `- **${flattened.length} project(s) have a multi-depth BOM whose entire bom lane sits at level 2**, and ` +
        `${laddered.length} carry a ladder of several levels. Those are the two ETLs' fingerprints: the SQL RPC ` +
        "writes a LITERAL `2` for every `bom_multi_level` row and the edge function writes `row.level || 1`, so the " +
        "histogram says which one last ran — and a page reading a fixed echelon ladder is reading a column whose " +
        "meaning depends on that. **D140**: two live writers, one column, two definitions.",
    );
    out(
      "- The `lane_inbound_levels` column is the same story on the other lane. Both writers use a `max BOM depth + 1` " +
        "shape there, so a material absent from `bom_multi_level` lands at **1** and one at depth 4 lands at **5** — " +
        "two suppliers, four levels apart, in the same upload. The page's ladder calls the first a material.",
    );
  });

  // 9 ── the invented node. `'ROOT'` is not a material, a product, a supplier or
  //      a customer; it is a string the RPC substitutes for a missing parent.
  const root = await tryQ(`
    select p.name as project,
           (select count(*)::int from public.supply_chain_data_multi_tier t
             where t.project_id = p.id and (t.to_location = 'ROOT' or t.from_location = 'ROOT')) as scdmt_root_edges,
           (select count(*)::int from public.supply_chain_data t
             where t.project_id = p.id and (t.to_location = 'ROOT' or t.from_location = 'ROOT')) as scd_root_edges,
           (select count(*)::int from public.node_list l
             where l.project_id = p.id and l.node_id = 'ROOT')                                    as node_list_root,
           (select count(*)::int from public.bom_multi_level b
             where b.project_id = p.id
               and (b.higher_level_component_id is null or btrim(b.higher_level_component_id) = '')) as bom_roots
      from public.projects p order by p.created_at`);
  report("D141 — `ROOT`, the node no upload contains", root, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
    const edges = rows.reduce((a, r) => a + Number(r.scdmt_root_edges || 0) + Number(r.scd_root_edges || 0), 0);
    const typed = rows.reduce((a, r) => a + Number(r.node_list_root || 0), 0);
    const roots = rows.reduce((a, r) => a + Number(r.bom_roots || 0), 0);
    out("");
    out(
      edges > 0
        ? `- **${edges} edge(s) name a node called \`ROOT\`, and ${typed} of them reached \`node_list\` as a typed ` +
          "node.** `COALESCE(b.higher_level_component_id, 'ROOT')` invents it where the BOM root has no parent — the " +
          "place the sidecar says the parent IS the finished product. So the finished product is still severed from " +
          "its own BOM, and in its place there is a node that no CSV contains, that no user can explain, and that " +
          "every centrality on the page is computed over. **T1 in one string**: a node on screen sourced to nothing."
        : `- **No \`ROOT\` edges.** The substitution is in the live RPC and has produced nothing measurable — either ` +
          `no project has a parentless BOM row (the \`bom_roots\` column says: ${roots} across all projects), or the ` +
          "lane predates it. A zero here makes D141 latent, not absent: the `COALESCE` is still what the next " +
          "parentless row meets.",
    );
    out(
      `- ${roots} \`bom_multi_level\` row(s) have no parent at all, which is how many finished-product edges the ` +
        "two writers have to get right. The edge function drops them (the demand walk finds no parent, so the child " +
        "gets no root and the row is never emitted); the RPC points them at `ROOT`. **Neither writes the product** — " +
        "which is D129, restated against what the data actually shows rather than against the `|| ''` a reader sees " +
        "first.",
    );
  });

  // 10 ── is the lane still true? Neither writer is triggered by an upload, so a
  //       later CSV changes the source tables and leaves the graph alone.
  const stale = await tryQ(`
    select p.name as project,
           (select count(*)::int from public.inbound_logistics  s where s.project_id = p.id) as inbound_src,
           (select count(*)::int from public.supply_chain_data_multi_tier t
             where t.project_id = p.id and t.data_source = 'inbound')                        as inbound_lane,
           (select count(*)::int from public.outbound_logistics s where s.project_id = p.id) as outbound_src,
           (select count(*)::int from public.supply_chain_data_multi_tier t
             where t.project_id = p.id and t.data_source = 'outbound')                       as outbound_lane,
           (select count(*)::int from public.bom_multi_level b where b.project_id = p.id)
             + (select count(*)::int from public.bom_single_level b where b.project_id = p.id) as bom_src,
           (select count(*)::int from public.supply_chain_data_multi_tier t
             where t.project_id = p.id and t.data_source = 'bom')                            as bom_lane,
           (select max(t.updated_at) from public.supply_chain_data_multi_tier t where t.project_id = p.id) as lane_written,
           (select max(s.updated_at) from public.inbound_logistics s where s.project_id = p.id)            as inbound_touched
      from public.projects p order by p.created_at`);
  report("D142 — the lane against the tables it was derived from", stale, (rows) => {
    if (!rows?.length) { out("- No projects."); return; }
    out(...table(rows));
    const drifted = rows.filter(
      (r) => Number(r.inbound_lane) > 0 && Number(r.inbound_lane) !== Number(r.inbound_src),
    );
    out("");
    out(
      drifted.length
        ? `- **${drifted.length} project(s) have an inbound lane whose row count does not match ` +
          "`inbound_logistics`.** Neither writer is a trigger: both are invoked by a client, so a CSV uploaded after " +
          "the last combine changes the source table and leaves the graph exactly as it was. The page then renders a " +
          "graph of a world that no longer exists, with no staleness signal on it — **D142**, and it is the one " +
          "defect in this phase that a user would describe as \"the map looks wrong\" without any classifier being " +
          "involved at all."
        : "- Every non-empty inbound lane matches its source row count. That does not make the lane fresh — a " +
          "same-size edit moves no count — but it removes the largest and cheapest explanation.",
    );
    out(
      "- `lane_written` beside `inbound_touched` is the direct comparison. A source touched AFTER the lane was " +
        "written is a graph derived from data that has since changed, and `project_freshness` is shown on " +
        "Product-level and on no other network page.",
    );
  });
}

async function main() {
  out(`# PLAN.md §15 — verification SQL, executed`);
  out("");
  out(`- project ref: \`${ref}\``);
  out(`- run at: ${new Date().toISOString()}`);
  out(`- route: Supabase Management API \`/database/query\` (the route §16 · WP 2.1 follow-up and \`seed-project.yml\` prove)`);
  out(`- every statement is a \`select\`; \`assertReadOnly()\` refuses anything else.`);

  await migrationFenceOpen();

  await schemaProbe();
  await viewSecurity();
  await d30();
  await d29();
  await boundaryDecisions();
  await ingestTables();
  await graphHashBlastRadius();
  await wp42Smear();
  await wp42Landed();
  await wp43and44Counts();
  await wp62and64Before();
  await graphLayerBefore();
  await graphLayerWhoWroteIt();
  await wp71Stage0();

  const project = await pickProject();
  if (!project) {
    section("§15 · per-project queries — SKIPPED");
    out("- `inbound_logistics` holds no rows in any project, so there is no project to measure.");
  } else {
    section(`§15 · the project measured`);
    out(`- \`project_id\` = \`${project.id}\` — **${project.name}** — chosen because it has the ${project.why}.`);
    await section15(project.id);
  }

  await allProjectsSweep();
  await migrationFenceClose();

  out("");
  out(`_${queryCount} statements, all \`SELECT\`._`);

  if (gateFailures.length) {
    section("GATE — this run FAILS");
    for (const f of gateFailures) out(`- ${f}`);
    out("");
    out("_The report above is complete; the run exits non-zero so the workflow is red._");
  }

  if (outPath) writeFileSync(outPath, lines.join("\n") + "\n");
  if (gateFailures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nverification-sql FAILED: ${err.message ?? err}`);
  if (outPath) writeFileSync(outPath, lines.join("\n") + `\n\n**RUN FAILED:** ${err.message ?? err}\n`);
  process.exit(1);
});
