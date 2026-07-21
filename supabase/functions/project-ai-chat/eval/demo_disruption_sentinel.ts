// Phase 4d end-to-end demo transcript (ai-agents.md §18.3 acceptance):
// drives the REAL B9 machinery offline — router decision → three assessments
// (a pasted plant-fire article naming a MAPPED tier-2 supplier + two wire
// corroborations; scripted extraction, real screening/typer/LEI/Q28 gates)
// → event evidence rows → Q28 corroboration (verified at 3 independent
// sources) → deep-tier exposure match THROUGH the B8 map (citable) →
// Sentinel agent turn (scripted provider I/O, real draft handler; the
// LINKED experiment spec drafted through B4's registered tool) → persona
// wrap-up → Approve → riskAlertApply through applyExperimentSpec →
// dispatchExperimentRun (the ONLY dispatch path; full provenance stamps)
// → the worker completes the run (simulated by seeding run_replications)
// → fillRiskAlertImpact fills the alert's impact range FROM the
// replication rows with the run citation — and prints the transcript.
// The impact field is PENDING until that final step; no LLM ever wrote it.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_disruption_sentinel.ts

import { decideRoute } from "../router.ts";
import { runChat } from "../providers.ts";
import { executeTool, type ToolContext } from "../tools.ts";
import "../sentinelTools.ts";
import { buildWrapupMessage, runAgentTurn } from "../agentTurn.ts";
import { applyRiskAlert, fillRiskAlertImpact } from "../../agent-apply/riskAlertApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const VER = "44444444-4444-4444-8444-444444444401";
const NORDWIND_LEI = "529900NORDWIND000044";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "disruption-sentinel,experiment-designer");
Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
Deno.env.set("GEMINI_API_KEY", "demo-key");

// The project: Helix Drives is the tier-1 supplier of power modules, and the
// B8 Cartographer previously mapped Nordwind Semiconductor as ITS supplier
// (tier-2) — three verified external_evidence rows (the nc-04 outcome).
const P = { project_id: PROJECT };
const tables: Record<string, Row[]> = {
  projects: [{ id: PROJECT, plant_name: "Alpine Assembly Graz", organization: "demo-org" }],
  suppliers: [
    { ...P, supplier_id: "S-HELIX", name: "Helix Drives GmbH", capacity_per_week: 800, reliability_score: 1 },
  ],
  materials: [{ ...P, material_id: "MAT-PM", name: "power modules", cost: 120, moq: 10, holding_cost_pct: 0.2 }],
  products: [{ ...P, product_id: "P1", name: "Drive unit", sell_price: 400, production_capacity: 500, demand_mean: 300, demand_cv: 0.2 }],
  inbound_logistics: [
    { ...P, plant_name: "Alpine Assembly Graz", supplier_id: "S-HELIX", material_id: "MAT-PM", unit_price: 120, lead_time: 2, volume: 40, time_unit: "week" },
  ],
  outbound_logistics: [{ ...P, customer_id: "C1", product_id: "P1", unit_price: 400, volume: 300, time_unit: "week" }],
  bom_single_level: [{ ...P, product_id: "P1", material_id: "MAT-PM" }],
  bom_multi_level: [],
  policy_defaults: [{
    ...P, fulfillment_strategy: "make_to_stock",
    sourcing: {}, inventory: {}, transport: {}, fulfillment: {}, production: {}, recovery: {}, demand: {},
  }],
  policy_overrides: [],
  policy_versions: [{
    id: VER, ...P, label: "baseline", parent_version_id: null, policy_hash: "ph-run",
    snapshot: { defaults: { sourcing: {}, inventory: {}, transport: {}, fulfillment: {}, production: {}, recovery: {}, demand: {} }, fulfillment_strategy: "make_to_stock" },
    created_at: 1,
  }],
  scenarios: [],
  dataset_versions: [{ id: "77777777-7777-4777-8777-777777777701", ...P, graph_hash: "graph-hash-1", created_at: 5 }],
  model_validations: [],
  simulation_runs: [],
  run_replications: [],
  proposals: [],
  external_evidence: [
    {
      id: "eeeeeeee-0000-4000-8000-000000000001", ...P, source_id: "news-wire",
      url_or_ref: "Wire: Nordwind-Helix supply agreement", content_hash: "maphash-1", retrieved_at: "2026-07-10T00:00:00Z", confidence: 0.7,
      triple: { subject: { name: "Nordwind Semiconductor GmbH", lei: NORDWIND_LEI }, relation: "SuppliesTo", object: { name: "Helix Drives GmbH", type: "Company" }, quote: "Nordwind Semiconductor GmbH has signed a three-year agreement to supply power modules to Helix Drives GmbH." },
      lei: NORDWIND_LEI,
    },
    {
      id: "eeeeeeee-0000-4000-8000-000000000002", ...P, source_id: "sec-edgar",
      url_or_ref: "10-K excerpt", content_hash: "maphash-2", retrieved_at: "2026-07-10T00:00:00Z", confidence: 0.9,
      triple: { subject: { name: "Nordwind Semiconductor GmbH", lei: NORDWIND_LEI }, relation: "SuppliesTo", object: { name: "Helix Drives GmbH", type: "Company" }, quote: "Helix Drives GmbH sources power modules from Nordwind Semiconductor GmbH." },
      lei: NORDWIND_LEI,
    },
    {
      id: "eeeeeeee-0000-4000-8000-000000000003", ...P, source_id: "lksg-csrd-disclosures",
      url_or_ref: "LkSG disclosure", content_hash: "maphash-3", retrieved_at: "2026-07-10T00:00:00Z", confidence: 0.7,
      triple: { subject: { name: "Nordwind Semiconductor GmbH", lei: NORDWIND_LEI }, relation: "SuppliesTo", object: { name: "Helix Drives GmbH", type: "Company" }, quote: "Helix Drives GmbH lists Nordwind Semiconductor GmbH as a direct supplier of power modules." },
      lei: NORDWIND_LEI,
    },
  ],
};
const db = makeStubDb(tables, makeAgentRpcs(tables));
const utterance =
  "This article says a fire destroyed Nordwind's Dresden fab - they supply our supplier Helix. Assess it.";

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);
say("user", utterance);

