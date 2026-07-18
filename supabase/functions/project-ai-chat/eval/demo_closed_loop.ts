// Phase H2 closed-loop demo transcripts (ai-agents.md §24.3 H2 acceptance):
// drives the REAL machinery offline (scripted provider, stateful stub DB) and
// prints the three acceptance scenarios:
//   (a) a project WITH a completed matching run — "what did the 6-week outage
//       do?" answers INSTANTLY citing the stored run id + hashes; no card;
//   (b) the same ask on a project WITHOUT the run — the spec card appears and
//       NOTHING dispatches until Approve (then Approve → queued run row with
//       full provenance stamps, via the one dispatch path);
//   (c) after a CSV re-upload (current_graph_hash drifts) — the cache_stale
//       reply names the drifted hash; no card, nothing dispatched.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_closed_loop.ts

import { decideRoute, type ClassifierCall } from "../router.ts";
import { executeTool, type ToolContext } from "../tools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { applyExperimentSpec } from "../../agent-apply/experimentSpecApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SCEN = "55555555-5555-4555-8555-555555555502";
const VER = "44444444-4444-4444-8444-444444444401";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("ROUTER_V2_SIGNALS", "true");
Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
Deno.env.set("CLOSED_LOOP_ENABLED", "true");
Deno.env.set("GEMINI_API_KEY", "demo-key");

const say = (s: string) => console.log(s);
const h = (s: string) => say(`\n\x1b[1m── ${s} ──\x1b[0m`);

const UTTERANCE = "what did the 6-week outage do?";

interface Fixture {
  stub?: { graph_hash?: string; current_policy_hash?: string };
  project_snapshot: Record<string, Row[]> | { reuse: string; patch?: Record<string, Row[]> };
  mocked_llm: { tool_calls: Array<{ tool: string; args: Record<string, unknown> }>; reply: string };
}

async function loadFixture(id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/closed-loop/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const spec = f.project_snapshot as { reuse: string; patch?: Record<string, Row[]> };
    const base = await loadFixture(spec.reuse);
    f.project_snapshot = { ...(base.project_snapshot as Record<string, Row[]>), ...(spec.patch ?? {}) };
    f.stub = { ...base.stub, ...(f.stub ?? {}) };
  }
  return f;
}

function makeHarness(fixture: Fixture): { ctx: ToolContext; db: StubDb } {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const rpcs = makeAgentRpcs(tables, { graphHash: fixture.stub?.graph_hash });
  if (fixture.stub?.current_policy_hash) {
    const hash = fixture.stub.current_policy_hash;
    rpcs.current_policy_hash = () => hash;
  }
  const db = makeStubDb(tables, rpcs);
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
      utterance: UTTERANCE,
    },
  };
  return { ctx, db };
}

const classifier: ClassifierCall = () =>
  Promise.resolve(JSON.stringify({
    route: "artifact", agent_id: "experiment-designer", intent: "exp.brief",
    confidence: 0.96, advisory_part: null, artifact_part: UTTERANCE,
    needs_run: true, cache_checkable: true,
  }));

function scriptTurn(fixture: Fixture) {
  const script = fixture.mocked_llm.tool_calls.map((tc) => ({
    json: { candidates: [{ content: { parts: [{ functionCall: { name: tc.tool, args: tc.args } }] } }] },
  }));
  script.push({
    json: { candidates: [{ content: { parts: [{ text: fixture.mocked_llm.reply }] } }] },
    // deno-lint-ignore no-explicit-any
  } as any);
  return installFetchMock(script);
}

async function routed() {
  const d = await decideRoute(UTTERANCE, {
    personaId: null, hasProject: true, enabledAgents: ["experiment-designer"], modelId: "gemini-2.5-flash",
  }, classifier);
  say(`user> ${UTTERANCE}`);
  say(`router.decision (v2): ${JSON.stringify({
    route: d.route, agent_id: d.agent_id, intent: d.intent,
    needs_run: d.needs_run, cache_checkable: d.cache_checkable,
  })}`);
  return d;
}

