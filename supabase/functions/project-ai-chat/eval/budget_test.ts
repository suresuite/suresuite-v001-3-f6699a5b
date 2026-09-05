// Phase H3 budget-enforcement tests, deterministic tier (ai-agents.md §21.5,
// §7.7-4): with injected fake providers (fetch mock) and a mocked clock, each
// per-request budget — LLM-call cap, tool-call cap, output budget, wall-time
// soft budget, and the recorded MAX_HOPS hit — triggers its DEFINED
// honest-degradation behavior: finish the current step, name the exhausted
// meter to the user (never silent truncation), record the hit for the
// chat.reply spend payload, and let §21.3 close any plan honestly.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";
import { executeTool, registerToolHandler, type ToolContext } from "../tools.ts";
import { runChat } from "../providers.ts";
import {
  BUDGET_EXHAUSTED_LINES,
  budgetExhaustedLine,
  budgetTelemetryPayload,
  makeRequestBudget,
  MAX_COMPLETION_CHARS_PER_REQUEST,
  MAX_LLM_CALLS_PER_REQUEST,
  MAX_TOOL_CALLS_PER_REQUEST,
  tryConsumeLlmCall,
  WALL_BUDGET_MS,
  type RequestBudget,
} from "../budgets.ts";
import { sweepPlanIntegrity, type PlanStep } from "../planTools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { installFetchMock, type ScriptedResponse } from "./harness/fetch_mock.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

Deno.env.set("GEMINI_API_KEY", "test-gemini-key");

function makeCtx(budget?: RequestBudget, tables: Record<string, Row[]> = {}): { ctx: ToolContext; tables: Record<string, Row[]> } {
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const ctx: ToolContext = {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    ...(budget ? { budget } : {}),
  };
  return { ctx, tables };
}

const textResponse = (text: string): ScriptedResponse => ({
  json: { candidates: [{ content: { parts: [{ text }] } }] },
});
const toolCallResponse = (name: string, args: Record<string, unknown> = {}): ScriptedResponse => ({
  json: { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] },
});

// ── the normative DEFAULTs (§21.5 table) ─────────────────────────────────────

Deno.test("§21.5 DEFAULTs are the normative table: 6 LLM calls, 15 tool calls, 48,000 chars, 60 s wall", () => {
  assertEquals(MAX_LLM_CALLS_PER_REQUEST, 6, "1 router + ≤ 2 step turns + ≤ 1 persona wrap-up + ≤ 1 verifier retry, + headroom");
  assertEquals(MAX_TOOL_CALLS_PER_REQUEST, 15);
  assertEquals(MAX_COMPLETION_CHARS_PER_REQUEST, 48_000);
  assertEquals(WALL_BUDGET_MS, 60_000);
  const b = makeRequestBudget();
  assertEquals(
    [b.maxLlmCalls, b.maxToolCalls, b.maxCompletionChars, b.wallBudgetMs],
    [6, 15, 48_000, 60_000],
  );
  // Headroom proof: the worst legal request shape (router + agent + persona +
  // one verifier retry = 4 turn-level calls) now leaves 2 calls of slack. At
  // the old cap of 4 it fit EXACTLY, so any additional call — the failure-path
  // persona turn, a second corrective retry — exhausted the meter and returned
  // the canned exhaustion line instead of an answer.
  for (let i = 0; i < 4; i++) assert(tryConsumeLlmCall(b), `worst-shape call ${i + 1} within budget`);
  assert(tryConsumeLlmCall(b), "the 5th call still has headroom");
  assert(tryConsumeLlmCall(b), "the 6th call is the last within budget");
  assert(!tryConsumeLlmCall(b), "the 7th call is the first denial");
});

// ── llm_calls: the cap denies the call, never truncates a reply ──────────────

Deno.test("llm_calls cap: the denied runChat 'runs' with the honest line naming the meter — no provider call is made", async () => {
  const budget = makeRequestBudget({ maxLlmCalls: 1 });
  const mock = installFetchMock([textResponse("first answer")]);
  try {
    const first = await runChat("gemini-2.5-flash", "hello", [], null, null, { budget });
    assertEquals(first.reply, "first answer");
    const second = await runChat("gemini-2.5-flash", "again", [], null, null, { budget });
    assertEquals(second.reply, BUDGET_EXHAUSTED_LINES.llm_calls);
    assertStringIncludes(second.reply, "model-call budget", "the exhausted meter is NAMED");
    assertStringIncludes(second.reply, "not done", "remaining work is stated, never silently dropped");
    assertEquals(mock.calls.length, 1, "the denied call never reaches a provider");
    assertEquals(budget.budgetHit, "llm_calls");
    assertEquals(budget.llmCalls, 1);
  } finally {
    mock.restore();
  }
});

