// DB-backed deterministic tier (ai-agents.md §7.4 tier 1): boots a scratch
// Postgres, applies the Stage 0 + M0 migrations VERBATIM, and asserts the
// proposal lifecycle state machine, idempotency, service-role-only apply
// markers, telemetry posture, capability seeds, and the chat store —
// including lossless localStorage import on the seeded fixture.
//
// Skips politely when no Postgres binaries exist (local sandboxes); CI sets
// EVAL_REQUIRE_DB=1 so absence there is a failure, not a skip.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";
import {
  quickThreadServerId,
  serializeThreadsForImport,
  type LocalThreadLike,
} from "../../../../src/lib/chat/localThreadImport.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "55555555-5555-4555-8555-555555555555";

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

-- hash + auth helpers (session-settable so drift can be simulated)
CREATE FUNCTION public.current_policy_hash(p_project_id uuid) RETURNS text
LANGUAGE sql AS $$ SELECT current_setting('eval.policy_hash', true) $$;
CREATE FUNCTION public.current_graph_hash(p_project_id uuid) RETURNS text
LANGUAGE sql AS $$ SELECT current_setting('eval.graph_hash', true) $$;
CREATE FUNCTION public.get_current_user_id() RETURNS uuid
LANGUAGE sql AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
CREATE FUNCTION public.current_is_super_admin() RETURNS boolean
LANGUAGE sql AS $$ SELECT false $$;

-- capability registry (mirrors 20260711000002 DDL, which predates this suite)
CREATE TABLE public.capabilities (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('page','feature')),
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.role_capabilities (
  role text NOT NULL CHECK (role IN ('super_admin','admin','modeler','user')),
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability_key)
);
INSERT INTO public.capabilities (key, kind, label) VALUES ('ai_chat', 'feature', 'AI Assistant');
INSERT INTO public.role_capabilities (role, capability_key, allowed) VALUES
  ('super_admin','ai_chat',true), ('admin','ai_chat',true),
  ('modeler','ai_chat',true), ('user','ai_chat',true);

-- capability RESOLVER stub for the §13.2 checkpoint-4 checks: the real
-- get_my_capabilities ships in 20260711000002 (out of this suite's scope);
-- the Stage 1 migration only calls it at runtime. USER_A holds agent_apply,
-- USER_B holds agent_proposals only — the §13.1 modeler-vs-user split.
CREATE TABLE public.eval_user_caps (user_id uuid PRIMARY KEY, caps jsonb NOT NULL);
CREATE FUNCTION public.get_my_capabilities(_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT caps FROM public.eval_user_caps WHERE user_id = _user_id),
    '{"is_super_admin": false, "features": {}}'::jsonb);
$$;
INSERT INTO public.eval_user_caps VALUES
  ('${USER_A}', '{"is_super_admin": false, "features": {"agent_apply": true, "agent_proposals": true, "data_editing": true}}'),
  ('${USER_B}', '{"is_super_admin": false, "features": {"agent_apply": false, "agent_proposals": true}}');

