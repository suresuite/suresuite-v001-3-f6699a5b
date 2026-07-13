// DB-backed deterministic tier for v1.2 Phase 1 (ai-agents.md §7.4 tier 1):
// boots a scratch Postgres, applies the proposals/telemetry/chat-store
// migrations plus the NEW 20260721000001_chat_modes_and_ui_events.sql
// VERBATIM, and asserts:
//   * chat_threads.mode: DEFAULT 'review'; the CHECK accepts ask/review and
//     DELIBERATELY rejects 'auto' (§15, §10 Q23 — unlocking Auto is a
//     migration + a Q6 decision, never a UI change);
//   * upsert_chat_thread: exactly ONE signature remains (the 8-arg original
//     is dropped, not overloaded — PostgREST named-call ambiguity), p_mode
//     round-trips, NULL keeps, invalid values reject;
//   * ai_chat_events: the four Phase-1 §16.3 kinds pass the CHECK; unknown
//     kinds still reject (the closed set stays closed);
//   * record_chat_ui_event: writes ONLY mode.changed / suggestion.clicked
//     (the client-originated funnel), rejects everything else, and caps the
//     payload (§7.5 — ids and codes, never message text).
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

const SETUP_SQL = `
-- Scratch stand-ins for the platform objects the migrations reference.
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

CREATE FUNCTION public.get_current_user_id() RETURNS uuid
LANGUAGE sql AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
CREATE FUNCTION public.current_is_super_admin() RETURNS boolean
LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_my_capabilities(_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT '{"is_super_admin": false, "features": {"agent_apply": true, "agent_proposals": true}}'::jsonb;
$$;

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
INSERT INTO public.capabilities (key, kind, label) VALUES ('ai_chat', 'feature', 'AI Assistant');
INSERT INTO public.role_capabilities VALUES
  ('super_admin','ai_chat',true), ('admin','ai_chat',true),
  ('modeler','ai_chat',true), ('user','ai_chat',true);
`;

const MIGRATIONS = [
  "20260715000001_agent_proposals.sql",
  "20260715000002_agent_telemetry.sql",
  "20260717000001_chat_store.sql",
  "20260717000002_chat_quick_thread_id_sha256.sql",
  "20260721000001_chat_modes_and_ui_events.sql",
];

Deno.test("Phase 1 modes/events migration against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if (Deno.env.get("EVAL_REQUIRE_DB") === "1") throw new Error("Postgres binaries required (EVAL_REQUIRE_DB=1)");
    console.warn("skipping DB-backed Stage 4 suite: no Postgres binaries found");
    return;
  }
  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of MIGRATIONS) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    await t.step("chat_threads.mode: default review; CHECK accepts ask/review, rejects 'auto' (§10 Q23)", async () => {
      await db.sql(`SELECT public.upsert_chat_thread('${USER}', '${THREAD}', 'Modes thread');`);
      assertEquals((await db.sql(`SELECT mode FROM public.chat_threads WHERE id = '${THREAD}';`)).trim(), "review");
      const err = await db.sqlExpectError(
        `UPDATE public.chat_threads SET mode = 'auto' WHERE id = '${THREAD}';`,
      );
      assertStringIncludes(err, "chat_threads_mode_check");
    });

    await t.step("upsert_chat_thread: one signature; p_mode round-trips; NULL keeps; invalid rejects", async () => {
      const overloads = await db.sql(
        `SELECT count(*) FROM pg_proc WHERE proname = 'upsert_chat_thread';`,
      );
      assertEquals(overloads.trim(), "1", "the 8-arg original must be DROPPED, not overloaded");
      await db.sql(`SELECT public.upsert_chat_thread('${USER}', '${THREAD}', NULL, NULL, false, NULL, NULL, false, 'ask');`);
      assertEquals((await db.sql(`SELECT mode FROM public.chat_threads WHERE id = '${THREAD}';`)).trim(), "ask");
      // NULL = keep (the M0 callers that don't know about modes stay valid)
      await db.sql(`SELECT public.upsert_chat_thread('${USER}', '${THREAD}', 'renamed');`);
      assertEquals((await db.sql(`SELECT mode FROM public.chat_threads WHERE id = '${THREAD}';`)).trim(), "ask");
      const err = await db.sqlExpectError(
        `SELECT public.upsert_chat_thread('${USER}', '${THREAD}', NULL, NULL, false, NULL, NULL, false, 'auto');`,
      );
      assertStringIncludes(err, "invalid mode");
    });

    await t.step("ai_chat_events: the four Phase-1 kinds pass; unknown kinds still reject", async () => {
      for (const kind of ["mode.changed", "mode.blocked_intent", "suggestion.shown", "suggestion.clicked"]) {
        await db.sql(
          `INSERT INTO public.ai_chat_events (event_kind, user_id, project_id) VALUES ('${kind}', '${USER}', '${PROJECT}');`,
        );
      }
      const err = await db.sqlExpectError(
        `INSERT INTO public.ai_chat_events (event_kind) VALUES ('mode.autonomy_granted');`,
      );
      assertStringIncludes(err, "ai_chat_events_event_kind_check", "the closed set stays closed");
    });

    await t.step("record_chat_ui_event: the narrow client funnel — two kinds only, payload capped", async () => {
      await db.sql(
        `SELECT public.record_chat_ui_event('mode.changed', '${USER}', '${PROJECT}', '${THREAD}', '{"mode":"ask"}'::jsonb);`,
      );
      await db.sql(
        `SELECT public.record_chat_ui_event('suggestion.clicked', '${USER}', '${PROJECT}', NULL, '{"rule":"data_gaps"}'::jsonb);`,
      );
      const rows = await db.sql(
        `SELECT event_kind, payload->>'mode', payload->>'rule' FROM public.ai_chat_events
          WHERE event_kind IN ('mode.changed','suggestion.clicked') AND user_id = '${USER}'
            AND payload != '{}'::jsonb ORDER BY event_kind;`,
      );
      assertStringIncludes(rows, "mode.changed|ask|");
      assertStringIncludes(rows, "suggestion.clicked||data_gaps");
      // server-emitted kinds are NOT writable through the client funnel
      const err = await db.sqlExpectError(
        `SELECT public.record_chat_ui_event('suggestion.shown', '${USER}', '${PROJECT}', NULL, '{}'::jsonb);`,
      );
      assertStringIncludes(err, "unsupported client event kind");
      // an oversized payload is replaced, never stored (§7.5)
      await db.sql(
        `SELECT public.record_chat_ui_event('mode.changed', '${USER}', NULL, NULL,
           jsonb_build_object('blob', repeat('x', 4000)));`,
      );
      const oversized = await db.sql(
        `SELECT count(*) FROM public.ai_chat_events
          WHERE event_kind = 'mode.changed' AND length(payload::text) > 2000;`,
      );
      assertEquals(oversized.trim(), "0");
    });

    await t.step("list_chat_threads carries mode (SETOF chat_threads — no client migration needed)", async () => {
      const out = await db.sql(`SELECT mode FROM public.list_chat_threads('${USER}');`);
      assert(out.includes("ask"), `expected the thread's mode in the listing, got: ${out}`);
    });
  } finally {
    await db.stop();
  }
});
