// B3 V&V Analyst golden suite, deterministic tier (ai-agents.md §5.3 table,
// §7.4 tier 1): each vv-* fixture drives the REAL tool handlers with a mocked
// LLM (the fixture's tool-call arguments), asserting the deterministic
// machinery — the HANDLER-READ computed block (warm-up, adequacy from
// persisted per-rep KPIs, persisted-tests-only rule), the §5.3 verdict/basis
// downgrade, badge derivation, and the §4.4 apply through
// record_model_validation (supersede-not-edit). No LLM, no network, no DB.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import { buildVvContext, buildVvPrompt, vvToolDeclarations } from "../vvTools.ts";
import { AGENT_COMMON } from "../draftTools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { applyModelCard } from "../../agent-apply/modelCardApply.ts";
import { ApplyFailure } from "../../agent-apply/itemMasterApply.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const RUN = "66666666-6666-4666-8666-666666666601";
const VER = "44444444-4444-4444-8444-444444444401";

interface Fixture {
  id: string;
  description: string;
  project_snapshot: Record<string, Row[]>;
  utterance: string;
  stub_graph_hash?: string;
  mocked_llm?: { tool?: string; args?: Record<string, unknown> };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

async function loadFixture(id: string): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/vv-analyst/${id}.json`, import.meta.url)),
  );
}

function makeCtx(fixture: Fixture): { ctx: ToolContext; db: StubDb } {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const db = makeStubDb(
    tables,
    makeAgentRpcs(tables, fixture.stub_graph_hash ? { graphHash: fixture.stub_graph_hash } : undefined),
  );
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

function withVvEnabled<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "vv-analyst");
  return fn().finally(() => Deno.env.delete("AGENT_ENABLED_IDS"));
}

function storedProposal(db: StubDb, env: ToolEnvelope): Row {
  assertEquals(env.kind, "proposal", `expected a proposal envelope, got ${env.kind}: ${env.data}`);
  const id = String((env.data as Record<string, unknown>).proposal_id);
  const row = db.tables.proposals.find((p) => String(p.id) === id);
  if (!row) throw new Error(`proposal ${id} not stored`);
  return row;
}

Deno.test("vv-01-interpret-pass: the grounding context carries the computed stats; no proposal", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-01-interpret-pass");
    const { ctx, db } = makeCtx(fixture);
    const context = await buildVvContext(ctx, { utterance: fixture.utterance });
    for (const chunk of fixture.expect.context_includes) {
      assertStringIncludes(context, chunk);
    }
    assertStringIncludes(context, "You are the V&V Analyst");
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("vv-02-adopt-pass: computed equals the persisted stats verbatim; validated/statistical survives", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-02-adopt-pass");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    const payload = stored.payload as Record<string, unknown>;
    const exp = fixture.expect.proposal;
    assertEquals(payload.verdict, exp.verdict);
    assertEquals(payload.basis, exp.basis);
    assertEquals(payload.downgrade_note, exp.downgrade_note, "no downgrade on honest claims");
    assertEquals(stored.provenance, exp.provenance, "§5.3: computed block ⇒ deterministic provenance");
    const computed = payload.computed as Record<string, unknown>;
    assertEquals(computed.adopted_warmup_days, exp.computed.adopted_warmup_days, "engine warm-up weeks × 7");
    assertEquals(computed.warmup_method, exp.computed.warmup_method);
    assertEquals(computed.recommended_replications, exp.computed.recommended_replications);
    const perKpi = (computed.replication_basis as Record<string, Record<string, Record<string, number>>>).per_kpi;
    for (const [kpi, stats] of Object.entries(exp.per_kpi)) {
      const got = perKpi[kpi];
      assert(got, `per_kpi carries ${kpi}`);
      // deno-lint-ignore no-explicit-any
      for (const [k, v] of Object.entries(stats as Record<string, any>)) {
        assertEquals(got[k], v, `${kpi}.${k} equals the persisted-run statistic verbatim`);
      }
    }
    assertEquals(computed.validation_tests, exp.validation_tests, "persisted tests copied verbatim");
    // Grounding = the evidence run's provenance triple (§5.3).
    const grounding = stored.grounding as Record<string, unknown>;
    assertEquals(grounding.policy_hash, "ph-run");
    assertEquals(grounding.scenario_hash, `scen-55555555-5555-4555-8555-555555555501`);
  }));

Deno.test("vv-03-adopt-fail-tests: a failing persisted test forces the honest verdict", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-03-adopt-fail-tests");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    const payload = storedProposal(db, env).payload as Record<string, unknown>;
    assertEquals(payload.verdict, fixture.expect.proposal.verdict, "downgraded to rejected");
    assertEquals(payload.basis, fixture.expect.proposal.basis);
    assertStringIncludes(String(payload.downgrade_note), fixture.expect.proposal.downgrade_note_includes);
  }));

Deno.test("vv-04-no-run: no completed evidence run ⇒ dependency_missing, no proposal", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-04-no-run");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, "dependency_missing");
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("vv-05-gate-skipped: the card's findings flag the gate-skipped evidence run", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-05-gate-skipped");
    const { ctx, db } = makeCtx(fixture);
    const context = await buildVvContext(ctx, { utterance: fixture.utterance });
    for (const chunk of fixture.expect.context_includes) {
      assertStringIncludes(context, chunk);
    }
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    const payload = storedProposal(db, env).payload as Record<string, unknown>;
    const findings = (payload.computed as { findings: Array<{ field: string }> }).findings;
    assert(
      findings.some((f) => f.field === fixture.expect.proposal.findings_include_field),
      "computed.findings carries run.gate_skipped",
    );
    assertEquals(payload.verdict, fixture.expect.proposal.verdict);
    assertEquals(payload.basis, fixture.expect.proposal.basis);
  }));

Deno.test("vv-06-stale-badge: drifted hashes derive a stale badge; nothing is drafted", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-06-stale-badge");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("get_validation_status", {}, ctx);
    assertEquals(env.kind, "table");
    const rows = (env.data as { rows: unknown[][] }).rows;
    assertEquals(rows.length, 1);
    assert(
      String(rows[0][1]).startsWith(fixture.expect.badge_prefix),
      `badge "${rows[0][1]}" derives stale on drift`,
    );
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("vv-07-adequacy-quote: the recommendation quotes the MAX per-KPI n*", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-07-adequacy-quote");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    const payload = storedProposal(db, env).payload as Record<string, unknown>;
    const computed = payload.computed as Record<string, unknown>;
    assertEquals(
      computed.recommended_replications,
      fixture.expect.proposal.computed.recommended_replications,
      "n* = max across focal KPIs (35 from the high-variance backlog)",
    );
    assertEquals(payload.verdict, fixture.expect.proposal.verdict, "inadequate n downgrades a validated claim");
    assertStringIncludes(String(payload.downgrade_note), fixture.expect.proposal.downgrade_note_includes);
  }));

Deno.test("vv-08-apply: record_model_validation supersedes the prior same-triple card", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-08-apply");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    stored.status = "approved"; // the card's Approve

    const result = await applyModelCard(db, {
      projectId: PROJECT,
      payload: stored.payload as Record<string, unknown>,
      userId: USER,
      userEmail: "a@example.com",
    });
    assert(result.model_validation_id, "a model_validations row was recorded");

    const prior = db.tables.model_validations.find(
      (c) => String(c.id) === fixture.expect.apply.prior_card_id,
    )!;
    assertEquals(prior.status, fixture.expect.apply.prior_status, "prior card superseded, never edited");
    assertEquals(prior.superseded_by, result.model_validation_id, "supersession pointer set");

    const { data: active } = await db.rpc("active_model_validation", {
      p_policy_version_id: VER,
      p_graph_hash: "graph-hash-1",
      p_scenario_hash: "scen-55555555-5555-4555-8555-555555555501",
    });
    const resolved = (active as Row[])[0];
    assertEquals(String(resolved?.id), result.model_validation_id, "active_model_validation resolves the new card");
  }));

Deno.test("apply: a run that lost its provenance stamps fails gate_blocked", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-02-adopt-pass");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_model_card_narrative", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    stored.status = "approved";
    (db.tables.simulation_runs[0] as Row).dataset_version_id = null;
    try {
      await applyModelCard(db, { projectId: PROJECT, payload: stored.payload as Record<string, unknown> });
      throw new Error("expected ApplyFailure");
    } catch (e) {
      assert(e instanceof ApplyFailure, `expected ApplyFailure, got ${e}`);
      assertEquals((e as ApplyFailure).code, "gate_blocked");
      assertStringIncludes((e as ApplyFailure).message, "dataset_version_id");
    }
    assertEquals(db.tables.model_validations.length, 1, "no card recorded");
  }));

Deno.test("agent turn (bridge 1): scripted provider drives the §5.3 loop to a proposal part", () =>
  withVvEnabled(async () => {
    const fixture = await loadFixture("vv-02-adopt-pass");
    const { ctx } = makeCtx(fixture);
    Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
    const mock = installFetchMock([
      {
        json: {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: "draft_model_card_narrative", args: fixture.mocked_llm!.args } }],
            },
          }],
        },
      },
      {
        json: {
          candidates: [{
            content: {
              parts: [{ text: "Drafted the adoption card — the card must be reviewed and approved before it governs Lab runs." }],
            },
          }],
        },
      },
    ]);
    try {
      const result = await runAgentTurn({
        agentId: "vv-analyst",
        modelId: "gemini-2.5-flash",
        utterance: fixture.utterance,
        ctx,
      });
      assert(result.ok, `agent turn failed: ${result.error}`);
      assert(result.proposalPart, "proposal part collected from the tool envelope");
      assertEquals(result.proposalPart!.data.artifact_type, "model_card_draft");

      const firstCall = mock.calls[0].body as {
        systemInstruction: { parts: Array<{ text: string }> };
        tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
      };
      const system = firstCall.systemInstruction.parts[0].text;
      assertStringIncludes(system, "You are the V&V Analyst");
      assertStringIncludes(system, "RULES THAT OVERRIDE EVERYTHING ELSE");
      assert(!system.includes("CONVERSATION SUMMARY"), "agent turns never receive the rolling summary");
      assertEquals(
        firstCall.tools[0].functionDeclarations.map((d) => d.name),
        ["get_validation_status", "get_run_results", "draft_model_card_narrative"],
        "least-privilege tool subset (§5.3)",
      );
    } finally {
      mock.restore();
    }
  }));

Deno.test("vv prompt template carries the verbatim §5.3 + AGENT_COMMON blocks", () => {
  const prompt = buildVvPrompt({
    projectId: PROJECT,
    utterance: "is my model validated?",
    runSummaryJson: "null",
    warmupJson: "null",
    adequacyJson: "null",
    testsJson: "[]",
    policyHash: "a",
    graphHash: "b",
    scenarioHash: "c",
    activeCardJson: "null",
  });
  assertStringIncludes(prompt, "You are the V&V Analyst, the SuReSuite agent that interprets verification &");
  assertStringIncludes(prompt, "call draft_model_card_narrative ONCE, copying every numeric");
  assertStringIncludes(prompt, "the card must be\n  reviewed and approved before it governs Lab runs.");
  assertStringIncludes(prompt, AGENT_COMMON);
  assertEquals(vvToolDeclarations().length, 3, "no tool beyond the §5.3 surface is declared");
});
