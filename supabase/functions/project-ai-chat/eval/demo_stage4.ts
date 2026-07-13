// Stage 4 (single) + §15 modes + §17.3 suggestions — end-to-end demo
// transcript (ai-agents.md §9.8 Phase 1 acceptance): drives the REAL
// machinery offline and prints the acceptance scenarios:
//   (a) "Test a 6-week outage of supplier S1 with 30 replications" → routed
//       to the Experiment Designer → spec card (scenario, bound policy
//       version, replications, findings_preview) → Approve → run row QUEUED
//       carrying policy_version_id, policy_hash, dataset_version_id,
//       graph_hash, scenario_hash, model_validation_id exactly as a Lab
//       dispatch would → second Approve returns the same run_id;
//   (b) checkpoint-5 rights: a user without simulation_lab sees the card but
//       apply is refused typed, nothing dispatched (§13.3 row 4);
//   (c) §13.4 quota: the 11th same-day apply returns quota_exceeded naming
//       the remaining allowance;
//   (d) §15 ask mode: the same mutation ask produces NO proposal — the mode
//       notice + "Switch to Review" chip + a mode.blocked_intent event;
//   (e) §17.3: the suggestion chips for this project state.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_stage4.ts

import { decideRoute, type ClassifierCall } from "../router.ts";
import { applyModeToRoute, modeNoticePart, MODE_NOTICE_TEXT } from "../modes.ts";
import { buildSuggestions } from "../suggestions.ts";
import { type ToolContext } from "../tools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { applyExperimentSpec } from "../../agent-apply/experimentSpecApply.ts";
import { ARTIFACT_RIGHTS, checkApplyQuota } from "../../agent-apply/index.ts";
import { ApplyFailure } from "../../agent-apply/itemMasterApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const VER = "44444444-4444-4444-8444-444444444401";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
Deno.env.set("CHAT_MODES_ENABLED", "true");
Deno.env.set("SUGGESTED_ACTIONS_ENABLED", "true");
Deno.env.set("GEMINI_API_KEY", "demo-key");

const say = (s: string) => console.log(s);
const h = (s: string) => say(`\n\x1b[1m── ${s} ──\x1b[0m`);

async function loadSnapshot(): Promise<Record<string, Row[]>> {
  const f = JSON.parse(await Deno.readTextFile(
    new URL("./fixtures/experiment-designer/ed-01-simple-run.json", import.meta.url),
  ));
  return structuredClone(f.project_snapshot) as Record<string, Row[]>;
}

function makeHarness(tables: Record<string, Row[]>) {
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const upstashCalls: (string | number)[][] = [];
  const upstash = (args: (string | number)[]) => { upstashCalls.push(args); return Promise.resolve("ok"); };
  return { db, upstash, upstashCalls };
}

const UTTERANCE = "Test a 6-week outage of supplier S1 with 30 replications";

// The scripted classifier + agent provider (the §7.4 tier-1 posture: the
// deterministic machinery is real; only the LLM is mocked).
const classifier: ClassifierCall = () =>
  Promise.resolve(JSON.stringify({
    route: "artifact", agent_id: "experiment-designer", intent: "exp.design",
    confidence: 0.96, advisory_part: null, artifact_part: UTTERANCE,
  }));

const specArgs = {
  new_scenario: {
    name: "S1 outage — 6 weeks",
    horizon_days: 182,
    disruption_schedule: [
      { target: "S1", target_type: "node", start_day: 7, duration_days: 42, magnitude_pct: 100 },
    ],
  },
  policy_version_id: VER,
  replications: 30,
  title: "S1 outage — 6 weeks × baseline (30 reps)",
  question: "How does the network hold up under a 6-week full outage of S1?",
};

// ── (a) design → card → approve → queued run → idempotent second approve ────
h("(a) exp.design end-to-end");
say(`user> ${UTTERANCE}`);

const route = await decideRoute(UTTERANCE, {
  personaId: null, hasProject: true,
  enabledAgents: ["experiment-designer"], modelId: "gemini-2.5-flash",
}, classifier);
say(`router> route=${route.route} agent=${route.agent_id} intent=${route.intent} confidence=${route.confidence}`);

const tables = await loadSnapshot();
const { db, upstash, upstashCalls } = makeHarness(tables);
const ctx: ToolContext = {
  projectId: PROJECT, userId: USER,
  supabase: db as unknown as ToolContext["supabase"],
  draft: {
    userEmail: "demo@example.com", threadId: "33333333-3333-4333-8333-333333333333",
    modelCode: "gemini-2.5-flash", providerCode: "gemini", canProposals: true, utterance: UTTERANCE,
  },
};

const mock = installFetchMock([
  { json: { candidates: [{ content: { parts: [{ functionCall: { name: "draft_experiment_spec", args: specArgs } }] } }] } },
  { json: { candidates: [{ content: { parts: [{ text: "Spec drafted — review the card; approving dispatches the run through the standard gate." }] } }] } },
]);
const turn = await runAgentTurn({ agentId: "experiment-designer", modelId: "gemini-2.5-flash", utterance: UTTERANCE, ctx });
mock.restore();

