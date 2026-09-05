// DB-backed deterministic tier for the GA capability grants
// (20260905000001_grant_ga_agent_capabilities.sql).
//
// This migration is the fix for the defect that kept every routed agent dark
// in production: each per-agent capability key was seeded `false` for every
// role by its own stage migration and no migration ever flipped one on, so
// index.ts computed
//
//     enabledAgents = deploymentEnabledAgents() ∩ {agent_<slug> granted}
//
// as the empty set and decideRoute() answered advisory("no_enabled_agents")
// for every message from every non-super-admin. A grant migration that
// silently no-ops would reinstate exactly that, so the assertions below check
// the EFFECTIVE resolution through capabilities_for_user, not just the rows.
//
// Also covers the second half of the migration: today_requests must count
// distinct request_ids rather than ai_usage_logs rows, so an agent-routed
// request (which legitimately writes an agent-turn row AND a request row)
// spends one unit of the per-day request limit, not two.
//
// Skips politely when no Postgres binaries exist; CI sets EVAL_REQUIRE_DB=1.

import { assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { startScratchPostgres } from "./harness/pg.ts";

const ORG = "99999999-9999-4999-8999-999999999901";
const MODELER = "22222222-2222-4222-8222-222222222201";
const USER_ROLE = "22222222-2222-4222-8222-222222222202";
const SUPER = "22222222-2222-4222-8222-222222222203";

const SETUP_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE PUBLICATION supabase_realtime;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text);
INSERT INTO public.organizations VALUES ('${ORG}', 'Org Alpha');

CREATE TABLE public.approved_users (
  id uuid PRIMARY KEY, organization_id uuid, email text, role text NOT NULL
);
INSERT INTO public.approved_users VALUES
  ('${MODELER}',   '${ORG}', 'modeler@example.com',   'modeler'),
  ('${USER_ROLE}', '${ORG}', 'plainuser@example.com', 'user'),
  ('${SUPER}',     '${ORG}', 'super@example.com',     'super_admin');

CREATE TABLE public.projects (id uuid PRIMARY KEY, name text);

CREATE FUNCTION public.get_current_user_id() RETURNS uuid
LANGUAGE sql AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
CREATE FUNCTION public.current_is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_super_admin(_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.approved_users WHERE id = _id AND role = 'super_admin') $$;
CREATE FUNCTION public.set_current_user_context(_id uuid, _email text) RETURNS void
LANGUAGE sql AS $$ SELECT set_config('app.current_user_id', _id::text, true)::void $$;
CREATE FUNCTION public.log_admin_action(_a text, _b text, _c jsonb) RETURNS void
LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ai_* stand-ins (the shapes 20260711000002's budget/model resolution reads).
CREATE TABLE public.ai_providers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, display_name text);
CREATE TABLE public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid, code text UNIQUE,
  display_name text, enabled boolean NOT NULL DEFAULT true,
  input_cost_per_1k numeric NOT NULL DEFAULT 0, output_cost_per_1k numeric NOT NULL DEFAULT 0
);
INSERT INTO public.ai_models (code, display_name) VALUES ('google/gemini-2.5-flash', 'Gemini 2.5 Flash');
CREATE TABLE public.user_ai_permissions (
  user_id uuid PRIMARY KEY, allowed_model_ids uuid[],
  default_model_id uuid, fallback_model_id uuid
);
CREATE TABLE public.ai_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text, scope_id uuid, period text,
  budget_usd numeric, token_limit bigint, rpm integer, rpd integer
);
CREATE TABLE public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, org_id uuid, project_id uuid,
  model_id uuid, model_code text, provider_code text,
  prompt_tokens integer NOT NULL DEFAULT 0, completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0, cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms integer, status text NOT NULL DEFAULT 'success', error_code text,
  request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_members (org_id uuid, user_id uuid, role text);
