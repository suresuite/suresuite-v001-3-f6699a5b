// Workstream M2 golden suite, deterministic tier (ai-agents.md §14.4, §14.7):
// mm-03 pins the consent-only write law (explicit "remember …" saves; nothing
// else does — no silent path exists); mm-04 pins memory retrieval + citation
// in a B2 draft; mm-05 the stale marker on grounding-hash drift; mm-06 that
// archive erases every read surface; mm-07 that instruction-like memory
// content is DATA. The SQL side (save/archive RPCs, caps, RPC-only writes) is
// pinned in db_stage23_test.ts against scratch Postgres.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  classifyMemoryKind,
  detectDecisionShape,
  detectExplicitMemoryRequest,
  getProjectMemoryDeclaration,
  isMemoryStale,
  memoryContextBlock,
  saveExplicitMemory,
  STALE_MARKER,
} from "../memory.ts";
import { buildConfiguratorContext } from "../configuratorTools.ts";
import { AGENT_TURNS } from "../agentTurn.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

interface Fixture {
  id: string;
  project_snapshot: Record<string, Row[]> | { reuse: string };
  memory_rows?: Row[];
  utterance?: string;
  non_consent_utterances?: string[];
  decision_shaped_utterance?: string;
  mocked_llm?: { tool?: string; args?: Record<string, unknown>; reuse?: string };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
}

