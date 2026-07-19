// DB-backed deterministic tier for Phase H3 (ai-agents.md §21.2, §7.4 tier
// 1): boots a scratch Postgres, applies the proposal/telemetry/chat-store
// migrations plus the NEW 20260726000001_chat_plans.sql VERBATIM, and pins:
//   * the chat_plans DDL (§21.2 verbatim: status/title CHECKs, 14-day TTL
//     default, resume_count, realtime publication membership);
//   * upsert_chat_plan is SERVICE PATH ONLY (anon/authenticated cannot
//     execute) and supersedes the thread's other active plan on create
//     ('abandoned', never deleted); the 12-step cap is enforced IN SQL;
//   * get_chat_plan / list_chat_plans are owner-scoped (the Q20 explicit
//     p_user_id idiom) and list lazily sweeps the TTL;
//   * expire_chat_plans expires only active-and-past-TTL rows;
//   * advance_chat_plan_step allows EXACTLY the two §21.4 client-legal
//     transitions from awaiting_approval (awaiting_run requires p_run_id;
//     failed carries the note), owner-checked, everything else rejected;
//   * the ai_chat_events CHECK gains exactly the three §21.3 plan kinds.
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const THREAD = "33333333-3333-4333-8333-333333333333";
const OWNER = "22222222-2222-4222-8222-222222222201";
const OTHER = "22222222-2222-4222-8222-222222222202";
const RUN = "99999999-9999-4999-8999-999999999901";

const SETUP_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE PUBLICATION supabase_realtime;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text
);
GRANT SELECT ON public.projects TO anon, authenticated, service_role;
INSERT INTO public.projects (id, name) VALUES ('${PROJECT}', 'Eval project');

