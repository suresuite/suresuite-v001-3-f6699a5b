#!/usr/bin/env node
// Phase B0 / real-project onboarding / §8 — seed "Project TRON - ver2", the
// WSC 2026 make-to-order supply chain (17 products × 560 materials × 60
// suppliers, dataset built by scripts/tron_ver2/build_dataset.py from
// SC_data__MOR.xlsx and cross-checked against the reference snapshot).
//
// Follows scripts/seed_example_project.mjs exactly — the same app lifecycle
// (DataManager.tsx), dependency-free, anon key from the frontend source:
//
//   create_project (or reuse) → bulk_upsert_{suppliers,materials,products}
//   → delete_project_dataset('all') → bulk_insert_{bom_single_level,
//     inbound_logistics,outbound_logistics} → update_project_completion_status
//   → combine_project_into_supply_chain → rebuild_node_list
//
// …and then the policy/scenario surface the /policies + Simulation Lab pages use:
//
//   save_policy_defaults (per family) → snapshot_policy (immutable version)
//   → scenarios rows (baseline + supplier-965 stress test) via anon REST.
//
// Idempotent: project is found by name for the modeler; masters upsert on
// (project_id, id); arcs are cleared and re-inserted; policy families are
// full-row updates; a new policy snapshot is only taken when the current
// policy hash differs from the latest saved version; scenarios upsert by name.
//
// Usage:
//   node scripts/seed_project_tron_ver2.mjs --dry-run
//   USER_ID=<uuid> USER_EMAIL=<email> node scripts/seed_project_tron_ver2.mjs
//
// A LIVE run needs BOTH USER_ID and USER_EMAIL (the approved_users identity
// the project must belong to — organization scoping hides it otherwise; see
// seed_example_project.mjs for the auth model).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const clientTs = readFileSync(join(repoRoot, "src/integrations/supabase/client.ts"), "utf8");
const SUPABASE_URL = clientTs.match(/SUPABASE_URL = "([^"]+)"/)?.[1];
const ANON_KEY = clientTs.match(/SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)?.[1];
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("could not parse SUPABASE_URL / anon key from client.ts");
  process.exit(2);
}

const DRY_RUN = process.argv.includes("--dry-run");
const USER_ID = process.env.USER_ID || null;
const USER_EMAIL = process.env.USER_EMAIL || null;
const USER_NAME = process.env.USER_NAME || "TRON Seed";
const BATCH = 250; // rows per bulk RPC call (560-material masters → 3 calls)

const ds = JSON.parse(
  readFileSync(join(repoRoot, "scripts/tron_ver2/dataset.json"), "utf8"),
);
const PROJECT = ds.project; // { name, plant_name, supply_chain_model, bom_level }

// ── Local validation (mirrors the §8.1 gate's structural hard blocks) ───────
const FULFILLMENT_MODES = new Set(["mto", "mts"]);
const DEMAND_DISTS = new Set(["triangular", "deterministic", "poisson", "negbin"]);
const LEAD_TIME_DISTS = new Set(["deterministic", "lognormal", "gamma"]);

function validate() {
  const errors = [];
  const productIds = new Set(ds.products.map((p) => p.product_id));
  const materialIds = new Set(ds.materials.map((m) => m.material_id));
  const supplierIds = new Set(ds.suppliers.map((s) => s.supplier_id));
  const sourcedMaterials = new Set(ds.inbound.map((a) => a.material_id));

  if (ds.products.length < 1) errors.push("structural: need ≥1 product");
  for (const p of ds.products) {
    if (!FULFILLMENT_MODES.has(p.fulfillment_mode)) errors.push(`${p.product_id}: bad fulfillment_mode`);
    if (!DEMAND_DISTS.has(p.demand_distribution)) errors.push(`${p.product_id}: bad demand_distribution`);
    if (p.demand_min != null && p.demand_min > p.demand_mean)
      errors.push(`${p.product_id}: demand_min > demand_mean`);
    if (p.demand_max != null && p.demand_max < p.demand_mean)
      errors.push(`${p.product_id}: demand_max < demand_mean`);
  }
  for (const m of ds.materials)
    if (m.lead_time_dist && !LEAD_TIME_DISTS.has(m.lead_time_dist))
      errors.push(`${m.material_id}: bad lead_time_dist`);
  for (const b of ds.bom) {
    if (!productIds.has(b.product_id)) errors.push(`bom: unknown product ${b.product_id}`);
    if (!materialIds.has(b.material_id)) errors.push(`bom: unknown material ${b.material_id}`);
    if (!sourcedMaterials.has(b.material_id))
      errors.push(`bom: material ${b.material_id} unsourced (engine hard block)`);
    if (!(b.consumption_rate > 0)) errors.push(`bom: rate ≤ 0 on ${b.product_id}→${b.material_id}`);
  }
  for (const a of ds.inbound) {
    if (!supplierIds.has(a.supplier_id)) errors.push(`inbound: unknown supplier ${a.supplier_id}`);
    if (!materialIds.has(a.material_id)) errors.push(`inbound: unknown material ${a.material_id}`);
    if (!(a.unit_price > 0)) errors.push(`inbound: unit_price ≤ 0 on ${a.supplier_id}→${a.material_id}`);
    if (!(a.lead_time >= 1 && a.lead_time <= 51))
      errors.push(`inbound: lead_time out of [1,51] on ${a.supplier_id}→${a.material_id}`);
  }
  for (const o of ds.outbound)
    if (!productIds.has(o.product_id)) errors.push(`outbound: unknown product ${o.product_id}`);
  return errors;
}

