// Phase 4c end-to-end demo transcript (ai-agents.md §18.2 v2 acceptance):
// drives the REAL B8 v2 machinery offline in two acts and prints the
// transcript.
//
//   Act 1 — the held-out real-BOM back-test (nc-15 world): each prior rate
//   method's declared interval scored against the project's observed
//   consumption rates, per-row hits/misses, and the demotion verdicts (the
//   PR back-test table).
//
//   Act 2 — the full map→estimate→apply run (nc-16 world): a FRESH project
//   (own demand data, no supply side) — verified evidence → rate candidates
//   (get_bom_rate_estimates) → one draft_network_map_diff carrying
//   add_supplier + add_supply_link + add_bom_line + add_outbound_lane →
//   Approve → applyNetworkMapDiff seeding bom + inbound + outbound through
//   the existing lifecycle RPCs → the G16 self-verification (list_projects,
//   get_project_dataset_status, the ONE shared grader) — ending in a mapped
//   project whose Run & Validate gate shows ZERO blocks.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_network_cartographer_v2.ts

import { executeTool, type ToolContext } from "../tools.ts";
import "../cartographerTools.ts";
import { applyNetworkMapDiff } from "../../agent-apply/networkMapDiffApply.ts";
import {
  backTestRateMethod,
  observedBomRates,
  RATE_ESTIMATOR_METHODS,
  rateMethodRef,
  type EstimatorInputs,
} from "../../_shared/estimators.ts";
import { loadGateDataset, runValidationGate } from "../../_shared/validationGate.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

Deno.env.set("AGENT_ENABLED_IDS", "network-cartographer");
Deno.env.set("CARTOGRAPHER_PRODUCT_LEVEL", "true");