CREATE TABLE public.approved_users (id uuid PRIMARY KEY, organization_id uuid, email text);
CREATE FUNCTION public.get_current_user_id() RETURNS uuid
LANGUAGE sql AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
CREATE FUNCTION public.current_is_super_admin() RETURNS boolean
LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_my_capabilities(_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT '{"is_super_admin": false, "features": {}}'::jsonb $$;

-- capability registry stand-in (20260711000002 predates this suite)
CREATE TABLE public.capabilities (
  key text PRIMARY KEY, kind text NOT NULL, label text NOT NULL,
  description text, sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.role_capabilities (
  role text NOT NULL, capability_key text NOT NULL REFERENCES public.capabilities(key),
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability_key)
);
-- the hash fns 20260715000001's expire sweep references
CREATE FUNCTION public.current_policy_hash(p_project_id uuid) RETURNS text
LANGUAGE sql AS $$ SELECT 'ph-current' $$;
CREATE FUNCTION public.current_graph_hash(p_project_id uuid) RETURNS text
LANGUAGE sql AS $$ SELECT 'gh-current' $$;
`;

const MIGRATIONS = [
  "20260715000001_agent_proposals.sql",
  "20260715000002_agent_telemetry.sql",
  "20260715000003_agent_capabilities.sql",
  "20260717000001_chat_store.sql",
  "20260717000002_chat_quick_thread_id_sha256.sql",
  "20260718000001_stage1_agent_rights_and_summary.sql",
  "20260721000001_chat_modes_and_ui_events.sql",
  "20260724000001_verifier_event.sql",
  "20260726000001_chat_plans.sql",
];

const STEPS_WAITING = `[
  {"id":"check","label":"Check the cache","status":"done"},
  {"id":"card","label":"Approve the spec","status":"awaiting_approval","ref":{"proposal_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01"}}
]`;

Deno.test("Phase H3 chat_plans migration against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if (Deno.env.get("EVAL_REQUIRE_DB") === "1") throw new Error("Postgres binaries required (EVAL_REQUIRE_DB=1)");
    console.warn("skipping DB-backed H3 suite: no Postgres binaries found");
    return;
  }
  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of MIGRATIONS) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    let planId = "";
    await t.step("upsert_chat_plan (service path) creates with the §21.2 defaults: active, 14-day TTL, resume_count 0", async () => {
      const row = await db.sql(`
        SELECT public.upsert_chat_plan(
          jsonb_build_object(
            'thread_id', '${THREAD}',
            'project_id', '${PROJECT}',
            'agent_id', 'experiment-designer',
            'title', 'Outage question',
            'steps', '${STEPS_WAITING}'::jsonb
          ), '${OWNER}'::uuid);
      `);
      const plan = JSON.parse(row.trim());
      planId = plan.id;
      assertEquals(plan.status, "active");
      assertEquals(plan.resume_count, 0);
      assertEquals(plan.agent_id, "experiment-designer");
      const ttl = await db.sql(
        `SELECT (expires_at - created_at) BETWEEN interval '13 days 23 hours' AND interval '14 days 1 hour' FROM public.chat_plans WHERE id='${planId}';`,
      );
      assertEquals(ttl.trim(), "t", "the proposals 14-day TTL default");
    });

    await t.step("upsert_chat_plan is service-path only: anon/authenticated cannot execute", async () => {
      const err = await db.sqlExpectError(
        `SELECT public.upsert_chat_plan('{"thread_id":"${THREAD}","steps":[]}'::jsonb, '${OWNER}'::uuid);`,
        { role: "anon" },
      );
      assertStringIncludes(err, "permission denied");
    });

    await t.step("the 12-step cap is enforced IN SQL (§21.5)", async () => {
      const thirteen = JSON.stringify(
        Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, status: "pending" })),
      );
      const err = await db.sqlExpectError(`
        SELECT public.upsert_chat_plan(
          jsonb_build_object('thread_id', '${THREAD}', 'steps', '${thirteen}'::jsonb),
          '${OWNER}'::uuid);
      `);
      assertStringIncludes(err, "at most 12 steps");
    });

    await t.step("create supersedes: a second plan abandons the first VISIBLY (never deleted)", async () => {
      await db.sql(`
        SELECT public.upsert_chat_plan(
          jsonb_build_object('thread_id', '${THREAD}', 'title', 'Second plan',
            'steps', '[{"id":"x","label":"X","status":"active"}]'::jsonb),
          '${OWNER}'::uuid);
      `);
      assertEquals(
        (await db.sql(`SELECT status FROM public.chat_plans WHERE id='${planId}';`)).trim(),
        "abandoned",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.chat_plans WHERE thread_id='${THREAD}';`)).trim(),
        "2",
        "both rows exist",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.chat_plans WHERE thread_id='${THREAD}' AND status='active';`)).trim(),
        "1",
        "one live plan per thread",
      );
    });

    await t.step("owner reads: get_chat_plan / list_chat_plans answer only the owner (Q20 p_user_id idiom)", async () => {
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.get_chat_plan('${planId}'::uuid, '${OWNER}'::uuid);`)).trim(),
        "1",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.get_chat_plan('${planId}'::uuid, '${OTHER}'::uuid);`)).trim(),
        "0",
        "not the owner ⇒ no row",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.list_chat_plans('${THREAD}'::uuid, '${OTHER}'::uuid);`)).trim(),
        "0",
      );
    });

    await t.step("update is owner-checked and thread-bound; resume_count increments only when asked", async () => {
      const err = await db.sqlExpectError(`
        SELECT public.upsert_chat_plan(
          jsonb_build_object('id', '${planId}', 'thread_id', '${THREAD}',
            'steps', '${STEPS_WAITING}'::jsonb),
          '${OTHER}'::uuid);
      `);
      assertStringIncludes(err, "forbidden");
      const row = await db.sql(`
        SELECT public.upsert_chat_plan(
          jsonb_build_object('id', '${planId}', 'thread_id', '${THREAD}',
            'model_code', 'gpt-5', 'increment_resume', true,
            'steps', '${STEPS_WAITING}'::jsonb),
          '${OWNER}'::uuid);
      `);
      const plan = JSON.parse(row.trim());
      assertEquals(plan.resume_count, 1, "the §21.4 LLM-reaching-resume counter");
      assertEquals(plan.model_code, "gpt-5", "the D3 informational model record");
    });

    await t.step("advance_chat_plan_step: awaiting_approval → awaiting_run requires p_run_id and stamps ref.run_id", async () => {
      // reactivate the superseded plan for the advance tests
      await db.sql(`UPDATE public.chat_plans SET status='active' WHERE id='${planId}';`);
      await db.sql(`UPDATE public.chat_plans SET status='abandoned' WHERE thread_id='${THREAD}' AND id <> '${planId}';`);
      const noRun = await db.sqlExpectError(`
        SELECT public.advance_chat_plan_step('${planId}'::uuid, 'card', 'awaiting_run', '${OWNER}'::uuid);
      `);
      assertStringIncludes(noRun, "requires p_run_id");
      const forbidden = await db.sqlExpectError(`
        SELECT public.advance_chat_plan_step('${planId}'::uuid, 'card', 'awaiting_run', '${OTHER}'::uuid, NULL, '${RUN}'::uuid);
      `);
      assertStringIncludes(forbidden, "forbidden");
      const badStatus = await db.sqlExpectError(`
        SELECT public.advance_chat_plan_step('${planId}'::uuid, 'card', 'done', '${OWNER}'::uuid);
      `);
      assertStringIncludes(badStatus, "only awaiting_run or failed");
      const advanced = JSON.parse((await db.sql(`
        SELECT public.advance_chat_plan_step('${planId}'::uuid, 'card', 'awaiting_run', '${OWNER}'::uuid, NULL, '${RUN}'::uuid);
      `)).trim());
      const card = advanced.steps.find((s: { id: string }) => s.id === "card");
      assertEquals(card.status, "awaiting_run");
      assertEquals(card.ref.run_id, RUN, "the run binding the resume pre-step advances on");
      const notWaiting = await db.sqlExpectError(`
        SELECT public.advance_chat_plan_step('${planId}'::uuid, 'card', 'failed', '${OWNER}'::uuid, 'note');
      `);
      assertStringIncludes(notWaiting, "only awaiting_approval steps");
    });

    await t.step("expire_chat_plans / lazy list sweep: only active-and-past-TTL rows expire", async () => {
      await db.sql(`UPDATE public.chat_plans SET expires_at = now() - interval '1 day' WHERE id='${planId}';`);
      const listed = await db.sql(
        `SELECT status FROM public.list_chat_plans('${THREAD}'::uuid, '${OWNER}'::uuid) WHERE id='${planId}';`,
      );
      assertEquals(listed.trim(), "expired", "list lazily swept the TTL (§4.1 pattern)");
      assertEquals(
        (await db.sql(`SELECT public.expire_chat_plans('${THREAD}'::uuid);`)).trim(),
        "0",
        "nothing further to expire",
      );
    });

    await t.step("realtime + telemetry: chat_plans joins supabase_realtime; the CHECK gains exactly the three plan kinds", async () => {
      assertEquals(
        (await db.sql(`SELECT count(*) FROM pg_publication_tables
          WHERE pubname='supabase_realtime' AND tablename='chat_plans';`)).trim(),
        "1",
      );
      for (const kind of ["plan.created", "plan.step_changed", "plan.closed"]) {
        await db.sql(`
          INSERT INTO public.ai_chat_events (event_kind, payload)
          VALUES ('${kind}', '{"plan_id":"${planId}","steps_by_status":{"done":2},"resume_count":1}'::jsonb);
        `);
      }
      const bad = await db.sqlExpectError(`
        INSERT INTO public.ai_chat_events (event_kind, payload) VALUES ('plan.unknown', '{}'::jsonb);
      `);
      assertStringIncludes(bad, "ai_chat_events_event_kind_check");
    });
  } finally {
    await db.stop();
  }
});
