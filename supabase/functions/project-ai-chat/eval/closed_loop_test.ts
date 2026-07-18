// Phase H2 closed-loop golden suite, deterministic tier (ai-agents.md §20.6,
// §7.4 tier 1): each cl-* fixture drives the REAL tool handlers / the real
// B4 turn with a mocked LLM (the fixture's scripted tool calls), asserting
// the deterministic machinery of the §20 loop — the §20.2 cache-first read
// (hit table / cache_miss / cache_stale / disambiguation), the handler-side
// cache_hit draft guard, the §20.3 single-turn branches, and the §13.6 laws
// on the STUB DB (zero run rows without approval; zero proposals on hits).
// cl-04 / cl-09 / cl-10 land with Phase H3 (plan tool + resume).
// No LLM, no network, no real DB.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  buildClosedLoopPrompt,
  buildExperimentContext,
  experimentToolDeclarations,
  findCompletedRunDeclaration,
} from "../experimentTools.ts";
import { AGENT_COMMON } from "../draftTools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { findReuseCandidates } from "../../_shared/dispatch.ts";
import { applyExperimentSpec } from "../../agent-apply/experimentSpecApply.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SCEN = "55555555-5555-4555-8555-555555555502";
const VER = "44444444-4444-4444-8444-444444444401";
const RUN = "99999999-9999-4999-8999-999999999901";

interface ClFixture {
  id: string;
  description: string;
  stub?: { graph_hash?: string; current_policy_hash?: string };
  project_snapshot: Record<string, Row[]> | { reuse: string; patch?: Record<string, Row[]> };
  utterance: string;
  mocked_llm: {
    tool_calls: Array<{ tool: string; args: Record<string, unknown> }>;
    reply: string;
  };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

async function loadFixture(id: string): Promise<ClFixture> {
  const f: ClFixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/closed-loop/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const spec = f.project_snapshot as { reuse: string; patch?: Record<string, Row[]> };
    const base = await loadFixture(spec.reuse);
    f.project_snapshot = {
      ...(base.project_snapshot as Record<string, Row[]>),
      ...(spec.patch ?? {}),
    };
    f.stub = { ...base.stub, ...(f.stub ?? {}) };
  }
  return f;
}

interface Harness {
  ctx: ToolContext;
  db: StubDb;
}

function makeCtx(fixture: ClFixture): Harness {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const rpcs = makeAgentRpcs(tables, { graphHash: fixture.stub?.graph_hash });
  // The cl fixtures pin the LIVE hashes explicitly (a saved version whose
  // hash equals — or drifts from — the current state is the whole point).
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
      userEmail: "a@example.com",
      threadId: "33333333-3333-4333-8333-333333333333",
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance: fixture.utterance,
    },
  };
  return { ctx, db };
}

function withClosedLoop<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
  Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
  Deno.env.set("CLOSED_LOOP_ENABLED", "true");
  return fn().finally(() => {
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("AGENT_EXPERIMENT_TYPES");
    Deno.env.delete("CLOSED_LOOP_ENABLED");
  });
}

/** Script the Gemini provider from the fixture's mocked tool calls + reply
 * (the same shape the ed-* bridge-1 test uses). */
function scriptTurn(fixture: ClFixture) {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const script = fixture.mocked_llm.tool_calls.map((tc) => ({
    json: {
      candidates: [{
        content: { parts: [{ functionCall: { name: tc.tool, args: tc.args } }] },
      }],
    },
  }));
  script.push({
    json: {
      candidates: [{ content: { parts: [{ text: fixture.mocked_llm.reply }] } }],
    },
    // deno-lint-ignore no-explicit-any
  } as any);
  return installFetchMock(script);
}

async function runScriptedTurn(fixture: ClFixture, h: Harness) {
  const mock = scriptTurn(fixture);
  try {
    return await runAgentTurn({
      agentId: "experiment-designer",
      modelId: "gemini-2.5-flash",
      utterance: fixture.utterance,
      ctx: h.ctx,
    });
  } finally {
    mock.restore();
  }
}

// ── cl-01: cache hit answers immediately ─────────────────────────────────────

