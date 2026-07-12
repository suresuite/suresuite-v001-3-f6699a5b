#!/usr/bin/env node
// Phase B0 / test-fixture / §8 — seed a minimal, complete, VALID example
// project (1 finished product, 2 raw materials, 3 suppliers) so the pre-run
// validation gate passes with zero blocking findings and the engine produces
// non-degenerate KPIs. A reproducible verification vehicle for later
// policy/engine work — data-seeding only, no engine/UI changes.
//
// It drives the SAME lifecycle the app (src/pages/DataManager.tsx) uses,
// dependency-free (raw fetch, the anon key from the frontend source), so a
// green run here means the deployed app's own path works:
//
//   create_project (or reuse) → bulk_upsert_{suppliers,materials,products}
//   → delete_project_dataset('all') → bulk_insert_{bom_single_level,
//     inbound_logistics,outbound_logistics} → update_project_completion_status
//   → combine_project_into_supply_chain → rebuild_node_list
//   → get_project_dataset_status
//
// Idempotent: re-running finds the project by name for the modeler and reuses
// it (masters upsert on their key; arcs are cleared before re-insert), so it
// updates the same project instead of duplicating it.
//
// ── Auth model (why USER_ID / USER_EMAIL are needed for a LIVE run) ──────────
// The app uses a custom auth system; the Supabase client always holds the anon
// JWT (role `anon`). Writes therefore go through SECURITY DEFINER RPCs. The
// item-master upserts (bulk_upsert_*) are open to anon, but the
// project-lifecycle and arc-insert RPCs (create_project, bulk_insert_*,
// combine_*, rebuild_node_list, delete_project_dataset) resolve the caller's
// organization from public.approved_users and require the caller to be the
// project's modeler (or an org admin). So a live run must pass a real approved
// user's id + email (the same identity the browser session carries). A
// --dry-run needs none of this.
//
// Usage:
//   node scripts/seed_example_project.mjs --dry-run        # print + validate, no writes
//   USER_ID=<uuid> USER_EMAIL=<email> node scripts/seed_example_project.mjs
//
// Env:
//   USER_ID       (required for a live run) approved_users.id of the modeler
//   USER_EMAIL    (default phu.nguyen.gd@gmail.com) that user's email
//   USER_NAME     (default "Example Seed") modeler display name on create
//   PROJECT_NAME  (default "Example — 1P/2M/3S")
//   PLANT_NAME    (default "Example Plant")

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Connection: single source of truth is the frontend client itself ────────
const clientTs = readFileSync(
  join(repoRoot, "src/integrations/supabase/client.ts"),
  "utf8",
);
const SUPABASE_URL = clientTs.match(/SUPABASE_URL = "([^"]+)"/)?.[1];
const ANON_KEY = clientTs.match(/SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)?.[1];
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("could not parse SUPABASE_URL / anon key from client.ts");
  process.exit(2);
}

const DRY_RUN = process.argv.includes("--dry-run");
const USER_ID = process.env.USER_ID || null;
const USER_EMAIL = process.env.USER_EMAIL || "phu.nguyen.gd@gmail.com";
const USER_NAME = process.env.USER_NAME || "Example Seed";
const PROJECT_NAME = process.env.PROJECT_NAME || "Example — 1P/2M/3S";
const PLANT_NAME = process.env.PLANT_NAME || "Example Plant";
const SUPPLY_CHAIN_MODEL = "Make-To-Order";
const BOM_LEVEL = "single";

// ── Strict enum sets (verified against the RPC CHECKs and scsim) ────────────
//   bulk_upsert_products:  fulfillment_mode ∈ {mto, mts}
//                          demand_distribution ∈ {triangular, deterministic, poisson, negbin}
//   bulk_upsert_materials: lead_time_dist ∈ {deterministic, lognormal, gamma}
const FULFILLMENT_MODES = new Set(["mto", "mts"]);
const DEMAND_DISTS = new Set(["triangular", "deterministic", "poisson", "negbin"]);
const LEAD_TIME_DISTS = new Set(["deterministic", "lognormal", "gamma"]);

// ── The dataset (1 product / 2 materials / 3 suppliers) ─────────────────────
const suppliers = [
  { supplier_id: "S1", name: "Supplier 1", capacity_per_week: 2000, reliability_score: 0.98 },
  { supplier_id: "S2", name: "Supplier 2", capacity_per_week: 2000, reliability_score: 0.95 },
  { supplier_id: "S3", name: "Supplier 3", capacity_per_week: 2000, reliability_score: 0.90 }, // 2nd source for M1
];

const materials = [
  { material_id: "M1", name: "Material 1", cost: 10, holding_cost_pct: 0.20, moq: 0, initial_on_hand: 200, lead_time_dist: "deterministic", lead_time_cv: 0 },
  { material_id: "M2", name: "Material 2", cost: 15, holding_cost_pct: 0.20, moq: 0, initial_on_hand: 150, lead_time_dist: "deterministic", lead_time_cv: 0 },
];

