-- Phase 7 / WP 7.1 stage 1 / §4 D130 + D133 — the sixteen policies learn the second role
--
-- STAGE 1 CANNOT ISSUE A SESSION UNTIL THIS LANDS, AND THE REASON IS NOT OBVIOUS.
--
-- §14's staged plan treats "issue a real session beside the existing one" as invisible
-- until stage 2 reads it. It is not. A Supabase session changes the PostgreSQL ROLE a
-- request arrives under — `anon` becomes `authenticated` — and a policy's `TO` clause
-- keys on the role, not on any predicate. A policy granted to `{anon}` ALONE simply
-- stops applying to an authenticated request, and RLS denies when no policy applies.
--
-- So without this migration, stage 1 would break these sixteen reads **for exactly the
-- users who logged in**, and leave them working for everybody who did not. That is the
-- inversion of what stage 1 is for, it fails on the READ path where nobody would look
-- for an authentication change, and §14's own "what it breaks if wrong" column said
-- "nothing reads it, so nothing can break".
--
-- §15 run `35467412134` counted them (16 of 168 policies; 103 are `TO public` and are
-- unaffected, 12 already name both roles) and run `35467910110` printed every name and
-- both expressions. That printing is why this migration can be read: every predicate
-- below is the measured one, not a reconstruction.
--
-- ── WHY DROP AND CREATE RATHER THAN `ALTER POLICY … TO` ─────────────────────
--
-- `ALTER POLICY <name> ON <table> TO anon, authenticated` is the precise statement and
-- it cannot be used, for a reason that is itself a finding (§4 D133): **FIVE of the
-- sixteen exist in production and NOWHERE in this repository** —
-- `customers_anon_read`, `materials_anon_read`, `products_anon_read`,
-- `suppliers_anon_read` and `policy_versions_anon_insert` appear in no migration, no
-- script and no source file, and the introspected artifact holds 11 of the 16 for the
-- same reason (it records what the migrations say, per table, under `rls.policies`).
-- `ALTER` on a policy that does not exist raises, so an ALTER migration would deploy
-- cleanly to production and fail on every rehearsed database — the mirror of the shape
-- this plan keeps finding, where the rehearsal passes and production does not.
--
-- `DROP POLICY IF EXISTS` then `CREATE POLICY` is TOTAL: correct on a database that has
-- the policy and on one that does not. It also ADOPTS the five undeclared ones, which is
-- what WP 1.4 did for the `risk_data` table (D43) and the same argument — a live object
-- no migration creates is an object no gate can see.
--
-- The drop and the create are in one transaction (`supabase db push` wraps each
-- migration), so no session observes the gap.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--
-- It does not tighten anything. Every predicate below stays exactly as measured —
-- fifteen `USING (true)` and one `WITH CHECK (true)` — so each policy permits precisely
-- what it permitted this morning, to one more role. Making them refuse anything is
-- stage 3's job, with a RESTRICTIVE policy that ANDs on top, and doing it here would
-- confuse an additive change with a subtractive one.
--
-- Revert: the same sixteen statements with `TO anon`.

-- ── 1 · the eleven SELECT policies on tier-2 and policy data ───────────────

DROP POLICY IF EXISTS bom_multi_level_anon_read ON public.bom_multi_level;
CREATE POLICY bom_multi_level_anon_read ON public.bom_multi_level
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS bom_single_level_anon_read ON public.bom_single_level;
CREATE POLICY bom_single_level_anon_read ON public.bom_single_level
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS customers_anon_read ON public.customers;
CREATE POLICY customers_anon_read ON public.customers
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS inbound_logistics_anon_read ON public.inbound_logistics;
CREATE POLICY inbound_logistics_anon_read ON public.inbound_logistics
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS materials_anon_read ON public.materials;
CREATE POLICY materials_anon_read ON public.materials
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS outbound_logistics_anon_read ON public.outbound_logistics;
CREATE POLICY outbound_logistics_anon_read ON public.outbound_logistics
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS products_anon_read ON public.products;
CREATE POLICY products_anon_read ON public.products
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS suppliers_anon_read ON public.suppliers;
CREATE POLICY suppliers_anon_read ON public.suppliers
  FOR SELECT TO anon, authenticated USING (true);

-- These three carry spaces in their names, which is why they are quoted. A policy name
-- is an identifier like any other and the dashboard does not discourage prose.
DROP POLICY IF EXISTS "Anon can read policy defaults" ON public.policy_defaults;
CREATE POLICY "Anon can read policy defaults" ON public.policy_defaults
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Anon can read policy overrides" ON public.policy_overrides;
CREATE POLICY "Anon can read policy overrides" ON public.policy_overrides
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Anon can read policy presets" ON public.policy_presets;
CREATE POLICY "Anon can read policy presets" ON public.policy_presets
  FOR SELECT TO anon, authenticated USING (true);

-- ── 2 · the one INSERT policy ──────────────────────────────────────────────
--
-- `policy_versions_anon_insert` is INSERT-only, so it has a WITH CHECK and no USING.
-- It is one of the four this repository did not declare.

DROP POLICY IF EXISTS policy_versions_anon_insert ON public.policy_versions;
CREATE POLICY policy_versions_anon_insert ON public.policy_versions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ── 3 · the four FOR ALL policies ──────────────────────────────────────────
--
-- `FOR ALL` carries both expressions, and both were measured as `true`.

DROP POLICY IF EXISTS run_item_series_anon_write ON public.run_item_series;
CREATE POLICY run_item_series_anon_write ON public.run_item_series
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS run_replications_anon_write ON public.run_replications;
CREATE POLICY run_replications_anon_write ON public.run_replications
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scenarios_anon_all ON public.scenarios;
CREATE POLICY scenarios_anon_all ON public.scenarios
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sim_runs_anon_all ON public.simulation_runs;
CREATE POLICY sim_runs_anon_all ON public.simulation_runs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