// 1 — router (classifier scripted; the §6.2 wrapper is the real one)
const decision = await decideRoute(utterance, {
  personaId: "risk-analyst",
  hasProject: true,
  enabledAgents: ["disruption-sentinel", "experiment-designer"],
  modelId: "gemini-2.5-flash",
}, () =>
  Promise.resolve(JSON.stringify({
    route: "artifact",
    agent_id: "disruption-sentinel",
    intent: "sentinel.assess_event",
    confidence: 0.95,
    advisory_part: null,
    artifact_part: utterance,
  })));
say("router.decision", JSON.stringify(decision));

const ctx: ToolContext = {
  projectId: PROJECT,
  userId: USER,
  supabase: db as unknown as ToolContext["supabase"],
  draft: {
    userEmail: "demo@example.com",
    threadId: "33333333-3333-4333-8333-333333333333",
    modelCode: "gemini-2.5-flash",
    providerCode: "gemini",
    canProposals: true,
    utterance,
  },
};

// 2 — the pasted article + two wire corroborations, each attributed to a
// registered SENSING source (§18.5 law). Extraction is scripted; the
// screening, deterministic event-typer, LEI and Q28 gates are the real ones.
const NSG = "Nordwind Semiconductor GmbH";
const docs = [
  {
    source_id: "gdelt",
    title: "Screened article: Nordwind fab fire",
    text:
      "A large fire has severely damaged the Dresden fab of Nordwind Semiconductor GmbH, halting wafer processing. Industrial customers were notified of expected shipment delays.",
  },
  {
    source_id: "reuters-wire",
    title: "Wire: Nordwind fire",
    text:
      "Nordwind Semiconductor GmbH said a fire at its Dresden site has stopped production lines while the damage is assessed; the company gave no restart estimate.",
  },
  {
    source_id: "dpa-wire",
    title: "Wire: Dresden fab blaze",
    text:
      "Dresden firefighters spent the night containing a fire at the semiconductor plant of Nordwind Semiconductor GmbH; authorities reported no injuries but significant equipment damage.",
  },
];

let eventEvidenceIds: string[] = [];
for (const doc of docs) {
  const queue = [
    JSON.stringify({ entities: [{ type: "Company", text: NSG }] }),
    JSON.stringify({ triples: [] }),
  ];
  ctx.extract = () => Promise.resolve(queue.shift() ?? "{}");
  const env = await executeTool("assess_event", { source_id: doc.source_id, text: doc.text, title: doc.title }, ctx);
  const data = env.data as { columns: string[]; rows: unknown[][] };
  say(`assess_event (${doc.source_id})`,
    [data.columns.join(" | ")].concat(data.rows.map((r) => r.map(String).join(" | "))).join("\n"));
  eventEvidenceIds = data.rows.map((r) => String(r[7]));
}
eventEvidenceIds = tables.external_evidence
  .filter((r) => String((r.triple as Record<string, unknown>).relation) === "EventReported")
  .map((r) => String(r.id));

// 3 — agent turn: scripted provider files the alert through the REAL
// handler; the LINKED sizing spec is drafted through B4's registered tool.
const agentReplyText =
  "Three independent registered sources (gdelt, reuters-wire, dpa-wire) verify the fire at " +
  "Nordwind Semiconductor GmbH, which the network map shows supplying Helix Drives — your " +
  "power-modules supplier. I filed a risk alert with a linked sizing run (56-day outage of " +
  "S-HELIX); the impact range stays pending until that run completes. Review the card.";