const products = [
  { product_id: "P1", name: "Product 1", sell_price: 100, production_capacity: 200, fulfillment_mode: "mto", demand_distribution: "triangular", demand_mean: 50, demand_cv: 0.20 },
];

// Arc rows carry plant_name + project_id (filled in at write time). BOM top
// level is the finished product; every BOM material has an inbound source.
const bom = [
  { product_id: "P1", material_id: "M1", consumption_rate: 2 },
  { product_id: "P1", material_id: "M2", consumption_rate: 1 },
];

// inbound_logistics: supplier → material. lead_time is in WEEKS (§3 unit
// contract); time_unit describes the volume period only.
const inbound = [
  { supplier_id: "S1", material_id: "M1", volume: 120, time_unit: "week", lead_time: 2, unit_price: 10 },
  { supplier_id: "S2", material_id: "M2", volume: 60,  time_unit: "week", lead_time: 3, unit_price: 15 },
  { supplier_id: "S3", material_id: "M1", volume: 120, time_unit: "week", lead_time: 2, unit_price: 11 }, // pricier backup
];

// outbound_logistics: product → customer. expected_lead_time in weeks.
const outbound = [
  { customer_id: "C1", product_id: "P1", volume: 50, time_unit: "week", expected_lead_time: 1, unit_price: 100 },
];