// ── REST / RPC helpers ───────────────────────────────────────────────────────
const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// On a statement timeout, dump who is blocking whom RIGHT NOW (read-only
// Management API query) — post-mortem activity dumps keep coming back empty
// because the blocker's own statements also time out and release.
async function dumpBlockers(context) {
  const token = process.env.DIAG_MANAGEMENT_TOKEN;
  if (!token) return;
  try {
    const ref = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1];
    const sql =
      "select a.pid, a.state, now()-a.xact_start as xact_age, " +
      "pg_blocking_pids(a.pid) as blocked_by, left(a.query,140) as query " +
      "from pg_stat_activity a where a.xact_start is not null " +
      "and a.pid <> pg_backend_pid() order by a.xact_start";
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    console.log(`  ⤷ live sessions at ${context}: ${JSON.stringify(await res.json())}`);
  } catch (err) {
    console.log(`  ⤷ blocker dump failed: ${err.message ?? err}`);
  }
}

async function rpc(fn, args) {
  // Each RPC is a single transaction, so a failed call leaves no partial
  // state — retrying transient faults (statement timeout 57014, 5xx, network)
  // is safe. Non-transient errors (4xx) fail immediately.
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let status, body;
    try {
      ({ status, body } = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }));
    } catch (err) {
      lastErr = new Error(`rpc ${fn} → network error: ${err.message ?? err}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (status < 300) return body;
    lastErr = new Error(`rpc ${fn} → HTTP ${status}: ${JSON.stringify(body)}`);
    const transient = status >= 500 || body?.code === "57014";
    if (!transient) throw lastErr;
    console.log(`  … transient ${fn} failure (attempt ${attempt}/4): HTTP ${status} ${body?.code ?? ""} — retrying`);
    if (body?.code === "57014") await dumpBlockers(`${fn} attempt ${attempt}`);
    await sleep(2000 * attempt);
  }
  throw lastErr;
}

async function rpcBatched(fn, rows, argsOf, batch = BATCH) {
  let total = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const n = await rpc(fn, argsOf(rows.slice(i, i + batch)));
    total += typeof n === "number" ? n : rows.slice(i, i + batch).length;
  }
  return total;
}

const arcRows = (rows, projectId) =>
  rows.map((r) => ({ ...r, plant_name: PROJECT.plant_name, project_id: projectId }));

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Project TRON - ver2 seed — ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  ${SUPABASE_URL}`);
  console.log(
    `  dataset: ${ds.suppliers.length} suppliers · ${ds.materials.length} materials · ` +
    `${ds.products.length} products · ${ds.bom.length} bom · ${ds.inbound.length} inbound · ` +
    `${ds.outbound.length} outbound · ${ds.scenarios.length} scenarios`,
  );

  const errors = validate();
  if (errors.length) {
    console.error(`\n✗ validation FAILED (${errors.length}):`);
    for (const e of errors.slice(0, 25)) console.error(`    - ${e}`);
    process.exit(1);
  }
  console.log("✓ payload validation passed (enums, referential integrity, gate hard blocks)");

  if (DRY_RUN) {
    console.log("\nDRY RUN complete — no writes. Live run seeds project " +
      `"${PROJECT.name}" (plant "${PROJECT.plant_name}", ${PROJECT.supply_chain_model}).`);
    return;
  }

  if (!USER_ID || !USER_EMAIL) {
    console.error(
      "\n✗ a LIVE run needs BOTH USER_ID and USER_EMAIL (approved_users identity\n" +
      "  of the modeler who should own the project — org scoping hides it otherwise).\n" +
      "  USER_ID=<uuid> USER_EMAIL=<email> node scripts/seed_project_tron_ver2.mjs",
    );
    process.exit(2);
  }
  const auth = { p_user_id: USER_ID, p_user_email: USER_EMAIL };
  console.log(`  modeler identity: ${USER_EMAIL} (${USER_ID})`);

  // 1) Resolve project (create or reuse by name for this modeler).
  console.log("\n── resolving project (create or reuse)");
  const existing = await rpc("list_projects", { ...auth });
  let project = Array.isArray(existing) ? existing.find((p) => p.name === PROJECT.name) : null;
  let projectId;
  if (project) {
    projectId = project.id;
    console.log(`  reusing existing project ${projectId}`);
  } else {
    try {
      projectId = await rpc("create_project", {
        p_name: PROJECT.name,
        p_plant: PROJECT.plant_name,
        p_model: PROJECT.supply_chain_model,
        p_bom_level: PROJECT.bom_level,
        p_user_id: USER_ID,
        p_user_email: USER_EMAIL,
        p_user_name: USER_NAME,
        p_data_type: "curated",
      });
      console.log(`  created project ${projectId}`);
    } catch (err) {
      // G16 "wrong-org invisibility": the unique key (modeler_id, plant_name,
      // name) says the project EXISTS for this modeler, yet the org-scoped
      // list_projects did not return it — projects.organization has drifted
      // from the owner's current approved_users.organization. Recover the id
      // through an org-independent read (the seeded scenarios are anon-
      // readable and carry project_id); the final visibility check below
      // remains the hard gate, so a still-misaligned org fails loudly there.
      if (!String(err.message).includes("uq_modeler_project")) throw err;
      console.error(
        "  ! create_project hit uq_modeler_project — the project exists but is NOT\n" +
        "    visible via list_projects under this identity (G16 org mismatch:\n" +
        "    projects.organization != owner's current approved_users.organization).\n" +
        "    The workflow's 'Org-visibility diagnosis + repair' step re-stamps it;\n" +
        "    recovering the project id via its seeded scenarios…",
      );
      const scenarioName = ds.scenarios[0]?.name;
      const found = await rest(
        `scenarios?select=project_id,created_at&name=eq.${encodeURIComponent(scenarioName)}&order=created_at.desc&limit=1`,
      );
      projectId = found.status === 200 ? found.body?.[0]?.project_id : null;
      if (!projectId) {
        throw new Error(
          `project exists (uq_modeler_project) but could not be recovered via scenario "${scenarioName}" — ` +
          "repair projects.organization to the owner's org and re-run",
        );
      }
      console.log(`  recovered existing project ${projectId} (org repair pending verification below)`);
    }
  }

  // 2) Item masters (chunked upserts — idempotent on (project_id, id)).
  console.log("── upserting item masters");
  console.log(`  suppliers: ${await rpcBatched("bulk_upsert_suppliers", ds.suppliers,
    (rows) => ({ p_project_id: projectId, p_rows: rows }))} row(s)`);
  console.log(`  materials: ${await rpcBatched("bulk_upsert_materials", ds.materials,
    (rows) => ({ p_project_id: projectId, p_rows: rows }))} row(s)`);
  console.log(`  products:  ${await rpcBatched("bulk_upsert_products", ds.products,
    (rows) => ({ p_project_id: projectId, p_rows: rows }))} row(s)`);

  // 3) Clear + re-insert arcs (masters upsert; arcs are insert-only).
  console.log("── clearing existing arcs (idempotency)");
  console.log(`  deleted ${await rpc("delete_project_dataset", { p_project_id: projectId, p_dataset: "all", ...auth })} arc row(s)`);
  console.log("── inserting arcs (bom + inbound + outbound)");
  console.log(`  bom:      ${await rpcBatched("bulk_insert_bom_single_level", ds.bom,
    (rows) => ({ p_rows: arcRows(rows, projectId), ...auth }))} row(s)`);
  console.log(`  inbound:  ${await rpcBatched("bulk_insert_inbound_logistics", ds.inbound,
    (rows) => ({ p_rows: arcRows(rows, projectId), ...auth }))} row(s)`);
  // Outbound inserts have shown ~100× the per-row trigger cost of the other
  // arc tables on the live DB (anon statement_timeout is 3s) — tiny batches
  // keep each RPC statement safely under it while the root cause is fixed.
  console.log(`  outbound: ${await rpcBatched("bulk_insert_outbound_logistics", ds.outbound,
    (rows) => ({ p_rows: arcRows(rows, projectId), ...auth }), 5)} row(s)`);

  // 4) Combine into the supply-chain graph + rebuild node list.
  console.log("── combining + rebuilding node list");
  await rpc("update_project_completion_status", { p_project_id: projectId, ...auth });
  await rpc("combine_project_into_supply_chain", { p_project_id: projectId, ...auth });
  await rpc("rebuild_node_list", { p_project_id: projectId, ...auth });

  // 5) Policy defaults (per family) + fulfillment strategy — the same RPC the
  //    /policies UI saves through.
  console.log("── saving policy defaults");
  const { fulfillment_strategy, ...families } = ds.policies;
  let first = true;
  for (const [family, value] of Object.entries(families)) {
    await rpc("save_policy_defaults", {
      p_project_id: projectId,
      p_family: family,
      p_value: value,
      p_strategy: first ? fulfillment_strategy : null,
    });
    console.log(`  ${family}: ${JSON.stringify(value)}`);
    first = false;
  }

  // 6) Immutable policy version — only when the live tables differ from the
  //    latest saved snapshot (keeps re-runs from stacking identical versions).
  console.log("── snapshotting policy version");
  const currentHash = await rpc("current_policy_hash", { p_project_id: projectId });
  const { body: latest } = await rest(
    `policy_versions?select=id,policy_hash&project_id=eq.${projectId}&order=created_at.desc&limit=1`,
  );
  let versionId = Array.isArray(latest) && latest[0]?.policy_hash === currentHash
    ? latest[0].id : null;
  if (versionId) {
    console.log(`  unchanged — reusing version ${versionId}`);
  } else {
    versionId = await rpc("snapshot_policy", {
      p_project_id: projectId,
      p_label: "TRON ver2 baseline (WSC 2026)",
      p_user_id: USER_ID,
      p_user_email: USER_EMAIL,
      p_user_name: USER_NAME,
    });
    console.log(`  saved version ${versionId}`);
  }

  // 7) Scenarios (baseline + stress test) — upsert by (project, name), the
  //    same anon REST surface the Run & Validate stage uses.
  console.log("── upserting scenarios");
  for (const sc of ds.scenarios) {
    const { name, ...fields } = sc;
    const found = await rest(
      `scenarios?select=id&project_id=eq.${projectId}&name=eq.${encodeURIComponent(name)}&limit=1`,
    );
    if (found.status === 200 && found.body.length > 0) {
      const patched = await rest(`scenarios?id=eq.${found.body[0].id}`, {
        method: "PATCH", body: JSON.stringify(fields),
      });
      if (patched.status >= 300) throw new Error(`scenario patch → HTTP ${patched.status}: ${JSON.stringify(patched.body)}`);
      console.log(`  updated "${name}" (${found.body[0].id})`);
    } else {
      const created = await rest("scenarios", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ project_id: projectId, name, ...fields }),
      });
      if (created.status !== 201) throw new Error(`scenario create → HTTP ${created.status}: ${JSON.stringify(created.body)}`);
      console.log(`  created "${name}" (${created.body[0].id})`);
    }
  }

  // 8) Dataset status + visibility for the seeding modeler.
  const status = await rpc("get_project_dataset_status", { p_project_id: projectId, ...auth });
  const listAfter = await rpc("list_projects", { ...auth });
  const seen = Array.isArray(listAfter) ? listAfter.find((p) => p.id === projectId) : null;

  console.log("\n════════ seed complete ════════");
  console.log(`project_id: ${projectId}`);
  console.log(`policy_version_id: ${versionId}`);
  console.log(`open in app: /project-manager?project=${projectId}`);
  console.log(`dataset status: ${JSON.stringify(status)}`);
  const datasetComplete = !!(status && status.has_bom && status.has_inbound && status.has_outbound);
  if (datasetComplete) console.log("✓ dataset complete (bom + inbound + outbound present)");
  else console.error("✗ dataset NOT complete — check the status above");
  if (seen) {
    console.log(`✓ visible to ${USER_EMAIL} via list_projects (org "${seen.organization ?? "(null)"}")`);
  } else {
    console.error(`✗ NOT visible to ${USER_EMAIL} via list_projects — wrong owning identity?`);
  }

  // Machine-readable outputs for the follow-up verify job (GitHub Actions).
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT,
      `project_id=${projectId}\npolicy_version_id=${versionId}\n`);
  }
  if (!datasetComplete || !seen) process.exit(1);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message ?? err}`);
  process.exit(1);
});