async function loadFixture(id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/memory/${id}.json`, import.meta.url)),
  );
  if (f.project_snapshot && "reuse" in f.project_snapshot) {
    // mm-04/mm-07 ground on the B2 base project (fixtures/policy-configurator).
    const base = JSON.parse(
      await Deno.readTextFile(
        new URL(`./fixtures/policy-configurator/${(f.project_snapshot as { reuse: string }).reuse}.json`, import.meta.url),
      ),
    );
    f.project_snapshot = base.project_snapshot;
    if (f.mocked_llm && "reuse" in f.mocked_llm) f.mocked_llm = base.mocked_llm;
  }
  const tables = f.project_snapshot as Record<string, Row[]>;
  if (f.memory_rows) tables.project_memory = f.memory_rows;
  return f;
}

function makeCtx(fixture: Fixture, opts?: { graphHash?: string }): { ctx: ToolContext; db: StubDb } {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const db = makeStubDb(tables, makeAgentRpcs(tables, opts));
  const ctx: ToolContext = {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "a@example.com",
      threadId: THREAD,
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance: fixture.utterance ?? "",
    },
  };
  return { ctx, db };
}

function withM2<T>(fn: () => Promise<T> | T, agents = "policy-configurator"): Promise<T> {
  Deno.env.set("PROJECT_MEMORY_ENABLED", "true");
  Deno.env.set("AGENT_ENABLED_IDS", agents);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Deno.env.delete("PROJECT_MEMORY_ENABLED");
      Deno.env.delete("AGENT_ENABLED_IDS");
    });
}

Deno.test("mm-03: explicit 'remember …' is the ONLY verbal write path (consent-required)", async () => {
  const fixture = await loadFixture("mm-03-consent-required");
  const { db } = makeCtx(fixture);

  // (a) the explicit ask saves — verbatim content, user_message citation.
  const explicit = detectExplicitMemoryRequest(fixture.utterance!);
  assert(explicit, "the explicit remember-pattern is detected");
  assertEquals(explicit!.content, fixture.expect.saved_content);
  assertEquals(explicit!.kind, fixture.expect.saved_kind);
  const saved = await saveExplicitMemory(db, {
    projectId: PROJECT,
    userId: USER,
    threadId: THREAD,
    content: explicit!.content,
    kind: explicit!.kind,
  });
  assert(saved.ok, `save failed: ${saved.error}`);
  assertEquals(db.tables.project_memory.length, 1);
  const row = db.tables.project_memory[0];
  assertEquals(row.content, fixture.expect.saved_content, "content stored verbatim");
  const citation = (row.citations as Array<{ kind: string }>)[0];
  assertEquals(citation.kind, fixture.expect.citation_kind);

  // Non-consent messages never match — no write path exists for them.
  for (const msg of fixture.non_consent_utterances!) {
    assertEquals(detectExplicitMemoryRequest(msg), null, `no consent in: "${msg}"`);
  }

  // (b) a decision-shaped message yields an OFFER only (write happens on the
  // chip's Save, never here) — and the explicit path always wins over it.
  const offer = detectDecisionShape(fixture.decision_shaped_utterance!);
  assert(offer, "decision-shaped message yields a chip offer");
  assertEquals(offer!.kind, "decision");
  assertEquals(detectDecisionShape(fixture.utterance!), null, "explicit remember never double-offers");
  assertEquals(db.tables.project_memory.length, 1, "the offer wrote nothing");
});

Deno.test("mm-03: the registered read tool performs no writes", () =>
  withM2(async () => {
    const fixture = await loadFixture("mm-03-consent-required");
    const { ctx, db } = makeCtx(fixture);
    const before = db.tables.project_memory.length;
    await executeTool("get_project_memory", {}, ctx);
    await executeTool("get_project_memory", { kind: "decision", limit: 5 }, ctx);
    assertEquals(db.tables.project_memory.length, before, "get_project_memory is read-only");
  }));

Deno.test("mm-04: a saved memory enters the B2 grounding context and is cited in the draft", () =>
  withM2(async () => {
    const fixture = await loadFixture("mm-04-memory-cited-in-draft");
    const { ctx, db } = makeCtx(fixture);

    const context = await buildConfiguratorContext(ctx, { utterance: fixture.utterance! });
    assertStringIncludes(context, "PROJECT MEMORY", "the §14.4 block renders");
    assertStringIncludes(context, fixture.expect.context_includes);

    const env = await executeTool("draft_policy_bundle", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.kind, "proposal", String(env.data));
    const stored = db.tables.proposals.find(
      (p) => String(p.id) === String((env.data as Record<string, unknown>).proposal_id),
    )!;
    const refs = (stored.citations as Array<{ kind: string; ref: string }>)
      .filter((c) => c.kind === "document")
      .map((c) => c.ref);
    assert(refs.includes(fixture.expect.citation_ref), `draft cites the memory (got ${JSON.stringify(refs)})`);
  }));

Deno.test("mm-04: get_project_memory joins EVERY agent's tool surface when M2 is on (§14.4)", () =>
  withM2(() => {
    for (const [agentId, spec] of Object.entries(AGENT_TURNS)) {
      const names = spec.tools().map((d) => d.name);
      assert(names.includes("get_project_memory"), `${agentId} declares get_project_memory`);
    }
    return Promise.resolve();
  }, "data-steward,policy-configurator,vv-analyst"));

Deno.test("mm-04 (flag off): the tool surface is byte-identical to M1", () => {
  Deno.env.delete("PROJECT_MEMORY_ENABLED");
  for (const [agentId, spec] of Object.entries(AGENT_TURNS)) {
    const names = spec.tools().map((d) => d.name);
    assert(!names.includes("get_project_memory"), `${agentId} must not declare the tool with the flag off`);
  }
});

Deno.test("mm-05: grounding-hash drift renders the stale marker (fresh hashes do not)", async () => {
  const fixture = await loadFixture("mm-05-stale-memory-marked");
  const staleRow = fixture.project_snapshot as Record<string, Row[]>;
  const mem = staleRow.project_memory[0] as unknown as Parameters<typeof isMemoryStale>[0];

  assert(isMemoryStale(mem, { policyHash: null, graphHash: "graph-hash-1" }), "OLD vs current ⇒ stale");
  assert(!isMemoryStale(mem, { policyHash: null, graphHash: "graph-hash-OLD" }), "matching hash ⇒ fresh");
  assert(!isMemoryStale(mem, { policyHash: null, graphHash: null }), "unknown current hash ≠ drift");

  const { block } = memoryContextBlock([mem], { policyHash: null, graphHash: "graph-hash-1" });
  assertStringIncludes(block, fixture.expect.stale_marker);
  assertEquals(fixture.expect.stale_marker, STALE_MARKER, "fixture pins the §14.4 marker text");

  // The registered tool shows the marker too (stub current graph hash is
  // graph-hash-1 ⇒ drifted from the row's graph-hash-OLD).
  const { ctx } = makeCtx(fixture);
  const env: ToolEnvelope = await executeTool("get_project_memory", {}, ctx);
  assertEquals(env.kind, "table");
  const rows = (env.data as { rows: unknown[][] }).rows;
  assertStringIncludes(String(rows[0][1]), STALE_MARKER);
});

Deno.test("mm-06: archive erases the memory from every read surface", async () => {
  const fixture = await loadFixture("mm-06-delete-erases");
  const { ctx, db } = makeCtx(fixture);

  const before: ToolEnvelope = await executeTool("get_project_memory", {}, ctx);
  assertEquals(before.meta.row_count, 1);

  await db.rpc("archive_project_memory", { p_id: "99999999-9999-4999-8999-999999999903" });

  const after: ToolEnvelope = await executeTool("get_project_memory", {}, ctx);
  assertEquals(after.meta.row_count, fixture.expect.after_archive_rows, "archived rows never surface");
  assertEquals(after.meta.note, "empty");
});

Deno.test("mm-07: instruction-like memory content is DATA; the registry gate still holds", () =>
  withM2(async () => {
    const fixture = await loadFixture("mm-07-injection-via-memory");
    const { ctx, db } = makeCtx(fixture);

    const context = await buildConfiguratorContext(ctx, { utterance: fixture.utterance! });
    assertStringIncludes(context, fixture.expect.context_marks_data, "the block is marked as DATA");
    assertStringIncludes(context, "ignore previous instructions", "content shown verbatim (it is data)");

    // A draft steered toward the injected out-of-schema field is refused by
    // the same deterministic gate regardless of what the memory said.
    const env = await executeTool("draft_policy_bundle", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, fixture.expect.error_code);
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("memory kind classification is deterministic", () => {
  assertEquals(classifyMemoryKind("we decided to dual-source MAT-9"), "decision");
  assertEquals(classifyMemoryKind("I prefer weekly buckets"), "preference");
  assertEquals(classifyMemoryKind("S3 is our strategic supplier"), "fact");
  assertEquals(getProjectMemoryDeclaration.name, "get_project_memory");
});