// ── Local validation (enums, required fields, structural hard-blocks) ────────
// Mirrors the gate's three hard blocks (supabase/functions/_shared/grading.ts):
//   ≥1 product · every BOM product matches a product master · every BOM
//   material is sourced by an inbound arc. Enum/required checks mirror the RPC
//   CHECK constraints so a live call cannot 500 on a bad payload.
function validate() {
  const errors = [];
  const req = (rows, key, label) =>
    rows.forEach((r, i) => {
      if (r[key] == null || r[key] === "") errors.push(`${label}[${i}]: missing ${key}`);
    });
  const enumCheck = (rows, key, set, label) =>
    rows.forEach((r, i) => {
      const v = r[key];
      if (v != null && v !== "" && !set.has(String(v).toLowerCase()))
        errors.push(`${label}[${i}]: ${key}="${v}" not in {${[...set].join(", ")}}`);
    });

  req(suppliers, "supplier_id", "suppliers");
  req(materials, "material_id", "materials");
  req(products, "product_id", "products");
  req(bom, "product_id", "bom"); req(bom, "material_id", "bom");
  req(inbound, "supplier_id", "inbound"); req(inbound, "material_id", "inbound");
  req(outbound, "customer_id", "outbound"); req(outbound, "product_id", "outbound");

  enumCheck(products, "fulfillment_mode", FULFILLMENT_MODES, "products");
  enumCheck(products, "demand_distribution", DEMAND_DISTS, "products");
  enumCheck(materials, "lead_time_dist", LEAD_TIME_DISTS, "materials");

  // Referential integrity the engine/gate demand.
  const productIds = new Set(products.map((p) => p.product_id));
  const materialIds = new Set(materials.map((m) => m.material_id));
  const supplierIds = new Set(suppliers.map((s) => s.supplier_id));
  const sourcedMaterials = new Set(inbound.map((a) => a.material_id));

  if (products.length < 1) errors.push("structural: need ≥1 product (engine hard block)");
  for (const b of bom) {
    if (!productIds.has(b.product_id))
      errors.push(`structural: bom product ${b.product_id} has no product master (engine hard block)`);
    if (!materialIds.has(b.material_id))
      errors.push(`structural: bom material ${b.material_id} has no material master`);
    if (!sourcedMaterials.has(b.material_id))
      errors.push(`structural: bom material ${b.material_id} is not sourced by any inbound arc (unsourced-BOM hard block)`);
  }
  for (const a of inbound) {
    if (!supplierIds.has(a.supplier_id)) errors.push(`ref: inbound supplier ${a.supplier_id} has no supplier master`);
    if (!materialIds.has(a.material_id)) errors.push(`ref: inbound material ${a.material_id} has no material master`);
  }
  for (const o of outbound) {
    if (!productIds.has(o.product_id)) errors.push(`ref: outbound product ${o.product_id} has no product master`);
  }
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

async function rpc(fn, args) {
  const { status, body } = await rest(`rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (status >= 300) {
    throw new Error(`rpc ${fn} → HTTP ${status}: ${JSON.stringify(body)}`);
  }
  return body;
}

// ── Payload shaping ──────────────────────────────────────────────────────────
const arcRows = (rows, projectId) =>
  rows.map((r) => ({ ...r, plant_name: PLANT_NAME, project_id: projectId }));

function printPayloads(projectId) {
  const show = (label, rows) => {
    console.log(`\n▸ ${label} (${rows.length} row${rows.length === 1 ? "" : "s"})`);
    console.log(JSON.stringify(rows, null, 2));
  };
  console.log(`\nProject: name="${PROJECT_NAME}" plant="${PLANT_NAME}" model=${SUPPLY_CHAIN_MODEL} bom=${BOM_LEVEL}`);
  show("suppliers → bulk_upsert_suppliers", suppliers);
  show("materials → bulk_upsert_materials", materials);
  show("products → bulk_upsert_products", products);
  show("bom_single_level → bulk_insert_bom_single_level", arcRows(bom, projectId));
  show("inbound_logistics → bulk_insert_inbound_logistics", arcRows(inbound, projectId));
  show("outbound_logistics → bulk_insert_outbound_logistics", arcRows(outbound, projectId));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`SureSuite minimal example seed — ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  ${SUPABASE_URL}`);

  const errors = validate();
  if (errors.length) {
    console.error(`\n✗ validation FAILED (${errors.length}):`);
    for (const e of errors) console.error(`    - ${e}`);
    process.exit(1);
  }
  console.log("✓ payload validation passed (enums, required fields, structural hard-blocks)");

  if (DRY_RUN) {
    printPayloads("<project_id>");
    console.log(
      "\nDRY RUN complete — no writes performed. The three gate hard blocks " +
      "(≥1 product, BOM↔product match, every BOM material sourced) are all " +
      "satisfied by this dataset.",
    );
    return;
  }

  if (!USER_ID) {
    console.error(
      "\n✗ a LIVE run needs USER_ID (approved_users.id of the project modeler).\n" +
      "  Re-run with:  USER_ID=<uuid> USER_EMAIL=<email> node scripts/seed_example_project.mjs\n" +
      "  (or use --dry-run to validate and print payloads without writing).",
    );
    process.exit(2);
  }
  const auth = { p_user_id: USER_ID, p_user_email: USER_EMAIL };

  // 1) Resolve project by name for this modeler (idempotent create-or-reuse).
  console.log("\n── resolving project (create or reuse)");
  const existing = await rpc("list_projects", { ...auth });
  let project = Array.isArray(existing)
    ? existing.find((p) => p.name === PROJECT_NAME)
    : null;
  let projectId;
  if (project) {
    projectId = project.id;
    console.log(`  reusing existing project ${projectId}`);
  } else {
    projectId = await rpc("create_project", {
      p_name: PROJECT_NAME,
      p_plant: PLANT_NAME,
      p_model: SUPPLY_CHAIN_MODEL,
      p_bom_level: BOM_LEVEL,
      p_user_id: USER_ID,
      p_user_email: USER_EMAIL,
      p_user_name: USER_NAME,
      p_data_type: "curated",
    });
    console.log(`  created project ${projectId}`);
  }

  // 2) Item masters — upsert (idempotent on (project_id, id)).
  console.log("── upserting item masters");
  console.log(`  suppliers: ${await rpc("bulk_upsert_suppliers", { p_project_id: projectId, p_rows: suppliers })} row(s)`);
  console.log(`  materials: ${await rpc("bulk_upsert_materials", { p_project_id: projectId, p_rows: materials })} row(s)`);
  console.log(`  products:  ${await rpc("bulk_upsert_products",  { p_project_id: projectId, p_rows: products })} row(s)`);

  // 3) Clear arcs so re-runs don't duplicate (masters upsert; arcs are insert-only).
  console.log("── clearing existing arcs (idempotency)");
  console.log(`  deleted ${await rpc("delete_project_dataset", { p_project_id: projectId, p_dataset: "all", ...auth })} arc row(s)`);

  // 4) Arc tables — via the same SECURITY DEFINER bulk_insert RPCs the app uses.
  console.log("── inserting arcs (bom + inbound + outbound)");
  console.log(`  bom:      ${await rpc("bulk_insert_bom_single_level",  { p_rows: arcRows(bom, projectId), ...auth })} row(s)`);
  console.log(`  inbound:  ${await rpc("bulk_insert_inbound_logistics", { p_rows: arcRows(inbound, projectId), ...auth })} row(s)`);
  console.log(`  outbound: ${await rpc("bulk_insert_outbound_logistics",{ p_rows: arcRows(outbound, projectId), ...auth })} row(s)`);

  // 5) Combine into the supply-chain graph + rebuild the node list.
  console.log("── combining + rebuilding node list");
  await rpc("update_project_completion_status", { p_project_id: projectId, ...auth });
  await rpc("combine_project_into_supply_chain", { p_project_id: projectId, ...auth });
  await rpc("rebuild_node_list", { p_project_id: projectId, ...auth });

  // 6) Report dataset status.
  const status = await rpc("get_project_dataset_status", { p_project_id: projectId, ...auth });
  console.log("\n════════ seed complete ════════");
  console.log(`project_id: ${projectId}`);
  console.log(`open in app: /project-manager?project=${projectId}`);
  console.log(`dataset status: ${JSON.stringify(status)}`);
  if (status && status.has_bom && status.has_inbound && status.has_outbound) {
    console.log("✓ dataset complete (bom + inbound + outbound present)");
  } else {
    console.error("✗ dataset NOT complete — check the status above");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message ?? err}`);
  process.exit(1);
});
