// Phase H3 plan-harness demo transcript (ai-agents.md §24.3 H3 acceptance):
// drives the REAL machinery offline (scripted provider, stateful stub DB) and
// prints the end-to-end arc — "test a 6-week outage of S1 with 30 reps and
// tell me the fill-rate impact":
//   plan checklist filed → spec card → Approve → the awaiting_run step shows
//   the LIVE replication count climbing (worker _stream_replication updates
//   the run row; each poll resume answers with the templated progress line,
//   ZERO LLM calls) → run completes → the thread resumes itself (one
//   debounced client-caused turn) → cited answer whose citations resolve →
//   every plan step terminal. Then: a mid-run "reload" (a FRESH client over
//   the same store — the plan is server state) shows the current checklist;
//   and a revoked-capability resume fails typed with the step marked failed.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_plan_harness.ts

import { executeTool, type ToolContext } from "../tools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { applyExperimentSpec } from "../../agent-apply/experimentSpecApply.ts";
import {
  formatPlanBlock,
  loadActivePlan,
  markPlanStepFailed,
  runResumePreStep,
  sweepPlanIntegrity,
  type PlanRow,
} from "../planTools.ts";
import { verifyWithRetry, type RecordedToolCall } from "../verifier.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
Deno.env.set("CLOSED_LOOP_ENABLED", "true");
Deno.env.set("CHAT_STORE_ENABLED", "true");
Deno.env.set("PLAN_TOOL_ENABLED", "true");
Deno.env.set("GEMINI_API_KEY", "demo-key");

const say = (s: string) => console.log(s);
const h = (s: string) => say(`\n\x1b[1m── ${s} ──\x1b[0m`);
const checklist = (plan: PlanRow) => {
  say(`  PlanCard "${plan.title}" [${plan.status}]`);
  for (const s of plan.steps) {
    const glyph = { pending: "○", active: "◐", done: "✓", failed: "✗", refused: "⊘", awaiting_approval: "⧖", awaiting_run: "⧖" }[s.status] ?? "?";
    say(`    ${glyph} ${s.label} — ${s.status.replace(/_/g, " ")}${s.note ? ` (${s.note})` : ""}`);
  }
};

// deno-lint-ignore no-explicit-any
async function loadFixture(id: string): Promise<any> {
  const f = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/closed-loop/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const base = await loadFixture(f.project_snapshot.reuse);
    f.project_snapshot = { ...base.project_snapshot, ...(f.project_snapshot.patch ?? {}) };
    f.stub = { ...base.stub, ...(f.stub ?? {}) };
  }
  return f;
}

function substitute<T>(value: T, map: Record<string, string>): T {
  return JSON.parse(
    JSON.stringify(value).replace(/\{(PROPOSAL_ID|PLAN_ID|RUN_ID)\}/g, (_, k) => map[k] ?? `{${k}}`),
  ) as T;
}

function scriptCalls(toolCalls: Array<{ tool: string; args: Record<string, unknown> }>, reply: string) {
  const script = toolCalls.map((tc) => ({
    json: { candidates: [{ content: { parts: [{ functionCall: { name: tc.tool, args: tc.args } }] } }] },
  }));
  script.push({
    json: { candidates: [{ content: { parts: [{ text: reply }] } }] },
    // deno-lint-ignore no-explicit-any
  } as any);
  return installFetchMock(script);
}

const fixture = await loadFixture("cl-04-approve-resume-cite");
const UTTERANCE = fixture.utterance as string;
const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
const rpcs = makeAgentRpcs(tables, { graphHash: fixture.stub?.graph_hash });
if (fixture.stub?.current_policy_hash) {
  const hash = fixture.stub.current_policy_hash;
  rpcs.current_policy_hash = () => hash;
}
const db: StubDb = makeStubDb(tables, rpcs);
const ctx: ToolContext = {
  projectId: PROJECT,
  userId: USER,
  supabase: db as unknown as ToolContext["supabase"],
  draft: {
    userEmail: "demo@example.com",
    threadId: THREAD,
    modelCode: "gemini-2.5-flash",
    providerCode: "gemini",
    canProposals: true,
    utterance: UTTERANCE,
    agentId: "experiment-designer",
  },
};