let mock = installFetchMock([
  {
    json: {
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "draft_risk_alert",
              args: {
                event_type: "fire",
                subject_name: NSG,
                evidence_ids: eventEvidenceIds,
                why: "Mapped tier-2 supplier of Helix Drives (power modules)",
              },
            },
          }],
        },
      }],
    },
  },
  { json: { candidates: [{ content: { parts: [{ text: agentReplyText }] } }] } },
]);
const agent = await runAgentTurn({ agentId: "disruption-sentinel", modelId: "gemini-2.5-flash", utterance, ctx });
mock.restore();
say("disruption-sentinel (agent turn)", agent.reply);
say("proposal part (attached mechanically)", JSON.stringify(agent.proposalPart?.data, null, 2));

// 4 — what the card renders: event + corroboration + matched entities +
// linked spec + PENDING impact + chips, all from the stored payload (§4.6).
const alert = tables.proposals.find((p) => p.id === agent.proposalPart!.data.proposal_id)!;
const payload = alert.payload as Record<string, unknown>;
const ev = payload.event as Record<string, unknown>;
say("card: event + corroboration", JSON.stringify({ ...ev, quotes: undefined }, null, 2));
say("card: matched entities (via the B8 deep-tier map, citable)", JSON.stringify(payload.matched_entities, null, 2));
say("card: linked experiment spec (drafted through B4's tool)", JSON.stringify(payload.linked_experiment, null, 2));
say("card: impact", JSON.stringify(payload.impact));
say("card: recommended actions (P-S.4 / P-X.1 chips)", JSON.stringify(
  (payload.recommended_actions as Array<Record<string, unknown>>).map((c) => c.label)));

// 5 — persona wrap-up (voice)
const wrapText =
  "I corroborated the Nordwind fab fire across three independent sources and matched it to your " +
  "network through the mapped tier-2 link to Helix Drives. The alert card below carries the " +
  "evidence, the exposure, and a linked 56-day outage experiment — approve it to dispatch the " +
  "sizing run; the impact range fills only from that run's results.";
mock = installFetchMock([{ json: { candidates: [{ content: { parts: [{ text: wrapText }] } }] } }]);
const wrap = await runChat("gemini-2.5-flash", buildWrapupMessage({
  utterance,
  agentReply: agent.reply,
  proposal: agent.proposalPart!.data,
  agentName: "Disruption Sentinel",
}), [], null, "risk-analyst");
mock.restore();
say("persona (wrap-up)", wrap.reply);

// 6 — Approve (modeler) → riskAlertApply re-verifies live, then dispatches
// the LINKED spec through applyExperimentSpec → dispatchExperimentRun (the
// ONLY dispatch path). Impact: still pending.
alert.status = "approved";
const upstashCalls: (string | number)[][] = [];
const result = await applyRiskAlert(db, {
  upstash: (cmd) => {
    upstashCalls.push(cmd);
    return Promise.resolve("ok");
  },
}, {
  projectId: PROJECT,
  payload: alert.payload as Record<string, unknown>,
  grounding: alert.grounding as Record<string, unknown>,
  userId: USER,
});
alert.status = "applied";
alert.applied_result = result as unknown as Row;
say("agent-apply (riskAlertApply → applyExperimentSpec → dispatchExperimentRun)", JSON.stringify(result, null, 2));
const run = tables.simulation_runs.find((r) => String(r.id) === result.run_id)!;
say("queued run (full provenance stamps, indistinguishable from a Lab dispatch)", JSON.stringify({
  id: run.id, status: run.status, policy_version_id: run.policy_version_id, policy_hash: run.policy_hash,
  graph_hash: run.graph_hash, dataset_version_id: run.dataset_version_id, scenario_hash: run.scenario_hash,
}, null, 2));
say("worker envelope enqueued", String(upstashCalls.some((c) => c[0] === "XADD")));

// 7 — the worker completes the run (simulated): per-rep KPIs persist to
// run_replications; the run row flips to done.
run.status = "done";
run.rep_count_done = 20;
for (let i = 0; i < 20; i++) {
  tables.run_replications.push({
    run_id: run.id, rep_index: i, status: "done",
    kpis: { fill_rate: 0.58 + 0.01 * (i % 12) },
  });
}

// 8 — the on-demand impact fill (§18.3 hard gate 8): min/max/mean of the
// primary KPI over the done replications, run citation stamped, written
// once through update_risk_alert_impact. Never a background job.
const refreshed = await fillRiskAlertImpact(db, {
  id: String(alert.id),
  applied_result: alert.applied_result as Record<string, unknown>,
});
say("alert after run completion (impact FROM run_replications, with its run citation)",
  JSON.stringify((refreshed as Record<string, unknown>).impact, null, 2));

const read = await executeTool("get_risk_alerts", {}, ctx);
const readData = read.data as { columns: string[]; rows: unknown[][] };
say("get_risk_alerts", [readData.columns.join(" | ")]
  .concat(readData.rows.map((r) => r.map(String).join(" | "))).join("\n"));