Deno.test("cl-01-cache-hit: find_completed_run returns the stored run (hit table, Validated badge, note carries the 12-hex triple)", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    const env = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, h.ctx);
    assertEquals(env.kind, "table", `expected a hit table, got: ${JSON.stringify(env.data)}`);
    const data = env.data as { columns: string[]; rows: unknown[][] };
    assertEquals(data.columns, ["Run", "Finished", "Replications", "Policy version", "Engine", "Validated"]);
    assertEquals(data.rows[0][0], fixture.expect.hit_run_id, "the stored run, newest first");
    assertEquals(data.rows[0][2], 30);
    assertEquals(data.rows[0][4], fixture.expect.hit_engine, "engine version RETURNED, not judged (G17 posture)");
    assertEquals(data.rows[0][5], fixture.expect.hit_badge, "the §9.5-derived badge via the vv badge logic");
    assert(
      String(env.meta.note).startsWith(fixture.expect.cache_note_prefix),
      `meta.note must carry the resolved triple: got "${env.meta.note}"`,
    );
    // §13.6 rule 1: a cache hit is a read, never a mutation.
    assertEquals((h.db.tables.proposals ?? []).length, 0, "no proposal on a hit");
    assertEquals(h.db.tables.simulation_runs.length, fixture.expect.run_count, "no new run row on a hit");
  }));

Deno.test("cl-01: the single-turn hit branch — find_completed_run → get_run_results → cited reply; no card, no dispatch, no plan", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    assertEquals(turn.proposalPart, null, "no proposal part on a hit");
    assertEquals(
      turn.toolCalls.map((c) => c.name),
      ["find_completed_run", "get_run_results"],
      "the §20.3 hit shape: cache read then results read, single turn",
    );
    assertStringIncludes(turn.reply, fixture.expect.hit_run_id, "the reply cites the stored run id");
    // Every number the scripted reply states exists in the stub run rows —
    // the platform law: simulation numbers come only from run envelopes.
    const stubNumbers = JSON.stringify([h.db.tables.simulation_runs, h.db.tables.run_replications]);
    for (const n of fixture.expect.reply_numbers_in_stub as string[]) {
      assertStringIncludes(turn.reply, n);
      assertStringIncludes(stubNumbers, n, `reply number ${n} must exist in the stub run rows`);
    }
    assertEquals((h.db.tables.proposals ?? []).length, 0, "zero proposals on hits (stub-DB assertion)");
    assertEquals(h.db.tables.simulation_runs.length, 1, "zero NEW run rows (stub-DB assertion)");
  }));

Deno.test("cl-01: read-hit and apply-hit are the SAME identity — the apply path answers ReuseAvailable with the identical run (§20.1 law 2)", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    // Read-path hit via the single extracted predicate…
    const [readHit] = await findReuseCandidates(h.db, {
      scenario: { id: SCEN },
      policyHash: "ph-run",
      graphHash: "graph-hash-1",
      scenarioHash: `scen-${SCEN}`,
      replications: 30,
    });
    assertEquals(readHit?.run_id, RUN);
    // …and the apply-path (dispatchExperimentRun's G17 check, same function):
    // an approved identical spec surfaces the stored run with reused:true —
    // strictly less compute than approved, never more (§13.6 rule 4).
    const upstashCalls: (string | number)[][] = [];
    const result = await applyExperimentSpec(h.db, {
      upstash: (args) => {
        upstashCalls.push(args);
        return Promise.resolve("ok");
      },
    }, {
      projectId: PROJECT,
      payload: { scenario_id: SCEN, policy_version_id: VER, replications: 30, findings_preview: [] },
      grounding: { policy_hash: "ph-run" },
      userId: USER,
    });
    assertEquals(result.run_id, RUN, "apply-hit surfaces the same run the read-hit found");
    assertEquals(result.reused, true);
    assertEquals(h.db.tables.simulation_runs.length, 1, "nothing recomputed");
    assertEquals(upstashCalls.length, 0, "nothing enqueued");
  }));

// ── cl-02 / cl-03: miss proposes; nothing runs without approval ──────────────

Deno.test("cl-02-cache-miss-proposes: miss note, then exactly one experiment_spec proposal and ZERO simulation_runs rows", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-02-cache-miss-proposes");
    const h = makeCtx(fixture);
    const env = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, h.ctx);
    assertEquals(env.meta.note, fixture.expect.cache_note);
    assertStringIncludes(String(env.data), "no completed run matches this scenario + policy version + current data");

    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    assert(turn.proposalPart, "the miss branch files the spec card");
    assertEquals(turn.proposalPart!.data.artifact_type, fixture.expect.proposal_artifact_type);
    assertEquals((h.db.tables.proposals ?? []).length, fixture.expect.proposal_count, "exactly one proposal");
    assertEquals((h.db.tables.simulation_runs ?? []).length, fixture.expect.run_count,
      "a miss NEVER dispatches — zero run rows (stub-DB assertion)");
  }));

