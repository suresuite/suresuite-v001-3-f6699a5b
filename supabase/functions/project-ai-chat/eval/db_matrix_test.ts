// DB-backed deterministic tier for Phase H4 (ai-agents.md §23.1, §7.4 tier
// 1): boots a scratch Postgres, applies the proposal/telemetry migrations
// plus the NEW 20260726000002_model_capability_matrix.sql VERBATIM, and pins:
//   * the ai_model_capabilities DDL (§23.1 verbatim: NOT NULL score/target/
//     pass/eval_run_id, measured_at default, the (model_code, capability_id)
//     unique key);
//   * "newest run upserts" — ON CONFLICT on the unique key (what PostgREST's
//     resolution=merge-duplicates compiles to) replaces score/pass/target/
//     eval_run_id/measured_at in place, one row per pair forever;
//   * writes are service-path only (anon/authenticated hold no INSERT and
//     RLS exposes no policy) while get_model_capability_matrix() reads the
//     FULL matrix as anon — quality metadata, not project data;
//   * the ai_chat_events CHECK gains exactly model.below_target and keeps
//     every prior kind.
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const SETUP_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE PUBLICATION supabase_realtime;

-- stand-ins the proposal/telemetry migrations reference (db_plans_test idiom)
CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
GRANT SELECT ON public.projects TO anon, authenticated, service_role;
CREATE TABLE public.approved_users (id uuid PRIMARY KEY, organization_id uuid, email text);
CREATE FUNCTION public.get_current_user_id() RETURNS uuid
LANGUAGE sql AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
CREATE FUNCTION public.current_is_super_admin() RETURNS boolean
LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.current_policy_hash(p_project_id uuid) RETURNS text
LANGUAGE sql AS $$ SELECT 'ph-current' $$;
CREATE FUNCTION public.current_graph_hash(p_project_id uuid) RETURNS text
LANGUAGE sql AS $$ SELECT 'gh-current' $$;
`;

const MIGRATIONS = [
  "20260715000001_agent_proposals.sql",
  "20260715000002_agent_telemetry.sql",
  "20260726000002_model_capability_matrix.sql",
];

const upsertRow = (score: number, pass: boolean, runId: string, measuredAt: string) => `
  INSERT INTO public.ai_model_capabilities
    (model_code, capability_id, score, target, pass, eval_run_id, measured_at)
  VALUES ('gemini-2.5-flash', 'agent:experiment-designer', ${score}, 1.0, ${pass}, '${runId}', '${measuredAt}')
  ON CONFLICT (model_code, capability_id) DO UPDATE SET
    score = excluded.score, target = excluded.target, pass = excluded.pass,
    eval_run_id = excluded.eval_run_id, measured_at = excluded.measured_at;
`;

Deno.test("Phase H4 ai_model_capabilities migration against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if (Deno.env.get("EVAL_REQUIRE_DB") === "1") throw new Error("Postgres binaries required (EVAL_REQUIRE_DB=1)");
    console.warn("skipping DB-backed H4 suite: no Postgres binaries found");
    return;
  }
  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of MIGRATIONS) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    await t.step("§23.1 DDL: columns NOT NULL, measured_at defaulted, unique (model_code, capability_id)", async () => {
      const cols = await db.sql(`
        SELECT column_name || ':' || is_nullable FROM information_schema.columns
        WHERE table_name = 'ai_model_capabilities' ORDER BY column_name;
      `);
      for (const c of ["capability_id:NO", "eval_run_id:NO", "measured_at:NO", "model_code:NO", "pass:NO", "score:NO", "target:NO"]) {
        assertStringIncludes(cols, c);
      }
      await db.sqlExpectError(
        `INSERT INTO public.ai_model_capabilities (model_code, capability_id, score, target, pass, eval_run_id)
         VALUES ('m', 'router', 1, 1, true, 'eval:a'),
                ('m', 'router', 1, 1, true, 'eval:b');`,
      );
      // measured_at defaults to now() when omitted.
      await db.sql(
        `INSERT INTO public.ai_model_capabilities (model_code, capability_id, score, target, pass, eval_run_id)
         VALUES ('gpt-5', 'router', 1, 1, true, 'eval:seed');`,
      );
      const defaulted = await db.sql(
        `SELECT measured_at > now() - interval '1 minute' FROM public.ai_model_capabilities WHERE model_code='gpt-5';`,
      );
      assertEquals(defaulted.trim(), "t");
    });

    await t.step("newest run upserts: ON CONFLICT replaces the row in place — one row per pair, history never accumulates", async () => {
      await db.sql(upsertRow(0.5, false, "eval:run00001", "2026-07-10T12:00:00Z"));
      await db.sql(upsertRow(1.0, true, "eval:run00002", "2026-07-18T12:00:00Z"));
      const row = await db.sql(`
        SELECT count(*) || '|' || max(score) || '|' || bool_or(pass) || '|' || max(eval_run_id)
        FROM public.ai_model_capabilities
        WHERE model_code = 'gemini-2.5-flash' AND capability_id = 'agent:experiment-designer';
      `);
      assertEquals(row.trim(), "1|1|true|eval:run00002");
      // The stored target is the one the newest run measured against — a
      // later threshold change writes a NEW row value, never a rewrite of
      // this one until the next run lands (§23.2 snapshotting).
      const target = await db.sql(
        `SELECT target FROM public.ai_model_capabilities WHERE model_code='gemini-2.5-flash' AND capability_id='agent:experiment-designer';`,
      );
      assertEquals(target.trim(), "1.0");
    });

    await t.step("writes are service-path only: anon cannot INSERT (no grant, no policy)", async () => {
      const err = await db.sqlExpectError(
        `INSERT INTO public.ai_model_capabilities (model_code, capability_id, score, target, pass, eval_run_id)
         VALUES ('m2', 'router', 1, 1, true, 'eval:x');`,
        { role: "anon" },
      );
      assertStringIncludes(err, "permission denied");
    });

    await t.step("get_model_capability_matrix(): anon reads the FULL matrix (quality metadata), ordered (model_code, capability_id)", async () => {
      const rows = await db.sql(
        `SELECT string_agg(model_code || '/' || capability_id, ',') FROM (SELECT * FROM public.get_model_capability_matrix()) m;`,
        { role: "anon" },
      );
      assertEquals(
        rows.trim(),
        "gemini-2.5-flash/agent:experiment-designer,gpt-5/router",
      );
    });

    await t.step("ai_chat_events CHECK: model.below_target accepted; prior kinds kept; unknown kinds rejected", async () => {
      await db.sql(
        `INSERT INTO public.ai_chat_events (event_kind, payload)
         VALUES ('model.below_target', '{"model_code":"gemini-2.5-flash","capability_id":"agent:experiment-designer"}');`,
      );
      await db.sql(`INSERT INTO public.ai_chat_events (event_kind) VALUES ('chat.reply'), ('router.decision');`);
      const err = await db.sqlExpectError(
        `INSERT INTO public.ai_chat_events (event_kind) VALUES ('model.autoswitched');`,
      );
      assertStringIncludes(err, "ai_chat_events_event_kind_check");
    });
  } finally {
    await db.stop();
  }
});