async function runTurn(fixture: Fixture, harness: { ctx: ToolContext; db: StubDb }) {
  const mock = scriptTurn(fixture);
  try {
    return await runAgentTurn({
      agentId: "experiment-designer",
      modelId: "gemini-2.5-flash",
      utterance: UTTERANCE,
      ctx: harness.ctx,
    });
  } finally {
    mock.restore();
  }
}

// (a) hit answers instantly ---------------------------------------------------
h("(a) completed matching run exists — the cache answers INSTANTLY, no card");
{
  const fixture = await loadFixture("cl-01-cache-hit");
  const harness = makeHarness(fixture);
  await routed();
  const cacheEnv = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, harness.ctx);
  say(`tool find_completed_run → ${cacheEnv.meta.note}`);
  const turn = await runTurn(fixture, harness);
  say(`assistant> ${turn.reply}`);
  say(`evidence: proposals=${(harness.db.tables.proposals ?? []).length} (no card), ` +
    `simulation_runs=${harness.db.tables.simulation_runs.length} (unchanged — nothing dispatched), ` +
    `quota spent: none`);
}

// (b) miss files the card; nothing runs until Approve -------------------------
h("(b) no completed run — the spec card appears; NOTHING dispatches until Approve");
{
  const fixture = await loadFixture("cl-02-cache-miss-proposes");
  const harness = makeHarness(fixture);
  await routed();
  const cacheEnv = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, harness.ctx);
  say(`tool find_completed_run → ${cacheEnv.meta.note}: ${cacheEnv.data}`);
  const turn = await runTurn(fixture, harness);
  say(`assistant> ${turn.reply}`);
  const proposal = (harness.db.tables.proposals ?? [])[0];
  say(`card: "${proposal?.title}" (status: ${proposal?.status})`);
  say(`evidence BEFORE approval: simulation_runs=${(harness.db.tables.simulation_runs ?? []).length} — zero rows`);

  say(`\nuser> [clicks Approve on the card]`);
  proposal.status = "approved";
  const upstashCalls: (string | number)[][] = [];
  const result = await applyExperimentSpec(harness.db, {
    upstash: (args) => { upstashCalls.push(args); return Promise.resolve("ok"); },
  }, {
    projectId: PROJECT,
    payload: proposal.payload as Record<string, unknown>,
    grounding: proposal.grounding as Record<string, unknown>,
    userId: USER,
  });
  const run = harness.db.tables.simulation_runs.find((r) => String(r.id) === result.run_id)!;
  say(`agent-apply → dispatchExperimentRun: run ${result.run_id} status=${run.status}`);
  say(`provenance stamps: policy_version_id=${run.policy_version_id} policy_hash=${run.policy_hash} ` +
    `graph_hash=${run.graph_hash} scenario_hash=${run.scenario_hash}`);
  say(`worker enqueued: ${upstashCalls.some((c) => c[0] === "XADD")}`);
}

// (c) CSV re-upload — cache_stale names the drifted hash ----------------------
h("(c) after a CSV re-upload — cache_stale NAMES the drifted hash");
{
  const fixture = await loadFixture("cl-05-stale-data");
  const harness = makeHarness(fixture);
  await routed();
  const cacheEnv = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, harness.ctx);
  say(`tool find_completed_run → ${cacheEnv.meta.note}: ${cacheEnv.data}`);
  const turn = await runTurn(fixture, harness);
  say(`assistant> ${turn.reply}`);
  say(`evidence: proposals=${(harness.db.tables.proposals ?? []).length} (no card — the user did not ask to proceed), ` +
    `simulation_runs=${harness.db.tables.simulation_runs.length} (nothing dispatched)`);
}

say("\ndone — the loop's cheap path answered (a) and (c) with zero compute; (b) entered the gate and dispatched only on Approve.");