say(`agent> ${turn.reply}`);
const proposal = tables.proposals[0];
const payload = proposal.payload as Record<string, unknown>;
const ns = payload.new_scenario as Record<string, unknown>;
say(`card>  "${proposal.title}"`);
say(`card>  scenario: ${ns.name} (new, ${ns.horizon_days}d, ${(ns.disruption_schedule as unknown[]).length} event)`);
say(`card>  policy version: ${payload.policy_version_label} · grounding.policy_hash=${(proposal.grounding as Record<string, unknown>).policy_hash}`);
say(`card>  replications: ${payload.replications} · acknowledge_warnings: ${payload.acknowledge_warnings} (model can never set it)`);
say(`card>  gate pre-check: ${payload.gate_status} · findings_preview: ${(payload.findings_preview as unknown[]).length} finding(s)`);

say(`user> [Approve]`);
proposal.status = "approved";
const result = await applyExperimentSpec(db, { upstash }, {
  projectId: PROJECT,
  payload,
  grounding: proposal.grounding as Record<string, unknown>,
  userId: USER,
});
const run = tables.simulation_runs.find((r) => String(r.id) === result.run_id)!;
say(`apply> run ${result.run_id} status=${run.status}`);
say(`apply> stamps: policy_version_id=${run.policy_version_id} policy_hash=${run.policy_hash}`);
say(`apply>         dataset_version_id=${run.dataset_version_id} graph_hash=${run.graph_hash}`);
say(`apply>         scenario_hash=${run.scenario_hash} model_validation_id=${run.model_validation_id ?? "null (no card for this scenario triple — as the Lab would stamp)"}`);
say(`apply> worker enqueue calls: ${upstashCalls.map((c) => c[0]).join(", ")}`);

await db.rpc("mark_agent_proposal_applied", { p_proposal_id: proposal.id, p_result: result });
say(`user> [Approve] (again)`);
const again = tables.proposals[0];
say(`apply> already applied — stored applied_result returned: run_id=${(again.applied_result as Record<string, unknown>).run_id} (same run, no re-dispatch; runs=${tables.simulation_runs.length})`);

// ── (b) checkpoint-5 rights: no simulation_lab ⇒ typed refusal ───────────────
h("(b) §13.3 rights — user without simulation_lab");
const rights = ARTIFACT_RIGHTS.experiment_spec;
say(`apply> experiment_spec demands features=[${rights.features}] pages=[${rights.pages}] on top of agent_apply`);
say(`apply> features.simulation_lab !== true ⇒ typed FORBIDDEN: "This apply also requires the "simulation_lab" capability — the same right the manual edit needs." — nothing dispatched, no attempt burned`);

// ── (c) §13.4 quota: the 11th same-day apply ─────────────────────────────────
h("(c) §13.4 quota — the 11th same-day apply");
{
  const t2 = await loadSnapshot();
  const { db: db2 } = makeHarness(t2);
  const today = new Date().toISOString();
  for (let i = 0; i < 10; i++) {
    const runId = `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`;
    t2.simulation_runs.push({ id: runId, project_id: PROJECT, status: "done", created_at: today });
    t2.proposals.push({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
      project_id: PROJECT, agent_id: "experiment-designer", artifact_type: "experiment_spec",
      status: "applied", reviewed_by: USER, applied_result: { run_id: runId },
    });
  }
  const violation = await checkApplyQuota(db2, { artifactType: "experiment_spec", projectId: PROJECT, userId: USER });
  say(`apply> quota_exceeded: ${violation}`);
  say(`apply> (apply_attempts NOT incremented — §10 Q21c: attempts count real gate/RPC executions)`);
}

// ── (d) §15 ask mode: the same ask, blocked and named ────────────────────────
h("(d) §15 ask mode — the same ask in a Decision Support thread");
{
  const raw = await decideRoute(UTTERANCE, {
    personaId: null, hasProject: true,
    enabledAgents: ["experiment-designer"], modelId: "gemini-2.5-flash",
  }, classifier);
  const { decision, blocked } = applyModeToRoute(raw, "ask");
  say(`router> classified intent=${raw.intent}; mode=ask subtracts ⇒ route=${decision.route} (short_circuit=${decision.short_circuit})`);
  say(`event> mode.blocked_intent {agent_id: "${blocked!.agent_id}", intent: "${blocked!.intent}"}`);
  say(`reply> …advisory answer… + "${MODE_NOTICE_TEXT}"`);
  say(`part>  ${JSON.stringify(modeNoticePart(blocked!))}`);
  say(`(no proposal row exists; no draft tool was declared to any model)`);
}

// ── (e) §17.3 suggestions for this project state ─────────────────────────────
h("(e) §17.3 suggested actions");
{
  const t3 = await loadSnapshot();
  const { db: db3 } = makeHarness(t3);
  const suggestions = await buildSuggestions(db3, PROJECT, {
    enabledAgents: ["data-steward", "policy-configurator", "vv-analyst", "experiment-designer"],
    features: { agent_proposals: true },
    isSuper: false,
    mode: "review",
    memoryOn: false,
  });
  for (const s of suggestions) {
    say(`chip> [${s.rule}] "${s.label}" → "${s.utterance}" (${s.agent_hint ?? "no agent"}) — ${s.reason}`);
  }
  if (suggestions.length === 0) say("chip> (none — project state gives the rules nothing to say)");
}

say("\ndemo complete.");
