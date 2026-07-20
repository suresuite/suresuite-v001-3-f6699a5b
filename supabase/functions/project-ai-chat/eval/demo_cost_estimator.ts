// Phase 4a end-to-end demo transcript (ai-agents.md §18.1 acceptance): drives
// the REAL B7 machinery offline — router decision → get_parameter_estimates
// (the grader finds the gaps, the method registry prices them) → Cost
// Estimator agent turn (scripted provider I/O, real tool handlers) → persona
// wrap-up → proposal card → apply through the §4.4 sequence — and prints the
// transcript: a project with missing material costs and holding rates →
// "estimate the missing economics" → card rows carry value + [low, high] +
// method@version + source dataset/vintage + assumptions → Approve → masters
// updated, findings_after ⊂ findings_before. Also shown: a tampered row
// rejected not_grounded, and the report-only firm-level resilience estimates.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_cost_estimator.ts

import { decideRoute } from "../router.ts";
import { runChat } from "../providers.ts";
import { executeTool, type ToolContext } from "../tools.ts";
import "../estimatorTools.ts";
import { buildWrapupMessage, runAgentTurn } from "../agentTurn.ts";
import { applyParameterEstimate } from "../../agent-apply/parameterEstimateApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "cost-estimator");
Deno.env.set("GEMINI_API_KEY", "demo-key");

// A project with missing economics: MAT-1/MAT-2 have inbound quotes but no
// cost; MAT-9 has NO quotes at all (the case B1 must refuse); all three lack
// a holding rate.
const P = { project_id: PROJECT };
const tables: Record<string, Row[]> = {
  materials: [
    { ...P, material_id: "MAT-1", name: "Resin A", cost: null, holding_cost_pct: null, moq: 100, initial_on_hand: null, lead_time_dist: null, lead_time_cv: null },
    { ...P, material_id: "MAT-2", name: "Resin B", cost: null, holding_cost_pct: null, moq: 50, initial_on_hand: null, lead_time_dist: null, lead_time_cv: null },
    { ...P, material_id: "MAT-9", name: "Novel Composite", cost: null, holding_cost_pct: null, moq: 10, initial_on_hand: null, lead_time_dist: null, lead_time_cv: null },
  ],
  products: [
    { ...P, product_id: "P-1", name: "Widget", sell_price: 30, production_capacity: 1000, fulfillment_mode: "mts", demand_distribution: "triangular", demand_mean: 100, demand_cv: 0.2 },
  ],
  suppliers: [
    { ...P, supplier_id: "S1", name: "Alpha Supply", capacity_per_week: 500, reliability_score: 1 },
    { ...P, supplier_id: "S2", name: "Beta Metals", capacity_per_week: 400, reliability_score: 1 },
    { ...P, supplier_id: "S3", name: "Gamma Chem", capacity_per_week: 300, reliability_score: 1 },
  ],
  inbound_logistics: [
    { ...P, supplier_id: "S1", material_id: "MAT-1", unit_price: 4.5, lead_time: 2, volume: 100, time_unit: "week" },
    { ...P, supplier_id: "S2", material_id: "MAT-1", unit_price: 3.75, lead_time: 3, volume: 80, time_unit: "week" },
    { ...P, supplier_id: "S2", material_id: "MAT-2", unit_price: 2, lead_time: 2, volume: 200, time_unit: "week" },
    { ...P, supplier_id: "S3", material_id: "MAT-2", unit_price: 2.6, lead_time: 4, volume: 60, time_unit: "week" },
  ],
  outbound_logistics: [
    { ...P, product_id: "P-1", customer_id: "C1", unit_price: 30, volume: 100, time_unit: "week" },
  ],
  bom_single_level: [
    { ...P, product_id: "P-1", material_id: "MAT-1" },
    { ...P, product_id: "P-1", material_id: "MAT-2" },
    { ...P, product_id: "P-1", material_id: "MAT-9" },
  ],
  bom_multi_level: [],
  policy_defaults: [{ ...P }],
};
const db = makeStubDb(tables, makeAgentRpcs(tables));
const utterance = "estimate the missing economics";

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);

say("user", utterance);

