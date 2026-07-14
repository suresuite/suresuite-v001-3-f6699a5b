// DB-backed deterministic tier for v1.2 Phase 3 (ai-agents.md §7.4 tier 1):
// boots a scratch Postgres, applies the proposal/telemetry/capability/chat
// migrations plus the NEW 20260723000001_reports_and_file_workspace.sql
// VERBATIM (against a storage-schema stand-in), and asserts:
//   * the proposals CHECK swap: ('report-builder','decision_report') accepted,
//     mismatched pairings still rejected (the closed pairing stays closed);
//   * review_agent_proposal checkpoint 4: approving a decision_report needs
//     agent_proposals + reports and NOT agent_apply; every other artifact
//     still demands agent_apply (§13.3);
//   * user_files: create_user_file is service-path only; list_user_files is
//     owner-scoped and lazily sweeps; sweep_expired_files deletes ROW AND
//     STORAGE OBJECT for unretained expired files only (retained files are
//     never auto-deleted) and emits file.expired; set_file_retained enforces
//     the 500 MB per-user cap IN SQL (typed 'retention_cap') and emits
//     file.kept; delete_user_file removes row + object;
//   * admin_org_file_usage aggregates per org (count, bytes, expiring-7d);
//   * the ai_chat_events CHECK gains exactly the four §16.3 kinds;
//   * capability seeds: reports follows ai_chat; agent_report_builder OFF
//     everywhere at landing (the Q19 discipline);
//   * the private 'workspace' bucket row exists with public=false.
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG_A = "99999999-9999-4999-8999-999999999901";
const ORG_B = "99999999-9999-4999-8999-999999999902";
/** reports + agent_proposals, NO agent_apply — the §13.3 decision_report reviewer. */
const REPORTER = "22222222-2222-4222-8222-222222222201";
/** agent_apply + agent_proposals, NO reports — can apply mutations, not renders. */
const APPLIER = "22222222-2222-4222-8222-222222222202";
/** second org's user for the rollup. */
const OTHER = "22222222-2222-4222-8222-222222222203";

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

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text
);
INSERT INTO public.organizations (id, name) VALUES
  ('${ORG_A}', 'Org Alpha'), ('${ORG_B}', 'Org Beta');

CREATE TABLE public.approved_users (
  id uuid PRIMARY KEY,
  organization_id uuid,
  email text
);
INSERT INTO public.approved_users (id, organization_id, email) VALUES
  ('${REPORTER}', '${ORG_A}', 'reporter@example.com'),
  ('${APPLIER}',  '${ORG_A}', 'applier@example.com'),
  ('${OTHER}',    '${ORG_B}', 'other@example.com');

