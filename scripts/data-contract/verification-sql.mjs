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

// ── schema probe: what does production ACTUALLY have? (D32) ────────────────
async function schemaProbe() {
  section("Schema probe — production vs. the migrations (D32)");

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
  if (extra.length) out(...table(extra.map((t) => ({ untracked_relation: t }))));

  return liveNames;
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
  if (forcedProject) return { id: forcedProject, why: "passed with --project" };
  const rows = await q(`
    select i.project_id as id, count(*)::int as inbound_rows
    from public.inbound_logistics i
    group by 1 order by 2 desc limit 1`);
  if (!rows.length) return null;
  return { id: rows[0].id, why: `most inbound_logistics rows (${rows[0].inbound_rows})` };
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

  section("§15 · D3 / D4 — the orphan tables are genuinely absent");
  report("orphan tables", await tryQ(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('product_code_map','risk_data')`),
    (rows) => out(rows.length
      ? `- **STILL PRESENT: ${rows.map((r) => r.table_name).join(", ")}** — WP 1.4's reconciliation described a table production still holds.`
      : "- Neither table exists. WP 1.4's reconciliation matches production."));
}

async function main() {
  out(`# PLAN.md §15 — verification SQL, executed`);
  out("");
  out(`- project ref: \`${ref}\``);
  out(`- run at: ${new Date().toISOString()}`);
  out(`- route: Supabase Management API \`/database/query\` (the route §16 · WP 2.1 follow-up and \`seed-project.yml\` prove)`);
  out(`- every statement is a \`select\`; \`assertReadOnly()\` refuses anything else.`);

  await schemaProbe();
  await d29();
  await boundaryDecisions();

  const project = await pickProject();
  if (!project) {
    section("§15 · per-project queries — SKIPPED");
    out("- `inbound_logistics` holds no rows in any project, so there is no project to measure.");
  } else {
    section(`§15 · the project measured`);
    out(`- \`project_id\` = \`${project.id}\` — chosen because it has the ${project.why}.`);
    await section15(project.id);
  }

  out("");
  out(`_${queryCount} statements, all \`SELECT\`._`);

  if (outPath) writeFileSync(outPath, lines.join("\n") + "\n");
}

main().catch((err) => {
  console.error(`\nverification-sql FAILED: ${err.message ?? err}`);
  if (outPath) writeFileSync(outPath, lines.join("\n") + `\n\n**RUN FAILED:** ${err.message ?? err}\n`);
  process.exit(1);
});
