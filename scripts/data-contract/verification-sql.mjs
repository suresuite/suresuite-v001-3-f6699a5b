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

async function main() {
  out(`# PLAN.md §15 — verification SQL, executed`);
  out("");
  out(`- project ref: \`${ref}\``);
  out(`- run at: ${new Date().toISOString()}`);
  out(`- route: Supabase Management API \`/database/query\` (the route §16 · WP 2.1 follow-up and \`seed-project.yml\` prove)`);
  out(`- every statement is a \`select\`; \`assertReadOnly()\` refuses anything else.`);

  await schemaProbe();
  await d30();
  await d29();
  await boundaryDecisions();
  await ingestTables();

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