// deno-lint-ignore no-explicit-any
async function loadFixture(id: string): Promise<any> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/network-cartographer/${id}.json`, import.meta.url)),
  );
}

// deno-lint-ignore no-explicit-any
function worldOf(fixture: any) {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const ctx: ToolContext = {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "a@example.com",
      threadId: "33333333-3333-4333-8333-333333333333",
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance: fixture.utterance,
    },
  };
  return { ctx, db, tables };
}

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);
const fmt = (n: number) => Number(n.toFixed(4)).toString();

// ═══ Act 1 — the held-out real-BOM back-test (nc-15 world) ═══

const bt = await loadFixture("nc-15-backtest-holdout");
const inputs15: EstimatorInputs = {
  dataset: {
    materials: bt.project_snapshot.materials,
    products: bt.project_snapshot.products,
    suppliers: bt.project_snapshot.suppliers,
    inbound: bt.project_snapshot.inbound_logistics,
    outbound: bt.project_snapshot.outbound_logistics,
    bom: bt.project_snapshot.bom_single_level,
  },
  defaults: {},
};

say("demo", "ACT 1 — held-out real-BOM back-test: estimated rate intervals vs the project's observed consumption rates");
console.log("\n| method | pair | estimated [low, high] | actual | verdict |");
console.log("|---|---|---|---|---|");
const observed = observedBomRates(inputs15.dataset);
for (const method of RATE_ESTIMATOR_METHODS) {
  if (method.family !== "benchmark_scaled") continue; // family (a) is exempt — its source IS the project
  for (const obs of observed) {
    const est = method.estimate(obs, inputs15);
    if (!est) continue;
    const hit = obs.rate >= est.low && obs.rate <= est.high;
    console.log(
      `| ${rateMethodRef(method)} | ${obs.product_id} × ${obs.material_id} | [${fmt(est.low)}, ${fmt(est.high)}] | ${fmt(obs.rate)} | ${hit ? "hit" : "MISS"} |`,
    );
  }
}
for (const method of RATE_ESTIMATOR_METHODS) {
  if (method.family !== "benchmark_scaled") continue;
  const r = backTestRateMethod(method, inputs15);
  console.log(
    `\nback-test ${rateMethodRef(method)}: coverage ${r.covered}/${r.n}` +
      (r.demoted
        ? ` ⇒ DEMOTED on this project (misses: ${r.outliers.map((o) => `${o.entity_id} actual ${fmt(o.actual)}`).join(", ")})`
        : " ⇒ ok"),
  );
}

// ═══ Act 2 — map → estimate → apply on a fresh project (nc-16 world) ═══

const fx = await loadFixture("nc-16-fresh-project-gate-green");
const { ctx, db } = worldOf(fx);

say("demo", "ACT 2 — a FRESH project: own demand data (1 product, 1 outbound lane), a material master, NO suppliers, NO inbound, NO BOM. The supply side gets mapped from verified external evidence.");
say("user", fx.utterance);

// 1 — the verified evidence is already in the store (three independent
// registered sources per triple — the v1 pipeline's output).
const evidence = await executeTool("get_network_evidence", {}, ctx);
say("platform · get_network_evidence", JSON.stringify(evidence.data, null, 1).slice(0, 900));

// 2 — rate candidates from the registered method registry.
const rates = await executeTool("get_bom_rate_estimates", {}, ctx);
say("platform · get_bom_rate_estimates", JSON.stringify(rates.data, null, 1));

// deno-lint-ignore no-explicit-any
const rateRows = (rates.data as any).rows as unknown[][];
const ioRow = rateRows.find((r) => String(r[2]) === "rate_io_technical_coefficient@1")!;

// 3 — ONE draft with all four ops, rates copied VERBATIM from the candidates.
const draft = await executeTool("draft_network_map_diff", {
  rows: [
    { op: "add_supplier", supplier_name: "Nordwind Semiconductor GmbH", evidence_ids: fx.evidence_ids.supplies },
    { op: "add_supply_link", supplier_name: "Nordwind Semiconductor GmbH", material_id: "MAT-PM", evidence_ids: fx.evidence_ids.produces },
    {
      op: "add_bom_line",
      supplier_name: "Nordwind Semiconductor GmbH",
      product_id: "PRD-INV",
      material_id: "MAT-PM",
      rate_method: String(ioRow[2]),
      rate: Number(ioRow[3]),
      rate_low: Number(ioRow[4]),
      rate_high: Number(ioRow[5]),
      evidence_ids: fx.evidence_ids.produces,
    },
    {
      op: "add_outbound_lane",
      supplier_name: "Alpine Motors AG",
      product_id: "PRD-INV",
      customer_name: "Veyron Logistics Ltd",
      evidence_ids: fx.evidence_ids.outbound,
    },
  ],
  title: "Make the fresh project run-ready from verified evidence",
}, ctx);
say("cartographer · draft_network_map_diff", JSON.stringify(draft.data, null, 1));
if (draft.kind !== "proposal") throw new Error(`draft failed: ${draft.data}`);

// 4 — human approval, then apply through the existing lifecycle RPCs.
const stored = db.tables.proposals[0];
stored.status = "approved";
say("user", "Approve — apply the mapped structure.");
const result = await applyNetworkMapDiff(db, {
  projectId: PROJECT,
  payload: stored.payload as Record<string, unknown>,
  grounding: stored.grounding as Record<string, unknown>,
  userId: USER,
  userEmail: "a@example.com",
});
say("platform · applyNetworkMapDiff", JSON.stringify(
  {
    added_suppliers: result.added_suppliers,
    added_links: result.added_links,
    added_bom_lines: result.added_bom_lines,
    added_outbound_lanes: result.added_outbound_lanes,
    verification: result.verification,
  },
  null,
  1,
));

// 5 — the G16 proof, independently: the SAME shared grader sim-command runs.
const dataset = await loadGateDataset(db, PROJECT);
const gate = runValidationGate({
  dataset,
  snapshotDefaults: {},
  disruptionSchedule: [],
  acknowledgeWarnings: false,
});
const findings = gate?.findings ?? [];
const blocks = findings.filter((f) => f.severity === "block");
const warns = findings.filter((f) => f.severity === "warn");
say(
  "platform · Run & Validate (the ONE shared grader)",
  `blocking findings: ${blocks.length}` +
    `\nacknowledgeable warnings: ${warns.length}` +
    (warns.length > 0 ? ` (${warns.map((w) => w.field).join(", ")})` : "") +
    `\n\nGATE ${blocks.length === 0 ? "GREEN" : "RED"} — ` +
    (blocks.length === 0
      ? "the mapped-from-outside project passes the SAME pre-run gate as human data (G16)."
      : "NOT run-ready."),
);
if (blocks.length > 0 || !result.verification?.done) {
  throw new Error("demo failed: the G16 contract did not close");
}
say("cartographer", "The map applied: 1 verified deep-tier supplier, its inbound link, one BOM line at the method-estimated rate (interval on the card), and a structural outbound lane. Self-verified per the G16 contract — org-visible, dataset complete, gate green.");
