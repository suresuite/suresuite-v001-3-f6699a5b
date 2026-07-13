// DB-backed deterministic tier for v1.2 Phase 2 (ai-agents.md §7.4 tier 1):
// boots a scratch Postgres, applies the proposals/chat-store chain plus the
// NEW 20260722000001_chat_bulk_thread_actions.sql VERBATIM, and asserts the
// §17.1 bulk-RPC contract:
//   * each RPC enforces the same owner check as its single-row §14.1 sibling,
//     but SKIPS (never fails on) non-owned and unknown ids — a mixed
//     owned/non-owned id array affects only the owned rows and returns the
//     count of rows actually touched;
//   * bulk_move_chat_threads validates the TARGET folder is the caller's own
//     (a foreign target fails whole, like move_chat_thread) and NULL detaches;
//   * bulk_set_thread_flags keeps NULL-means-keep semantics per flag;
//   * bulk_delete_chat_threads hard-deletes owned rows and cascades messages;
//   * NULL p_user_id fails closed ('forbidden') on all three.
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "55555555-5555-4555-8555-555555555555";

// USER_A owns A1..A3; USER_B owns B1. UNKNOWN never exists.
const A1 = "aaaaaaa1-0000-4000-8000-000000000001";
const A2 = "aaaaaaa1-0000-4000-8000-000000000002";
const A3 = "aaaaaaa1-0000-4000-8000-000000000003";
const B1 = "bbbbbbb1-0000-4000-8000-000000000001";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const MIXED = `ARRAY['${A1}','${A2}','${B1}','${UNKNOWN}']::uuid[]`;

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
  "20260722000001_chat_bulk_thread_actions.sql",
];

const SEED_SQL = `
SELECT public.upsert_chat_thread('${USER_A}', '${A1}', 'A one');
SELECT public.upsert_chat_thread('${USER_A}', '${A2}', 'A two');
SELECT public.upsert_chat_thread('${USER_A}', '${A3}', 'A three');
SELECT public.upsert_chat_thread('${USER_B}', '${B1}', 'B one');
SELECT public.append_chat_message('${USER_A}', '${A1}', 'user', 'keep me until bulk delete');
SELECT public.append_chat_message('${USER_B}', '${B1}', 'user', 'never touched by user A');
`;

Deno.test("Phase 2 bulk thread actions against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if (Deno.env.get("EVAL_REQUIRE_DB") === "1") throw new Error("Postgres binaries required (EVAL_REQUIRE_DB=1)");
    console.warn("skipping DB-backed bulk-actions suite: no Postgres binaries found");
    return;
  }
  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of MIGRATIONS) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
      await db.sql(SEED_SQL);
    });

    await t.step("bulk_set_thread_flags: mixed ids touch only owned rows; count is the owned subset", async () => {
      const n = await db.sql(
        `SELECT public.bulk_set_thread_flags(${MIXED}, NULL, true, '${USER_A}');`,
      );
      assertEquals(n.trim(), "2", "B1 and the unknown id are skipped, not failed on");
      assertEquals(
        await db.sql(`SELECT string_agg(id::text, ',' ORDER BY id) FROM public.chat_threads WHERE archived;`),
        `${A1},${A2}`,
      );
      assertEquals(
        await db.sql(`SELECT archived FROM public.chat_threads WHERE id='${B1}';`),
        "f",
        "the non-owned row is untouched",
      );
    });

    await t.step("bulk_set_thread_flags: NULL keeps per flag (set_thread_flags semantics)", async () => {
      const n = await db.sql(
        `SELECT public.bulk_set_thread_flags(ARRAY['${A1}','${A2}']::uuid[], true, NULL, '${USER_A}');`,
      );
      assertEquals(n.trim(), "2");
      assertEquals(
        await db.sql(`SELECT bool_and(pinned) || '|' || bool_and(archived)
                      FROM public.chat_threads WHERE id IN ('${A1}','${A2}');`),
        "true|true",
        "pinned set; archived kept from the previous step",
      );
    });

    await t.step("bulk_move_chat_threads: owned rows file under an owned folder; foreign/unknown skipped", async () => {
      const folderA = await db.sql(`SELECT public.create_chat_folder('${USER_A}', 'Q3 stress review', 0);`);
      const n = await db.sql(
        `SELECT public.bulk_move_chat_threads(${MIXED}, '${folderA}', '${USER_A}');`,
      );
      assertEquals(n.trim(), "2");
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.chat_threads WHERE folder_id='${folderA}';`),
        "2",
      );
      assertEquals(
        await db.sql(`SELECT folder_id IS NULL FROM public.chat_threads WHERE id='${B1}';`),
        "t",
        "the non-owned row keeps its folder",
      );
      // NULL folder detaches (same as move_chat_thread)
      const detached = await db.sql(
        `SELECT public.bulk_move_chat_threads(ARRAY['${A1}']::uuid[], NULL, '${USER_A}');`,
      );
      assertEquals(detached.trim(), "1");
      assertEquals(
        await db.sql(`SELECT folder_id IS NULL FROM public.chat_threads WHERE id='${A1}';`),
        "t",
      );
    });

    await t.step("bulk_move_chat_threads: a foreign target folder fails whole (never right for any row)", async () => {
      const folderB = await db.sql(`SELECT public.create_chat_folder('${USER_B}', 'Not yours', 0);`);
      const err = await db.sqlExpectError(
        `SELECT public.bulk_move_chat_threads(ARRAY['${A1}']::uuid[], '${folderB}', '${USER_A}');`,
      );
      assertStringIncludes(err, "not found");
    });

    await t.step("NULL p_user_id fails closed on all three (§10 Q20 idiom)", async () => {
      for (const call of [
        `SELECT public.bulk_move_chat_threads(ARRAY['${A1}']::uuid[], NULL, NULL);`,
        `SELECT public.bulk_set_thread_flags(ARRAY['${A1}']::uuid[], true, NULL, NULL);`,
        `SELECT public.bulk_delete_chat_threads(ARRAY['${A1}']::uuid[], NULL);`,
      ]) {
        assertStringIncludes(await db.sqlExpectError(call), "forbidden");
      }
    });

    await t.step("empty / NULL id arrays are no-ops returning 0", async () => {
      assertEquals(
        (await db.sql(`SELECT public.bulk_set_thread_flags('{}'::uuid[], true, NULL, '${USER_A}');`)).trim(),
        "0",
      );
      assertEquals(
        (await db.sql(`SELECT public.bulk_delete_chat_threads(NULL::uuid[], '${USER_A}');`)).trim(),
        "0",
      );
    });

    await t.step("bulk_delete_chat_threads: mixed ids delete only owned rows; messages cascade", async () => {
      const n = await db.sql(
        `SELECT public.bulk_delete_chat_threads(${MIXED}, '${USER_A}');`,
      );
      assertEquals(n.trim(), "2", "A1+A2 deleted; B1 and the unknown id skipped");
      assertEquals(
        await db.sql(`SELECT string_agg(id::text, ',' ORDER BY id) FROM public.chat_threads;`),
        `${A3},${B1}`,
      );
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.chat_messages WHERE thread_id='${A1}';`),
        "0",
        "owned messages cascade",
      );
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.chat_messages WHERE thread_id='${B1}';`),
        "1",
        "the other owner's history is intact",
      );
    });
  } finally {
    await db.stop();
  }
});
