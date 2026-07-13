// DB-backed deterministic tier for Stage 2/3 + M2 (ai-agents.md §7.4 tier 1):
// boots a scratch Postgres, applies the policy write/snapshot/model-validation
// migrations plus the NEW 20260716000001_apply_policy_bundle.sql and
// 20260717000003_project_memory.sql VERBATIM, and asserts:
//   * apply_policy_bundle merges defaults + override patches and snapshots
//     with the agent label + parent lineage — in ONE transaction (a forced
//     snapshot failure rolls back the merges);
//   * the transactional stale_values guard (expected-hash mismatch);
//   * record_model_validation supersede-not-edit + active_model_validation
//     resolution (the SQL half of vv-08);
//   * project_memory consent funnel: RPC-only writes (direct INSERT denied to
//     clients), content/kind/cap guards, archive semantics, capability seed.
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const SETUP_SQL = `
-- Scratch stand-ins for the platform objects the migrations reference.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE PUBLICATION supabase_realtime;

-- The live schema resolves extensions.digest / auth.uid(); stand them in.
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.digest(data text, type text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest(data, type) $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text
);
GRANT SELECT ON public.projects TO anon, authenticated, service_role;
INSERT INTO public.projects (id, name) VALUES ('${PROJECT}', 'Eval project');

-- policy tables (pre-20260609000025 slice)
CREATE TABLE public.policy_defaults (
  project_id uuid PRIMARY KEY,
  fulfillment_strategy text,
  active_preset text,
  preset_applied_at timestamptz,
  sourcing jsonb DEFAULT '{}'::jsonb,
  inventory jsonb DEFAULT '{}'::jsonb,
  transport jsonb DEFAULT '{}'::jsonb,
  fulfillment jsonb DEFAULT '{}'::jsonb,
  production jsonb DEFAULT '{}'::jsonb,
  recovery jsonb DEFAULT '{}'::jsonb,
  demand jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.policy_overrides (
  project_id uuid NOT NULL,
  scope text NOT NULL,
  target_key text NOT NULL,
  family text NOT NULL,
  patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, scope, target_key, family)
);
CREATE TABLE public.policy_presets (
  slug text PRIMARY KEY,
  label text
);
CREATE TABLE public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  label text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.policy_defaults  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_presets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions  ENABLE ROW LEVEL SECURITY;

-- run/scenario/dataset stand-ins (20260710000001 references)
CREATE TABLE public.scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text,
  horizon_days integer DEFAULT 365,
  time_step text DEFAULT 'daily',
  demand_model jsonb DEFAULT '{}'::jsonb,
  warmup_mode text,
  warmup_days integer,
  replications integer,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  scenario_id uuid,
  status text NOT NULL DEFAULT 'queued',
  code_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  graph_hash text NOT NULL
);

-- capability registry (project_memory seeds into it)
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

INSERT INTO public.policy_defaults (project_id, fulfillment_strategy)
VALUES ('${PROJECT}', 'make_to_stock');
`;