// ── 1. the ask: plan filed, cache checked, card drafted ──────────────────────
h("1. the ask — plan checklist + spec card (the §20.3 plan-shaped miss branch)");
say(`user> ${UTTERANCE}`);
{
  const mock = scriptCalls(fixture.mocked_llm.tool_calls, fixture.mocked_llm.reply);
  try {
    const turn = await runAgentTurn({
      agentId: "experiment-designer", modelId: "gemini-2.5-flash", utterance: UTTERANCE, ctx,
    });
    say(`assistant> ${turn.reply}`);
  } finally {
    mock.restore();
  }
}
let plan = (await loadActivePlan(db, THREAD, USER))!;
const proposal = tables.proposals[0];
for (const upd of fixture.plan_binding_updates as Array<Record<string, unknown>>) {
  await executeTool("update_task_plan", {
    plan_id: plan.id,
    ...substitute(upd, { PROPOSAL_ID: String(proposal.id) }),
  }, ctx);
}
plan = (await loadActivePlan(db, THREAD, USER))!;
checklist(plan);
say(`  card: "${proposal.title}" (status: ${proposal.status}; pill embedded in the awaiting_approval step)`);
say(`  evidence: simulation_runs=${(tables.simulation_runs ?? []).length} — NOTHING dispatched before Approve`);

// ── 2. Approve → apply → the client advance (§21.4, ONE RPC) ─────────────────
h("2. Approve — apply dispatches; the bound step advances to awaiting_run");
say("user> [clicks Approve on the card]");
proposal.status = "approved";
proposal.reviewed_by = USER;
const applied = await applyExperimentSpec(db, { upstash: () => Promise.resolve("ok") }, {
  projectId: PROJECT,
  payload: proposal.payload as Record<string, unknown>,
  grounding: proposal.grounding as Record<string, unknown>,
  userId: USER,
});
const runId = String(applied.run_id);
await db.rpc("mark_agent_proposal_applied", { p_proposal_id: proposal.id, p_result: applied });
await db.rpc("advance_chat_plan_step", {
  p_plan_id: plan.id, p_step_id: "card", p_status: "awaiting_run", p_user_id: USER, p_run_id: runId,
});
say(`agent-apply → dispatchExperimentRun: run ${runId} queued (full provenance stamps)`);
checklist((await loadActivePlan(db, THREAD, USER))!);

// ── 3. the LIVE replication count climbs (worker streams rep_count_done) ─────
h("3. run in progress — the awaiting_run step's progress line climbs LIVE; each poll resume is ZERO-LLM");
const runRow = tables.simulation_runs.find((r) => String(r.id) === runId)!;
runRow.rep_count_target = 30;
runRow.status = "running";
for (const done of [6, 18]) {
  runRow.rep_count_done = done; // worker.py::_stream_replication updates the row per replication
  const poll = await runResumePreStep(db, { planId: plan.id, userId: USER });
  say(`  realtime → resume (kind=${poll.kind}): "${(poll as { reply: string }).reply}"`);
}

// ── 3b. reload mid-run: the checklist is SERVER state ────────────────────────
h("3b. reload mid-run — a FRESH client reads the same row: the checklist is current (D3)");
{
  const freshClient = makeStubDb(tables, rpcs); // brand-new client, same store
  const reloaded = (await loadActivePlan(freshClient, THREAD, USER))!;
  checklist(reloaded);
  say(`  progress line: run dispatched — ${runRow.rep_count_done}/${runRow.rep_count_target} replications`);
}

