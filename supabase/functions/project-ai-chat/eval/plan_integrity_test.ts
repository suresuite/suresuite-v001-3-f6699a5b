// Phase H3 plan-integrity suite, deterministic tier (ai-agents.md §21.6,
// §7.7-3): each pi-* fixture drives the REAL update_task_plan handler, the
// §21.3 integrity sweep, and the §21.4 resume pre-step against the stub DB —
// no LLM, no network, no real Postgres (the SQL originals are pinned in
// db_plans_test.ts). The laws under test: every declared step ends terminal
// or waiting (never 'active', never vanished); steps are append-only; at
// most one active; waiting refs are mandatory; reload (fresh stub client)
// and model switch resume the same row; the §21.5 caps reject with the cap
// named; a second create supersedes visibly.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  buildPlanBlock,
  formatPlanBlock,
  loadActivePlan,
  markPlanStepFailed,
  planToolEnabled,
  progressLine,
  recomputePlanStatus,
  runResumePreStep,
  sweepPlanIntegrity,
  UPDATE_TASK_PLAN_SCHEMA,
  updateTaskPlanDeclaration,
  type PlanRow,
  type PlanStep,
} from "../planTools.ts";
import { buildExperimentContext, experimentToolDeclarations } from "../experimentTools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "22222222-2222-4222-8222-222222222299";
const THREAD = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
async function loadFixture(id: string): Promise<any> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/plans/${id}.json`, import.meta.url)),
  );
}

interface Harness {
  ctx: ToolContext;
  db: StubDb;
  tables: Record<string, Row[]>;
}

function makeCtx(tables: Record<string, Row[]> = {}, threadId: string | null = THREAD): Harness {
  const rpcs = makeAgentRpcs(tables);
  const db = makeStubDb(tables, rpcs);
  const ctx: ToolContext = {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "a@example.com",
      threadId,
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance: "test a 6-week outage of S1 with 30 reps",
      agentId: "experiment-designer",
    },
  };
  return { ctx, db, tables };
}

function withPlanTool<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("CHAT_STORE_ENABLED", "true");
  Deno.env.set("PLAN_TOOL_ENABLED", "true");
  return fn().finally(() => {
    Deno.env.delete("CHAT_STORE_ENABLED");
    Deno.env.delete("PLAN_TOOL_ENABLED");
  });
}

function seedPlan(tables: Record<string, Row[]>, seed: Row): Row {
  const row: Row = {
    thread_id: THREAD,
    project_id: PROJECT,
    user_id: USER,
    agent_id: "experiment-designer",
    title: "Task plan",
    status: "active",
    resume_count: 0,
    model_code: null,
    expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    created_at: 1,
    ...seed,
  };
  (tables.chat_plans ??= []).push(row);
  return row;
}

function seedRun(tables: Record<string, Row[]>, seed: Row): void {
  (tables.simulation_runs ??= []).push({ project_id: PROJECT, ...seed });
}

const stepById = (row: Row, id: string): PlanStep =>
  ((row.steps as PlanStep[]) ?? []).find((s) => s.id === id)!;

// ── flag discipline (D3/Q34) ─────────────────────────────────────────────────

Deno.test("PLAN_TOOL_ENABLED requires CHAT_STORE_ENABLED — alone it refuses to register (Q34)", () => {
  Deno.env.set("PLAN_TOOL_ENABLED", "true");
  Deno.env.delete("CHAT_STORE_ENABLED");
  try {
    assertEquals(planToolEnabled(), false, "the store is a hard prerequisite");
  } finally {
    Deno.env.delete("PLAN_TOOL_ENABLED");
  }
});

Deno.test("flags off ⇒ the handler refuses and the B4 surface never declares update_task_plan", async () => {
  Deno.env.delete("PLAN_TOOL_ENABLED");
  Deno.env.set("CLOSED_LOOP_ENABLED", "true");
  try {
    assert(
      !experimentToolDeclarations().some((d) => d.name === "update_task_plan"),
      "flag off ⇒ no model can see the tool",
    );
    const h = makeCtx();
    const env = await executeTool("update_task_plan", { steps: [{ id: "a", label: "x", status: "active" }] }, h.ctx);
    assertEquals(env.meta.note, "agent_disabled");
    assertEquals((h.tables.chat_plans ?? []).length, 0);
  } finally {
    Deno.env.delete("CLOSED_LOOP_ENABLED");
  }
});

Deno.test("flags on ⇒ update_task_plan LEADS the closed-loop set (§20.4 step 2 orders it before any other tool)", () =>
  withPlanTool(async () => {
    Deno.env.set("CLOSED_LOOP_ENABLED", "true");
    try {
      const names = experimentToolDeclarations().map((d) => d.name);
      assertEquals(names[0], "update_task_plan");
      assert(names.includes("find_completed_run"));
    } finally {
      Deno.env.delete("CLOSED_LOOP_ENABLED");
    }
  }));

Deno.test("Q34 degradation: an unsynced thread files NO plan — dependency_missing, single-turn shapes remain", () =>
  withPlanTool(async () => {
    const h = makeCtx({}, "local-legacy-thread");
    const env = await executeTool("update_task_plan", {
      steps: [{ id: "a", label: "x", status: "active" }],
    }, h.ctx);
    assertEquals(env.meta.note, "dependency_missing");
    assertStringIncludes(String(env.data), "single turn");
    assertEquals((h.tables.chat_plans ?? []).length, 0, "never a half-persisted plan");
  }));

// ── the §21.1 schema + envelope (rule 5) ─────────────────────────────────────

Deno.test("§21.1 schema constant is verbatim (fixtures pin the contract) and the declaration matches", () => {
  assertEquals(UPDATE_TASK_PLAN_SCHEMA.$id, "https://suresuite.dev/schemas/update_task_plan.v1.json");
  assertEquals(UPDATE_TASK_PLAN_SCHEMA.required, ["steps"]);
  assertEquals(UPDATE_TASK_PLAN_SCHEMA.properties.steps.maxItems, 12);
  assertEquals(
    UPDATE_TASK_PLAN_SCHEMA.properties.steps.items.properties.status.enum,
    ["pending", "active", "done", "failed", "refused", "awaiting_approval", "awaiting_run"],
  );
  assertEquals(UPDATE_TASK_PLAN_SCHEMA.additionalProperties, false);
  assertEquals(updateTaskPlanDeclaration.name, "update_task_plan");
});

Deno.test("rule 5: the plan envelope — {kind:'plan', data:{plan_id,title,status,steps}, meta row_count 1}", () =>
  withPlanTool(async () => {
    const h = makeCtx();
    const env = await executeTool("update_task_plan", {
      title: "Outage plan",
      steps: [
        { id: "check", label: "Check the cache", status: "active" },
        { id: "answer", label: "Answer", status: "pending" },
      ],
    }, h.ctx);
    assertEquals(env.kind, "plan");
    assertEquals(env.meta, { tool: "update_task_plan", row_count: 1, note: undefined });
    const data = env.data as { plan_id: string; title: string; status: string; steps: PlanStep[] };
    assertEquals(data.title, "Outage plan");
    assertEquals(data.status, "active");
    assertEquals(data.steps.length, 2);
    assertEquals((h.tables.chat_plans ?? []).length, 1, "one row, written via the RPC funnel");
    assertEquals(String((h.tables.chat_plans ?? [])[0].agent_id), "experiment-designer");
  }));

// ── pi-01: terminal-or-waiting (the §21.3 integrity law) ─────────────────────

Deno.test("pi-01: the sweep fails a dangling 'active' step (note 'interrupted: <cause>') and recomputes the plan — never vanished", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-01-terminal-or-waiting");
    const h = makeCtx();
    const env = await executeTool("update_task_plan", fixture.create, h.ctx);
    assertEquals(env.kind, "plan");
    const planId = (env.data as { plan_id: string }).plan_id;

    const sweep = await sweepPlanIntegrity(h.db, {
      planId,
      userId: USER,
      cause: "provider error",
    });
    assert(sweep.changed && sweep.closed && sweep.plan, "the sweep acted and closed the plan");
    assertEquals(sweep.plan!.status, fixture.expect.plan_status);
    assertEquals(sweep.plan!.steps.length, fixture.expect.step_count, "steps never vanish");
    const swept = sweep.plan!.steps.find((s) => s.id === "check")!;
    assertEquals(swept.status, fixture.expect.swept_step_status);
    assertStringIncludes(swept.note ?? "", fixture.expect.swept_note_prefix);
    assertStringIncludes(swept.note ?? "", "provider error", "the cause lands in the note");
    assert(!sweep.plan!.steps.some((s) => s.status === "active"), "never a dangling active step");
  }));

Deno.test("pi-01 (scripted crash): a real B4 turn files the plan, the provider 500s through the §20.5 retry, the sweep closes honestly", () =>
  withPlanTool(async () => {
    Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer");
    Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
    Deno.env.set("CLOSED_LOOP_ENABLED", "true");
    Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
    const clFixture = JSON.parse(
      await Deno.readTextFile(new URL("./fixtures/closed-loop/cl-02-cache-miss-proposes.json", import.meta.url)),
    );
    const tables = structuredClone(clFixture.project_snapshot) as Record<string, Row[]>;
    const h = makeCtx(tables);
    const fixture = await loadFixture("pi-01-terminal-or-waiting");
    const mock = installFetchMock([
      {
        json: {
          candidates: [{
            content: { parts: [{ functionCall: { name: "update_task_plan", args: fixture.create } }] },
          }],
        },
      },
      { status: 500, json: { error: "boom" } },
      { status: 500, json: { error: "boom" } },
    ]);
    try {
      const turn = await runAgentTurn({
        agentId: "experiment-designer",
        modelId: "gemini-2.5-flash",
        utterance: "test a 6-week outage of S1 with 30 reps and tell me the fill-rate impact",
        ctx: h.ctx,
      });
      assert(!turn.ok, "the provider crash fails the turn");
      // The plan WAS filed before the crash — mid-step state on the row.
      const plan = await loadActivePlan(h.db, THREAD, USER);
      assert(plan, "the plan row exists");
      assertEquals(stepById(h.tables.chat_plans[0], "check").status, "active", "dangling before the sweep");
      // index.ts runs this after every plan-touching turn (incl. its catch).
      const sweep = await sweepPlanIntegrity(h.db, {
        planId: h.ctx.planTouchedId ?? plan!.id,
        userId: USER,
        cause: turn.error ?? "agent turn failed",
      });
      assertEquals(sweep.plan!.status, "failed");
      const swept = sweep.plan!.steps.find((s) => s.id === "check")!;
      assertEquals(swept.status, "failed");
      assertStringIncludes(swept.note ?? "", "interrupted");
      assert(!sweep.plan!.steps.some((s) => s.status === "active"));
    } finally {
      mock.restore();
      Deno.env.delete("AGENT_ENABLED_IDS");
      Deno.env.delete("AGENT_EXPERIMENT_TYPES");
      Deno.env.delete("CLOSED_LOOP_ENABLED");
    }
  }));

// ── pi-02: append-only ───────────────────────────────────────────────────────

Deno.test("pi-02: an update dropping a step id ⇒ invalid_params naming append-only; the stored row never loses a step; appending works", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-02-append-only");
    const h = makeCtx();
    const created = await executeTool("update_task_plan", fixture.create, h.ctx);
    const planId = (created.data as { plan_id: string }).plan_id;

    const dropped = await executeTool("update_task_plan", { plan_id: planId, ...fixture.update_dropping_b }, h.ctx);
    assertEquals(dropped.meta.note, "invalid_params");
    assertStringIncludes(String(dropped.data), fixture.expect.drop_error_includes);
    assertEquals(
      ((h.tables.chat_plans[0].steps as PlanStep[]) ?? []).map((s) => s.id),
      fixture.expect.stored_step_ids,
      "the stored row is untouched",
    );

    const appended = await executeTool("update_task_plan", { plan_id: planId, ...fixture.update_refusing_b }, h.ctx);
    assertEquals(appended.kind, "plan", `append failed: ${JSON.stringify(appended.data)}`);
    assertEquals(
      ((h.tables.chat_plans[0].steps as PlanStep[]) ?? []).map((s) => s.id),
      fixture.expect.appended_step_ids,
      "ids may be added, never removed",
    );
  }));

// ── pi-03 / pi-04: one active + waiting refs ─────────────────────────────────

Deno.test("pi-03: two 'active' steps ⇒ invalid_params naming rule 3; nothing written", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-03-one-active");
    const h = makeCtx();
    const env = await executeTool("update_task_plan", fixture.create, h.ctx);
    assertEquals(env.meta.note, "invalid_params");
    assertStringIncludes(String(env.data), fixture.expect.error_includes);
    assertEquals((h.tables.chat_plans ?? []).length, fixture.expect.plan_rows);
  }));

Deno.test("pi-04: awaiting_approval without proposal_id (and awaiting_run without run_id) ⇒ invalid_params naming rule 4", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-04-waiting-refs");
    const h = makeCtx();
    const noProposal = await executeTool("update_task_plan", fixture.create_missing_proposal_ref, h.ctx);
    assertEquals(noProposal.meta.note, "invalid_params");
    assertStringIncludes(String(noProposal.data), fixture.expect.approval_error_includes);
    const noRun = await executeTool("update_task_plan", fixture.create_missing_run_ref, h.ctx);
    assertEquals(noRun.meta.note, "invalid_params");
    assertStringIncludes(String(noRun.data), fixture.expect.run_error_includes);
    assertEquals((h.tables.chat_plans ?? []).length, fixture.expect.plan_rows);
  }));

Deno.test("rule 3 transitions: a terminal step cannot move; pending cannot jump to done", () =>
  withPlanTool(async () => {
    const h = makeCtx();
    const created = await executeTool("update_task_plan", {
      steps: [
        { id: "a", label: "A", status: "done" },
        { id: "b", label: "B", status: "pending" },
      ],
    }, h.ctx);
    const planId = (created.data as { plan_id: string }).plan_id;
    const reopened = await executeTool("update_task_plan", {
      plan_id: planId,
      steps: [
        { id: "a", label: "A", status: "active" },
        { id: "b", label: "B", status: "pending" },
      ],
    }, h.ctx);
    assertEquals(reopened.meta.note, "invalid_params");
    assertStringIncludes(String(reopened.data), "done → active");
    const jumped = await executeTool("update_task_plan", {
      plan_id: planId,
      steps: [
        { id: "a", label: "A", status: "done" },
        { id: "b", label: "B", status: "done" },
      ],
    }, h.ctx);
    assertEquals(jumped.meta.note, "invalid_params");
    assertStringIncludes(String(jumped.data), "pending → done");
  }));

// ── pi-05: reload survival — fresh client, same row, zero LLM ────────────────

Deno.test("pi-05: a FRESH stub client + resume_plan_id resumes the same row; running run ⇒ the §21.2 templated progress reply, ZERO fetches", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-05-reload-resume");
    const tables: Record<string, Row[]> = {};
    seedPlan(tables, fixture.seed_plan);
    seedRun(tables, fixture.seed_run);
    // "Reload": a brand-new client over the same store (the plan is server
    // state — nothing lives in any process between turns).
    const fresh = makeStubDb(tables, makeAgentRpcs(tables));
    const mock = installFetchMock([]);
    try {
      const outcome = await runResumePreStep(fresh, { planId: fixture.seed_plan.id, userId: USER });
      assertEquals(outcome.kind, fixture.expect.kind);
      assertStringIncludes((outcome as { reply: string }).reply, fixture.expect.reply_includes);
      assertEquals(mock.calls.length, fixture.expect.fetch_calls, "zero LLM calls — a poll costs nothing");
      assertEquals(Number(tables.chat_plans[0].resume_count), fixture.expect.resume_count_after,
        "resume_count increments only on LLM-reaching turns");
      assertEquals(progressLine(12, 30), "run dispatched — 12/30 replications", "the §21.2 line verbatim");
    } finally {
      mock.restore();
    }
  }));

Deno.test("owner check: another user's resume is refused typed — a plan is never a pre-authorization (§13.6 rule 5)", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-05-reload-resume");
    const tables: Record<string, Row[]> = {};
    seedPlan(tables, fixture.seed_plan);
    seedRun(tables, fixture.seed_run);
    const db = makeStubDb(tables, makeAgentRpcs(tables));
    const outcome = await runResumePreStep(db, { planId: fixture.seed_plan.id, userId: OTHER_USER });
    assertEquals(outcome.kind, "error");
    assertEquals((outcome as { error: string }).error, "forbidden");
  }));

// ── pi-06: model switch resumes the same plan ────────────────────────────────

Deno.test("pi-06: a resume under a different model_code advances the SAME row and records the new model (D3: data, not context)", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-06-model-switch");
    const tables: Record<string, Row[]> = {};
    seedPlan(tables, fixture.seed_plan);
    seedRun(tables, fixture.seed_run);
    const db = makeStubDb(tables, makeAgentRpcs(tables));
    const outcome = await runResumePreStep(db, {
      planId: fixture.seed_plan.id,
      userId: USER,
      modelCode: fixture.resume_model_code,
    });
    assertEquals(outcome.kind, fixture.expect.kind);
    const row = tables.chat_plans[0];
    assertEquals(String(row.id), String(fixture.seed_plan.id), "the same plan row");
    assertEquals(String(row.model_code), fixture.expect.model_code_after);
    assertEquals(Number(row.resume_count), fixture.expect.resume_count_after, "this resume reaches the LLM");
    assertEquals(stepById(row, "run").status, fixture.expect.step_status_after,
      "awaiting_run → active (a legal §21.1 transition) for the read-and-cite turn");
    assertStringIncludes(
      (outcome as { utterance: string }).utterance,
      fixture.seed_run.id,
      "the deterministic resume instruction names the run",
    );
  }));

// ── pi-07: the caps reject with the cap named ────────────────────────────────

Deno.test("pi-07: the 13th step and the 11th resume are rejected with the cap NAMED (§21.5 plan budgets)", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-07-caps");
    const h = makeCtx();
    const thirteen = Array.from({ length: 13 }, (_, i) => ({
      id: `s${i + 1}`,
      label: `Step ${i + 1}`,
      status: i === 0 ? "active" : "pending",
    }));
    const env = await executeTool("update_task_plan", { title: fixture.thirteen_steps_title, steps: thirteen }, h.ctx);
    assertEquals(env.meta.note, "invalid_params");
    assertStringIncludes(String(env.data), fixture.expect.step_cap_error_includes);
    assertEquals((h.tables.chat_plans ?? []).length, 0);

    const tables: Record<string, Row[]> = {};
    seedPlan(tables, fixture.seed_plan);
    seedRun(tables, fixture.seed_run);
    const db = makeStubDb(tables, makeAgentRpcs(tables));
    const outcome = await runResumePreStep(db, { planId: fixture.seed_plan.id, userId: USER });
    assertEquals(outcome.kind, "closed");
    assertStringIncludes((outcome as { reply: string }).reply, fixture.expect.resume_reply_includes);
    assertEquals(stepById(tables.chat_plans[0], "run").status, "failed");
    assertEquals(stepById(tables.chat_plans[0], "run").note, fixture.expect.resume_step_note);
    assertEquals(String(tables.chat_plans[0].status), fixture.expect.plan_status_after);
  }));

// ── pi-08: supersede visibly ─────────────────────────────────────────────────

Deno.test("pi-08: a second create abandons the first plan VISIBLY (never deleted, steps intact) — one live plan per thread", () =>
  withPlanTool(async () => {
    const fixture = await loadFixture("pi-08-supersede");
    const h = makeCtx();
    const first = await executeTool("update_task_plan", fixture.create_first, h.ctx);
    const firstId = (first.data as { plan_id: string }).plan_id;
    const second = await executeTool("update_task_plan", fixture.create_second, h.ctx);
    const secondId = (second.data as { plan_id: string }).plan_id;

    assertEquals((h.tables.chat_plans ?? []).length, fixture.expect.plan_rows, "both rows exist");
    const firstRow = h.tables.chat_plans.find((p) => String(p.id) === firstId)!;
    const secondRow = h.tables.chat_plans.find((p) => String(p.id) === secondId)!;
    assertEquals(String(firstRow.status), fixture.expect.first_status);
    assertEquals(((firstRow.steps as PlanStep[]) ?? []).map((s) => s.id), fixture.expect.first_step_ids);
    assertEquals(String(secondRow.status), fixture.expect.second_status);
    const active = await loadActivePlan(h.db, THREAD, USER);
    assertEquals(active?.id, secondId, "the new plan is the thread's live one");
  }));

// ── the §21.4 resume branches beyond pi-05/06 ────────────────────────────────

Deno.test("run failed ⇒ the step fails with the run's error_message; honest reply; NO retry without a fresh ask", () =>
  withPlanTool(async () => {
    const tables: Record<string, Row[]> = {};
    const plan = seedPlan(tables, {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
      steps: [
        { id: "run", label: "Wait for the run", status: "awaiting_run", ref: { run_id: "99999999-9999-4999-8999-999999999920" } },
        { id: "answer", label: "Answer", status: "pending" },
      ],
    });
    seedRun(tables, {
      id: "99999999-9999-4999-8999-999999999920",
      status: "failed",
      rep_count_done: 3,
      rep_count_target: 30,
      error_message: "worker OOM at replication 4",
    });
    const db = makeStubDb(tables, makeAgentRpcs(tables));
    const outcome = await runResumePreStep(db, { planId: String(plan.id), userId: USER });
    assertEquals(outcome.kind, "closed");
    assertStringIncludes((outcome as { reply: string }).reply, "worker OOM at replication 4");
    assertEquals(stepById(tables.chat_plans[0], "run").status, "failed");
    assertStringIncludes(stepById(tables.chat_plans[0], "run").note ?? "", "worker OOM");
    assertEquals(String(tables.chat_plans[0].status), "failed", "pending remainder cannot proceed");
    assertEquals(Number(tables.chat_plans[0].resume_count), 0, "a failure resume never reaches the LLM");
  }));

Deno.test("awaiting_approval resume: pending card ⇒ progress; rejected card ⇒ step failed 'rejected'; applied card ⇒ server-side advance to awaiting_run", () =>
  withPlanTool(async () => {
    const mk = (proposal: Row) => {
      const tables: Record<string, Row[]> = { proposals: [proposal] };
      seedPlan(tables, {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11",
        steps: [
          { id: "card", label: "Approve the spec", status: "awaiting_approval", ref: { proposal_id: String(proposal.id) } },
          { id: "answer", label: "Answer", status: "pending" },
        ],
      });
      return { tables, db: makeStubDb(tables, makeAgentRpcs(tables)) };
    };
    const PROP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
    const RUN = "99999999-9999-4999-8999-999999999921";

    const pending = mk({ id: PROP, status: "proposed" });
    const p = await runResumePreStep(pending.db, { planId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11", userId: USER });
    assertEquals(p.kind, "progress");
    assertStringIncludes((p as { reply: string }).reply, "awaiting review");

    const rejected = mk({ id: PROP, status: "rejected" });
    const r = await runResumePreStep(rejected.db, { planId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11", userId: USER });
    assertEquals(r.kind, "closed");
    assertEquals(stepById(rejected.tables.chat_plans[0], "card").status, "failed");
    assertEquals(stepById(rejected.tables.chat_plans[0], "card").note, "rejected");

    const applied = mk({ id: PROP, status: "applied", applied_result: { run_id: RUN } });
    seedRun(applied.tables, { id: RUN, status: "running", rep_count_done: 2, rep_count_target: 30 });
    const a = await runResumePreStep(applied.db, { planId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11", userId: USER });
    assertEquals(a.kind, "progress", "advanced then polled");
    assertEquals(stepById(applied.tables.chat_plans[0], "card").status, "awaiting_run",
      "the server-side twin of the client advance — the two paths converge");
    assertEquals(stepById(applied.tables.chat_plans[0], "card").ref?.run_id, RUN);
  }));

Deno.test("revoked capability at resume: the step is marked failed typed — the checkpoint outranks the plan (§13.6 rule 5)", () =>
  withPlanTool(async () => {
    // index.ts re-runs checkpoint 2 before the run_done agent turn; the
    // deterministic seam it uses on refusal is markPlanStepFailed.
    const tables: Record<string, Row[]> = {};
    seedPlan(tables, {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12",
      steps: [
        { id: "run", label: "Wait for the run", status: "active" },
        { id: "answer", label: "Answer", status: "pending" },
      ],
    });
    const db = makeStubDb(tables, makeAgentRpcs(tables));
    const plan = (await loadActivePlan(db, THREAD, USER))!;
    const fresh = await markPlanStepFailed(db, plan, "run", "forbidden: capability revoked", USER);
    assertEquals(stepById(tables.chat_plans[0], "run").status, "failed");
    assertEquals(stepById(tables.chat_plans[0], "run").note, "forbidden: capability revoked");
    assertEquals(fresh.status, "failed");
  }));

// ── the PLAN block (D3: serialized from the row, never model memory) ─────────

Deno.test("the §20.4 PLAN block serializes the active row and joins buildExperimentContext only when the flags are on", () =>
  withPlanTool(async () => {
    Deno.env.set("CLOSED_LOOP_ENABLED", "true");
    try {
      const tables: Record<string, Row[]> = {};
      seedPlan(tables, {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13",
        title: "Outage question",
        steps: [
          { id: "check", label: "Check the cache", status: "done" },
          { id: "card", label: "Approve the spec", status: "awaiting_approval", ref: { proposal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02" } },
        ],
      });
      const h = makeCtx(tables);
      const block = await buildPlanBlock(h.db, THREAD, USER);
      assertStringIncludes(block, "PLAN (plan_id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13");
      assertStringIncludes(block, "[done] check: Check the cache");
      assertStringIncludes(block, "[awaiting_approval] card: Approve the spec (proposal bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02)");
      const context = await buildExperimentContext(h.ctx, { utterance: "continue" });
      assertStringIncludes(context, "PLAN (plan_id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13");
      // formatPlanBlock is a pure function of the row (thread state).
      const plan = (await loadActivePlan(h.db, THREAD, USER)) as PlanRow;
      assertEquals(block, formatPlanBlock(plan));
    } finally {
      Deno.env.delete("CLOSED_LOOP_ENABLED");
    }
  }));

Deno.test("recomputePlanStatus: the §21.3 state machine table", () => {
  const s = (status: string): PlanStep => ({ id: "x", label: "x", status: status as PlanStep["status"] });
  assertEquals(recomputePlanStatus([s("done"), s("done")]), "done");
  assertEquals(recomputePlanStatus([s("done"), s("refused")]), "done", "refusal is honest closure, not failure");
  assertEquals(recomputePlanStatus([s("done"), s("failed")]), "failed");
  assertEquals(recomputePlanStatus([s("done"), s("awaiting_run")]), "active", "waiting keeps the plan live");
  assertEquals(recomputePlanStatus([s("failed"), s("pending")]), "failed", "no step can proceed");
  assertEquals(recomputePlanStatus([s("done"), s("pending")]), "active");
});
