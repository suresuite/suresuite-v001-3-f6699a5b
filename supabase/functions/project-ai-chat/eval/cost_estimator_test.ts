// B7 Cost Estimator golden suite, deterministic tier (ai-agents.md §18.1
// table, §7.4 tier 1): each ce-* fixture drives the REAL tool handlers with a
// mocked LLM (the fixture's tool-call arguments), asserting the deterministic
// machinery — method recomputation on value/low/high (1e-9), the mandatory
// interval, scope gates, back-test demotion, firm-level refusal, idempotency,
// the §4.5 error taxonomy, and the §4.4 apply sequence with its findings
// delta. No LLM, no network, no database.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  buildEstimatorPrompt,
  estimatorToolDeclarations,
} from "../estimatorTools.ts";
import { AGENT_COMMON } from "../draftTools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { ApplyFailure } from "../../agent-apply/itemMasterApply.ts";
import { applyParameterEstimate } from "../../agent-apply/parameterEstimateApply.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

interface Fixture {
  id: string;
  description: string;
  project_snapshot: Record<string, Row[]> | { reuse: string };
  utterance: string;
  mocked_llm?: {
    tool?: string;
    args?: Record<string, unknown>;
    reuse?: string;
  };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

async function loadFixture(id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/cost-estimator/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const base = await loadFixture((f.project_snapshot as { reuse: string }).reuse);
    f.project_snapshot = base.project_snapshot;
    if (f.mocked_llm && "reuse" in f.mocked_llm) f.mocked_llm = base.mocked_llm;
  }
  return f;
}

function makeCtx(fixture: Fixture): { ctx: ToolContext; db: StubDb } {
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
  return { ctx, db };
}

function withEstimatorEnabled<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "cost-estimator");
  return fn().finally(() => Deno.env.delete("AGENT_ENABLED_IDS"));
}

interface CandidateCell {
  field: string;
  entity: string;
  method: string;
  value: number;
  low: number;
  high: number;
  basis: string;
  dataset: string;
  vintage: string;
  status: string;
  assumptions: string;
}

function candidateCells(env: ToolEnvelope): CandidateCell[] {
  assertEquals(env.kind, "table", "get_parameter_estimates returns a table");
  const data = env.data as { columns: string[]; rows: unknown[][] };
  assertEquals(
    data.columns,
    ["field", "entity_id", "method", "value", "low", "high", "basis", "dataset", "vintage", "status", "assumptions"],
    "§18.1 column contract",
  );
  return data.rows.map((r) => ({
    field: String(r[0]),
    entity: String(r[1]),
    method: String(r[2]),
    value: Number(r[3]),
    low: Number(r[4]),
    high: Number(r[5]),
    basis: String(r[6]),
    dataset: String(r[7]),
    vintage: String(r[8]),
    status: String(r[9]),
    assumptions: String(r[10]),
  }));
}

function proposalRow(db: StubDb, proposalId: string): Row {
  const row = db.tables.proposals.find((p) => String(p.id) === proposalId);
  if (!row) throw new Error(`proposal ${proposalId} not stored`);
  return row;
}

// deno-lint-ignore no-explicit-any
function assertProposalExpectations(db: StubDb, env: ToolEnvelope, expect: Record<string, any>) {
  assertEquals(env.kind, "proposal", `expected a proposal envelope, got ${env.kind}: ${env.data}`);
  const data = env.data as Record<string, unknown>;
  const stored = proposalRow(db, String(data.proposal_id));
  const payload = stored.payload as { rows: Array<Record<string, unknown>> };
  assertEquals(payload.rows.length, expect.rows, "row count");
  assertEquals(stored.provenance, expect.provenance, "provenance");
  if (expect.methods) {
    const used = [...new Set(payload.rows.map((r) => String(r.method)))].sort();
    assertEquals(used, [...expect.methods].sort(), "methods used");
  }
  if (expect.basis) {
    const bases = [...new Set(payload.rows.map((r) => String(r.basis)))].sort();
    assertEquals(bases, [...expect.basis].sort(), "interval bases");
  }
  // §18.1 output contract: every payload row is server-enriched and carries
  // a full interval, its method, sources (dataset + vintage) and assumptions.
  for (const r of payload.rows) {
    assert(typeof r.value === "number" && typeof r.low === "number" && typeof r.high === "number",
      "row carries a numeric {value, low, high}");
    assert((r.low as number) <= (r.value as number) && (r.value as number) <= (r.high as number),
      "low ≤ value ≤ high");
    assert(Array.isArray(r.sources) && (r.sources as unknown[]).length > 0, "row carries sources");
    for (const s of r.sources as Array<Record<string, unknown>>) {
      assert(typeof s.dataset === "string" && s.dataset, "source carries dataset");
      assert(s.vintage !== undefined, "source carries vintage");
    }
    assert(Array.isArray(r.assumptions) && (r.assumptions as unknown[]).length > 0, "row carries assumptions");
  }
  if (expect.citation_kinds) {
    const kinds = new Set(
      ((stored.citations ?? []) as Array<Record<string, unknown>>).map((c) => String(c.kind)),
    );
    for (const k of expect.citation_kinds) assert(kinds.has(k), `citation kind ${k} present`);
  }
  if (expect.no_value !== undefined) {
    const banned = String(expect.no_value);
    assert(!JSON.stringify(payload).includes(banned), `payload must not contain ${banned}`);
  }
}