Deno.test("cl-03-no-run-without-approval: after the turn ends with NO approval, the stub still has zero run rows and the card sits 'proposed'", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-03-no-run-without-approval");
    const h = makeCtx(fixture);
    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    // Simulate NO approval: nothing else happens. The §4.2 state machine is
    // the mechanism — only the card's Approve reaches agent-apply → dispatch.
    assertEquals((h.db.tables.simulation_runs ?? []).length, fixture.expect.run_count,
      "zero run rows without approval (stub-DB assertion)");
    const proposal = (h.db.tables.proposals ?? [])[0];
    assert(proposal, "the card exists");
    assertEquals(proposal.status, fixture.expect.proposal_status, "inert until approved");
    assertEquals(proposal.applied_result ?? null, null, "nothing applied");
  }));

// ── cl-05: stale data names the drifted hash ─────────────────────────────────

Deno.test("cl-05-stale-data: a done run exists but current_graph_hash drifted — cache_stale NAMES the drifted hash; no proposal filed", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-05-stale-data");
    const h = makeCtx(fixture);
    const env = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, h.ctx);
    assertEquals(env.meta.note, fixture.expect.cache_note);
    assertStringIncludes(String(env.data), fixture.expect.stale_names_hash, "the drifted hash is NAMED");
    assertStringIncludes(String(env.data), fixture.expect.stale_run_id, "the stale run is identified");
    assertStringIncludes(String(env.data), "graph-hash-2", "current hash shown");
    assertStringIncludes(String(env.data), "graph-hash-1", "stored hash shown");

    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    assertEquals(turn.proposalPart, null);
    assertEquals((h.db.tables.proposals ?? []).length, fixture.expect.proposal_count,
      "no proposal unless the utterance asked to proceed (§20.3 stale branch)");
    assertEquals(h.db.tables.simulation_runs.length, fixture.expect.run_count, "nothing dispatched");
  }));

// ── cl-06: insufficient replications is a miss, not a hit ────────────────────

Deno.test("cl-06-reps-upgrade: 10 done reps vs 30 asked ⇒ miss whose reason says why the stored run is insufficient; proposal filed", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-06-reps-upgrade");
    const h = makeCtx(fixture);
    const env = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, h.ctx);
    assertEquals(env.meta.note, fixture.expect.cache_note, "rep_count_done < asked is a MISS (§20.2 identity)");
    for (const s of fixture.expect.miss_reason_includes as string[]) {
      assertStringIncludes(String(env.data), s);
    }
    // Sanity: the same state at 10 asked reps IS a hit — the identity's
    // rep_count_done ≥ n clause, not a blanket miss.
    const at10 = await executeTool("find_completed_run", { scenario: "outage", replications: 10 }, h.ctx);
    assertEquals(at10.kind, "table", "any completed run of at least n reps");

    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    assert(turn.proposalPart, "the reps upgrade goes through the gate like any miss");
    assertEquals((h.db.tables.proposals ?? []).length, fixture.expect.proposal_count);
    assertEquals(h.db.tables.simulation_runs.length, fixture.expect.run_count, "nothing dispatched");
  }));

// ── cl-07: the deterministic guard, not the prompt, is the gate ──────────────

Deno.test("cl-07-forgotten-order: draft_experiment_spec called FIRST on a cache-hit state ⇒ handler answers cache_hit, files NO proposal", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-07-forgotten-order");
    const h = makeCtx(fixture);
    // Direct handler call — no prior find_completed_run this turn.
    const env = await executeTool("draft_experiment_spec", fixture.mocked_llm.tool_calls[0].args, h.ctx);
    assertEquals(env.meta.note, fixture.expect.guard_note, "the §4.5 cache_hit code (success-like)");
    assertStringIncludes(String(env.data), fixture.expect.guard_run_id, "data points at the stored run");
    for (const hash of fixture.expect.guard_hashes as string[]) {
      assertStringIncludes(String(env.data), hash, "data carries the provenance triple");
    }
    assertEquals((h.db.tables.proposals ?? []).length, 0, "NO proposal filed — no approval wasted");
    assertEquals(h.db.tables.simulation_runs.length, fixture.expect.run_count, "nothing dispatched");

    // The full scripted turn (model forgets the order): same outcome.
    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    assertEquals(turn.proposalPart, null);
    assertEquals((h.db.tables.proposals ?? []).length, 0, "zero proposals on hits (stub-DB assertion)");
  }));

