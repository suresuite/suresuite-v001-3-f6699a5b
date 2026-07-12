// Stage 1 end-to-end demo transcript (ai-agents.md §9.2 acceptance): drives
// the REAL Stage 1 machinery offline — router decision → Data Steward agent
// turn (scripted provider I/O, real tool handlers) → persona wrap-up →
// proposal card → apply through the §4.4 sequence — and prints the transcript.
// The SQL-side counterparts (review_agent_proposal rights check, bulk_upsert
// semantics) are pinned against scratch Postgres in db_rpc_test.ts.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_stage1.ts

import { decideRoute } from "../router.ts";
import { runChat } from "../providers.ts";
import { executeTool, type ToolContext } from "../tools.ts";
import "../draftTools.ts";
import { buildWrapupMessage, runDataStewardTurn } from "../agentTurn.ts";
import { applyItemMasterDiff } from "../../agent-apply/itemMasterApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "data-steward");
Deno.env.set("GEMINI_API_KEY", "demo-key");

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/data-steward/ds-01-fill-costs.json", import.meta.url)),
);
const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
const db = makeStubDb(tables, makeAgentRpcs(tables));
const utterance = "fill in the missing material costs";

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);

say("user", utterance);

// 1 — router (classifier scripted; the §6.2 wrapper is the real one)
const decision = await decideRoute(utterance, {
  personaId: "inventory-strategist",
  hasProject: true,
  enabledAgents: ["data-steward"],
  modelId: "gemini-2.5-flash",
}, () =>
  Promise.resolve(JSON.stringify({
    route: "artifact",
    agent_id: "data-steward",
    intent: "steward.fill_missing",
    confidence: 0.94,
    advisory_part: null,
    artifact_part: utterance,
  })));
say("router.decision", JSON.stringify(decision));

// 2 — agent turn: the model reads the grader's candidates and files the draft
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
const agentReplyText =
  "I drafted an update covering the 3 materials with missing costs (MAT-1, MAT-2, MAT-3), " +
  "each valued by the cheapest-inbound-price reducer from your own logistics data. Nothing else " +
  "is missing for these fields. The card must be reviewed and approved before anything applies.";
let mock = installFetchMock([
  { json: { candidates: [{ content: { parts: [{ functionCall: { name: "draft_item_master_update", args: fixture.mocked_llm.args } }] } }] } },
  { json: { candidates: [{ content: { parts: [{ text: agentReplyText }] } }] } },
]);
const agent = await runDataStewardTurn({ modelId: "gemini-2.5-flash", utterance, ctx });
mock.restore();
say("data-steward (agent turn)", agent.reply);
say("proposal part (attached mechanically)", JSON.stringify(agent.proposalPart?.data, null, 2));

// 3 — persona wrap-up (voice)
const wrapText =
  "I've drafted this for you — three material costs filled from your cheapest inbound prices. " +
  "Review the card below and approve it before anything applies.";
mock = installFetchMock([{ json: { candidates: [{ content: { parts: [{ text: wrapText }] } }] } }]);
const wrap = await runChat("gemini-2.5-flash", buildWrapupMessage({
  utterance,
  agentReply: agent.reply,
  proposal: agent.proposalPart!.data,
}), [], null, "inventory-strategist");
mock.restore();
say("persona (wrap-up)", wrap.reply);

// 4 — re-running the ask converges on the same proposal_id (§4.5)
const rerun = await executeTool("draft_item_master_update", fixture.mocked_llm.args, ctx);
say("re-run of the same ask", JSON.stringify({
  proposal_id: (rerun.data as Record<string, unknown>).proposal_id,
  note: rerun.meta.note,
  converges: (rerun.data as Record<string, unknown>).proposal_id === agent.proposalPart!.data.proposal_id,
}));

// 5 — a user WITHOUT agent_apply cannot approve: SQL-pinned in db_rpc_test.ts
say("review (user without agent_apply)",
  'review_agent_proposal(...,"approve") ⇒ ERROR: forbidden: approve requires the agent_apply capability\n' +
  "(typed failure — pinned against scratch Postgres in db_rpc_test.ts, checkpoint 4)");

// 6 — Approve (modeler) → agent-apply walks §4.4
const stored = tables.proposals.find((p) => p.id === agent.proposalPart!.data.proposal_id)!;
stored.status = "approved";
const result = await applyItemMasterDiff(db, {
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
  tables.materials.map((m) => ({ id: m.material_id, cost: m.cost })),
));