function assertFailure(env: ToolEnvelope, code: string, reasonIncludes?: string) {
  assertEquals(env.kind, "text", "failure envelopes are text");
  assertEquals(env.meta?.note, code, `error code (got: ${env.data})`);
  if (reasonIncludes) assertStringIncludes(String(env.data), reasonIncludes);
}

// ── ce-01: family (a) — values + source-range intervals, duplicate, apply ──

Deno.test("ce-01-estimate-costs: candidates surface, draft equals recomputation, re-run converges, apply shrinks findings", async () => {
  const fixture = await loadFixture("ce-01-estimate-costs");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const read = await executeTool("get_parameter_estimates", {}, ctx);
    const cells = candidateCells(read);
    for (const want of fixture.expect.candidates) {
      const got = cells.find(
        (c) => c.field === want.field && c.entity === want.entity_id && c.method === want.method,
      );
      assert(got, `candidate ${want.field}/${want.entity_id} via ${want.method} present`);
      assertEquals(got!.value, want.value, "candidate value");
      assertEquals(got!.low, want.low, "candidate low");
      assertEquals(got!.high, want.high, "candidate high");
      assertEquals(got!.status, want.status, "candidate status");
    }

    const draft = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, draft, fixture.expect.proposal);
    const firstId = String((draft.data as Record<string, unknown>).proposal_id);

    // §4.5 duplicate path: the identical ask converges on the same card.
    const again = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertEquals(again.kind, "proposal");
    assertEquals(String((again.data as Record<string, unknown>).proposal_id), firstId, "idempotent proposal id");
    assertEquals(again.meta?.note, "duplicate", "duplicate marker");

    // §4.4 apply: masters updated; findings_after ⊂ findings_before.
    const stored = proposalRow(db, firstId);
    const result = await applyParameterEstimate(db, {
      projectId: PROJECT,
      payload: stored.payload as Record<string, unknown>,
      grounding: stored.grounding as Record<string, unknown>,
    });
    const mats = db.tables.materials;
    // The volume-weighted lane price, not the cheapest quote (3.75 / 2.0):
    // (4.5×100 + 3.75×80) / 180 and (2×200 + 2.6×60) / 260.
    assertEquals(Number(mats.find((m) => m.material_id === "MAT-1")!.cost), 4.166666666666667, "MAT-1 cost applied");
    assertEquals(Number(mats.find((m) => m.material_id === "MAT-2")!.cost), 2.1384615384615384, "MAT-2 cost applied");
    assert(Array.isArray(result.before.materials) && result.before.materials!.length === 2, "before snapshot present");
    const beforeKeys = new Set(result.findings_before.map((f) => `${f.severity}|${f.field}|${f.policy}`));
    for (const f of result.findings_after) {
      assert(beforeKeys.has(`${f.severity}|${f.field}|${f.policy}`), "no new finding appeared");
    }
    assert(
      result.findings_after.length < result.findings_before.length,
      `findings_after (${result.findings_after.length}) strictly ⊂ findings_before (${result.findings_before.length})`,
    );
  });
});

// ── ce-02: family (b) rate benchmark with dataset + vintage + assumptions ──

Deno.test("ce-02-holding-rates: benchmark rows carry the seed interval, dataset, vintage and assumptions", async () => {
  const fixture = await loadFixture("ce-02-holding-rates");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const read = await executeTool("get_parameter_estimates", { table: "materials" }, ctx);
    const cells = candidateCells(read);
    const want = fixture.expect.candidates[0];
    const got = cells.find((c) => c.field === want.field && c.entity === want.entity_id);
    assert(got, "holding-rate candidate present");
    assertEquals(got!.value, want.value);
    assertEquals(got!.low, want.low);
    assertEquals(got!.high, want.high);
    assert(got!.dataset.includes("holding-rate"), "candidate names its dataset");
    assertEquals(got!.vintage, "2013", "candidate names its vintage");

    const draft = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, draft, fixture.expect.proposal);
  });
});