CREATE FUNCTION public.get_current_user_id() RETURNS uuid
LANGUAGE sql AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
CREATE FUNCTION public.current_is_super_admin() RETURNS boolean
LANGUAGE sql AS $$ SELECT false $$;
-- Per-user grant stand-in: the reporter holds reports (no agent_apply); the
-- applier holds agent_apply (no reports).
CREATE FUNCTION public.get_my_capabilities(_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN _user_id = '${REPORTER}'::uuid THEN
      '{"is_super_admin": false, "features": {"agent_proposals": true, "reports": true}}'::jsonb
    WHEN _user_id = '${APPLIER}'::uuid THEN
      '{"is_super_admin": false, "features": {"agent_proposals": true, "agent_apply": true}}'::jsonb
    ELSE '{"is_super_admin": false, "features": {}}'::jsonb
  END;
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
  ('modeler','ai_chat',true), ('user','ai_chat',false);

-- Supabase storage stand-in: the §16.2 bucket + objects the sweep deletes.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL
);
`;

const MIGRATIONS = [
  "20260715000001_agent_proposals.sql",
  "20260715000002_agent_telemetry.sql",
  "20260715000003_agent_capabilities.sql",
  "20260717000001_chat_store.sql",
  "20260717000002_chat_quick_thread_id_sha256.sql",
  "20260718000001_stage1_agent_rights_and_summary.sql",
  "20260721000001_chat_modes_and_ui_events.sql",
  "20260723000001_reports_and_file_workspace.sql",
];

const MB = 1024 * 1024;

Deno.test("Phase 3 reports/file-workspace migration against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if (Deno.env.get("EVAL_REQUIRE_DB") === "1") throw new Error("Postgres binaries required (EVAL_REQUIRE_DB=1)");
    console.warn("skipping DB-backed Phase 3 suite: no Postgres binaries found");
    return;
  }
  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of MIGRATIONS) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    await t.step("the private 'workspace' bucket exists (public=false — no public bucket)", async () => {
      assertEquals(
        (await db.sql(`SELECT public FROM storage.buckets WHERE id = 'workspace';`)).trim(),
        "f",
      );
    });

    await t.step("proposals CHECK swap: the ('report-builder','decision_report') pairing inserts; mismatches still reject", async () => {
      const id = await db.sql(`
        SELECT public.create_agent_proposal(
          '${PROJECT}', 'report-builder', 'decision_report', 'Outage brief',
          '{"schema_version":1,"template_id":"disruption-brief","format":"pdf","sections":[]}'::jsonb,
          '[]'::jsonb, 'llm_drafted', '{}'::jsonb, 'idem-report-1',
          NULL, NULL, NULL, '${REPORTER}'::uuid, 'reporter@example.com', 'proposed');
      `);
      assert(id.trim().length === 36, "proposal created");
      const err = await db.sqlExpectError(`
        INSERT INTO public.proposals (project_id, agent_id, artifact_type, title, payload, provenance, idempotency_key)
        VALUES ('${PROJECT}', 'report-builder', 'experiment_spec', 'wrong pairing', '{}'::jsonb, 'llm_drafted', 'idem-bad');
      `);
      assertStringIncludes(err, "proposals_agent_owns_artifact");
    });

    await t.step("checkpoint 4 (§13.3): reports (not agent_apply) approves a decision_report; agent_apply users without reports cannot; other artifacts still demand agent_apply", async () => {
      const reportId = (await db.sql(`
        SELECT id FROM public.proposals WHERE artifact_type = 'decision_report' LIMIT 1;
      `)).trim();

      // The applier (agent_apply, no reports) is refused — typed, fail closed.
      const deniedApplier = await db.sqlExpectError(`
        SELECT public.review_agent_proposal('${reportId}', 'approve', '${APPLIER}'::uuid);
      `);
      assertStringIncludes(deniedApplier, "reports");

      // The reporter (agent_proposals + reports, NO agent_apply) approves.
      await db.sql(`SELECT public.review_agent_proposal('${reportId}', 'approve', '${REPORTER}'::uuid);`);
      assertEquals(
        (await db.sql(`SELECT status FROM public.proposals WHERE id = '${reportId}';`)).trim(),
        "approved",
      );

      // The same reporter CANNOT approve a mutation artifact (agent_apply rule
      // unchanged for every other row).
      const specId = await db.sql(`
        SELECT public.create_agent_proposal(
          '${PROJECT}', 'experiment-designer', 'experiment_spec', 'Run baseline',
          '{"schema_version":1}'::jsonb, '[]'::jsonb, 'llm_drafted', '{}'::jsonb,
          'idem-spec-1', NULL, NULL, NULL, '${REPORTER}'::uuid, NULL, 'proposed');
      `);
      const deniedReporter = await db.sqlExpectError(`
        SELECT public.review_agent_proposal('${specId.trim()}', 'approve', '${REPORTER}'::uuid);
      `);
      assertStringIncludes(deniedReporter, "agent_apply");
    });

    await t.step("create_user_file is service-path only (REVOKEd from anon/authenticated)", async () => {
      const err = await db.sqlExpectError(
        `SELECT public.create_user_file('${REPORTER}'::uuid, 'report_pdf', 'x.pdf', 'org/x/user/y/shared/z__x.pdf', 10);`,
        { role: "anon" },
      );
      assertStringIncludes(err, "permission denied");
    });

    await t.step("user_files lifecycle: insert (service), owner-scoped list, org resolution from approved_users", async () => {
      const mk = (user: string, org: string, name: string, bytes: number, expiresSql: string, id: string) => `
        SELECT public.create_user_file('${user}'::uuid, 'report_pdf', '${name}',
          'org/${org}/user/${user}/${PROJECT}/${id}__${name}', ${bytes},
          NULL, '${PROJECT}'::uuid, NULL, ${expiresSql}, '${id}'::uuid);
      `;
      // reporter: one live file + one expired unretained + one expired-but-kept
      await db.sql(mk(REPORTER, ORG_A, "live.pdf", 100 * MB, "now() + interval '10 days'", "aaaaaaaa-0000-4000-8000-000000000001"));
      await db.sql(mk(REPORTER, ORG_A, "old.pdf", 10 * MB, "now() - interval '1 day'", "aaaaaaaa-0000-4000-8000-000000000002"));
      await db.sql(mk(REPORTER, ORG_A, "kept.pdf", 20 * MB, "now() - interval '1 day'", "aaaaaaaa-0000-4000-8000-000000000003"));
      await db.sql(`UPDATE public.user_files SET retained = true WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';`);
      // the other org's user
      await db.sql(mk(OTHER, ORG_B, "beta.pdf", 5 * MB, "now() + interval '2 days'", "aaaaaaaa-0000-4000-8000-000000000004"));
      // storage object stand-ins for every path
      await db.sql(`
        INSERT INTO storage.objects (bucket_id, name)
        SELECT 'workspace', path FROM public.user_files;
      `);
      assertEquals(
        (await db.sql(`SELECT org_id FROM public.user_files WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';`)).trim(),
        ORG_A,
        "org_id resolved from approved_users when not passed",
      );
    });

    await t.step("retention law: list sweeps the expired unretained file — row AND storage object gone; the Kept file survives; file.expired emitted", async () => {
      const listed = await db.sql(
        `SELECT name FROM public.list_user_files('${REPORTER}'::uuid, NULL) ORDER BY name;`,
      );
      assertEquals(listed.split("\n").map((s) => s.trim()).filter(Boolean), ["kept.pdf", "live.pdf"],
        "expired unretained file is gone from the listing; the Kept file is never auto-deleted");
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.user_files WHERE name = 'old.pdf';`)).trim(),
        "0", "row deleted",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM storage.objects WHERE name LIKE '%old.pdf';`)).trim(),
        "0", "storage object deleted — the retention delete removes BOTH",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM storage.objects WHERE name LIKE '%kept.pdf';`)).trim(),
        "1", "the Kept object untouched",
      );
      assertEquals(
        (await db.sql(
          `SELECT count(*) FROM public.ai_chat_events WHERE event_kind = 'file.expired'
             AND payload->>'file_id' = 'aaaaaaaa-0000-4000-8000-000000000002';`,
        )).trim(),
        "1", "§16.3 file.expired emitted with structured ids",
      );
    });

    await t.step("set_file_retained: the 500 MB per-user cap fails typed IN SQL; file.kept emitted; other users unaffected", async () => {
      // A 450 MB file + the 20 MB kept file: keeping 100 MB more breaches 500 MB.
      await db.sql(`
        SELECT public.create_user_file('${REPORTER}'::uuid, 'report_xlsx', 'big.xlsx',
          'org/${ORG_A}/user/${REPORTER}/${PROJECT}/aaaaaaaa-0000-4000-8000-000000000005__big.xlsx',
          ${450 * MB}, NULL, '${PROJECT}'::uuid, NULL, NULL, 'aaaaaaaa-0000-4000-8000-000000000005'::uuid);
      `);
      await db.sql(`SELECT public.set_file_retained('aaaaaaaa-0000-4000-8000-000000000005', '${REPORTER}'::uuid, true);`);
      const err = await db.sqlExpectError(
        `SELECT public.set_file_retained('aaaaaaaa-0000-4000-8000-000000000001', '${REPORTER}'::uuid, true);`,
      );
      assertStringIncludes(err, "retention_cap");
      assertEquals(
        (await db.sql(`SELECT retained FROM public.user_files WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';`)).trim(),
        "f", "the over-cap Keep changed nothing",
      );
      assertEquals(
        (await db.sql(
          `SELECT count(*) FROM public.ai_chat_events WHERE event_kind = 'file.kept'
             AND payload->>'file_id' = 'aaaaaaaa-0000-4000-8000-000000000005';`,
        )).trim(),
        "1",
      );
      // A different user's Keep is measured against THEIR bytes only.
      await db.sql(`SELECT public.set_file_retained('aaaaaaaa-0000-4000-8000-000000000004', '${OTHER}'::uuid, true);`);
      // Ownership: a non-owner cannot touch the file.
      const foreign = await db.sqlExpectError(
        `SELECT public.set_file_retained('aaaaaaaa-0000-4000-8000-000000000001', '${OTHER}'::uuid, true);`,
      );
      assertStringIncludes(foreign, "not found");
    });

    await t.step("delete_user_file removes row AND storage object (owner only)", async () => {
      const foreign = await db.sqlExpectError(
        `SELECT public.delete_user_file('aaaaaaaa-0000-4000-8000-000000000001', '${OTHER}'::uuid);`,
      );
      assertStringIncludes(foreign, "not found");
      await db.sql(`SELECT public.delete_user_file('aaaaaaaa-0000-4000-8000-000000000001', '${REPORTER}'::uuid);`);
      assertEquals(
        (await db.sql(`SELECT count(*) FROM public.user_files WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';`)).trim(),
        "0",
      );
      assertEquals(
        (await db.sql(`SELECT count(*) FROM storage.objects WHERE name LIKE '%live.pdf';`)).trim(),
        "0",
      );
    });

    await t.step("admin_org_file_usage: per-org count/bytes/expiring-7d roll up on user_files.org_id", async () => {
      // Remaining: ORG_A = kept.pdf (20 MB, retained) + big.xlsx (450 MB,
      // retained); ORG_B = beta.pdf (5 MB, retained now, expires in 2 days —
      // retained files never count as expiring).
      const rows = await db.sql(`
        SELECT org_name, file_count, total_bytes, retained_bytes, expiring_7d
          FROM public.admin_org_file_usage ORDER BY org_name;
      `);
      const lines = rows.split("\n").map((s) => s.trim()).filter(Boolean);
      assertEquals(lines, [
        `Org Alpha|2|${470 * MB}|${470 * MB}|0`,
        `Org Beta|1|${5 * MB}|${5 * MB}|0`,
      ]);
      // Un-keep beta.pdf: it now expires within 7 days and must show up.
      await db.sql(`SELECT public.set_file_retained('aaaaaaaa-0000-4000-8000-000000000004', '${OTHER}'::uuid, false);`);
      assertEquals(
        (await db.sql(`SELECT expiring_7d FROM public.admin_org_file_usage WHERE org_name = 'Org Beta';`)).trim(),
        "1",
      );
    });

    await t.step("ai_chat_events: the four §16.3 kinds pass the CHECK; unknown kinds still reject", async () => {
      for (const kind of ["report.rendered", "report.downloaded", "file.kept", "file.expired"]) {
        await db.sql(
          `INSERT INTO public.ai_chat_events (event_kind, user_id, project_id) VALUES ('${kind}', '${REPORTER}', '${PROJECT}');`,
        );
      }
      const err = await db.sqlExpectError(
        `INSERT INTO public.ai_chat_events (event_kind) VALUES ('report.hallucinated');`,
      );
      assertStringIncludes(err, "ai_chat_events_event_kind_check");
    });

    await t.step("capability seeds: reports follows ai_chat; agent_report_builder OFF for every role (Q19 discipline)", async () => {
      const reports = await db.sql(`
        SELECT role, allowed FROM public.role_capabilities
         WHERE capability_key = 'reports' ORDER BY role;
      `);
      assertEquals(
        reports.split("\n").map((s) => s.trim()).filter(Boolean),
        ["admin|t", "modeler|t", "super_admin|t", "user|f"],
        "reports mirrors each role's ai_chat seed",
      );
      const agent = await db.sql(`
        SELECT bool_or(allowed) FROM public.role_capabilities WHERE capability_key = 'agent_report_builder';
      `);
      assertEquals(agent.trim(), "f");
    });
  } finally {
    await db.stop();
  }
});
