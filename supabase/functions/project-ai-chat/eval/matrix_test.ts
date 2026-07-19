// Phase H4 capability-matrix suite, deterministic tier (ai-agents.md §23,
// §7.4 tier 1): drives the REAL §23.4 gate (matrix.ts — the exact module
// index.ts consults), the REAL --matrix row builder + writer
// (run_model_eval.ts), and the client mirror (src/lib/modelMatrix.ts) with
// a mocked clock — no LLM, no network, no real DB. The laws under test:
//   * a FRESH failing row for the routed (model, capability) fires the
//     VERBATIM §22.5 template naming the best passing model, with the agent
//     turn UNEXECUTED (zero provider calls, zero proposals) and
//     model.below_target telemetry recorded (mx-01);
//   * the fail-open trio — fresh-passing / stale / no-row all proceed
//     (mx-02/03/04), and the stale row renders as stale client-side under
//     the SAME mocked clock (§7.6);
//   * the vocabulary is the CLOSED §23.2 set, byte-equal between the doc,
//     the server module and the client mirror;
//   * matrixRowsFor emits one row per capability with the target it was
//     measured against (threshold changes never rewrite history), and
//     writeMatrix REFUSES --mock runs and upserts on the unique key.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import {
  CAPABILITY_NAMES,
  checkMatrixGate,
  isFreshRow,
  MATRIX_CAPABILITY_IDS,
  MATRIX_STALE_DAYS,
  matrixEnabled,
  NEEDS_STRONGER_MODEL_TEMPLATE,
  renderNeedsStrongerModel,
  routedCapabilityIds,
  type MatrixRow,
} from "../matrix.ts";
import { makeTelemetry } from "../telemetry.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { type ToolContext } from "../tools.ts";
import {
  MATRIX_TARGETS,
  matrixRowsFor,
  writeMatrix,
  type CapabilityRow,
  type MatrixRowInput,
} from "./run_model_eval.ts";
import {
  aggregateMatrixByModel,
  CAPABILITY_NAMES as CLIENT_CAPABILITY_NAMES,
  MATRIX_STALE_DAYS as CLIENT_STALE_DAYS,
  summarizeModelMatrix,
} from "../../../../src/lib/modelMatrix.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
async function loadFixture(id: string): Promise<Record<string, any>> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/matrix/${id}.json`, import.meta.url)),
  );
}

// ── the closed §23.2 vocabulary ─────────────────────────────────────────────

Deno.test("§23.2: the capability vocabulary is the closed 16-id set, verbatim from the doc", () => {
  assertEquals([...MATRIX_CAPABILITY_IDS], [
    "router",
    "router.needs_run",
    "router.cache_checkable",
    "agent:data-steward",
    "agent:policy-configurator",
    "agent:vv-analyst",
    "agent:experiment-designer",
    "agent:report-builder",
    "loop:cache_hit",
    "loop:run_needed",
    "plan:integrity",
    "coverage:relations",
    "coverage:policy_reads",
    "coverage:run_reads",
    "fabrication",
    "faithfulness",
  ]);
});

Deno.test("§23.2/§23.3: every capability has a plain-language name, and the client mirror speaks the identical vocabulary", () => {
  for (const id of MATRIX_CAPABILITY_IDS) {
    assert(CAPABILITY_NAMES[id], `server name missing for ${id}`);
  }
  assertEquals(
    { ...CAPABILITY_NAMES },
    CLIENT_CAPABILITY_NAMES,
    "src/lib/modelMatrix.ts CAPABILITY_NAMES drifted from matrix.ts",
  );
  assertEquals(CLIENT_STALE_DAYS, MATRIX_STALE_DAYS, "staleness windows drifted");
});

// ── the §22.5 template, verbatim ────────────────────────────────────────────

Deno.test("§22.5: the needs-a-stronger-model template is the doc's verbatim text", () => {
  assertEquals(
    NEEDS_STRONGER_MODEL_TEMPLATE,
    "This request needs {{capability_name}}, which {{current_model}} doesn't\n" +
      "currently pass our quality checks for. Switch models in the composer\n" +
      "{{#best_model}}({{best_model}} passes){{/best_model}} and ask again —\n" +
      "I won't guess with a below-target setup.",
  );
});

Deno.test("§22.5: server instantiation — with and without a best passing model", () => {
  assertEquals(
    renderNeedsStrongerModel({
      capabilityName: "the Experiment Designer agent",
      currentModel: "Gemini 2.5 Flash",
      bestModel: "GPT-5",
    }),
    "This request needs the Experiment Designer agent, which Gemini 2.5 Flash doesn't\n" +
      "currently pass our quality checks for. Switch models in the composer\n" +
      "(GPT-5 passes) and ask again —\n" +
      "I won't guess with a below-target setup.",
  );
  const withoutBest = renderNeedsStrongerModel({
    capabilityName: "plan tracking",
    currentModel: "DeepSeek",
    bestModel: null,
  });
  assertEquals(
    withoutBest,
    "This request needs plan tracking, which DeepSeek doesn't\n" +
      "currently pass our quality checks for. Switch models in the composer\n" +
      "and ask again —\n" +
      "I won't guess with a below-target setup.",
  );
  assert(!withoutBest.includes("{{"), "no mustache residue when best_model is absent");
});

// ── the route → capability mapping (§23.4 "routes to an agent/loop") ────────

Deno.test("§23.4 mapping: agent capability always; loop ids only for the B4 closed-loop turn", () => {
  const base = { agent_id: "experiment-designer" as const, needs_run: false, cache_checkable: false };
  assertEquals(routedCapabilityIds(base, "experiment-designer"), ["agent:experiment-designer"]);

  Deno.env.set("CLOSED_LOOP_ENABLED", "true");
  try {
    assertEquals(
      routedCapabilityIds({ ...base, needs_run: true }, "experiment-designer"),
      ["agent:experiment-designer", "loop:run_needed"],
    );
    assertEquals(
      routedCapabilityIds({ ...base, needs_run: true, cache_checkable: true }, "experiment-designer"),
      ["agent:experiment-designer", "loop:run_needed", "loop:cache_hit"],
    );
    // needs_run on a non-B4 agent is not the loop (§6.6 rule 2).
    assertEquals(
      routedCapabilityIds({ agent_id: "data-steward", needs_run: true, cache_checkable: true }, "data-steward"),
      ["agent:data-steward"],
    );
  } finally {
    Deno.env.delete("CLOSED_LOOP_ENABLED");
  }
  // Flag off ⇒ no closed-loop turn ⇒ no loop capability to gate.
  assertEquals(
    routedCapabilityIds({ ...base, needs_run: true, cache_checkable: true }, "experiment-designer"),
    ["agent:experiment-designer"],
  );
});

// ── the mx-* fixtures: block + fail-open trio, index.ts-shaped ──────────────

interface DrivenTurn {
  gateBlocked: boolean;
  reply: string;
  capabilityId?: string;
  providerCalls: number;
  db: StubDb;
  events: Row[];
}

/** Mirrors the index.ts orchestration seam exactly: gate first; when blocked
 * the template IS the reply and the turn never starts; when open the routed
 * agent turn executes (a scripted provider answers it — reaching the
 * provider is the proof the turn ran). */
// deno-lint-ignore no-explicit-any
async function driveRoutedTurn(fixture: Record<string, any>): Promise<DrivenTurn> {
  const tables: Record<string, Row[]> = { ai_chat_events: [] };
  const db = makeStubDb(tables, {
    ...makeAgentRpcs(tables),
    get_model_capability_matrix: () => fixture.matrix_rows as Row[],
  });
  Deno.env.set("MODEL_MATRIX_ENABLED", "true");
  Deno.env.set("AGENT_TELEMETRY_ENABLED", "true");
  Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
  Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { json: { candidates: [{ content: { parts: [{ text: "I would need a saved policy version to draft this." }] } }] } },
  ]);
  try {
    const telemetry = makeTelemetry(db, {
      user_id: USER,
      model_code: fixture.model_code,
      request_id: "req-matrix-test",
    });
    assert(matrixEnabled(), "the fixture drives the flag-on path");
    const gate = await checkMatrixGate(db, {
      modelCode: fixture.model_code,
      modelLabel: "Gemini 2.5 Flash",
      capabilityIds: routedCapabilityIds(fixture.route, fixture.route.agent_id),
      now: new Date(fixture.now),
    });
    if (gate.blocked) {
      await telemetry.emit("model.below_target", {
        model_code: fixture.model_code,
        capability_id: gate.capabilityId,
      });
      return {
        gateBlocked: true,
        reply: gate.reply,
        capabilityId: gate.capabilityId,
        providerCalls: mock.calls.length,
        db,
        events: tables.ai_chat_events,
      };
    }
    const ctx: ToolContext = {
      projectId: PROJECT,
      userId: USER,
      supabase: db as unknown as ToolContext["supabase"],
      draft: {
        userEmail: "eval@example.com",
        threadId: null,
        modelCode: fixture.model_code,
        providerCode: "gemini",
        canProposals: true,
        utterance: fixture.utterance,
      },
    };
    const turn = await runAgentTurn({
      agentId: fixture.route.agent_id,
      modelId: fixture.model_code,
      utterance: fixture.utterance,
      ctx,
    });
    assert(turn.ok, `the fail-open turn must execute: ${turn.error}`);
    return {
      gateBlocked: false,
      reply: turn.reply,
      providerCalls: mock.calls.length,
      db,
      events: tables.ai_chat_events,
    };
  } finally {
    mock.restore();
    Deno.env.delete("MODEL_MATRIX_ENABLED");
    Deno.env.delete("AGENT_TELEMETRY_ENABLED");
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("AGENT_EXPERIMENT_TYPES");
  }
}

Deno.test("mx-01: a fresh failing row fires the VERBATIM template naming the best passing model; the agent turn never runs; telemetry recorded", async () => {
  const fixture = await loadFixture("mx-01-below-target-blocks");
  const turn = await driveRoutedTurn(fixture);
  assert(turn.gateBlocked, "the §23.4 gate must block");
  assertEquals(turn.reply, fixture.expect.reply, "the §22.5 template, byte-exact");
  assertStringIncludes(turn.reply, fixture.expect.best_model, "the best passing model is named");
  assertEquals(turn.capabilityId, fixture.expect.capability_id);
  assertEquals(turn.providerCalls, fixture.expect.provider_calls, "ZERO provider calls — the routed intent unexecuted");
  assertEquals((turn.db.tables.proposals ?? []).length, fixture.expect.proposal_count, "no card attached");
  const events = turn.events.filter((e) => e.event_kind === fixture.expect.telemetry_event);
  assertEquals(events.length, 1, "model.below_target recorded exactly once");
  assertEquals((events[0].payload as Row).model_code, fixture.model_code);
  assertEquals((events[0].payload as Row).capability_id, fixture.expect.capability_id);
});

for (const id of ["mx-02-passing-proceeds", "mx-03-stale-proceeds", "mx-04-no-row-proceeds"]) {
  Deno.test(`${id}: fail-open — the routed turn executes normally`, async () => {
    const fixture = await loadFixture(id);
    const turn = await driveRoutedTurn(fixture);
    assertEquals(turn.gateBlocked, false, "the gate must not block");
    assert(
      turn.providerCalls >= fixture.expect.provider_calls_min,
      "the agent turn reached the provider — proof it executed",
    );
    assertEquals(
      turn.events.filter((e) => e.event_kind === "model.below_target").length,
      0,
      "no below-target telemetry on a fail-open turn",
    );
  });
}

Deno.test("mx-03 + §7.6 coherence: the SAME 8-day-old row that stopped gating renders as stale in the client summarizer (one mocked clock)", async () => {
  const fixture = await loadFixture("mx-03-stale-proceeds");
  const now = new Date(fixture.now);
  const summary = summarizeModelMatrix(fixture.matrix_rows, fixture.model_code, now);
  assert(summary, "rows exist — the summary renders");
  assertEquals(summary!.stale, fixture.expect.client_renders_stale, "the stale marker renders");
  // The row is failing, so the hint still names the gap — informing without
  // gating is exactly the stale posture.
  assertStringIncludes(summary!.summary, "below target: the Experiment Designer agent");
});

Deno.test("§23.4: a matrix read failure fails OPEN (never blocks the turn)", async () => {
  const db = makeStubDb({}, {}); // no get_model_capability_matrix rpc ⇒ error
  const gate = await checkMatrixGate(db, {
    modelCode: "gemini-2.5-flash",
    modelLabel: "Gemini 2.5 Flash",
    capabilityIds: ["agent:experiment-designer"],
  });
  assertEquals(gate.blocked, false);
});

Deno.test("§7.6 boundary: exactly 7 days old is still fresh; a second past it is stale", () => {
  const now = new Date("2026-07-19T12:00:00Z");
  assert(isFreshRow({ measured_at: "2026-07-12T12:00:00Z" }, now), "7d exactly ⇒ fresh");
  assert(!isFreshRow({ measured_at: "2026-07-12T11:59:59Z" }, now), "7d + 1s ⇒ stale");
  assert(!isFreshRow({ measured_at: "not-a-date" }, now), "unparseable ⇒ treated stale (fail open)");
});

Deno.test("§23.4: when no OTHER model passes, the template omits the suggestion instead of inventing one", async () => {
  const rows: MatrixRow[] = [{
    model_code: "gemini-2.5-flash",
    capability_id: "agent:experiment-designer",
    score: 0.5,
    target: 1,
    pass: false,
    eval_run_id: "eval:seed0001",
    measured_at: "2026-07-18T12:00:00Z",
  }];
  const db = makeStubDb({}, { get_model_capability_matrix: () => rows as unknown as Row[] });
  const gate = await checkMatrixGate(db, {
    modelCode: "gemini-2.5-flash",
    modelLabel: "Gemini 2.5 Flash",
    capabilityIds: ["agent:experiment-designer"],
    now: new Date("2026-07-19T12:00:00Z"),
  });
  assert(gate.blocked);
  if (gate.blocked) {
    assertEquals(gate.bestModel, null);
    assert(!gate.reply.includes("passes)"), "no invented best model");
  }
});

// ── matrixRowsFor: the writer's row builder ─────────────────────────────────

function syntheticInput(): MatrixRowInput {
  const suite = (ids: string[], pass = true) => ({
    fixtures: Object.fromEntries(ids.map((id) => [id, { pass, detail: "ok" }])),
    score: pass ? 1 : 0,
  });
  const agentMetrics = (ids: string[]) => ({
    model: "gemini-2.5-flash",
    fixtures: Object.fromEntries(ids.map((id) => [id, { pass: true, detail: "ok" }])),
    draftCalls: 4,
    validDraftCalls: 4,
    schemaValidity: 1,
    gateViolationRate: 0,
    pass: true,
    failures: [],
  });
  return {
    routing: {
      model: "gemini-2.5-flash",
      n: 10,
      perClass: {
        "experiment-designer": { tp: 5, fp: 0, fn: 0, precision: 1, recall: 1 },
        "data-steward": { tp: 5, fp: 0, fn: 1, precision: 1, recall: 0.833 },
      },
      advisoryFalseArtifactRate: 0,
      mixedRecall: 1,
      needsRunRecall: 0.9,
      cacheCheckablePrecision: 0.88,
      pass: false,
      failures: [],
    },
    steward: agentMetrics(["ds-01"]),
    agents: {
      "policy-configurator": agentMetrics(["pc-01"]),
      "vv-analyst": agentMetrics(["vv-02"]),
      "experiment-designer": agentMetrics(["ed-01"]),
      "report-builder": agentMetrics(["rb-01"]),
    },
    coverage: {
      model: "gemini-2.5-flash",
      battery: {
        "cov-01-supplier-materials": { pass: true, detail: "ok", fabrications: 0 },
        "cov-02-material-suppliers": { pass: true, detail: "ok", fabrications: 0 },
        "cov-03-bom-both-directions": { pass: true, detail: "ok", fabrications: 0 },
        "cov-04-disambiguation": { pass: false, detail: "guessed", fabrications: 0 },
        "cov-05-count-not-list": { pass: true, detail: "ok", fabrications: 0 },
        "cov-06-policy-read": { pass: true, detail: "ok", fabrications: 0 },
        "cov-07-readiness": { pass: true, detail: "ok", fabrications: 0 },
        "cov-08-run-results": { pass: false, detail: "fabricated: 42", fabrications: 1 },
        "cov-09-no-data-honesty": { pass: true, detail: "ok", fabrications: 0 },
      },
      fabrications: 1,
      layer2Violations: 0,
      judgedFaithful: 9,
      judged: 9,
      judgeErrors: 0,
      judgeDisagreements: [],
      pass: false,
      failures: [],
    },
    loop: {
      model: "gemini-2.5-flash",
      cacheHit: suite(["cl-01", "cl-08", "cl-09"]),
      runNeeded: suite(["cl-02", "cl-05", "cl-06"]),
      planIntegrity: suite(["cl-04"]),
      pass: true,
      failures: [],
    },
  };
}

Deno.test("matrixRowsFor: one row per §23.2 capability, none missing when everything measured", () => {
  const { rows, missing } = matrixRowsFor("gemini-2.5-flash", syntheticInput());
  assertEquals(missing, []);
  assertEquals(
    rows.map((r) => r.capability_id),
    [...MATRIX_CAPABILITY_IDS],
    "exactly the closed set, in doc order",
  );
  for (const r of rows) assertEquals(r.model_code, "gemini-2.5-flash");
});

Deno.test("matrixRowsFor: scores and passes derive from the measured metrics", () => {
  const { rows } = matrixRowsFor("gemini-2.5-flash", syntheticInput());
  const by = Object.fromEntries(rows.map((r) => [r.capability_id, r]));
  // router composite: 6 checks (2 classes × P/R + advisory + mixed), the
  // data-steward recall check (0.833 < 0.85) fails ⇒ 5/6.
  assertEquals(by["router"].score, 0.833);
  assertEquals(by["router"].pass, false);
  assertEquals(by["router.needs_run"].score, 0.9);
  assertEquals(by["router.needs_run"].pass, true);
  assertEquals(by["router.cache_checkable"].score, 0.88);
  assertEquals(by["router.cache_checkable"].pass, true);
  // coverage:relations — cov-04 failed ⇒ 4/5.
  assertEquals(by["coverage:relations"].score, 0.8);
  assertEquals(by["coverage:relations"].pass, false);
  assertEquals(by["coverage:policy_reads"].score, 1);
  // coverage:run_reads — cov-08 failed ⇒ 1/2.
  assertEquals(by["coverage:run_reads"].score, 0.5);
  // fabrication — 1 fabricating reply of 9 ⇒ 1 − 1/9; pass false.
  assertEquals(by["fabrication"].score, 0.889);
  assertEquals(by["fabrication"].pass, false);
  assertEquals(by["faithfulness"].score, 1);
  assertEquals(by["faithfulness"].pass, true);
  assertEquals(by["loop:cache_hit"].score, 1);
  assertEquals(by["plan:integrity"].pass, true);
});

Deno.test("matrixRowsFor: each row SNAPSHOTS the target it was measured against — changing thresholds later never rewrites history (§23.2)", () => {
  const input = syntheticInput();
  const tightened = { ...MATRIX_TARGETS, needsRunRecall: 0.95, faithfulness: 0.99 };
  const before = matrixRowsFor("gemini-2.5-flash", input).rows;
  const after = matrixRowsFor("gemini-2.5-flash", input, tightened).rows;
  const pick = (rows: CapabilityRow[], id: string) => rows.find((r) => r.capability_id === id)!;
  assertEquals(pick(before, "router.needs_run").target, 0.8);
  assertEquals(pick(before, "router.needs_run").pass, true);
  assertEquals(pick(after, "router.needs_run").target, 0.95);
  assertEquals(pick(after, "router.needs_run").pass, false, "same score, new target — the row records what it was measured against");
  assertEquals(pick(after, "faithfulness").target, 0.99);
});

Deno.test("matrixRowsFor: unmeasured capabilities yield NO row (absent beats invented; §23.4 fails open on absent rows)", () => {
  const input = syntheticInput();
  input.steward = null; // data-steward suite didn't run
  input.coverage.judged = 0; // judge unavailable
  const { rows, missing } = matrixRowsFor("gemini-2.5-flash", input);
  assertEquals(missing, ["agent:data-steward", "faithfulness"]);
  assert(!rows.some((r) => r.capability_id === "agent:data-steward"));
  assert(!rows.some((r) => r.capability_id === "faithfulness"));
});

Deno.test("matrixRowsFor: an agent row can score 1.0 on fixtures yet fail on the §7.4 metrics — pass records the FULL gate", () => {
  const input = syntheticInput();
  input.steward = {
    ...input.steward!,
    schemaValidity: 0.5,
    pass: false,
    failures: ["schema validity 0.500 < 0.95"],
  };
  const { rows } = matrixRowsFor("gemini-2.5-flash", input);
  const row = rows.find((r) => r.capability_id === "agent:data-steward")!;
  assertEquals(row.score, 1);
  assertEquals(row.pass, false);
});

// ── writeMatrix: upsert + the mock refusal ──────────────────────────────────

Deno.test("writeMatrix: a --mock run is REFUSED — zero writes, ever (§7.4)", async () => {
  let fetches = 0;
  const result = await writeMatrix("abc12345", [
    { model_code: "m", capability_id: "router", score: 1, target: 1, pass: true },
  ], {
    mock: true,
    fetchImpl: (() => {
      fetches++;
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch,
  });
  assert("refused" in result, "the write is refused, not skipped");
  assertEquals(fetches, 0, "a mock run never touches the store");
});

Deno.test("writeMatrix: upserts on the (model_code, capability_id) unique key with the run correlator and an explicit measured_at", async () => {
  Deno.env.set("SUPABASE_URL", "http://stub.local");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const captured: { url: string; headers: Record<string, string>; body: Row[] }[] = [];
  try {
    const result = await writeMatrix("abc12345", [
      { model_code: "gemini-2.5-flash", capability_id: "router", score: 0.833, target: 1, pass: false },
      { model_code: "gemini-2.5-flash", capability_id: "fabrication", score: 1, target: 1, pass: true },
    ], {
      mock: false,
      measuredAt: "2026-07-19T12:00:00Z",
      fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
        captured.push({
          url: String(url),
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: JSON.parse(String(init?.body)),
        });
        return Promise.resolve(new Response("[]", { status: 201 }));
      }) as typeof fetch,
    });
    assert("written" in result && result.written === 2);
    assertEquals(captured.length, 1, "one batched upsert per run");
    assertStringIncludes(captured[0].url, "/rest/v1/ai_model_capabilities?on_conflict=model_code,capability_id");
    assertEquals(captured[0].headers["Prefer"], "resolution=merge-duplicates", "newest run upserts (§23.1)");
    for (const row of captured[0].body) {
      assertEquals(row.eval_run_id, "eval:abc12345", "the §7.4 correlator");
      assertEquals(row.measured_at, "2026-07-19T12:00:00Z", "measured_at sent explicitly so freshness advances on upsert");
    }
  } finally {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("writeMatrix: without service credentials the write is SKIPPED loudly, never invented", async () => {
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  const result = await writeMatrix("abc12345", [], { mock: false });
  assert("skipped" in result);
});

// ── the client mirror (§23.3 picker hints + admin rollup) ───────────────────

const clientRows = (measuredAt: string, pass = true) => [
  {
    model_code: "gemini-2.5-flash",
    capability_id: "loop:run_needed",
    score: pass ? 1 : 0.5,
    target: 1,
    pass,
    eval_run_id: "eval:seed0001",
    measured_at: measuredAt,
  },
];

Deno.test("summarizeModelMatrix: fresh passing rows say 'passes all checks'; failing rows name the gap in plain language", () => {
  const now = new Date("2026-07-19T12:00:00Z");
  const pass = summarizeModelMatrix(clientRows("2026-07-18T12:00:00Z"), "gemini-2.5-flash", now)!;
  assertEquals(pass.summary, "passes all checks");
  assertEquals(pass.stale, false);
  const fail = summarizeModelMatrix(clientRows("2026-07-18T12:00:00Z", false), "gemini-2.5-flash", now)!;
  assertEquals(fail.summary, "below target: the decision loop");
});

Deno.test("summarizeModelMatrix: no rows ⇒ null (the picker renders exactly as pre-H4); >7d ⇒ the stale marker (clock-mocked)", () => {
  const now = new Date("2026-07-19T12:00:00Z");
  assertEquals(summarizeModelMatrix([], "gemini-2.5-flash", now), null);
  assertEquals(summarizeModelMatrix(clientRows("2026-07-18T12:00:00Z"), "gpt-5", now), null, "another model's rows are not mine");
  const stale = summarizeModelMatrix(clientRows("2026-07-11T11:59:59Z"), "gemini-2.5-flash", now)!;
  assertEquals(stale.stale, true);
});

Deno.test("aggregateMatrixByModel: per-model counts + below-target names, deterministic order (aggregates only — §23.3 admin)", () => {
  const now = new Date("2026-07-19T12:00:00Z");
  const rows = [
    ...clientRows("2026-07-18T12:00:00Z", false),
    {
      model_code: "gpt-5",
      capability_id: "loop:run_needed",
      score: 1,
      target: 1,
      pass: true,
      eval_run_id: "eval:seed0001",
      measured_at: "2026-07-18T12:00:00Z",
    },
  ];
  const agg = aggregateMatrixByModel(rows, now);
  assertEquals(agg.map((a) => a.model_code), ["gemini-2.5-flash", "gpt-5"]);
  assertEquals(agg[0].passing, 0);
  assertEquals(agg[0].total, 1);
  assertEquals(agg[0].belowTarget, ["the decision loop"]);
  assertEquals(agg[1].passing, 1);
  assertEquals(agg[1].stale, false);
});