// ── ce-03: family (b) VoS-scaled cost where B1 must refuse ──

Deno.test("ce-03-benchmark-scaled: a no-arc material gets a benchmark-scaled estimate", async () => {
  const fixture = await loadFixture("ce-03-benchmark-scaled");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const read = await executeTool("get_parameter_estimates", {}, ctx);
    const cells = candidateCells(read);
    const want = fixture.expect.candidates[0];
    const got = cells.find(
      (c) => c.field === want.field && c.entity === want.entity_id && c.method === want.method,
    );
    assert(got, "benchmark-scaled candidate present for the no-arc material");
    assert(Math.abs(got!.value - want.value) < 1e-9, `value ${got!.value} ≈ ${want.value}`);
    assert(Math.abs(got!.low - want.low) < 1e-9, "low matches");
    assert(Math.abs(got!.high - want.high) < 1e-9, "high matches");
    // No direct_from_project candidate exists — this is the case B1 refuses.
    assert(
      !cells.some((c) => c.entity === want.entity_id && c.method.startsWith("direct_")),
      "no direct candidate for a material without arcs",
    );

    const draft = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, draft, fixture.expect.proposal);
  });
});

// ── ce-04/05/06: the §4.5 taxonomy ──

Deno.test("ce-04-interval-required: missing low/high ⇒ invalid_params, no proposal", async () => {
  const fixture = await loadFixture("ce-04-interval-required");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const env = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertFailure(env, fixture.expect.error_code, fixture.expect.reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, 0, "no proposal created");
  });
});

Deno.test("ce-05-mismatch: a tampered value ⇒ not_grounded at draft, stale_values at apply", async () => {
  const fixture = await loadFixture("ce-05-mismatch");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const env = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertFailure(env, fixture.expect.error_code, fixture.expect.reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, 0, "no proposal created");

    // Apply twin: a stored row that no longer recomputes fails stale_values.
    const tampered = {
      schema_version: 1,
      prompt_version: 1,
      rows: [{
        table: "materials", entity_id: "MAT-1", field: "cost",
        method: "direct_inbound_price@1", value: 4.17, low: 3.75, high: 4.5,
      }],
    };
    let failed: ApplyFailure | null = null;
    try {
      await applyParameterEstimate(db, { projectId: PROJECT, payload: tampered, grounding: {} });
    } catch (e) {
      failed = e as ApplyFailure;
    }
    assert(failed instanceof ApplyFailure, "apply throws ApplyFailure");
    assertEquals(failed!.code, "stale_values", "apply-time code");
  });
});

Deno.test("ce-06-scope: foreign entity id ⇒ project_scope_violation", async () => {
  const fixture = await loadFixture("ce-06-scope");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const env = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertFailure(env, fixture.expect.error_code, fixture.expect.reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, 0, "no proposal created");
  });
});

// ── ce-07: family (c) is report-only ──

Deno.test("ce-07-resilience-report: firm-level rows surface with C^res mapping; drafting them is refused", async () => {
  const fixture = await loadFixture("ce-07-resilience-report");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const read = await executeTool("get_parameter_estimates", { include_resilience: true }, ctx);
    const cells = candidateCells(read);
    for (const want of fixture.expect.firm_rows) {
      const got = cells.find((c) => c.method === want.method && c.entity === "firm");
      assert(got, `firm-level row for ${want.method} present`);
      assert(got!.value > 0 && got!.low > 0 && got!.high >= got!.value, "firm estimate carries an interval");
      assertStringIncludes(got!.assumptions, `C^res component: ${want.cres} (${want.catalog_ref})`);
      assertStringIncludes(got!.assumptions, "Talluri");
    }
    // Without the flag, firm rows stay out of the table.
    const bare = await executeTool("get_parameter_estimates", {}, ctx);
    assert(
      !candidateCells(bare).some((c) => c.entity === "firm"),
      "firm rows only appear with include_resilience",
    );

    const env = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertFailure(env, fixture.expect.error_code, fixture.expect.reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, 0, "no proposal created");
  });
});

// ── ce-08: injection cannot move values ──

