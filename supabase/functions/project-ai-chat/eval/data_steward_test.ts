// B1 Data Steward golden suite, deterministic tier (ai-agents.md §5.1 table,
// §7.4 tier 1): each ds-* fixture drives the REAL tool handlers with a mocked
// LLM (the fixture's tool-call arguments), asserting the deterministic
// machinery — reducer recomputation (1e-9), enum gates mirroring the write-RPC
// CHECKs, scope gates, idempotency, the §4.5 error taxonomy, and the §4.4
// apply sequence with its findings delta. No LLM, no network, no database.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  buildStewardPrompt,
  stewardToolDeclarations,
  AGENT_COMMON,
} from "../draftTools.ts";
import { runDataStewardTurn } from "../agentTurn.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { ApplyFailure, applyItemMasterDiff } from "../../agent-apply/itemMasterApply.ts";

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
    args_injected?: Record<string, unknown>;
    reuse?: string;
  };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

async function loadFixture(id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/data-steward/${id}.json`, import.meta.url)),
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

function withStewardEnabled<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "data-steward");
  return fn().finally(() => Deno.env.delete("AGENT_ENABLED_IDS"));
}

interface CompletenessCell {
  severity: string;
  field: string;
  entity: string;
  value: unknown;
  source: unknown;
}

function completenessCells(env: ToolEnvelope): CompletenessCell[] {
  assertEquals(env.kind, "table", "get_data_completeness returns a table");
  const data = env.data as { columns: string[]; rows: unknown[][] };
  assertEquals(
    data.columns,
    ["severity", "field", "policy", "entity_ids", "candidate_value", "candidate_source", "message"],
    "§5.1 column contract",
  );
  return data.rows.map((r) => ({
    severity: String(r[0]),
    field: String(r[1]),
    entity: String(r[3]),
    value: r[4],
    source: r[5],
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
  if (expect.sources) {
    const counts: Record<string, number> = {};
    for (const r of payload.rows) counts[String(r.source)] = (counts[String(r.source)] ?? 0) + 1;
    assertEquals(counts, expect.sources, "source mix");
  }
  if (expect.reducers) {
    for (const r of payload.rows.filter((x) => x.source === "reducer")) {
      assert(expect.reducers.includes(String(r.reducer)), `unexpected reducer ${r.reducer}`);
    }
  }
  if (expect.citation_kinds) {
    const kinds = [...new Set((stored.citations as Array<{ kind: string }>).map((c) => c.kind))].sort();
    assertEquals(kinds, [...expect.citation_kinds].sort(), "citation kinds");
  }
  if (expect.values) {
    for (const v of expect.values) {
      const row = payload.rows.find((r) => r.entity_id === v.entity_id && r.field === v.field);
      assert(row, `missing row for ${v.entity_id}.${v.field}`);
      assertEquals(row!.value, v.value, `value for ${v.entity_id}.${v.field} is verbatim`);
    }
  }
  if (expect.no_zero_values) {
    for (const r of payload.rows) {
      assert(r.value !== 0, `injected zero value leaked into ${r.entity_id}.${r.field}`);
    }
  }
}

Deno.test("ds-01-fill-costs: reducer candidates surface and the draft equals recomputation", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-01-fill-costs");
    const { ctx, db } = makeCtx(fixture);

    const completeness = await executeTool("get_data_completeness", {}, ctx);
    const cells = completenessCells(completeness);
    for (const c of fixture.expect.completeness_candidates) {
      const hit = cells.find((x) => x.field === c.field && x.entity === c.entity_id);
      assert(hit, `candidate row missing for ${c.entity_id}`);
      assertEquals(hit!.value, c.value, `candidate value for ${c.entity_id}`);
      assertEquals(hit!.source, c.source, `candidate source for ${c.entity_id}`);
    }

    const env = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, env, fixture.expect.proposal);
  }));

Deno.test("ds-02-no-source: no candidate ⇒ not_grounded, no proposal", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-02-no-source");
    const { ctx, db } = makeCtx(fixture);

    const cells = completenessCells(await executeTool("get_data_completeness", {}, ctx));
    for (const c of fixture.expect.completeness_no_candidate) {
      const hit = cells.find((x) => x.field === c.field && x.entity === c.entity_id);
      assert(hit, `finding missing for ${c.entity_id}`);
      assertEquals(hit!.source, "-", "no reducer candidate may be offered");
    }

    const env = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, "not_grounded");
    assertEquals(db.tables.proposals.length, 0, "no proposal row created");
  }));

Deno.test("ds-03-user-value: user-stated value verbatim with a user_message citation", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-03-user-value");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, env, fixture.expect.proposal);
    const stored = proposalRow(db, String((env.data as Record<string, unknown>).proposal_id));
    const userCite = (stored.citations as Array<Record<string, unknown>>).find((c) => c.kind === "user_message");
    assertStringIncludes(String(userCite?.quote ?? ""), "MAT-17", "citation quotes the user's ask");
  }));

Deno.test("ds-04-enum-guard: ATO refused with the RPC's own error text", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-04-enum-guard");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, "invalid_params");
    assertStringIncludes(String(env.data), fixture.expect.message_includes);
    assertEquals(db.tables.proposals.length, 0);
  }));

Deno.test("ds-05-mixed: mixed sources file one deterministic proposal with a stable key", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-05-mixed");
    const { ctx, db } = makeCtx(fixture);
    const first = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, first, fixture.expect.proposal);
    const second = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertEquals(
      (second.data as Record<string, unknown>).proposal_id,
      (first.data as Record<string, unknown>).proposal_id,
      "re-run converges on the same proposal",
    );
    assertEquals(db.tables.proposals.length, 1, "one live card, not a stack");
  }));

Deno.test("ds-06-scope: foreign entity id ⇒ project_scope_violation", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-06-scope");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, "project_scope_violation");
    assertStringIncludes(String(env.data), fixture.expect.message_includes);
    assertEquals(db.tables.proposals.length, 0);
  }));

Deno.test("ds-07-idempotent: second run returns the SAME proposal_id via the duplicate path", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-07-idempotent");
    const { ctx, db } = makeCtx(fixture);
    const first = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertEquals(first.meta.note, undefined, "first run is a fresh create");
    const second = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertEquals(second.meta.note, "duplicate", "second run reports the §4.5 duplicate path");
    assertEquals(
      (second.data as Record<string, unknown>).proposal_id,
      (first.data as Record<string, unknown>).proposal_id,
    );
    assertEquals(db.tables.proposals.length, 1);
  }));

Deno.test("ds-08-injection: instruction-like project data cannot steer values", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-08-injection");
    const { ctx, db } = makeCtx(fixture);

    // the injected 0-cost attempt is refused by recomputation…
    const attacked = await executeTool("draft_item_master_update", fixture.mocked_llm!.args_injected!, ctx);
    assertEquals(attacked.meta.note, fixture.expect.injected_error_code);
    assertEquals(db.tables.proposals.length, 0);

    // …and the honest draft carries only recomputed reducer values.
    const honest = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    assertProposalExpectations(db, honest, fixture.expect.proposal);
  }));

Deno.test("ds-09-gate-delta: apply walks §4.4 — before snapshot, full-row merge, findings delta", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-09-gate-delta");
    const { ctx, db } = makeCtx(fixture);

    const env = await executeTool("draft_item_master_update", fixture.mocked_llm!.args!, ctx);
    const proposalId = String((env.data as Record<string, unknown>).proposal_id);
    const stored = proposalRow(db, proposalId);
    stored.status = "approved"; // the card's Approve (state machine pinned in db_rpc_test)

    const result = await applyItemMasterDiff(db, {
      projectId: PROJECT,
      payload: stored.payload as Record<string, unknown>,
      grounding: stored.grounding as Record<string, unknown>,
    });

    const exp = fixture.expect.apply;
    assertEquals(Object.keys(result.before), exp.before_tables, "before snapshot covers touched tables");
    assertEquals(result.before.materials?.length, exp.before_rows, "before snapshot row count");
    for (const row of result.before.materials ?? []) {
      assertEquals(row.cost, null, "before snapshot captured the pre-apply NULLs");
    }
    assertEquals(result.after_counts, exp.after_counts);

    // findings_after ⊂ findings_before, strictly (§5.1 #9).
    const key = (f: { severity: string; field: string; policy: string }) =>
      `${f.severity}|${f.field}|${f.policy}`;
    const beforeKeys = new Set(result.findings_before.map(key));
    for (const f of result.findings_after) {
      assert(beforeKeys.has(key(f)), `new finding appeared after apply: ${key(f)}`);
    }
    assert(
      result.findings_after.length < result.findings_before.length,
      "apply must strictly reduce the findings",
    );

    // masters now carry the reducer values; the full-row merge cleared nothing.
    for (const [id, cost] of Object.entries(exp.materials_costs_after)) {
      const row = db.tables.materials.find((m) => m.material_id === id)!;
      assertEquals(row.cost, cost, `${id} cost applied`);
      assertEquals(row.moq, fixture.project_snapshot && (fixture.project_snapshot as Record<string, Row[]>).materials.find((m) => m.material_id === id)!.moq,
        `${id} untouched column survived the full-row upsert`);
    }

    // retry is idempotent: re-verification accepts already-applied masters.
    const again = await applyItemMasterDiff(db, {
      projectId: PROJECT,
      payload: stored.payload as Record<string, unknown>,
      grounding: stored.grounding as Record<string, unknown>,
    });
    assertEquals(again.after_counts, exp.after_counts, "re-apply succeeds without stale_values");
  }));

Deno.test("apply: graph-hash drift fails stale_values before any write", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-01-fill-costs");
    const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
    const db = makeStubDb(tables, makeAgentRpcs(tables, { graphHash: "drifted-hash" }));
    try {
      await applyItemMasterDiff(db, {
        projectId: PROJECT,
        payload: { schema_version: 1, rows: (fixture.mocked_llm!.args!.rows as Row[]) },
        grounding: { graph_hash: "graph-hash-1" },
      });
      throw new Error("expected ApplyFailure");
    } catch (e) {
      assert(e instanceof ApplyFailure, `expected ApplyFailure, got ${e}`);
      assertEquals((e as ApplyFailure).code, "stale_values");
    }
    assertEquals(tables.materials.every((m) => m.cost === null), true, "nothing mutated");
  }));

Deno.test("agent turn (bridge 1): scripted provider drives the real loop to a proposal part", () =>
  withStewardEnabled(async () => {
    const fixture = await loadFixture("ds-01-fill-costs");
    const { ctx } = makeCtx(fixture);
    Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
    const mock = installFetchMock([
      {
        json: {
          candidates: [{
            content: {
              parts: [{
                functionCall: { name: "draft_item_master_update", args: fixture.mocked_llm!.args },
              }],
            },
          }],
        },
      },
      {
        json: {
          candidates: [{
            content: {
              parts: [{ text: "Drafted a proposal covering the three missing costs — review the card before it applies." }],
            },
          }],
        },
      },
    ]);
    try {
      const result = await runDataStewardTurn({
        modelId: "gemini-2.5-flash",
        utterance: fixture.utterance,
        ctx,
      });
      assert(result.ok, `agent turn failed: ${result.error}`);
      assert(result.proposalPart, "proposal part collected from the tool envelope");
      assertEquals(result.proposalPart!.data.artifact_type, "item_master_diff");

      // The agent turn's system prompt is the §5.1 template with the steward's
      // least-privilege toolset — and never any conversation summary (§14.3).
      const firstCall = mock.calls[0].body as {
        systemInstruction: { parts: Array<{ text: string }> };
        tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
      };
      const system = firstCall.systemInstruction.parts[0].text;
      assertStringIncludes(system, "You are the Data Steward");
      assertStringIncludes(system, "RULES THAT OVERRIDE EVERYTHING ELSE");
      assert(!system.includes("CONVERSATION SUMMARY"), "agent turns never receive the rolling summary");
      assertEquals(
        firstCall.tools[0].functionDeclarations.map((d) => d.name),
        ["list_project_entities", "get_data_completeness", "draft_item_master_update"],
        "least-privilege tool subset (§5.1)",
      );
    } finally {
      mock.restore();
    }
  }));

Deno.test("steward prompt template carries the verbatim §5.1 + AGENT_COMMON blocks", () => {
  const prompt = buildStewardPrompt({
    projectId: PROJECT,
    utterance: "fill in the costs",
    findingsJson: "[]",
    datasetCountsJson: "{}",
    enumVocabJson: "{}",
  });
  assertStringIncludes(prompt, "You are the Data Steward, the SuReSuite agent that completes and corrects");
  assertStringIncludes(prompt, "call draft_item_master_update ONCE with all rows");
  assertStringIncludes(prompt, AGENT_COMMON);
  assertEquals(stewardToolDeclarations.length, 3, "no tool beyond the §5.1 surface is declared");
});