// ── tool_calls: executeTool consumes the counter via ToolContext ─────────────

Deno.test("tool_calls cap: the 16th-style call returns the 'budget' envelope telling the model to wrap up; the handler never runs", async () => {
  const budget = makeRequestBudget({ maxToolCalls: 1 });
  const { ctx } = makeCtx(budget);
  const first = await executeTool("list_project_entities", { entity_type: "all" }, ctx);
  assert(first.meta.note !== "budget", "the first call executes normally");
  const second = await executeTool("list_project_entities", { entity_type: "all" }, ctx);
  assertEquals(second.meta.note, "budget");
  assertStringIncludes(String(second.data), "tool budget");
  assertStringIncludes(String(second.data), "wrap up");
  assertEquals(budget.budgetHit, "tool_calls");
  assertEquals(budget.toolCalls, 1, "the denied call is not counted as executed");
});

Deno.test("tool_calls cap inside a live turn: the model sees the budget envelope and must wrap up (the §21.5 'model must wrap up' behavior)", async () => {
  const budget = makeRequestBudget({ maxToolCalls: 1 });
  const { ctx } = makeCtx(budget);
  const envelopes: Array<{ name: string; note?: string }> = [];
  const mock = installFetchMock([
    {
      json: {
        candidates: [{
          content: {
            parts: [
              { functionCall: { name: "list_project_entities", args: { entity_type: "supplier" } } },
              { functionCall: { name: "list_project_entities", args: { entity_type: "material" } } },
            ],
          },
        }],
      },
    },
    textResponse("wrapped up with what I have"),
  ]);
  try {
    const result = await runChat("gemini-2.5-flash", "list things", [], ctx, null, {
      budget,
      onToolResult: (name, _args, envelope) => envelopes.push({ name, note: envelope.meta.note }),
    });
    assertEquals(result.reply, "wrapped up with what I have");
    assertEquals(envelopes.length, 2);
    assert(envelopes[0].note !== "budget");
    assertEquals(envelopes[1].note, "budget", "the second call is denied in-envelope, not silently dropped");
    assertEquals(budget.budgetHit, "tool_calls");
  } finally {
    mock.restore();
  }
});

// ── output: stop issuing LLM calls once completion chars exceed the cap ──────

Deno.test("output budget: after the cap is crossed, no further LLM call is issued and the reply names the output meter", async () => {
  const budget = makeRequestBudget({ maxCompletionChars: 10 });
  const mock = installFetchMock([textResponse("a completion far longer than ten characters")]);
  try {
    const first = await runChat("gemini-2.5-flash", "hello", [], null, null, { budget });
    assert(first.reply.length > 10);
    assertEquals(budget.budgetHit, "output", "noteCompletion trips the meter after the call");
    const second = await runChat("gemini-2.5-flash", "more", [], null, null, { budget });
    assertEquals(second.reply, BUDGET_EXHAUSTED_LINES.output);
    assertEquals(mock.calls.length, 1, "stop issuing LLM calls (§21.5)");
  } finally {
    mock.restore();
  }
});

// ── wall: mocked clock, checked between hops — finish the step, start no other ─

Deno.test("wall budget (mocked clock): exceeded between hops ⇒ the turn finishes with the honest wall line + the parts it already earned", async () => {
  let now = 0;
  const budget = makeRequestBudget({ wallBudgetMs: 1000, now: () => now });
  const tables: Record<string, Row[]> = {
    node_list: [{ project_id: PROJECT, node_id: "S1", node_type: "supplier", node_group: "g" }],
  };
  const { ctx } = makeCtx(budget, tables);
  const mock = installFetchMock([
    toolCallResponse("list_project_entities", { entity_type: "supplier" }),
    textResponse("this second hop must never be reached"),
  ]);
  try {
    const result = await runChat("gemini-2.5-flash", "list suppliers", [], ctx, null, {
      budget,
      // the mocked clock jumps past the wall while the first hop's tool runs
      onToolResult: () => {
        now = 5000;
      },
    });
    assertEquals(result.reply, BUDGET_EXHAUSTED_LINES.wall);
    assertStringIncludes(result.reply, "time budget", "the exhausted meter is NAMED");
    assertEquals(mock.calls.length, 1, "the current step finished; another hop never started");
    assertEquals(result.parts.length, 1, "the work already done is kept, not truncated away");
    assertEquals(budget.budgetHit, "wall");
  } finally {
    mock.restore();
  }
});