Deno.test("cl-07 companion: after a find_completed_run for the SAME scenario+version, the guard stands down (the record shows the cache was consulted)", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-02-cache-miss-proposes");
    const h = makeCtx(fixture);
    // Miss state: consult the cache first (records the check on the turn)…
    const check = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, h.ctx);
    assertEquals(check.meta.note, "cache_miss");
    assert((h.ctx.cacheChecks ?? []).some((c) => c.scenario_id === SCEN && c.policy_version_id === VER),
      "the consultation is recorded for the guard");
    // …then draft: the guard must not re-run the lookup, and the miss drafts.
    const env = await executeTool("draft_experiment_spec", {
      scenario_id: SCEN,
      policy_version_id: VER,
      replications: 30,
    }, h.ctx);
    assertEquals(env.kind, "proposal", "consulted miss ⇒ the ordinary §5.4 draft path");
  }));

// ── cl-08: engine-version caveat material is envelope-carried ────────────────

Deno.test("cl-08-engine-version-caveat: the hit table carries the run's code_version; the reply surfaces the caveat sentence", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-08-engine-version-caveat");
    const h = makeCtx(fixture);
    const env = await executeTool("find_completed_run", { scenario: "outage", replications: 30 }, h.ctx);
    assertEquals(env.kind, "table");
    const data = env.data as { rows: unknown[][] };
    assertEquals(data.rows[0][4], fixture.expect.hit_engine,
      "the candidate's engine code_version is returned for the user to judge");

    const turn = await runScriptedTurn(fixture, h);
    assert(turn.ok, `turn failed: ${turn.error}`);
    for (const s of fixture.expect.reply_caveat_includes as string[]) {
      assertStringIncludes(turn.reply, s, "the §20.4 step-5 engine-version caveat");
    }
    assertEquals((h.db.tables.proposals ?? []).length, 0);
  }));

// ── §20.2 parameter surface: read-only, resolution, disambiguation ───────────

Deno.test("find_completed_run is READ-ONLY by construction: no parameter reaches a dispatch; unknown scenario / no versions answer honestly", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    const before = structuredClone(h.db.tables.simulation_runs);
    // Hostile-ish args: nothing can mutate — the handler only reads.
    await executeTool("find_completed_run", {
      scenario: "outage", replications: 9999, force_rerun: true, dispatch: true,
    }, h.ctx);
    assertEquals(h.db.tables.simulation_runs, before, "no run rows touched");
    assertEquals((h.db.tables.proposals ?? []).length, 0, "no proposals filed");

    const missing = await executeTool("find_completed_run", { scenario: "nonexistent" }, h.ctx);
    assertEquals(missing.meta.note, "empty");

    // No saved policy version ⇒ the §5.4-style dependency_missing phrasing.
    const bare = makeCtx(fixture);
    bare.db.tables.policy_versions = [];
    const noVersion = await executeTool("find_completed_run", { scenario: "outage" }, bare.ctx);
    assertEquals(noVersion.meta.note, "dependency_missing");
    assertStringIncludes(String(noVersion.data), "no saved policy version");
  }));

Deno.test("scenario ambiguity ⇒ the §22.5 disambiguation candidates (never a guess); a single-scenario project needs no fragment", () =>
  withClosedLoop(async () => {
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    h.db.tables.scenarios.push({
      ...structuredClone(h.db.tables.scenarios[0]),
      id: "55555555-5555-4555-8555-555555555503",
      name: "6-week outage of S2",
      created_at: 21,
    });
    const ambiguous = await executeTool("find_completed_run", { scenario: "outage" }, h.ctx);
    assertEquals(ambiguous.kind, "table");
    assertStringIncludes(String(ambiguous.meta.note), "ambiguous");
    assertStringIncludes(String(ambiguous.meta.note), "ask which one");
    assertEquals((ambiguous.data as { rows: unknown[][] }).rows.length, 2, "the ≤5 candidates");
    // An exact id resolves without a question.
    const exact = await executeTool("find_completed_run", { scenario: SCEN, replications: 30 }, h.ctx);
    assertEquals(exact.kind, "table", "exact id match wins outright");

    // Single-scenario project: the fragment is optional (§20.2 params).
    const single = makeCtx(fixture);
    const implicit = await executeTool("find_completed_run", { replications: 30 }, single.ctx);
    assertEquals(implicit.kind, "table", "the only scenario is unambiguous");
  }));