`;

const MIGRATIONS = [
  "20260711000002_unified_access_control.sql",
  "20260715000003_agent_capabilities.sql",
  "20260905000001_grant_ga_agent_capabilities.sql",
];

/** The five agents AGENT_ENABLED_IDS deploys (workflow line 108). */
const GA_AGENTS = [
  "agent_data_steward",
  "agent_policy_configurator",
  "agent_vv_analyst",
  "agent_experiment_designer",
  "agent_report_builder",
];

Deno.test("GA agent capability grants against scratch Postgres", async (t) => {
  const db = await startScratchPostgres();
  if (!db) {
    if (Deno.env.get("EVAL_REQUIRE_DB")) throw new Error("EVAL_REQUIRE_DB set but no Postgres available");
    console.warn("no Postgres binaries — skipping");
    return;
  }

  try {
    await t.step("setup + migrations apply cleanly (verbatim files)", async () => {
      await db.sql(SETUP_SQL);
      for (const f of MIGRATIONS) {
        await db.applyFile(new URL(`../../../migrations/${f}`, import.meta.url));
        if (f === "20260715000003_agent_capabilities.sql") {
          // agent_report_builder is registered by 20260723000001 (the reports
          // migration), which this suite does not apply — role_capabilities
          // has an FK to capabilities(key), so register it the same way the
          // reports migration does before the grant references it.
          // role_capabilities has an FK to capabilities(key). These three keys
          // are registered by migrations this suite does not apply
          // (20260723000001 reports, 20260717000001 chat store, 20260717000003
          // project memory), each of which drags in the proposals fabric.
          // Register just the catalog rows, the same way those migrations do,
          // so the grant under test has something to reference. In production
          // they already exist: every one of those migrations sorts before
          // 20260905000001.
          await db.sql(`
            INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
              ('agent_report_builder', 'feature', 'Report Builder Agent', 330),
              ('chat_history_sync',    'feature', 'Chat History Sync',    340),
              ('project_memory',       'feature', 'Project Memory',       350)
            ON CONFLICT (key) DO NOTHING;
          `);
        }
      }
    });

    await t.step("the five GA agents are granted to super_admin/admin/modeler, withheld from 'user'", async () => {
      for (const key of GA_AGENTS) {
        const out = await db.sql(
          `SELECT role, allowed FROM public.role_capabilities WHERE capability_key = '${key}' ORDER BY role;`,
        );
        assertEquals(
          out.split("\n").map((s) => s.trim()).filter(Boolean),
          ["admin|t", "modeler|t", "super_admin|t", "user|f"],
          `${key}: on for the power roles, off for 'user' — routing an agent implies proposing`,
        );
      }
    });

    await t.step("the grant OVERWRITES the denying stage seed (ON CONFLICT DO UPDATE, not DO NOTHING)", async () => {
      // 20260715000003 seeds every per-agent key false with ON CONFLICT DO
      // NOTHING. A grant written the same way would silently no-op and every
      // agent would stay dark — the exact production defect this fixes.
      const out = await db.sql(
        `SELECT bool_and(allowed) FROM public.role_capabilities
          WHERE capability_key IN ('agent_data_steward','agent_vv_analyst')
            AND role IN ('super_admin','admin','modeler');`,
      );
      assertEquals(out.trim(), "t", "the stage seed's false was replaced, not preserved");
    });

    await t.step("agents WITHOUT a deployed AGENT_ENABLED_IDS entry stay denied", async () => {
      // explainer has no implementation at all (no AGENT_TURNS entry);
      // granting it would only produce silent advisory fall-throughs.
      const out = await db.sql(
        `SELECT bool_or(allowed) FROM public.role_capabilities WHERE capability_key = 'agent_explainer';`,
      );
      assertEquals(out.trim(), "f", "agent_explainer must stay off — it is a phantom agent");
    });

    await t.step("chat continuity follows ai_chat (the M0-M2 server flags are already on)", async () => {
      for (const key of ["chat_history_sync", "project_memory"]) {
        const out = await db.sql(
          `SELECT rc.role, (rc.allowed = chat.allowed) AS tracks_ai_chat
             FROM public.role_capabilities rc
             JOIN public.role_capabilities chat
               ON chat.role = rc.role AND chat.capability_key = 'ai_chat'
            WHERE rc.capability_key = '${key}' ORDER BY rc.role;`,
        );
        assertEquals(
          out.split("\n").map((s) => s.trim()).filter(Boolean),
          ["admin|t", "modeler|t", "super_admin|t", "user|t"],
          `${key} tracks each role's ai_chat grant`,
        );
      }
    });

    await t.step("capabilities_for_user resolves the grants — a modeler can now be routed an agent", async () => {
      const caps = await db.sql(
        `SELECT public.capabilities_for_user('${MODELER}'::uuid)->'features' ->> '${GA_AGENTS[0]}';`,
      );
      assertEquals(caps.trim(), "true", "agent_data_steward is EFFECTIVE for a modeler, not merely a row");

      const all = await db.sql(
        `SELECT public.capabilities_for_user('${MODELER}'::uuid)->'features' AS f;`,
      );
      for (const key of GA_AGENTS) {
        assertStringIncludes(all, `"${key}": true`, `${key} effective for a modeler`);
      }
      assertStringIncludes(all, `"agent_explainer": false`, "the phantom agent stays off");

      const plain = await db.sql(
        `SELECT public.capabilities_for_user('${USER_ROLE}'::uuid)->'features' AS f;`,
      );
      for (const key of GA_AGENTS) {
        assertStringIncludes(plain, `"${key}": false`, `${key} withheld from role 'user'`);
      }
    });

    await t.step("today_requests counts REQUESTS, not ai_usage_logs rows", async () => {
      // One agent-routed request writes an agent-turn row AND a request row
      // under the same request_id; a second request writes one more.
      await db.sql(`
        INSERT INTO public.ai_usage_logs (user_id, request_id, status) VALUES
          ('${MODELER}', 'req-one', 'success'),
          ('${MODELER}', 'req-one', 'success'),
          ('${MODELER}', 'req-two', 'success');
      `);
      const out = await db.sql(
        `SELECT public.capabilities_for_user('${MODELER}'::uuid)->'budgets' ->> 'today_requests';`,
      );
      assertEquals(
        out.trim(),
        "2",
        "3 usage rows across 2 request_ids is 2 requests — counting rows double-charged every agent turn",
      );
    });

    await t.step("historical rows with a NULL request_id still count one each", async () => {
      await db.sql(`
        INSERT INTO public.ai_usage_logs (user_id, request_id, status) VALUES
          ('${MODELER}', NULL, 'success'),
          ('${MODELER}', NULL, 'success');
      `);
      const out = await db.sql(
        `SELECT public.capabilities_for_user('${MODELER}'::uuid)->'budgets' ->> 'today_requests';`,
      );
      assertEquals(out.trim(), "4", "2 requests + 2 unattributed legacy rows");
    });
  } finally {
    await db.stop();
  }
});