Deno.test("the §20.5 provider retry burns real wall time the wall check sees (the H2 retry counts against the budgets)", async () => {
  const budget = makeRequestBudget({ wallBudgetMs: 300 });
  const tables: Record<string, Row[]> = {
    node_list: [{ project_id: PROJECT, node_id: "S1", node_type: "supplier", node_group: "g" }],
  };
  const { ctx } = makeCtx(budget, tables);
  const mock = installFetchMock([
    { status: 500, json: { error: "flaky" } },
    toolCallResponse("list_project_entities", { entity_type: "supplier" }),
    textResponse("never reached — the ~1s retry wait exceeded the wall"),
  ]);
  try {
    const result = await runChat("gemini-2.5-flash", "list suppliers", [], ctx, null, { budget });
    assertEquals(result.reply, BUDGET_EXHAUSTED_LINES.wall);
    assertEquals(budget.budgetHit, "wall");
    assertEquals(mock.calls.length, 2, "the retried first hop completed; hop 2 never started");
  } finally {
    mock.restore();
  }
});

// ── hops: the existing reply, now recorded as a hit ──────────────────────────

Deno.test("MAX_HOPS exhaustion spends one closing completion so the final hop's tool results are answered from, not discarded", async () => {
  const budget = makeRequestBudget();
  const { ctx } = makeCtx(budget);
  // 6 hops of tool calls, then the closing (tool-free) completion.
  const mock = installFetchMock([
    ...Array.from({ length: 6 }, () => toolCallResponse("list_project_entities", { entity_type: "all" })),
    textResponse("Here is what I could establish from the reads I did make."),
  ]);
  try {
    const result = await runChat("gemini-2.5-flash", "loop forever", [], ctx, null, { budget });
    assertEquals(result.reply, "Here is what I could establish from the reads I did make.");
    assertEquals(budget.budgetHit, "hops", "the hit is still recorded for the chat.reply spend");
    assertEquals(mock.calls.length, 7, "6 tool hops + 1 closing completion");
    // The closing call withdraws the tool surface — the model cannot keep looping.
    const closing = mock.calls[6].body as { tools?: unknown; contents: { parts: { text?: string }[] }[] };
    assertEquals(closing.tools, undefined, "the closing completion declares no tools");
    const lastTurn = closing.contents[closing.contents.length - 1];
    assertEquals(
      lastTurn.parts[0].text?.startsWith("You have used all the tool steps available"),
      true,
      "the wrap-up instruction is the final turn",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("MAX_HOPS exhaustion falls back to the verbatim 'ran out of steps' reply when the closing completion fails", async () => {
  const budget = makeRequestBudget();
  const { ctx } = makeCtx(budget);
  const mock = installFetchMock([
    ...Array.from({ length: 6 }, () => toolCallResponse("list_project_entities", { entity_type: "all" })),
    // 400 is non-retryable (§20.5), so this exercises the fallback without
    // burning the retry wait.
    { status: 400, json: { error: "bad request" } },
  ]);
  try {
    const result = await runChat("gemini-2.5-flash", "loop forever", [], ctx, null, { budget });
    assertEquals(result.reply, "I ran out of steps on that one. Try narrowing the question.");
    assertEquals(budget.budgetHit, "hops");
  } finally {
    mock.restore();
  }
});

// ── telemetry: every chat.reply carries the spend (§21.5 / §7.7-4) ───────────

Deno.test("the chat.reply spend payload: {llm_calls, tool_calls, wall_ms, budget_hit} — null hit on a clean request", async () => {
  let now = 100;
  const budget = makeRequestBudget({ now: () => now });
  const mock = installFetchMock([textResponse("clean answer")]);
  try {
    await runChat("gemini-2.5-flash", "hello", [], null, null, { budget });
    now = 350;
    assertEquals(budgetTelemetryPayload(budget), {
      llm_calls: 1,
      tool_calls: 0,
      wall_ms: 250,
      budget_hit: null,
    });
  } finally {
    mock.restore();
  }
});

Deno.test("every meter has an honest line and budgetExhaustedLine names it", () => {
  for (const hit of ["hops", "llm_calls", "tool_calls", "output", "wall"] as const) {
    assert(BUDGET_EXHAUSTED_LINES[hit].length > 0);
    assertEquals(budgetExhaustedLine(hit), BUDGET_EXHAUSTED_LINES[hit]);
  }
});

// ── budget exhaustion + the §21.3 integrity law (the "budget_hit fixture") ───

Deno.test("a budget-exhausted plan turn closes honestly: the dangling step fails with note 'interrupted: budget: <meter>' and the reply names the meter", async () => {
  Deno.env.set("CHAT_STORE_ENABLED", "true");
  Deno.env.set("PLAN_TOOL_ENABLED", "true");
  Deno.env.set("CLOSED_LOOP_ENABLED", "true");
  Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
  Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
  // A tiny LLM budget: the agent turn itself is denied — the §21.5 honest
  // line is the whole reply, and the sweep closes the plan it left behind.
  const budget = makeRequestBudget({ maxLlmCalls: 0 });
  const tables: Record<string, Row[]> = {};
  const { ctx } = makeCtx(budget, tables);
  ctx.draft = {
    userEmail: "a@example.com",
    threadId: THREAD,
    modelCode: "gemini-2.5-flash",
    providerCode: "gemini",
    canProposals: true,
    utterance: "outage question",
    agentId: "experiment-designer",
  };
  const db = ctx.supabase as unknown as Parameters<typeof sweepPlanIntegrity>[0];
  const mock = installFetchMock([]);
  try {
    // A plan already mid-flight in the thread (filed on an earlier turn).
    await db.rpc("upsert_chat_plan", {
      p_plan: {
        thread_id: THREAD,
        project_id: PROJECT,
        title: "Outage question",
        steps: [
          { id: "check", label: "Check the cache", status: "active" },
          { id: "answer", label: "Answer", status: "pending" },
        ],
      },
      p_user_id: USER,
    });
    const turn = await runAgentTurn({
      agentId: "experiment-designer",
      modelId: "gemini-2.5-flash",
      utterance: "outage question",
      ctx,
    });
    assert(turn.ok, "a budget denial is honest degradation, not a crash");
    assertEquals(turn.reply, BUDGET_EXHAUSTED_LINES.llm_calls, "the reply NAMES the exhausted meter");
    assertEquals(mock.calls.length, 0, "no provider call was made");
    assertEquals(budget.budgetHit, "llm_calls");
    // index.ts sweeps with cause `budget: <meter>` after the turn:
    const sweep = await sweepPlanIntegrity(db, {
      threadId: THREAD,
      userId: USER,
      cause: `budget: ${budget.budgetHit}`,
    });
    const step = (sweep.plan!.steps as PlanStep[]).find((s) => s.id === "check")!;
    assertEquals(step.status, "failed");
    assertEquals(step.note, "interrupted: budget: llm_calls", "§21.3: the cause lands in the note");
    assertEquals(sweep.plan!.status, "failed");
    assertEquals(budgetTelemetryPayload(budget).budget_hit, "llm_calls", "the chat.reply spend records the hit");
  } finally {
    mock.restore();
    Deno.env.delete("CHAT_STORE_ENABLED");
    Deno.env.delete("PLAN_TOOL_ENABLED");
    Deno.env.delete("CLOSED_LOOP_ENABLED");
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("AGENT_EXPERIMENT_TYPES");
  }
});

// A one-off tool for exercising the registry seam without touching real
// handlers (kept registered — the name can never collide with a §2.3 tool).
registerToolHandler("_budget_test_noop", () =>
  Promise.resolve({ kind: "text", data: "ok", meta: { tool: "_budget_test_noop", row_count: 0 } }));

Deno.test("an unmetered context is byte-identical: no budget on ToolContext ⇒ executeTool never denies", async () => {
  const { ctx } = makeCtx();
  for (let i = 0; i < 20; i++) {
    const env = await executeTool("_budget_test_noop", {}, ctx);
    assert(env.meta.note !== "budget");
  }
});