// 1 — router (classifier scripted; the §6.2 wrapper is the real one)
const decision = await decideRoute(utterance, {
  personaId: "inventory-strategist",
  hasProject: true,
  enabledAgents: ["cost-estimator"],
  modelId: "gemini-2.5-flash",
}, () =>
  Promise.resolve(JSON.stringify({
    route: "artifact",
    agent_id: "cost-estimator",
    intent: "estimator.estimate_missing",
    confidence: 0.93,
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

// 2 — the read tool: the grader finds the gaps, the registry prices them.
const read = await executeTool("get_parameter_estimates", {}, ctx);
const table = read.data as { columns: string[]; rows: unknown[][] };
say("get_parameter_estimates (deterministic candidates)",
  [table.columns.slice(0, 10).join(" | ")]
    .concat(table.rows.map((r) => r.slice(0, 10).map(String).join(" | ")))
    .join("\n"));

// The selector role, made explicit: per gap, prefer direct_from_project,
// else the benchmark method — numbers copied VERBATIM from the candidates.
const byKey = new Map<string, unknown[]>();
for (const r of table.rows) {
  const key = `${r[0]}|${r[1]}`;
  const isDirect = String(r[2]).startsWith("direct_");
  if (!byKey.has(key) || isDirect) byKey.set(key, r);
}
const draftRows = [...byKey.values()].map((r) => ({
  table: String(r[0]).split(".")[0],
  entity_id: String(r[1]),
  field: String(r[0]).split(".")[1],
  method: String(r[2]),
  value: Number(r[3]),
  low: Number(r[4]),
  high: Number(r[5]),
}));

// 3 — agent turn: scripted provider files the draft through the REAL handler.
const agentReplyText =
  "I drafted 6 estimates: MAT-1 and MAT-2 costs from your own inbound price ranges " +
  "(direct_from_project), MAT-9's cost scaled from the ASM materials share of your revenue " +
  "(benchmark_scaled — it has no quotes yet), and all three holding rates from the industry " +
  "benchmark range. Every row carries its interval and sources. The card must be reviewed " +
  "and approved before anything applies.";
let mock = installFetchMock([
  { json: { candidates: [{ content: { parts: [{ functionCall: { name: "draft_parameter_estimate", args: { rows: draftRows, title: "Estimate the missing economics" } } }] } }] } },
  { json: { candidates: [{ content: { parts: [{ text: agentReplyText }] } }] } },
]);
const agent = await runAgentTurn({ agentId: "cost-estimator", modelId: "gemini-2.5-flash", utterance, ctx });
mock.restore();
say("cost-estimator (agent turn)", agent.reply);
say("proposal part (attached mechanically)", JSON.stringify(agent.proposalPart?.data, null, 2));

// 4 — what the card renders: value + [low, high] + method@version + sources
//     + assumptions, all from the stored payload (§4.6: no client recompute).
const stored = tables.proposals.find((p) => p.id === agent.proposalPart!.data.proposal_id)!;
const payloadRows = (stored.payload as { rows: Array<Record<string, unknown>> }).rows;
say("card rows (value + interval + method + source)", payloadRows.map((r) =>
  `${r.table}.${r.field} ${r.entity_id}: ${r.value} [${r.low}, ${r.high}] via ${r.method} — ` +
  (r.sources as Array<Record<string, unknown>>).map((s) => `${s.dataset} (${s.vintage})`).join("; ")
).join("\n"));
say("card assumptions (declared, citable)",
  [...new Set(payloadRows.flatMap((r) => r.assumptions as string[]))].map((a) => `- ${a}`).join("\n"));

// 5 — persona wrap-up (voice)
const wrapText =
  "I've drafted the missing economics for you — two costs from your own inbound quotes, one " +
  "benchmark-scaled estimate for the unquoted composite, and holding rates from the industry " +
  "range, each with its uncertainty interval. Review the card below and approve it before " +
  "anything applies.";
mock = installFetchMock([{ json: { candidates: [{ content: { parts: [{ text: wrapText }] } }] } }]);
const wrap = await runChat("gemini-2.5-flash", buildWrapupMessage({
  utterance,
  agentReply: agent.reply,
  proposal: agent.proposalPart!.data,
  agentName: "Cost Estimator",
}), [], null, "inventory-strategist");
mock.restore();
say("persona (wrap-up)", wrap.reply);

// 6 — a tampered value is rejected not_grounded (§18.1 hard gate 1)
const tampered = structuredClone(draftRows);
tampered[0].value = tampered[0].value + 0.01;
const refusal = await executeTool("draft_parameter_estimate", { rows: tampered }, ctx);
say("tampered row (value +0.01)", `${refusal.meta.note}: ${refusal.data}`);

// 7 — report-only firm-level resilience estimates (family c)
const firm = await executeTool("get_parameter_estimates", { include_resilience: true }, ctx);
const firmRows = (firm.data as { rows: unknown[][] }).rows.filter((r) => String(r[1]) === "firm");
say("firm-level resilience estimates (report-only, no apply path)", firmRows.map((r) =>
  `${r[0]}: ${Number(r[3]).toFixed(2)} [${Number(r[4]).toFixed(2)}, ${Number(r[5]).toFixed(2)}] via ${r[2]}`
).join("\n"));

// 8 — Approve (modeler) → agent-apply walks the §4.4 sequence
stored.status = "approved";
const result = await applyParameterEstimate(db, {
  projectId: PROJECT,
  payload: stored.payload as Record<string, unknown>,
  grounding: stored.grounding as Record<string, unknown>,
});
say("agent-apply (bulk_upsert_materials + gradeManifest delta)", JSON.stringify({
  after_counts: result.after_counts,
  findings_before: result.findings_before.map((f) => `${f.severity}:${f.field}`),
  findings_after: result.findings_after.map((f) => `${f.severity}:${f.field}`),
  findings_after_subset_of_before: result.findings_after.every((a) =>
    result.findings_before.some((b) => a.severity === b.severity && a.field === b.field && a.policy === b.policy)
  ) && result.findings_after.length < result.findings_before.length,
  before_snapshot_rows: Object.fromEntries(
    Object.entries(result.before).map(([t, rows]) => [t, rows!.length]),
  ),
}, null, 2));
say("materials after apply", JSON.stringify(
  tables.materials.map((m) => ({ id: m.material_id, cost: m.cost, holding_cost_pct: m.holding_cost_pct })),
));