-- item-master tables (20260614000001 slice) so the write-RPC migration —
-- applied VERBATIM below — runs against the real column set.
CREATE TABLE public.materials (
  project_id uuid NOT NULL, material_id text NOT NULL, name text,
  cost numeric, holding_cost_pct numeric, moq numeric, initial_on_hand numeric,
  lead_time_dist text, lead_time_cv numeric,
  updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, material_id)
);
CREATE TABLE public.products (
  project_id uuid NOT NULL, product_id text NOT NULL, name text,
  sell_price numeric, production_capacity numeric, fulfillment_mode text,
  demand_distribution text, demand_mean numeric, demand_cv numeric,
  updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, product_id)
);
CREATE TABLE public.suppliers (
  project_id uuid NOT NULL, supplier_id text NOT NULL, name text,
  capacity_per_week numeric, reliability_score numeric NOT NULL DEFAULT 1.0,
  updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, supplier_id)
);
`;

function createProposalSql(idem: string, opts?: { grounding?: string; userId?: string; status?: string; agent?: string; artifact?: string }): string {
  return `SELECT public.create_agent_proposal(
    '${PROJECT}', '${opts?.agent ?? "data-steward"}', '${opts?.artifact ?? "item_master_diff"}',
    'Eval proposal ${idem}', '{"schema_version":1,"rows":[]}'::jsonb, '[]'::jsonb,
    'deterministic', '${opts?.grounding ?? "{}"}'::jsonb, '${idem}',
    NULL, 'gemini-2.5-flash', 'gemini', '${opts?.userId ?? USER_A}', 'a@example.com',
    '${opts?.status ?? "proposed"}');`;
}

Deno.test("Stage 0 + M0 migrations against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if ((Deno.env.get("EVAL_REQUIRE_DB") ?? "") === "1") {
      throw new Error("EVAL_REQUIRE_DB=1 but no Postgres binaries were found");
    }
    console.warn("%cSKIP: no Postgres binaries — DB-backed RPC assertions not run", "color: yellow");
    return;
  }

  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of [
        "20260702000001_item_master_write_rpcs.sql",
        "20260715000001_agent_proposals.sql",
        "20260715000002_agent_telemetry.sql",
        "20260715000003_agent_capabilities.sql",
        "20260717000001_chat_store.sql",
        "20260718000001_stage1_agent_rights_and_summary.sql",
      ]) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    // ── proposal fabric: state machine + idempotency (§4.1/§4.2) ────────────
    let idA = "";
    await t.step("create converges on idempotency key (duplicate ⇒ same id)", async () => {
      idA = await db.sql(createProposalSql("idem-1"));
      const again = await db.sql(createProposalSql("idem-1"));
      assertEquals(again, idA, "idempotency hit must return the existing live id");
    });

    await t.step("create rejects terminal statuses and foreign artifact pairings", async () => {
      const e1 = await db.sqlExpectError(createProposalSql("idem-bad", { status: "applied" }));
      assertStringIncludes(e1, "status must be draft or proposed");
      const e2 = await db.sqlExpectError(createProposalSql("idem-bad2", { artifact: "policy_bundle_diff" }));
      assertStringIncludes(e2, "proposals_agent_owns_artifact");
      const e3 = await db.sqlExpectError(
        createProposalSql("idem-bad3").replace(PROJECT, "99999999-9999-4999-8999-999999999999"),
      );
      assertStringIncludes(e3, "not found");
    });

    await t.step("review: checkpoint 4 — approve needs agent_apply, fail closed (§13.2)", async () => {
      // USER_B holds agent_proposals but NOT agent_apply: sees the card,
      // cannot approve (typed failure) — the Stage 1 acceptance case.
      const denied = await db.sqlExpectError(
        `SELECT public.review_agent_proposal('${idA}', 'approve', '${USER_B}');`,
      );
      assertStringIncludes(denied, "forbidden: approve requires the agent_apply capability");
      // No asserted user resolves to no grants ⇒ forbidden (fail closed).
      const anon = await db.sqlExpectError(`SELECT public.review_agent_proposal('${idA}', 'approve');`);
      assertStringIncludes(anon, "forbidden");
      assertEquals(await db.sql(`SELECT status FROM public.proposals WHERE id='${idA}';`), "proposed");
      // USER_B may still reject (agent_proposals).
      const idRej = await db.sql(createProposalSql("idem-userb-reject", { userId: USER_B }));
      await db.sql(`SELECT public.review_agent_proposal('${idRej}', 'reject', '${USER_B}', NULL, 'not needed');`);
      assertEquals(await db.sql(`SELECT status FROM public.proposals WHERE id='${idRej}';`), "rejected");
    });

    await t.step("review: proposed → approved → rejected; wrong-state actions raise", async () => {
      await db.sql(`SELECT public.review_agent_proposal('${idA}', 'approve', '${USER_A}', 'a@example.com', NULL);`);
      assertEquals(
        await db.sql(`SELECT status || '|' || COALESCE(reviewed_by::text,'') FROM public.proposals WHERE id='${idA}';`),
        `approved|${USER_A}`,
      );
      // §4.2 side effect: the approve event lands in ai_chat_events.
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.ai_chat_events
                      WHERE proposal_id='${idA}' AND event_kind='proposal.approved';`),
        "1",
      );
      const e1 = await db.sqlExpectError(`SELECT public.review_agent_proposal('${idA}', 'approve', '${USER_A}');`);
      assertStringIncludes(e1, "approve requires status=proposed");
      const e2 = await db.sqlExpectError(`SELECT public.review_agent_proposal('${idA}', 'propose');`);
      assertStringIncludes(e2, "propose requires status=draft");
      await db.sql(`SELECT public.review_agent_proposal('${idA}', 'reject', '${USER_A}', NULL, 'changed my mind');`);
      assertEquals(
        await db.sql(`SELECT status || '|' || status_reason FROM public.proposals WHERE id='${idA}';`),
        "rejected|changed my mind",
      );
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.ai_chat_events
                      WHERE proposal_id='${idA}' AND event_kind='proposal.rejected';`),
        "1",
      );
    });

    await t.step("draft → proposed via action=propose", async () => {
      const idDraft = await db.sql(createProposalSql("idem-draft", { status: "draft" }));
      await db.sql(`SELECT public.review_agent_proposal('${idDraft}', 'propose');`);
      assertEquals(await db.sql(`SELECT status FROM public.proposals WHERE id='${idDraft}';`), "proposed");
    });

    let idB = "";
    await t.step("apply markers are service-role-only (single-writer, A11)", async () => {
      idB = await db.sql(createProposalSql("idem-2"));
      await db.sql(`SELECT public.review_agent_proposal('${idB}', 'approve', '${USER_A}');`);
      for (const role of ["anon", "authenticated"]) {
        const err = await db.sqlExpectError(
          `SELECT public.mark_agent_proposal_applied('${idB}', '{}'::jsonb);`, { role },
        );
        assertStringIncludes(err, "permission denied", `${role} must not mark applied`);
        const err2 = await db.sqlExpectError(
          `SELECT public.mark_agent_proposal_apply_failed('${idB}', 'x');`, { role },
        );
        assertStringIncludes(err2, "permission denied", `${role} must not mark apply-failed`);
      }
      await db.sql(
        `SELECT public.mark_agent_proposal_apply_failed('${idB}', 'gate_blocked: findings attached');`,
        { role: "service_role" },
      );
      assertEquals(
        await db.sql(`SELECT status || '|' || apply_attempts || '|' || apply_error FROM public.proposals WHERE id='${idB}';`),
        "approved|1|gate_blocked: findings attached",
      );
      await db.sql(
        `SELECT public.mark_agent_proposal_applied('${idB}', '{"before":{}}'::jsonb);`,
        { role: "service_role" },
      );
      assertEquals(
        await db.sql(`SELECT status || '|' || (applied_at IS NOT NULL) || '|' || COALESCE(apply_error,'') FROM public.proposals WHERE id='${idB}';`),
        "applied|true|",
      );
      // idempotent re-mark: applied is terminal, the second call is a no-op
      await db.sql(`SELECT public.mark_agent_proposal_applied('${idB}', '{"other":1}'::jsonb);`, { role: "service_role" });
      assertEquals(
        await db.sql(`SELECT applied_result::text FROM public.proposals WHERE id='${idB}';`),
        '{"before": {}}',
      );
    });

    await t.step("terminal idempotency key frees the unique live slot", async () => {
      const idB2 = await db.sql(createProposalSql("idem-2"));
      assert(idB2 !== idB, "a terminal (applied) row must not swallow a new draft with the same key");
    });

    await t.step("supersede expires the old card and links the new one", async () => {
      const idOld = await db.sql(createProposalSql("idem-supersede"));
      const idNew = await db.sql(createProposalSql("idem-supersede-2"));
      await db.sql(`SELECT public.supersede_agent_proposal('${idOld}', '${idNew}');`);
      assertEquals(
        await db.sql(`SELECT status || '|' || status_reason || '|' || superseded_by FROM public.proposals WHERE id='${idOld}';`),
        `expired|superseded|${idNew}`,
      );
    });

    await t.step("expire: ttl and grounding drift (§4.2, §8 T8)", async () => {
      const idTtl = await db.sql(createProposalSql("idem-ttl"));
      await db.sql(`UPDATE public.proposals SET expires_at = now() - interval '1 hour' WHERE id='${idTtl}';`);
      const idDrift = await db.sql(createProposalSql("idem-drift", { grounding: '{"policy_hash":"h1"}' }));
      // matching hash ⇒ no drift expiry
      await db.sql(`SET eval.policy_hash TO 'h1'; SELECT public.expire_agent_proposals('${PROJECT}');`);
      assertEquals(await db.sql(`SELECT status FROM public.proposals WHERE id='${idDrift}';`), "proposed");
      assertEquals(
        await db.sql(`SELECT status || '|' || status_reason FROM public.proposals WHERE id='${idTtl}';`),
        "expired|ttl",
      );
      // drifted hash ⇒ grounding_drift
      await db.sql(`SET eval.policy_hash TO 'h2'; SELECT public.expire_agent_proposals('${PROJECT}');`);
      assertEquals(
        await db.sql(`SELECT status || '|' || status_reason FROM public.proposals WHERE id='${idDrift}';`),
        "expired|grounding_drift",
      );
    });

    await t.step("list_agent_proposals sweeps lazily and filters by status", async () => {
      const n = await db.sql(`SET eval.policy_hash TO 'h2'; SELECT count(*) FROM public.list_agent_proposals('${PROJECT}', 'applied');`);
      assertEquals(n, "1");
      const total = await db.sql(`SET eval.policy_hash TO 'h2'; SELECT count(*) FROM public.list_agent_proposals('${PROJECT}', NULL);`);
      assert(Number(total) >= 7, `expected all eval proposals, got ${total}`);
    });

    await t.step("per-user live-proposal cap (§8 T10, DEFAULT 20)", async () => {
      await db.sql(`DO $$ BEGIN FOR i IN 1..20 LOOP
        PERFORM public.create_agent_proposal(
          '${PROJECT}', 'data-steward', 'item_master_diff', 'cap ' || i,
          '{}'::jsonb, '[]'::jsonb, 'deterministic', '{}'::jsonb, 'cap-' || i,
          NULL, NULL, NULL, '${USER_B}', NULL, 'proposed');
      END LOOP; END $$;`);
      const err = await db.sqlExpectError(createProposalSql("cap-21", { userId: USER_B }));
      assertStringIncludes(err, "too_large");
    });

    await t.step("clients cannot write proposals directly (RPC-only posture)", async () => {
      const err = await db.sqlExpectError(
        `INSERT INTO public.proposals (project_id, agent_id, artifact_type, title, payload, provenance, idempotency_key)
         VALUES ('${PROJECT}', 'data-steward', 'item_master_diff', 'x', '{}'::jsonb, 'deterministic', 'direct-1');`,
        { role: "anon" },
      );
      assertStringIncludes(err, "permission denied");
    });

    // ── telemetry (§7.1) ─────────────────────────────────────────────────────
    await t.step("record_proposal_viewed writes exactly one typed event", async () => {
      await db.sql(`SELECT public.record_proposal_viewed('${idB}', '${USER_A}');`);
      assertEquals(
        await db.sql(`SELECT event_kind || '|' || project_id || '|' || (payload->>'artifact_type')
                      FROM public.ai_chat_events
                      WHERE proposal_id='${idB}' AND event_kind='proposal.viewed';`),
        `proposal.viewed|${PROJECT}|item_master_diff`,
      );
      const err = await db.sqlExpectError(`SELECT public.record_proposal_viewed('99999999-9999-4999-8999-999999999999');`);
      assertStringIncludes(err, "not found");
    });

    await t.step("event_kind is a closed set; prune is service-role-only", async () => {
      const err = await db.sqlExpectError(
        `INSERT INTO public.ai_chat_events (event_kind) VALUES ('made.up');`,
      );
      assertStringIncludes(err, "ai_chat_events_event_kind_check");
      const err2 = await db.sqlExpectError(`SELECT public.prune_ai_chat_events(180);`, { role: "anon" });
      assertStringIncludes(err2, "permission denied");
      const total = await db.sql(`SELECT count(*) FROM public.ai_chat_events;`);
      await db.sql(`UPDATE public.ai_chat_events SET created_at = now() - interval '181 days';`);
      assertEquals(await db.sql(`SELECT public.prune_ai_chat_events(180);`, { role: "service_role" }), total);
    });

    // ── capability seeds (§13.1 + §14.7) ─────────────────────────────────────
    await t.step("capability rows + role defaults match the §13.1/§14.7 seeding", async () => {
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.capabilities WHERE key IN
          ('agent_proposals','agent_apply','agent_data_steward','agent_policy_configurator',
           'agent_vv_analyst','agent_experiment_designer','agent_explainer','chat_history_sync');`),
        "8",
      );
      // agent_proposals follows ai_chat (true for every role in this fixture)
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.role_capabilities WHERE capability_key='agent_proposals' AND allowed;`),
        "4",
      );
      assertEquals(
        await db.sql(`SELECT string_agg(role, ',' ORDER BY role) FROM public.role_capabilities
                      WHERE capability_key='agent_apply' AND allowed;`),
        "admin,modeler,super_admin",
      );
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.role_capabilities
                      WHERE capability_key LIKE 'agent\\_%' AND capability_key NOT IN ('agent_proposals','agent_apply') AND allowed;`),
        "0",
        "per-agent keys seed OFF until their stage GAs",
      );
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.role_capabilities WHERE capability_key='chat_history_sync' AND allowed;`),
        "0",
        "chat_history_sync seeds OFF at M0 landing (§10 Q19)",
      );
    });

    // ── chat store (§14.1/§14.7 M0) ──────────────────────────────────────────
    await t.step("quick-thread id derivation: TS and SQL agree exactly", async () => {
      const ts = await quickThreadServerId(USER_A);
      const sql = await db.sql(`SELECT public.chat_quick_thread_id('${USER_A}');`);
      assertEquals(sql, ts);
    });

    let importPayload = "";
    let fixtureThreads: LocalThreadLike[] = [];
    await t.step("import_local_threads: lossless on the seeded fixture", async () => {
      const fixture = JSON.parse(
        await Deno.readTextFile(new URL("./fixtures/local-threads.json", import.meta.url)),
      );
      fixtureThreads = fixture.threads as LocalThreadLike[];
      importPayload = JSON.stringify(serializeThreadsForImport(fixtureThreads));
      assert(!importPayload.includes("$json$"), "fixture must not break dollar quoting");
      const res = JSON.parse(await db.sql(
        `SELECT public.import_local_threads('${USER_A}', $json$${importPayload}$json$::jsonb);`,
      ));
      assertEquals(res.imported, 3);
      assertEquals(res.skipped, 0);

      const quickId = await quickThreadServerId(USER_A);
      const mapById = new Map(res.mappings.map((m: { local_id: string; server_id: string }) => [m.local_id, m.server_id]));
      assertEquals(mapById.get("quick"), quickId, "quick maps to the deterministic id");
      assertEquals(mapById.get("33333333-3333-4333-8333-333333333333"), "33333333-3333-4333-8333-333333333333");
      assert(isUuidLike(String(mapById.get("k3xy9ab2"))), "legacy id maps to a derived uuid");

      // Content losslessness: every message survives with role/content/parts/
      // tool_calls/order/timestamp intact.
      for (const thread of fixtureThreads) {
        const serverId = mapById.get(thread.id) as string;
        const rows = JSON.parse(await db.sql(
          `SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'seq', seq, 'role', role, 'content', content,
             'parts', parts, 'toolCalls', tool_calls,
             'createdAt', round(extract(epoch from created_at) * 1000)::bigint
           ) ORDER BY seq), '[]'::jsonb)
           FROM public.chat_messages WHERE thread_id = '${serverId}';`,
        ));
        const expected = thread.messages.map((m, i) => ({
          seq: i + 1,
          role: m.role,
          content: m.content,
          parts: m.parts ?? [],
          toolCalls: m.toolCalls ?? [],
          createdAt: m.createdAt,
        }));
        assertEquals(rows, expected, `thread ${thread.id} messages must round-trip losslessly`);
      }

      // Thread metadata: title, project, persona, recency.
      assertEquals(
        await db.sql(`SELECT title || '|' || project_id || '|' || persona_id ||  '|' ||
                        round(extract(epoch from last_message_at) * 1000)::bigint
                      FROM public.chat_threads WHERE id = '33333333-3333-4333-8333-333333333333';`),
        `Supplier exposure review|${PROJECT}|risk-analyst|1720003000000`,
      );
    });

    await t.step("import is idempotent by thread id (re-run imports nothing)", async () => {
      const res = JSON.parse(await db.sql(
        `SELECT public.import_local_threads('${USER_A}', $json$${importPayload}$json$::jsonb);`,
      ));
      assertEquals(res.imported, 0);
      assertEquals(res.skipped, 3);
      assertEquals(await db.sql(`SELECT count(*) FROM public.chat_threads WHERE user_id='${USER_A}';`), "3");
    });

    const threadId = "33333333-3333-4333-8333-333333333333";
    await t.step("append_chat_message: dense seq, content cap, owner-only", async () => {
      const seq = await db.sql(
        `SELECT public.append_chat_message('${USER_A}', '${threadId}', 'assistant', 'Tier-2 view coming right up.');`,
      );
      assertEquals(seq, "4", "seq continues densely after import");
      const err = await db.sqlExpectError(
        `SELECT public.append_chat_message('${USER_B}', '${threadId}', 'user', 'not mine');`,
      );
      assertStringIncludes(err, "forbidden");
      const capped = await db.sql(
        `SELECT public.append_chat_message('${USER_A}', '${threadId}', 'user', repeat('x', 40000));
         SELECT char_length(content) FROM public.chat_messages WHERE thread_id='${threadId}' AND seq=5;`,
      );
      assertEquals(capped.split("\n").pop(), "32000");
    });

    await t.step("thread flags: NULL keeps; move requires an owned folder", async () => {
      await db.sql(`SELECT public.set_thread_flags('${threadId}', true, NULL, '${USER_A}');`);
      assertEquals(
        await db.sql(`SELECT pinned || '|' || archived FROM public.chat_threads WHERE id='${threadId}';`),
        "true|false",
      );
      const folderId = await db.sql(`SELECT public.create_chat_folder('${USER_A}', 'Q3 stress review', 0);`);
      await db.sql(`SELECT public.move_chat_thread('${threadId}', '${folderId}', '${USER_A}');`);
      assertEquals(await db.sql(`SELECT folder_id FROM public.chat_threads WHERE id='${threadId}';`), folderId);
      const foreign = await db.sql(`SELECT public.create_chat_folder('${USER_B}', 'Not yours', 0);`);
      const err = await db.sqlExpectError(
        `SELECT public.move_chat_thread('${threadId}', '${foreign}', '${USER_A}');`,
      );
      assertStringIncludes(err, "not found");
    });

    await t.step("search_chat_messages: owner-scoped FTS (§14.5)", async () => {
      const hits = await db.sql(
        `SELECT count(*) FROM public.search_chat_messages('${USER_A}', 'supplier lead times');`,
      );
      assert(Number(hits) >= 1, "owner finds their own message");
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.search_chat_messages('${USER_B}', 'supplier lead times');`),
        "0",
        "FTS never crosses the owner boundary",
      );
    });

    await t.step("RLS: direct reads are owner-bounded; anon sees nothing", async () => {
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.chat_messages;`, { role: "anon" }),
        "0",
        "no user context ⇒ no rows",
      );
      assertEquals(
        await db.sql(
          `SELECT set_config('app.current_user_id', '${USER_A}', false); SELECT count(*) > 0 FROM public.chat_threads;`,
          { role: "anon" },
        ).then((s) => s.split("\n").pop()),
        "t",
        "owner context ⇒ own rows visible",
      );
    });

    // ── Stage 1: write-RPC semantics the apply path leans on (§4.4) ──────────
    await t.step("bulk_upsert_materials: full-row upsert — NULL clears; enum CHECK rejects", async () => {
      await db.sql(`INSERT INTO public.materials (project_id, material_id, name, cost, moq)
                    VALUES ('${PROJECT}', 'MAT-1', 'Resin A', NULL, 100);`);
      // a full-row payload built by merging the diff onto `before` keeps moq
      await db.sql(`SELECT public.bulk_upsert_materials('${PROJECT}', '[
        {"material_id":"MAT-1","name":"Resin A","cost":"3.75","holding_cost_pct":null,
         "moq":"100","initial_on_hand":null,"lead_time_dist":null,"lead_time_cv":null}]'::jsonb);`);
      assertEquals(
        await db.sql(`SELECT cost || '|' || moq FROM public.materials
                      WHERE project_id='${PROJECT}' AND material_id='MAT-1';`),
        "3.75|100",
      );
      // …while a PARTIAL payload would clear untouched columns — the reason
      // agent-apply must merge before calling (§4.4 step 3):
      await db.sql(`SELECT public.bulk_upsert_materials('${PROJECT}', '[
        {"material_id":"MAT-1","cost":"3.75"}]'::jsonb);`);
      assertEquals(
        await db.sql(`SELECT cost || '|' || COALESCE(moq::text,'NULL') FROM public.materials
                      WHERE project_id='${PROJECT}' AND material_id='MAT-1';`),
        "3.75|NULL",
        "partial payloads clear — full-row merge is mandatory",
      );
      const enumErr = await db.sqlExpectError(
        `SELECT public.bulk_upsert_products('${PROJECT}', '[
          {"product_id":"P-2","fulfillment_mode":"ato"}]'::jsonb);`,
      );
      assertStringIncludes(enumErr, "engine accepts: mto, mts (ato is not yet runnable)");
    });

    // ── M1: rolling-summary write / delete (§14.3) ──────────────────────────
    await t.step("set_thread_summary: owner-checked write, 4000-char cap, delete resets", async () => {
      await db.sql(`SELECT public.set_thread_summary('${threadId}', '${USER_A}', 'S3 is strategic for MAT-17.', 18);`);
      assertEquals(
        await db.sql(`SELECT summary || '|' || summary_upto_seq FROM public.chat_threads WHERE id='${threadId}';`),
        "S3 is strategic for MAT-17.|18",
      );
      const foreign = await db.sqlExpectError(
        `SELECT public.set_thread_summary('${threadId}', '${USER_B}', 'not yours', 1);`,
      );
      assertStringIncludes(foreign, "forbidden");
      const capped = await db.sql(
        `SELECT public.set_thread_summary('${threadId}', '${USER_A}', repeat('x', 5000), 20);
         SELECT char_length(summary) FROM public.chat_threads WHERE id='${threadId}';`,
      );
      assertEquals(capped.split("\n").pop(), "4000");
      // user deletes ⇒ summary NULL, summary_upto_seq 0 (§14.3 integrity)
      await db.sql(`SELECT public.set_thread_summary('${threadId}', '${USER_A}', NULL, 0);`);
      assertEquals(
        await db.sql(`SELECT COALESCE(summary,'NULL') || '|' || summary_upto_seq FROM public.chat_threads WHERE id='${threadId}';`),
        "NULL|0",
      );
    });

    await t.step("delete_chat_thread cascades messages (right to erase)", async () => {
      await db.sql(`SELECT public.delete_chat_thread('${threadId}', '${USER_A}');`);
      assertEquals(await db.sql(`SELECT count(*) FROM public.chat_messages WHERE thread_id='${threadId}';`), "0");
    });
  } finally {
    await db.stop();
  }
});

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