Deno.test("ce-08-injection: instruction-like project data cannot steer values", async () => {
  const fixture = await loadFixture("ce-08-injection");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const draft = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, draft, fixture.expect.proposal);
    const stored = proposalRow(db, String((draft.data as Record<string, unknown>).proposal_id));
    const rows = (stored.payload as { rows: Array<Record<string, unknown>> }).rows;
    assertEquals(Number(rows.find((r) => r.entity_id === "MAT-1")!.value), 4.166666666666667, "MAT-1 unchanged by injection");
    assertEquals(Number(rows.find((r) => r.entity_id === "MAT-2")!.value), 2.1384615384615384, "MAT-2 unchanged by injection");
  });
});

// ── ce-09: back-test demotion ──

Deno.test("ce-09-backtest-demoted: an interval that excludes the observed actuals demotes the method", async () => {
  const fixture = await loadFixture("ce-09-backtest-demoted");
  const { ctx, db } = makeCtx(fixture);
  await withEstimatorEnabled(async () => {
    const read = await executeTool("get_parameter_estimates", {}, ctx);
    const cells = candidateCells(read);
    const want = fixture.expect.candidates[0];
    const got = cells.find(
      (c) => c.field === want.field && c.entity === want.entity_id && c.method === want.method,
    );
    assert(got, "demoted candidate still listed (marked)");
    assertEquals(got!.status, "demoted", "candidate is marked demoted");

    const env = await executeTool("draft_parameter_estimate", fixture.mocked_llm!.args!, ctx);
    assertFailure(env, fixture.expect.error_code, fixture.expect.reason_includes);
    assertEquals(db.tables.proposals?.length ?? 0, 0, "no proposal created");
  });
});

// ── bridge 1: the real agent turn drives the loop to a proposal part ──

Deno.test("agent turn (bridge 1): scripted provider drives the real loop to a proposal part", () =>
  withEstimatorEnabled(async () => {
    const fixture = await loadFixture("ce-01-estimate-costs");
    const { ctx } = makeCtx(fixture);
    Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
    const mock = installFetchMock([
      {
        json: {
          candidates: [{
            content: {
              parts: [{
                functionCall: { name: "draft_parameter_estimate", args: fixture.mocked_llm!.args },
              }],
            },
          }],
        },
      },
      {
        json: {
          candidates: [{
            content: {
              parts: [{ text: "Drafted 2 cost estimates from inbound price ranges — review the card before it applies." }],
            },
          }],
        },
      },
    ]);
    try {
      const turn = await runAgentTurn({
        agentId: "cost-estimator",
        modelId: "gemini-2.5-flash",
        utterance: fixture.utterance,
        ctx,
      });
      assert(turn.ok, `turn failed: ${turn.error}`);
      assert(turn.proposalPart, "a proposal part is attached mechanically");
      assertEquals(turn.proposalPart!.data.artifact_type, "parameter_estimate");
      assertEquals(turn.proposalPart!.data.provenance, "deterministic");

      // The agent turn's system prompt is the §18.1 template with the
      // estimator's least-privilege toolset (never any conversation summary).
      const firstCall = mock.calls[0].body as {
        systemInstruction: { parts: Array<{ text: string }> };
        tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
      };
      const system = firstCall.systemInstruction.parts[0].text;
      assertStringIncludes(system, "You are the Cost Estimator");
      assertStringIncludes(system, "RULES THAT OVERRIDE EVERYTHING ELSE");
      assert(!system.includes("CONVERSATION SUMMARY"), "agent turns never receive the rolling summary");
      assertEquals(
        firstCall.tools[0].functionDeclarations.map((d) => d.name),
        ["list_project_entities", "get_parameter_estimates", "draft_parameter_estimate"],
        "least-privilege tool subset (§18.1)",
      );
    } finally {
      mock.restore();
      Deno.env.delete("GEMINI_API_KEY");
    }
  }));

// ── the §18.1 prompt template is verbatim ──

Deno.test("estimator prompt template carries the verbatim §18.1 + AGENT_COMMON blocks", () => {
  const prompt = buildEstimatorPrompt({
    projectId: PROJECT,
    utterance: "estimate the missing economics",
    findingsJson: "[]",
    datasetCountsJson: "{}",
    methodsJson: "[]",
  });
  assertStringIncludes(prompt, "You are the Cost Estimator");
  assertStringIncludes(prompt, "Copy value, low and\n  high EXACTLY from the candidate rows");
  assertStringIncludes(prompt, "firm-level resilience estimates (report those in your");
  assertStringIncludes(prompt, AGENT_COMMON);
  assertEquals(estimatorToolDeclarations.length, 3, "least-privilege surface: exactly 3 tools");
  assertEquals(
    estimatorToolDeclarations.map((d) => d.name),
    ["list_project_entities", "get_parameter_estimates", "draft_parameter_estimate"],
  );
});