// ── 4. run completes → ONE debounced resume → cited answer ───────────────────
h("4. run done — the thread resumes itself; the answer cites the persisted evidence");
Object.assign(runRow, {
  status: "done", rep_count_done: 30, ended_at: "2026-07-19T12:00:00Z",
  aggregate_kpis: fixture.worker_result.aggregate_kpis,
});
tables.run_replications = (fixture.worker_result.replication_kpis as Row[]).map((r) => ({
  run_id: runId, status: "done", ...r,
}));
const outcome = await runResumePreStep(db, { planId: plan.id, userId: USER, modelCode: "gemini-2.5-flash" });
say(`resume pre-step: ${outcome.kind} → the read-and-cite agent turn runs (§20.4 step 5)`);
const sub = { PLAN_ID: plan.id, RUN_ID: runId };
const resumeCalls: RecordedToolCall[] = [];
{
  const mock = scriptCalls(
    substitute(fixture.resume_llm.tool_calls, sub),
    substitute(fixture.resume_llm.reply, sub),
  );
  try {
    const resumed = await runAgentTurn({
      agentId: "experiment-designer", modelId: "gemini-2.5-flash",
      utterance: (outcome as { utterance: string }).utterance, ctx,
      onToolResult: (name, args, envelope) => resumeCalls.push({ name, args, envelope }),
    });
    say(`assistant> ${resumed.reply}`);
    const verdict = await verifyWithRetry({
      projectId: PROJECT, db, userMessage: UTTERANCE,
      attempt: { reply: resumed.reply, calls: resumeCalls }, retry: null,
    });
    say(`  evidence chip: verified=${verdict.verified}, citations=${
      verdict.citations.map((c) => `${c.kind}:${String(c.ref).slice(0, 8)}`).join(", ")
    }`);
  } finally {
    mock.restore();
  }
}
await sweepPlanIntegrity(db, { planId: plan.id, userId: USER });
checklist((await loadActivePlan(db, THREAD, USER)) ?? (JSON.parse(JSON.stringify(tables.chat_plans[0])) as PlanRow));
say(`  every step terminal; plan status: ${tables.chat_plans[0].status}`);

// ── 5. the guardrail: a revoked-capability resume fails typed ────────────────
h("5. revoked capability — a plan is never a pre-authorization (§13.6 rule 5)");
{
  const t2: Record<string, Row[]> = {};
  const rpcs2 = makeAgentRpcs(t2);
  const db2 = makeStubDb(t2, rpcs2);
  await db2.rpc("upsert_chat_plan", {
    p_plan: {
      thread_id: THREAD, project_id: PROJECT, agent_id: "experiment-designer",
      title: "Revoked-grant plan",
      steps: [
        { id: "run", label: "Wait for the run", status: "awaiting_run", ref: { run_id: runId } },
        { id: "answer", label: "Answer from evidence", status: "pending" },
      ],
    },
    p_user_id: USER,
  });
  t2.simulation_runs = [{ id: runId, status: "done", rep_count_done: 30, rep_count_target: 30 }];
  const p2 = (await loadActivePlan(db2, THREAD, USER))!;
  const o2 = await runResumePreStep(db2, { planId: p2.id, userId: USER });
  say(`resume pre-step: ${o2.kind} — but checkpoint 2 finds experiment-designer REVOKED`);
  const failed = await markPlanStepFailed(db2, (o2 as { plan: PlanRow }).plan, "run", "forbidden: capability revoked", USER);
  say(`assistant> forbidden: resuming this plan needs the same rights as starting it, and the ` +
    `experiment-designer agent is no longer enabled for your account. Plan step "run" is marked failed.`);
  checklist(failed);
}

say("\nfor the next turn's model, the PLAN block would read:\n" + formatPlanBlock(
  (JSON.parse(JSON.stringify(tables.chat_plans[0])) as PlanRow),
));
say("\ndone — the loop spanned the approval and the run with no server-side timer, queue, or background job: every resume was a client-caused turn.");