// ── flags off ⇒ §5.4 v1 byte-identically ─────────────────────────────────────

Deno.test("CLOSED_LOOP_ENABLED off ⇒ the v1 tool surface, the v1 prompt, and NO draft-time guard (the §9 kill-switch convention)", async () => {
  Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
  Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
  Deno.env.delete("CLOSED_LOOP_ENABLED");
  try {
    assertEquals(
      experimentToolDeclarations().map((d) => d.name),
      ["get_run_results", "get_validation_status", "get_policy_config", "draft_experiment_spec"],
      "the §5.4 v1 surface unchanged",
    );
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    const context = await buildExperimentContext(h.ctx, { utterance: fixture.utterance });
    assertStringIncludes(context, "You are the Experiment Designer, the SureSuite agent that compiles decision");
    assert(!context.includes("THE LOOP"), "the §20.4 prompt never leaks with the flag off");
    // v1 has no guard: drafting on a hit state files the card (dispatch's own
    // G17 check still protects the apply — reuse at apply, §13.6 rule 4).
    const env = await executeTool("draft_experiment_spec", {
      scenario_id: SCEN, policy_version_id: VER, replications: 30,
    }, h.ctx);
    assertEquals(env.kind, "proposal", "v1 draft behavior byte-identical");
  } finally {
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("AGENT_EXPERIMENT_TYPES");
  }
});

Deno.test("CLOSED_LOOP_ENABLED on ⇒ the §20.4 verbatim prompt supersedes §5.4's and the surface gains find_completed_run", () =>
  withClosedLoop(async () => {
    assertEquals(
      experimentToolDeclarations().map((d) => d.name),
      ["find_completed_run", "get_run_results", "get_validation_status", "get_policy_config", "draft_experiment_spec"],
      "the closed-loop set carries the cache-first read always (§20.2)",
    );
    const fixture = await loadFixture("cl-01-cache-hit");
    const h = makeCtx(fixture);
    const context = await buildExperimentContext(h.ctx, { utterance: fixture.utterance });
    assertStringIncludes(context, "You are the Experiment Designer, the SureSuite agent that answers decision\nquestions from simulation evidence for one project. You follow a fixed loop.");
    assertStringIncludes(context, "THE LOOP — follow these steps IN ORDER, one at a time:");
    assertStringIncludes(context, "3. CHECK THE CACHE. Call find_completed_run for the scenario + policy\n   version BEFORE drafting anything.");
    assertStringIncludes(context, "- HIT: do NOT draft a proposal.");
    assertStringIncludes(context, "STALE (note cache_stale)");
    assertStringIncludes(context, "4. PROPOSE THE RUN. Call draft_experiment_spec ONCE");
    assertStringIncludes(context, "5. ANSWER FROM EVIDENCE. Report ONLY numbers present in tool results from");
    assertStringIncludes(context, "if the run's engine code_version is not the current one, say so.");
    assertStringIncludes(context, AGENT_COMMON, "the {{AGENT_COMMON}} suffix applies unchanged");

    // The verbatim template builder itself (the fixtures pin the constant).
    const prompt = buildClosedLoopPrompt({
      projectId: PROJECT,
      scenariosJson: "[]",
      policyVersionsJson: "[]",
      validationJson: "null",
      runsJson: "[]",
    });
    assertStringIncludes(prompt, "1. UNDERSTAND. Identify the scenario and policy version the question needs.");
    assertStringIncludes(prompt, "2. PLAN. If answering needs more than one step (an approval, a new run),");
    assert(!prompt.includes("{{"), "no unexpanded slots");

    // §20.2: the read tool is declared exactly like the §2.3 tools.
    assertEquals(findCompletedRunDeclaration.name, "find_completed_run");
    assertStringIncludes(findCompletedRunDeclaration.description, "Read-only");
  }));