Deno.test("Stage 2/3 + M2 migrations against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if ((Deno.env.get("EVAL_REQUIRE_DB") ?? "") === "1") {
      throw new Error("EVAL_REQUIRE_DB=1 but no Postgres binaries were found");
    }
    console.warn("%cSKIP: no Postgres binaries — DB-backed Stage 2/3 assertions not run", "color: yellow");
    return;
  }

  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of [
        "20260609000025_policy_write_rpcs.sql",
        "20260612000001_policy_version_snapshots.sql",
        "20260710000001_model_validations.sql",
        "20260716000001_apply_policy_bundle.sql",
        "20260717000003_project_memory.sql",
      ]) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
      }
    });

    // ── apply_policy_bundle: merge + snapshot + lineage (§4.4 steps 2–3) ─────
    let baseVersionId = "";
    let bundleVersionId = "";
    await t.step("apply_policy_bundle merges defaults/overrides and snapshots with agent label + parent", async () => {
      baseVersionId = await db.sql(
        `SELECT public.snapshot_policy('${PROJECT}', 'baseline', '${USER}');`,
      );
      // A pre-existing override the bundle must MERGE onto, not clobber.
      await db.sql(
        `SELECT public.bulk_upsert_policy_overrides('${PROJECT}',
           '[{"scope":"node","target_key":"MAT-4","family":"inventory","patch":{"basis":"days_of_supply"}}]'::jsonb);`,
      );
      const expected = await db.sql(`SELECT public.current_policy_hash('${PROJECT}');`);
      const result = await db.sql(
        `SELECT public.apply_policy_bundle(
           '${PROJECT}',
           '{"inventory":{"type":"base_stock"}}'::jsonb,
           '[{"scope":"node","target_key":"MAT-4","family":"inventory","patch":{"review_period_days":14}}]'::jsonb,
           'agent: Review period 2 weeks for MAT-4',
           '${baseVersionId}',
           '${expected}',
           '${USER}', 'a@example.com', NULL);`,
      );
      const parsed = JSON.parse(result);
      bundleVersionId = String(parsed.policy_version_id);
      assert(bundleVersionId, "returns the new version id");

      assertEquals(
        await db.sql(`SELECT inventory->>'type' FROM public.policy_defaults WHERE project_id='${PROJECT}';`),
        "base_stock",
        "family patch merged onto the live defaults",
      );
      assertEquals(
        await db.sql(
          `SELECT (patch->>'basis') || '|' || (patch->>'review_period_days')
             FROM public.policy_overrides
            WHERE project_id='${PROJECT}' AND target_key='MAT-4' AND family='inventory';`,
        ),
        "days_of_supply|14",
        "override patch MERGED — sibling fields survive",
      );
      const row = await db.sql(
        `SELECT label || '|' || parent_version_id || '|' || (policy_hash = public.current_policy_hash('${PROJECT}'))
           FROM public.policy_versions WHERE id='${bundleVersionId}';`,
      );
      assertEquals(
        row,
        `agent: Review period 2 weeks for MAT-4|${baseVersionId}|true`,
        "agent label, parent lineage, and the snapshot hash equals the live hash",
      );
    });

    await t.step("apply_policy_bundle rejects a stale expected hash inside the transaction (pc-08)", async () => {
      const err = await db.sqlExpectError(
        `SELECT public.apply_policy_bundle('${PROJECT}', '{"inventory":{"type":"rop"}}'::jsonb,
           '[]'::jsonb, 'agent: stale', NULL, 'bogus-hash');`,
      );
      assertStringIncludes(err, "stale_values");
      assertEquals(
        await db.sql(`SELECT inventory->>'type' FROM public.policy_defaults WHERE project_id='${PROJECT}';`),
        "base_stock",
        "nothing mutated on the stale failure",
      );
    });

    await t.step("apply_policy_bundle is ONE transaction — a snapshot failure rolls back the merges", async () => {
      // Force the final step (the snapshot insert) to fail mid-transaction.
      await db.sql(`
        CREATE FUNCTION public._eval_boom() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.label = 'agent: boom' THEN RAISE EXCEPTION 'forced snapshot failure'; END IF;
          RETURN NEW;
        END; $$;
        CREATE TRIGGER eval_boom BEFORE INSERT ON public.policy_versions
          FOR EACH ROW EXECUTE FUNCTION public._eval_boom();`);
      const err = await db.sqlExpectError(
        `SELECT public.apply_policy_bundle('${PROJECT}',
           '{"inventory":{"type":"rop"}}'::jsonb,
           '[{"scope":"node","target_key":"MAT-4","family":"sourcing","patch":{"primary_source":true}}]'::jsonb,
           'agent: boom', NULL, NULL);`,
      );
      assertStringIncludes(err, "forced snapshot failure");
      assertEquals(
        await db.sql(`SELECT inventory->>'type' FROM public.policy_defaults WHERE project_id='${PROJECT}';`),
        "base_stock",
        "defaults merge rolled back with the failed snapshot",
      );
      assertEquals(
        await db.sql(
          `SELECT count(*) FROM public.policy_overrides
            WHERE project_id='${PROJECT}' AND family='sourcing';`,
        ),
        "0",
        "override merge rolled back with the failed snapshot",
      );
      await db.sql(`DROP TRIGGER eval_boom ON public.policy_versions; DROP FUNCTION public._eval_boom();`);
    });

    // ── record_model_validation: the SQL half of vv-08 ───────────────────────
    await t.step("record_model_validation supersedes the prior same-triple card", async () => {
      const scenarioId = await db.sql(
        `INSERT INTO public.scenarios (project_id, name) VALUES ('${PROJECT}', 'Validation scenario') RETURNING id;`,
      );
      const graphHash = "g".repeat(16);
      const datasetId = await db.sql(
        `INSERT INTO public.dataset_versions (project_id, graph_hash) VALUES ('${PROJECT}', '${graphHash}') RETURNING id;`,
      );
      const runId = await db.sql(
        `INSERT INTO public.simulation_runs (project_id, scenario_id, status, code_version)
         VALUES ('${PROJECT}', '${scenarioId}', 'done', 'scsim-1') RETURNING id;`,
      );
      const record = (verdict: string) => db.sql(
        `SELECT public.record_model_validation(
           '${PROJECT}', '${bundleVersionId}', '${datasetId}', '${scenarioId}',
           84, 'engine', 1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
           '${verdict}', 'statistical', '${runId}', '${USER}', 'a@example.com');`,
      );
      const first = await record("validated");
      const second = await record("validated");
      assertEquals(
        await db.sql(`SELECT status || '|' || superseded_by FROM public.model_validations WHERE id='${first}';`),
        `superseded|${second}`,
        "prior card superseded with the pointer set — never edited",
      );
      const scenarioHash = await db.sql(`SELECT public.scenario_fingerprint_hash('${scenarioId}');`);
      assertEquals(
        await db.sql(
          `SELECT id FROM public.active_model_validation('${bundleVersionId}', '${graphHash}', '${scenarioHash}');`,
        ),
        second,
        "active_model_validation resolves the new card",
      );
    });

    // ── project_memory: the consent funnel (§14.4) ───────────────────────────
    await t.step("project_memory writes are RPC-only; guards hold; archive flips", async () => {
      for (const role of ["anon", "authenticated"]) {
        const err = await db.sqlExpectError(
          `INSERT INTO public.project_memory (project_id, kind, content)
           VALUES ('${PROJECT}', 'fact', 'smuggled');`,
          { role },
        );
        assertStringIncludes(err, "permission denied", `${role} cannot write memory directly`);
      }
      const memId = await db.sql(
        `SELECT public.save_project_memory('${PROJECT}', 'fact',
           'S3 is our strategic supplier',
           '[{"kind":"user_message","ref":"thread:t1"}]'::jsonb,
           NULL, '${USER}', '{"graph_hash":"old"}'::jsonb);`,
      );
      assertEquals(
        await db.sql(`SELECT kind || '|' || content || '|' || status FROM public.project_memory WHERE id='${memId}';`),
        "fact|S3 is our strategic supplier|active",
      );
      const badKind = await db.sqlExpectError(
        `SELECT public.save_project_memory('${PROJECT}', 'vibe', 'x');`,
      );
      assertStringIncludes(badKind, "kind must be");
      const tooLong = await db.sqlExpectError(
        `SELECT public.save_project_memory('${PROJECT}', 'fact', repeat('x', 501));`,
      );
      assertStringIncludes(tooLong, "too_large");
      const empty = await db.sqlExpectError(
        `SELECT public.save_project_memory('${PROJECT}', 'fact', '   ');`,
      );
      assertStringIncludes(empty, "must not be empty");

      await db.sql(`SELECT public.archive_project_memory('${memId}');`);
      assertEquals(
        await db.sql(`SELECT status FROM public.project_memory WHERE id='${memId}';`),
        "archived",
        "archive is a status flip, never a delete",
      );

      // §14.4 cap: 200 active per project — the RPC refuses beyond it.
      await db.sql(
        `INSERT INTO public.project_memory (project_id, kind, content)
         SELECT '${PROJECT}', 'fact', 'seed ' || g FROM generate_series(1, 200) g;`,
      );
      const capped = await db.sqlExpectError(
        `SELECT public.save_project_memory('${PROJECT}', 'fact', 'one too many');`,
      );
      assertStringIncludes(capped, "active-memory cap (200)");
    });

    await t.step("project_memory capability seeds OFF for every role (§10 Q19 discipline)", async () => {
      assertEquals(
        await db.sql(`SELECT count(*) FROM public.capabilities WHERE key='project_memory';`),
        "1",
      );
      assertEquals(
        await db.sql(
          `SELECT count(*) FROM public.role_capabilities
            WHERE capability_key='project_memory' AND allowed=false;`,
        ),
        "4",
        "all four roles seeded off at the M2 landing",
      );
    });
  } finally {
    await db.stop();
  }
});
