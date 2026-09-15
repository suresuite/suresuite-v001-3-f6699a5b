-- Phase 2 / WP 2.1 / PLAN.md §9 — ONE ORGANIZATION IDENTITY (D13, D27).
--
-- The platform names an organization twice: a uuid (`organizations.id`, copied to
-- `projects.organization_id` and `approved_users.organization_id`) and a free-text
-- string (`projects.organization`, `approved_users.organization`). RLS authorizes
-- on the text; the public /v1 API authorizes on the uuid. `uuid-identity`
-- (PLAN.md §2.1 G1) says a displayable name is never a join key. It is one here,
-- 122 times.
--
-- D27 is the part that is broken rather than untidy. `set_project_defaults()`
-- stamps `NEW.organization` and never `NEW.organization_id`, so the one-time
-- backfill in `20260709000002` is the only thing that has ever set the uuid.
-- Every project created since is NULL there: visible through RLS, invisible to
-- `/v1`, and the gap grows by one row per insert. This migration fixes the
-- trigger FIRST — a backfill in front of a trigger that does not stamp just rots
-- again at the next insert.
--
-- WHAT "MIGRATE THE 221 COMPARISONS" TURNED OUT TO MEAN. `grep -c` over
-- supabase/migrations/ returns 221, but a migration directory is an append-only
-- log, not a schema: policies are dropped and recreated across many files,
-- functions are CREATE OR REPLACEd a dozen times, three migrations rolled back
-- entirely, and one DROP TABLE ... CASCADE took every policy on that table with
-- it. Replaying the log (scripts/data-contract/live-sql.mjs, the same
-- last-write-wins discipline as the introspector) gives the figure that matters:
-- 122 calls in 102 LIVE objects. Those are what this file redefines. The other
-- 100 are in superseded definitions no database is running.
--
-- THE DUAL READ IS AUTHORED ONCE. Every one of the 107 rewritten comparisons
-- calls `org_is_current_user_org(uuid, text)`; none of them spells out an OR.
-- The text branch stays until the backfill is verified at 100 % (PLAN.md §15,
-- which no work-package session can run) — and when it goes, it goes from one
-- function body, not from 107 call sites. That is `single-source` (I1) applied
-- to an access rule.
--
-- NOT DONE HERE, ON PURPOSE:
--   · The text branch is not removed. See above; that is the follow-up.
--   · Nine `set_*_defaults` triggers still stamp a text `organization` onto tables
--     that have no `organization_id` column (supply_chain_data, node_list, the
--     scenario and network tables). Their RLS does not read that column — it
--     joins to `projects` — so the column is write-only decoration today. Giving
--     those tables a uuid org is a schema change, and it belongs with the tier
--     work, not here. Recorded in §16.

-- ── 0. preflight ─────────────────────────────────────────────────────────────
-- Say up front which of the tables this file touches are absent. The migration
-- log is the only place anyone sees this database's real shape (D31: a migration's
-- first execution is the production deploy), so it should not have to be inferred
-- one aborted statement at a time.
DO $preflight$
DECLARE missing text[];
BEGIN
  SELECT array_agg(t ORDER BY t) INTO missing
    FROM unnest(ARRAY[
      'approved_users','organizations','projects',
      'bom_multi_level','bom_single_level','inbound_logistics','outbound_logistics',
      'multi_tier_supply_chain','supply_chain_data','node_list',
      'network_edges','network_nodes','network_summary',
      'disruption_scenarios','disruption_scenario_effects','disruption_scenario_profiles',
      'disruption_scenario_settings','disruption_scenario_targets',
      'simulation_cache','simulation_jobs','simulation_job_magnitudes',
      'simulation_performance_metrics','simulation_results',
      'tier2_suppliers','tier3_suppliers'
    ]) t
   WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN
    -- EXCEPTION, not NOTICE. The Supabase CLI's `db push` log captures ERROR lines
    -- and drops NOTICEs, so a notice here is invisible exactly where it is needed —
    -- and the alternative is learning the set one aborted statement per deploy,
    -- which is how D32 was found and then how `tier2_suppliers` was found after it.
    -- Failing here names ALL of them at once, before anything has been attempted.
    RAISE EXCEPTION 'this database is missing % table(s) that this migration needs: %. '
                    'Adopt them (CREATE TABLE IF NOT EXISTS, verbatim from their '
                    'original migration) the way network_summary is adopted below — '
                    'see D32 and PLAN.md §16.', array_length(missing, 1), missing;
  END IF;
END
$preflight$;

-- ── 1. the uuid resolver ─────────────────────────────────────────────────────
-- `_user_id` is EXPLICIT, exactly as `capabilities_for_user()` takes it, and for
-- the same reason: `get_current_user_org()` reads `current_setting('app.current_user_id')`,
-- and a GUC on a pooled PostgREST connection is the one thing in this access
-- layer that cannot be relied on. A caller that knows the user passes the user.

CREATE OR REPLACE FUNCTION public.get_current_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT au.organization_id
  FROM public.approved_users au
  WHERE au.id = _user_id;
$$;

-- ── 2. the single dual-read rule ─────────────────────────────────────────────
-- Both planes, OR'd, with NULL folded to false so a NULL uuid on either side
-- cannot make the whole predicate NULL (which RLS treats as deny, and which
-- would lock every D27 row out of the very policies meant to keep it reachable).

CREATE OR REPLACE FUNCTION public.org_is_current_user_org(_org_id uuid, _org_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    -- the uuid plane: survives a rename, because nothing about it is displayable
    COALESCE(_org_id = public.get_current_user_org_id(public.get_current_user_id()), false)
    -- the text plane: retained until the backfill is verified at 100 % (§15)
    OR COALESCE(_org_name = public.get_current_user_org(), false);
$$;

-- ── 3. D27 — stamp the uuid plane on every project insert ────────────────────

CREATE OR REPLACE FUNCTION public.set_project_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_id uuid;
  current_org text;
BEGIN
  current_user_id := public.get_current_user_id();

  IF NEW.modeler_id IS NULL AND current_user_id IS NOT NULL THEN
    NEW.modeler_id := current_user_id;
  END IF;

  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;

  -- D27. Taken from the SAME user the text org came from — NOT resolved from
  -- `current_org`, which would make the name a join key one level further down
  -- and would hand a renamed org's projects to whoever holds the old name.
  IF NEW.organization_id IS NULL AND current_user_id IS NOT NULL THEN
    NEW.organization_id := public.get_current_user_org_id(current_user_id);
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. backfill what the trigger never stamped ───────────────────────────────
-- Matched on name OR slug: a renamed org keeps its original slug, so a row
-- written before the rename carries the old name (slug matches) and one written
-- after carries the new name (name matches).
--
-- `(array_agg(DISTINCT o.id))[1]` and not `min(o.id)`: Postgres has no `min()`
-- aggregate for uuid, and `min(uuid)` is a 42883 at RUN time, not at parse time —
-- it took the first real `db push` to surface it. The HAVING below guarantees the
-- array has exactly one element, so the subscript is exact rather than a choice.
--
-- `count(DISTINCT o.id) = 1` is the point of the GROUP BY: `organizations.name`
-- is NOT unique (only `slug` is), so a text org matching two organizations is
-- ambiguous and is LEFT NULL rather than resolved to an arbitrary one. Rows this
-- leaves behind keep working on the text branch and are what §15 counts. No
-- `organizations` row is created here: auto-seeding one per distinct string is
-- how a renamed org would get silently split in two.

UPDATE public.approved_users au
   SET organization_id = m.org_id
  FROM (
    SELECT u.id AS user_id, (array_agg(DISTINCT o.id))[1] AS org_id
      FROM public.approved_users u
      JOIN public.organizations o
        ON o.name = u.organization
        OR o.slug = lower(regexp_replace(u.organization, '[^a-zA-Z0-9]+', '-', 'g'))
     WHERE u.organization_id IS NULL
       AND u.organization IS NOT NULL
     GROUP BY u.id
    HAVING count(DISTINCT o.id) = 1
  ) m
 WHERE au.id = m.user_id;

UPDATE public.projects p
   SET organization_id = m.org_id
  FROM (
    SELECT pr.id AS project_id, (array_agg(DISTINCT o.id))[1] AS org_id
      FROM public.projects pr
      JOIN public.organizations o
        ON o.name = pr.organization
        OR o.slug = lower(regexp_replace(pr.organization, '[^a-zA-Z0-9]+', '-', 'g'))
     WHERE pr.organization_id IS NULL
       AND pr.organization IS NOT NULL
     GROUP BY pr.id
    HAVING count(DISTINCT o.id) = 1
  ) m
 WHERE p.id = m.project_id;

-- ── 5. the organizations self-bridge ─────────────────────────────────────────
-- It matched the org's own row by `name` or `slug` against the caller's text org.
-- `admin_update_organization` — what the Rename button calls — updates
-- `organizations.name` and nothing else, so the moment an org is renamed its own
-- members lose SELECT on the row that was just renamed. The uuid branch goes
-- first and the text branches stay as the fallback for un-backfilled users.

DROP POLICY IF EXISTS "orgs: members read own" ON public.organizations;
CREATE POLICY "orgs: members read own" ON public.organizations FOR SELECT
  USING (
    id = public.get_current_user_org_id(public.get_current_user_id())
    OR name = public.get_current_user_org()
    OR slug = public.get_current_user_org()
  );

-- ── 6. the 58 live policies ──────────────────────────────────────────────────
-- Every one is the definition the database is currently running, re-emitted with
-- its org comparison routed through the predicate. Nothing else in them changed.

DROP POLICY IF EXISTS "BOM Multi: modifiers only" ON public.bom_multi_level;
CREATE POLICY "BOM Multi: modifiers only" 
ON public.bom_multi_level FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_multi_level.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_multi_level.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

DROP POLICY IF EXISTS "BOM Multi: organization access" ON public.bom_multi_level;
CREATE POLICY "BOM Multi: organization access" 
ON public.bom_multi_level FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_multi_level.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "BOM Single: modifiers only" ON public.bom_single_level;
CREATE POLICY "BOM Single: modifiers only" 
ON public.bom_single_level FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_single_level.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_single_level.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

DROP POLICY IF EXISTS "BOM Single: organization access" ON public.bom_single_level;
CREATE POLICY "BOM Single: organization access" 
ON public.bom_single_level FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_single_level.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Scenario effects: organization access view" ON public.disruption_scenario_effects;
CREATE POLICY "Scenario effects: organization access view"
ON public.disruption_scenario_effects
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_effects.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Scenario effects: project access modify" ON public.disruption_scenario_effects;
CREATE POLICY "Scenario effects: project access modify"
ON public.disruption_scenario_effects
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_effects.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_effects.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

DROP POLICY IF EXISTS "Scenario profiles: organization access view" ON public.disruption_scenario_profiles;
CREATE POLICY "Scenario profiles: organization access view"
ON public.disruption_scenario_profiles
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = disruption_scenario_profiles.project_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Scenario profiles: project access modify" ON public.disruption_scenario_profiles;
CREATE POLICY "Scenario profiles: project access modify"
ON public.disruption_scenario_profiles
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = disruption_scenario_profiles.project_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = disruption_scenario_profiles.project_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

DROP POLICY IF EXISTS "Scenario settings: organization access view" ON public.disruption_scenario_settings;
CREATE POLICY "Scenario settings: organization access view"
ON public.disruption_scenario_settings
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_settings.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Scenario settings: project access modify" ON public.disruption_scenario_settings;
CREATE POLICY "Scenario settings: project access modify"
ON public.disruption_scenario_settings
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_settings.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_settings.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

DROP POLICY IF EXISTS "Scenario targets: organization access view" ON public.disruption_scenario_targets;
CREATE POLICY "Scenario targets: organization access view"
ON public.disruption_scenario_targets
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_targets.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Scenario targets: project access modify" ON public.disruption_scenario_targets;
CREATE POLICY "Scenario targets: project access modify"
ON public.disruption_scenario_targets
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_targets.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_targets.profile_id
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

DROP POLICY IF EXISTS "Disruption scenarios: organization access view" ON public.disruption_scenarios;
CREATE POLICY "Disruption scenarios: organization access view" 
ON public.disruption_scenarios 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = disruption_scenarios.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Disruption scenarios: project access modify" ON public.disruption_scenarios;
CREATE POLICY "Disruption scenarios: project access modify" 
ON public.disruption_scenarios 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = disruption_scenarios.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = disruption_scenarios.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Inbound: modifiers only" ON public.inbound_logistics;
CREATE POLICY "Inbound: modifiers only" 
ON public.inbound_logistics FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = inbound_logistics.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = inbound_logistics.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

DROP POLICY IF EXISTS "Inbound: organization access" ON public.inbound_logistics;
CREATE POLICY "Inbound: organization access" 
ON public.inbound_logistics FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = inbound_logistics.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Multi-tier: modifiers only" ON public.multi_tier_supply_chain;
CREATE POLICY "Multi-tier: modifiers only" 
ON public.multi_tier_supply_chain FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = multi_tier_supply_chain.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = multi_tier_supply_chain.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

DROP POLICY IF EXISTS "Multi-tier: organization access" ON public.multi_tier_supply_chain;
CREATE POLICY "Multi-tier: organization access" 
ON public.multi_tier_supply_chain FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = multi_tier_supply_chain.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Network edges: project access delete" ON public.network_edges;
CREATE POLICY "Network edges: project access delete" 
ON public.network_edges 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network edges: project access insert" ON public.network_edges;
CREATE POLICY "Network edges: project access insert" 
ON public.network_edges 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network edges: project access update" ON public.network_edges;
CREATE POLICY "Network edges: project access update" 
ON public.network_edges 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network edges: project access view" ON public.network_edges;
CREATE POLICY "Network edges: project access view" 
ON public.network_edges 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Network nodes: project access delete" ON public.network_nodes;
CREATE POLICY "Network nodes: project access delete" 
ON public.network_nodes 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network nodes: project access insert" ON public.network_nodes;
CREATE POLICY "Network nodes: project access insert" 
ON public.network_nodes 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network nodes: project access update" ON public.network_nodes;
CREATE POLICY "Network nodes: project access update" 
ON public.network_nodes 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network nodes: project access view" ON public.network_nodes;
CREATE POLICY "Network nodes: project access view" 
ON public.network_nodes 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

-- `network_summary` EXISTS IN THE MIGRATIONS AND NOT IN THE PRODUCTION DATABASE.
-- `20250904105527` creates it beside `network_nodes` and `network_edges`; those two
-- are in production and this one is not, and no migration drops it. The first
-- `db push` of this file found it — `DROP POLICY IF EXISTS` still needs the TABLE
-- to exist (the IF EXISTS is about the policy), so statement 59 aborted the whole
-- migration. This is `risk_data` (D4) inverted: WP 1.4 found a table in production
-- that no migration creates; this is a table the migrations create that production
-- does not have. A static replay cannot see either.
--
-- ADOPTED, NOT GUARDED, and the difference matters. Skipping the four policies
-- where the table is absent was the first fix, and it cost more than it saved: the
-- statements have to go through EXECUTE, the introspector cannot read them, and the
-- contract then shows `network_summary` still on the TEXT comparison for ever.
-- `orgIdentity.test.ts` caught exactly that and refused it. Creating the table
-- instead closes the divergence rather than encoding it — the definition below is
-- copied verbatim from `20250904105527`, IF NOT EXISTS makes it a no-op everywhere
-- the table already is, and nothing in `src/` or `supabase/functions/` reads the
-- table, so adopting it cannot change any behaviour. Recorded as D32.
CREATE TABLE IF NOT EXISTS public.network_summary (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  nodes_count integer,
  edges_count integer,
  tiers_data jsonb
);
ALTER TABLE public.network_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Network summary: project access delete" ON public.network_summary;

CREATE POLICY "Network summary: project access delete" 
ON public.network_summary 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network summary: project access insert" ON public.network_summary;

CREATE POLICY "Network summary: project access insert" 
ON public.network_summary 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network summary: project access update" ON public.network_summary;

CREATE POLICY "Network summary: project access update" 
ON public.network_summary 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Network summary: project access view" ON public.network_summary;

CREATE POLICY "Network summary: project access view" 
ON public.network_summary 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Node list: project access delete" ON public.node_list;
CREATE POLICY "Node list: project access delete"
ON public.node_list
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND public.org_is_current_user_org(p.organization_id, p.organization)
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Node list: project access insert" ON public.node_list;
CREATE POLICY "Node list: project access insert"
ON public.node_list
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND public.org_is_current_user_org(p.organization_id, p.organization)
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Node list: project access update" ON public.node_list;
CREATE POLICY "Node list: project access update"
ON public.node_list
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND public.org_is_current_user_org(p.organization_id, p.organization)
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND public.org_is_current_user_org(p.organization_id, p.organization)
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Node list: project access view" ON public.node_list;
CREATE POLICY "Node list: project access view"
ON public.node_list
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Outbound: modifiers only" ON public.outbound_logistics;
CREATE POLICY "Outbound: modifiers only" 
ON public.outbound_logistics FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = outbound_logistics.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = outbound_logistics.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

DROP POLICY IF EXISTS "Outbound: organization access" ON public.outbound_logistics;
CREATE POLICY "Outbound: organization access" 
ON public.outbound_logistics FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = outbound_logistics.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Projects: org create by modeler or admin" ON public.projects;
CREATE POLICY "Projects: org create by modeler or admin"
ON public.projects
FOR INSERT
WITH CHECK (
  public.org_is_current_user_org(organization_id, organization) AND (
    ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'modeler' AND modeler_id = public.get_current_user_id() )
    OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' )
  )
);

DROP POLICY IF EXISTS "Projects: org delete by owner or admin" ON public.projects;
CREATE POLICY "Projects: org delete by owner or admin"
ON public.projects
FOR DELETE
USING (
  public.org_is_current_user_org(organization_id, organization) AND (
    modeler_id = public.get_current_user_id() OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
);

DROP POLICY IF EXISTS "Projects: org update by owner or admin" ON public.projects;
CREATE POLICY "Projects: org update by owner or admin"
ON public.projects
FOR UPDATE
USING (
  public.org_is_current_user_org(organization_id, organization) AND (
    modeler_id = public.get_current_user_id() OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
)
WITH CHECK (
  public.org_is_current_user_org(organization_id, organization) AND (
    modeler_id = public.get_current_user_id() OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
);

DROP POLICY IF EXISTS "Projects: org-wide view" ON public.projects;
CREATE POLICY "Projects: org-wide view"
ON public.projects
FOR SELECT
USING (
  public.org_is_current_user_org(organization_id, organization)
);

DROP POLICY IF EXISTS "Simulation cache: project access modify" ON public.simulation_cache;
CREATE POLICY "Simulation cache: project access modify" ON public.simulation_cache
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_cache.project_id 
            AND public.org_is_current_user_org(p.organization_id, p.organization)
            AND (p.modeler_id = public.get_current_user_id() OR 
                 (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
        )
    );

DROP POLICY IF EXISTS "Simulation cache: project access view" ON public.simulation_cache;
CREATE POLICY "Simulation cache: project access view" ON public.simulation_cache
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_cache.project_id 
            AND public.org_is_current_user_org(p.organization_id, p.organization)
        )
    );

DROP POLICY IF EXISTS "Simulation job magnitudes: project access modify" ON public.simulation_job_magnitudes;
CREATE POLICY "Simulation job magnitudes: project access modify" 
ON public.simulation_job_magnitudes 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = simulation_job_magnitudes.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization) 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1) = 'admin'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = simulation_job_magnitudes.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization) 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1) = 'admin'
    )
  )
);

DROP POLICY IF EXISTS "Simulation job magnitudes: project access view" ON public.simulation_job_magnitudes;
CREATE POLICY "Simulation job magnitudes: project access view" 
ON public.simulation_job_magnitudes 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = simulation_job_magnitudes.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Simulation jobs: project access modify" ON public.simulation_jobs;
CREATE POLICY "Simulation jobs: project access modify" ON public.simulation_jobs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_jobs.project_id 
            AND public.org_is_current_user_org(p.organization_id, p.organization)
            AND (p.modeler_id = public.get_current_user_id() OR 
                 (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
        )
    );

DROP POLICY IF EXISTS "Simulation jobs: project access view" ON public.simulation_jobs;
CREATE POLICY "Simulation jobs: project access view" ON public.simulation_jobs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_jobs.project_id 
            AND public.org_is_current_user_org(p.organization_id, p.organization)
        )
    );

DROP POLICY IF EXISTS "Simulation metrics: project access modify" ON public.simulation_performance_metrics;
CREATE POLICY "Simulation metrics: project access modify" ON public.simulation_performance_metrics
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_performance_metrics.project_id 
            AND public.org_is_current_user_org(p.organization_id, p.organization)
            AND (p.modeler_id = public.get_current_user_id() OR 
                 (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
        )
    );

DROP POLICY IF EXISTS "Simulation metrics: project access view" ON public.simulation_performance_metrics;
CREATE POLICY "Simulation metrics: project access view" ON public.simulation_performance_metrics
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_performance_metrics.project_id 
            AND public.org_is_current_user_org(p.organization_id, p.organization)
        )
    );

DROP POLICY IF EXISTS "Simulation results: organization access view" ON public.simulation_results;
CREATE POLICY "Simulation results: organization access view" 
ON public.simulation_results 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = simulation_results.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Simulation results: project access modify" ON public.simulation_results;
CREATE POLICY "Simulation results: project access modify" 
ON public.simulation_results 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = simulation_results.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = simulation_results.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Supply chain data: project access delete" ON public.supply_chain_data;
CREATE POLICY "Supply chain data: project access delete" 
ON public.supply_chain_data 
FOR DELETE 
USING (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = get_current_user_id() OR (SELECT get_current_approved_user.user_role FROM get_current_approved_user() get_current_approved_user(user_id, user_email, user_role) LIMIT 1) = 'admin')
  )
);

DROP POLICY IF EXISTS "Supply chain data: project access insert" ON public.supply_chain_data;
CREATE POLICY "Supply chain data: project access insert" 
ON public.supply_chain_data 
FOR INSERT 
WITH CHECK (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = get_current_user_id() OR (SELECT get_current_approved_user.user_role FROM get_current_approved_user() get_current_approved_user(user_id, user_email, user_role) LIMIT 1) = 'admin')
  )
);

DROP POLICY IF EXISTS "Supply chain data: project access update" ON public.supply_chain_data;
CREATE POLICY "Supply chain data: project access update" 
ON public.supply_chain_data 
FOR UPDATE 
USING (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
    AND (p.modeler_id = get_current_user_id() OR (SELECT get_current_approved_user.user_role FROM get_current_approved_user() get_current_approved_user(user_id, user_email, user_role) LIMIT 1) = 'admin')
  )
);

DROP POLICY IF EXISTS "Supply chain data: project access view" ON public.supply_chain_data;
CREATE POLICY "Supply chain data: project access view" 
ON public.supply_chain_data 
FOR SELECT 
USING (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  )
);

DROP POLICY IF EXISTS "Tier2: organization access view" ON public.tier2_suppliers;
CREATE POLICY "Tier2: organization access view" 
ON public.tier2_suppliers 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier2_suppliers.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Tier2: project access modify" ON public.tier2_suppliers;
CREATE POLICY "Tier2: project access modify" 
ON public.tier2_suppliers 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier2_suppliers.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier2_suppliers.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

DROP POLICY IF EXISTS "Tier3: organization access view" ON public.tier3_suppliers;
CREATE POLICY "Tier3: organization access view" 
ON public.tier3_suppliers 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier3_suppliers.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization)
));

DROP POLICY IF EXISTS "Tier3: project access modify" ON public.tier3_suppliers;
CREATE POLICY "Tier3: project access modify" 
ON public.tier3_suppliers 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier3_suppliers.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier3_suppliers.project_id 
  AND public.org_is_current_user_org(p.organization_id, p.organization) 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- ── 7. the 32 live functions ─────────────────────────────────────────────────
-- Same rule. The 29 plpgsql guards additionally fetch `organization_id` into
-- `v_org_id` alongside the `organization` they already fetched, so the guard has
-- both planes to compare; the fetch is widened by one column and nothing else
-- in the body moves.

CREATE OR REPLACE FUNCTION public.ai_can_access_project(
  p_user_id uuid,
  p_user_email text,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_plant_name text;
  v_role text;
BEGIN
  -- Establish the user context the get_current_* helpers read from.
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id, plant_name
    INTO v_org, v_org_id, v_modeler, v_plant_name
  FROM public.projects
  WHERE id = p_project_id;

  -- Unknown project -> no access.
  IF v_org IS NULL THEN
    RETURN false;
  END IF;

  -- Must be in the same organization.
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RETURN false;
  END IF;

  SELECT user_role INTO v_role
  FROM public.get_current_approved_user()
  LIMIT 1;

  -- Owner, admin, or plant-granted viewer (mirrors the projects SELECT policy).
  RETURN (
    v_modeler = public.get_current_user_id()
    OR v_role = 'admin'
    OR v_plant_name IN (
      SELECT upa.plant
      FROM public.user_plant_access upa
      WHERE upa.user_id = public.get_current_user_id()
        AND upa.can_view = true
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_bom_multi_level(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.bom_multi_level (
      material_id,
      level,
      higher_level_component_id,
      consumption_rate,
      plant_name,
      project_id
    ) VALUES (
      r->>'material_id',
      CASE WHEN r ? 'level' AND NULLIF(r->>'level','') IS NOT NULL THEN (r->>'level')::int ELSE 0 END,
      NULLIF(r->>'higher_level_component_id',''),
      CASE WHEN r ? 'consumption_rate' AND NULLIF(r->>'consumption_rate','') IS NOT NULL THEN (r->>'consumption_rate')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_bom_single_level(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.bom_single_level (
      product_id,
      material_id,
      consumption_rate,
      plant_name,
      project_id
    ) VALUES (
      r->>'product_id',
      r->>'material_id',
      CASE WHEN r ? 'consumption_rate' AND NULLIF(r->>'consumption_rate','') IS NOT NULL THEN (r->>'consumption_rate')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_inbound_logistics(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.inbound_logistics (
      supplier_id,
      material_id,
      volume,
      time_unit,
      lead_time,
      unit_price,
      plant_name,
      project_id
    ) VALUES (
      r->>'supplier_id',
      r->>'material_id',
      CASE WHEN r ? 'volume' AND NULLIF(r->>'volume','') IS NOT NULL THEN (r->>'volume')::numeric ELSE NULL END,
      NULLIF(r->>'time_unit',''),
      CASE WHEN r ? 'lead_time' AND NULLIF(r->>'lead_time','') IS NOT NULL THEN (r->>'lead_time')::numeric ELSE NULL END,
      CASE WHEN r ? 'unit_price' AND NULLIF(r->>'unit_price','') IS NOT NULL THEN (r->>'unit_price')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_multi_tier_supply_chain(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.multi_tier_supply_chain (
      project_id,
      plant_name,
      from_firm_id,
      to_firm_id,
      to_firm_tier,
      to_firm_relationship
    ) VALUES (
      (r->>'project_id')::uuid,
      r->>'plant_name',
      r->>'from_firm_id',
      r->>'to_firm_id',
      CASE WHEN r ? 'to_firm_tier' AND NULLIF(r->>'to_firm_tier','') IS NOT NULL THEN (r->>'to_firm_tier')::int ELSE NULL END,
      NULLIF(r->>'to_firm_relationship','')
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_network_edges(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF NOT public.org_is_current_user_org(v_org_id, v_org)
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows; treat uncritical fields as NULL if missing/empty
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_edges (
      project_id,
      plant_name,
      src_uid,
      dst_uid,
      relation_type,
      relative_revenue,
      relative_revenue_percentage,
      depth,
      direction
    ) VALUES (
      p_project_id,
      p_plant_name,
      r->>'src_uid',
      r->>'dst_uid',
      NULLIF(r->>'relation_type',''),
      CASE WHEN r ? 'relative_revenue' AND NULLIF(r->>'relative_revenue','') IS NOT NULL THEN (r->>'relative_revenue')::numeric ELSE NULL END,
      CASE WHEN r ? 'relative_revenue_percentage' AND NULLIF(r->>'relative_revenue_percentage','') IS NOT NULL THEN (r->>'relative_revenue_percentage')::numeric ELSE NULL END,
      CASE WHEN r ? 'depth' AND NULLIF(r->>'depth','') IS NOT NULL THEN (r->>'depth')::int ELSE NULL END,
      NULLIF(r->>'direction','')
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_network_nodes(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF NOT public.org_is_current_user_org(v_org_id, v_org)
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows; treat uncritical fields as NULL if missing/empty
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_nodes (
      project_id,
      plant_name,
      uid,
      depth,
      name,
      country,
      industry,
      website,
      traded_as,
      number_of_employees,
      revenue,
      lat,
      long,
      is_seed
    ) VALUES (
      p_project_id,
      p_plant_name,
      r->>'uid',
      CASE WHEN r ? 'depth' AND NULLIF(r->>'depth','') IS NOT NULL THEN (r->>'depth')::int ELSE NULL END,
      NULLIF(r->>'name',''),
      NULLIF(r->>'country',''),
      NULLIF(r->>'industry',''),
      NULLIF(r->>'website',''),
      NULLIF(r->>'traded_as',''),
      CASE WHEN r ? 'number_of_employees' AND NULLIF(r->>'number_of_employees','') IS NOT NULL THEN (r->>'number_of_employees')::int ELSE NULL END,
      CASE WHEN r ? 'revenue' AND NULLIF(r->>'revenue','') IS NOT NULL THEN (r->>'revenue')::numeric ELSE NULL END,
      CASE WHEN r ? 'lat' AND NULLIF(r->>'lat','') IS NOT NULL THEN (r->>'lat')::numeric ELSE NULL END,
      CASE WHEN r ? 'long' AND NULLIF(r->>'long','') IS NOT NULL THEN (r->>'long')::numeric ELSE NULL END,
      CASE WHEN r ? 'is_seed' THEN COALESCE((r->>'is_seed')::boolean, false) ELSE false END
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_outbound_logistics(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.outbound_logistics (
      customer_id,
      product_id,
      volume,
      time_unit,
      expected_lead_time,
      unit_price,
      plant_name,
      project_id
    ) VALUES (
      r->>'customer_id',
      r->>'product_id',
      CASE WHEN r ? 'volume' AND NULLIF(r->>'volume','') IS NOT NULL THEN (r->>'volume')::numeric ELSE NULL END,
      NULLIF(r->>'time_unit',''),
      CASE WHEN r ? 'expected_lead_time' AND NULLIF(r->>'expected_lead_time','') IS NOT NULL THEN (r->>'expected_lead_time')::numeric ELSE NULL END,
      CASE WHEN r ? 'unit_price' AND NULLIF(r->>'unit_price','') IS NOT NULL THEN (r->>'unit_price')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_tier2_suppliers(
  p_project_id uuid,
  p_data jsonb,
  p_user_id uuid,
  p_user_email text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_plant text;
  inserted_count integer := 0;
  row_data jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id, plant_name INTO v_org, v_org_id, v_modeler, v_plant
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    INSERT INTO public.tier2_suppliers (
      project_id, plant_name, supplier_id, upstream_supplier_id, 
      material_id, relationship_type, volume, unit_price, lead_time, time_unit
    ) VALUES (
      p_project_id,
      v_plant,
      row_data->>'supplier_id',
      row_data->>'upstream_supplier_id',
      row_data->>'material_id',
      row_data->>'relationship_type',
      CASE WHEN row_data->>'volume' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'volume')::numeric ELSE NULL END,
      CASE WHEN row_data->>'unit_price' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'unit_price')::numeric ELSE NULL END,
      CASE WHEN row_data->>'lead_time' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'lead_time')::numeric ELSE NULL END,
      row_data->>'time_unit'
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_tier3_suppliers(
  p_project_id uuid,
  p_data jsonb,
  p_user_id uuid,
  p_user_email text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_plant text;
  inserted_count integer := 0;
  row_data jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id, plant_name INTO v_org, v_org_id, v_modeler, v_plant
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    INSERT INTO public.tier3_suppliers (
      project_id, plant_name, supplier_id, upstream_supplier_id, 
      material_id, relationship_type, volume, unit_price, lead_time, time_unit
    ) VALUES (
      p_project_id,
      v_plant,
      row_data->>'supplier_id',
      row_data->>'upstream_supplier_id',
      row_data->>'material_id',
      row_data->>'relationship_type',
      CASE WHEN row_data->>'volume' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'volume')::numeric ELSE NULL END,
      CASE WHEN row_data->>'unit_price' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'unit_price')::numeric ELSE NULL END,
      CASE WHEN row_data->>'lead_time' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'lead_time')::numeric ELSE NULL END,
      row_data->>'time_unit'
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(p_project_id uuid, p_user_id uuid, p_user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Clear existing combined data for this project
  DELETE FROM public.supply_chain_data WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;

  -- Build supply_chain_data (node-to-node "rollup" edges)
  
  -- 1) Outbound (Product → Customer): material_consumption_rate = volume, sourcing_ratio = 1.0
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    o.plant_name,
    'outbound',
    o.product_id,
    o.customer_id,
    COALESCE(o.volume, 0) as material_consumption_rate,
    1.0 as sourcing_ratio,
    COALESCE(o.volume, 0) as weighted,
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- 2) BOM single-level (Material → Product): weighted = total_outbound_volume * consumption_rate
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    b.product_id,
    COALESCE(b.consumption_rate, 0) as material_consumption_rate,
    1.0 as sourcing_ratio,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0) as weighted,
    p_user_id,
    v_org
  FROM public.bom_single_level b
  LEFT JOIN (
    SELECT plant_name, product_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, product_id
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name AND b.product_id = outbound_totals.product_id
  WHERE b.project_id = p_project_id;

  -- 3) BOM multi-level (Material → Higher-level component): with material_consumption_rate
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    COALESCE(b.higher_level_component_id, 'ROOT'),
    COALESCE(b.consumption_rate, 0) as material_consumption_rate,
    1.0 as sourcing_ratio,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0) as weighted,
    p_user_id,
    v_org
  FROM public.bom_multi_level b
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name
  WHERE b.project_id = p_project_id;

  -- 4) Inbound (Supplier → Material): sourcing_ratio = volume/total_volume_per_material
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    i.plant_name,
    'inbound',
    i.supplier_id,
    i.material_id,
    COALESCE(i.volume, 0) as material_consumption_rate,
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END as sourcing_ratio,
    COALESCE(outbound_totals.total_volume, 0) * 
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END as weighted,
    p_user_id,
    v_org
  FROM public.inbound_logistics i
  LEFT JOIN (
    SELECT plant_name, material_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.inbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, material_id
  ) material_totals ON i.plant_name = material_totals.plant_name AND i.material_id = material_totals.material_id
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON i.plant_name = outbound_totals.plant_name
  WHERE i.project_id = p_project_id;

  -- Build supply_chain_data_multi_tier (path-aware edges with levels)
  
  -- Level 0: Outbound (Product → Customer)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    o.plant_name,
    'outbound',
    o.product_id,
    o.customer_id,
    0,
    o.product_id,
    COALESCE(o.volume, 0),
    1.0,
    COALESCE(o.volume, 0),
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- Level 1: BOM single-level (Material → Product)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    b.product_id,
    1,
    b.product_id,
    COALESCE(b.consumption_rate, 0),
    1.0,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0),
    p_user_id,
    v_org
  FROM public.bom_single_level b
  LEFT JOIN (
    SELECT plant_name, product_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, product_id
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name AND b.product_id = outbound_totals.product_id
  WHERE b.project_id = p_project_id;

  -- Level 2: BOM multi-level (Material → Higher-level component)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    COALESCE(b.higher_level_component_id, 'ROOT'),
    2,
    COALESCE(b.higher_level_component_id, 'ROOT'),
    COALESCE(b.consumption_rate, 0),
    1.0,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0),
    p_user_id,
    v_org
  FROM public.bom_multi_level b
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name
  WHERE b.project_id = p_project_id;

  -- Level ≥1: Inbound (Supplier → Material)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    i.plant_name,
    'inbound',
    i.supplier_id,
    i.material_id,
    GREATEST(1, COALESCE(bom_levels.max_level, 0) + 1),
    i.material_id,
    COALESCE(i.volume, 0),
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END,
    COALESCE(outbound_totals.total_volume, 0) * 
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END,
    p_user_id,
    v_org
  FROM public.inbound_logistics i
  LEFT JOIN (
    SELECT plant_name, material_id, MAX(level) as max_level
    FROM public.bom_multi_level
    WHERE project_id = p_project_id
    GROUP BY plant_name, material_id
  ) bom_levels ON i.plant_name = bom_levels.plant_name AND i.material_id = bom_levels.material_id
  LEFT JOIN (
    SELECT plant_name, material_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.inbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, material_id
  ) material_totals ON i.plant_name = material_totals.plant_name AND i.material_id = material_totals.material_id
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON i.plant_name = outbound_totals.plant_name
  WHERE i.project_id = p_project_id;

END;
$function$;

CREATE OR REPLACE FUNCTION public.create_disruption_scenario(
  p_project_id uuid,
  p_plant_name text,
  p_node_id text,
  p_scenario_name text,
  p_capacity_reduction_percent numeric,
  p_time_delay_days numeric,
  p_description text,
  p_user_id uuid,
  p_user_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  new_id uuid;
BEGIN
  -- Set user context so helper funcs and RLS checks use caller identity
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role
  FROM public.get_current_approved_user()
  LIMIT 1;

  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert scenario, ensuring org and creator are set
  INSERT INTO public.disruption_scenarios (
    project_id,
    plant_name,
    node_id,
    scenario_name,
    capacity_reduction_percent,
    time_delay_days,
    description,
    created_by,
    organization
  ) VALUES (
    p_project_id,
    p_plant_name,
    p_node_id,
    p_scenario_name,
    COALESCE(p_capacity_reduction_percent, 0),
    COALESCE(p_time_delay_days, 0),
    p_description,
    p_user_id,
    v_org
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_simulation_result(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_plant_name text,
  p_scenario_ids uuid[],
  p_status text DEFAULT 'running',
  p_started_at timestamptz DEFAULT now(),
  p_metrics jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  new_id uuid;
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (owner or admin in same org)
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert simulation result (triggers/policies will enforce org & created_by)
  INSERT INTO public.simulation_results (
    project_id, plant_name, status, scenario_ids, started_at, created_by, organization, metrics
  ) VALUES (
    p_project_id, p_plant_name, COALESCE(p_status, 'running'), p_scenario_ids, COALESCE(p_started_at, now()),
    p_user_id, v_org, p_metrics
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_all_disruption_scenarios(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN 
    RAISE EXCEPTION 'project_not_found'; 
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete all scenario profiles for this project (cascading deletes will handle related tables)
  DELETE FROM public.disruption_scenario_profiles 
  WHERE project_id = p_project_id;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_disruption_scenario(p_scenario_id uuid, p_user_id uuid, p_user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info from the scenario
  SELECT dsp.project_id, p.organization, p.organization_id, p.modeler_id 
  INTO v_project_id, v_org, v_org_id, v_modeler
  FROM public.disruption_scenario_profiles dsp
  JOIN public.projects p ON p.id = dsp.project_id
  WHERE dsp.id = p_scenario_id;

  IF v_org IS NULL THEN 
    RAISE EXCEPTION 'scenario_not_found'; 
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete the scenario (cascading deletes will handle related tables)
  DELETE FROM public.disruption_scenario_profiles 
  WHERE id = p_scenario_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario_not_found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 1) Disruption scenarios and children
  DELETE FROM public.disruption_scenario_effects e USING public.disruption_scenario_profiles sp
  WHERE e.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_targets t USING public.disruption_scenario_profiles sp
  WHERE t.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_settings s USING public.disruption_scenario_profiles sp
  WHERE s.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_profiles sp WHERE sp.project_id = p_project_id;

  -- 2) Simulation results
  DELETE FROM public.simulation_results sr WHERE sr.project_id = p_project_id;

  -- 3) Deep-tier network data (nodes/edges only)
  DELETE FROM public.network_edges ne WHERE ne.project_id = p_project_id;
  DELETE FROM public.network_nodes nn WHERE nn.project_id = p_project_id;

  -- 4) Node list
  DELETE FROM public.node_list nl WHERE nl.project_id = p_project_id;

  -- 5) Combined supply chain data
  DELETE FROM public.supply_chain_data scd WHERE scd.project_id = p_project_id;
  DELETE FROM public.node_list nl2 WHERE nl2.project_id = p_project_id;

  -- 6) Inbound/Outbound logistics
  DELETE FROM public.inbound_logistics i WHERE i.project_id = p_project_id;
  DELETE FROM public.outbound_logistics o WHERE o.project_id = p_project_id;

  -- 7) BOM datasets
  DELETE FROM public.bom_single_level b1 WHERE b1.project_id = p_project_id;
  DELETE FROM public.bom_multi_level b2 WHERE b2.project_id = p_project_id;

  -- 8) Finally the project
  DELETE FROM public.projects p WHERE p.id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or access denied'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project_dataset(
  p_project_id uuid,
  p_dataset text,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
  temp_count integer;
BEGIN
  -- Ensure this function has the correct caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, bom_level, modeler_id
  INTO v_org, v_org_id, v_bom_level, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(p_dataset) = 'inbound' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'outbound' THEN
    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('multitier','multi_tier') THEN
    DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'bom' THEN
    IF v_bom_level = 'single' THEN
      DELETE FROM public.bom_single_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
    ELSE
      DELETE FROM public.bom_multi_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
    END IF;
  ELSIF lower(p_dataset) = 'all' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := temp_count;
    
    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;
    
    DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;
    
    IF v_bom_level = 'single' THEN
      DELETE FROM public.bom_single_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS temp_count = ROW_COUNT;
      deleted_count := deleted_count + temp_count;
    ELSE
      DELETE FROM public.bom_multi_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS temp_count = ROW_COUNT;
      deleted_count := deleted_count + temp_count;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_dataset';
  END IF;

  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_simulation_result(
  p_simulation_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate simulation exists and get project info for authorization
  SELECT p.organization, p.organization_id, p.modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.simulation_results sr
  JOIN public.projects p ON p.id = sr.project_id
  WHERE sr.id = p_simulation_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'simulation_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete the simulation result
  DELETE FROM public.simulation_results WHERE id = p_simulation_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'simulation_not_found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_simulation_results_batch(
  p_simulation_ids uuid[],
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
  sim_id uuid;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get user role once
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  
  -- Delete each simulation with proper authorization check
  FOREACH sim_id IN ARRAY p_simulation_ids LOOP
    -- Check authorization for this specific simulation
    SELECT p.organization, p.organization_id, p.modeler_id INTO v_org, v_org_id, v_modeler
    FROM public.simulation_results sr
    JOIN public.projects p ON p.id = sr.project_id
    WHERE sr.id = sim_id;

    -- Skip if simulation not found or not authorized
    IF v_org IS NULL OR 
       NOT public.org_is_current_user_org(v_org_id, v_org) OR 
       NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
      CONTINUE;
    END IF;

    -- Delete the simulation result
    DELETE FROM public.simulation_results WHERE id = sim_id;
    IF FOUND THEN
      deleted_count := deleted_count + 1;
    END IF;
  END LOOP;

  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_deep_tier_datasets(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_deep boolean;
  nodes jsonb := '[]'::jsonb;
  edges jsonb := '[]'::jsonb;
  summary jsonb := '[]'::jsonb;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and org access
  SELECT organization, organization_id, deep_tier_enabled INTO v_org, v_org_id, v_deep
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF COALESCE(v_deep, false) = false THEN
    RETURN jsonb_build_object('nodes', nodes, 'edges', edges, 'summary', summary);
  END IF;

  -- Aggregate datasets
  SELECT COALESCE(jsonb_agg(to_jsonb(n.*)), '[]'::jsonb) INTO nodes
  FROM public.network_nodes n WHERE n.project_id = p_project_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO edges
  FROM public.network_edges e WHERE e.project_id = p_project_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO summary
  FROM public.network_summary s WHERE s.project_id = p_project_id;

  RETURN jsonb_build_object('nodes', nodes, 'edges', edges, 'summary', summary);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_multi_tier_network_data(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  from_location text,
  to_location text,
  level integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  data_source text,
  data_source_group text,
  path_root text,
  uploaded_by uuid,
  organization text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project access (same organization)
  SELECT organization, organization_id INTO v_org, v_org_id
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Return multi-tier network data for the specified project
  RETURN QUERY
  SELECT
    smt.id,
    smt.project_id,
    smt.plant_name,
    smt.from_location,
    smt.to_location,
    smt.level,
    smt.material_consumption_rate,
    smt.sourcing_ratio,
    smt.weighted,
    smt.data_source,
    smt.data_source_group,
    smt.path_root,
    smt.uploaded_by,
    smt.organization,
    smt.created_at,
    smt.updated_at
  FROM public.supply_chain_data_multi_tier smt
  WHERE smt.project_id = p_project_id
  ORDER BY smt.level ASC, smt.from_location ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_dataset_counts(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  v_deep_tier_enabled boolean;
  bom_count integer := 0;
  inbound_count integer := 0;
  outbound_count integer := 0;
  multi_tier_count integer := 0;
  result jsonb;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info and validate access
  SELECT organization, organization_id, bom_level, deep_tier_enabled
  INTO v_org, v_org_id, v_bom_level, v_deep_tier_enabled
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Get BOM count (either single or multi-level)
  IF v_bom_level = 'single' THEN
    SELECT COUNT(*) INTO bom_count FROM public.bom_single_level WHERE project_id = p_project_id;
  ELSE
    SELECT COUNT(*) INTO bom_count FROM public.bom_multi_level WHERE project_id = p_project_id;
  END IF;

  -- Get other dataset counts
  SELECT COUNT(*) INTO inbound_count FROM public.inbound_logistics WHERE project_id = p_project_id;
  SELECT COUNT(*) INTO outbound_count FROM public.outbound_logistics WHERE project_id = p_project_id;
  SELECT COUNT(*) INTO multi_tier_count FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;

  result := jsonb_build_object(
    'bom_level', v_bom_level,
    'deep_tier_enabled', COALESCE(v_deep_tier_enabled, false),
    'bom_count', bom_count,
    'inbound_count', inbound_count,
    'outbound_count', outbound_count,
    'multi_tier_count', multi_tier_count,
    'total_records', bom_count + inbound_count + outbound_count + multi_tier_count
  );

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_dataset_status(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  v_deep_tier_enabled boolean;
  has_bom boolean := false;
  has_inbound boolean := false;
  has_outbound boolean := false;
  has_deep_tier_nodes boolean := false;
  has_deep_tier_edges boolean := false;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info
  SELECT organization, organization_id, bom_level, deep_tier_enabled
  INTO v_org, v_org_id, v_bom_level, v_deep_tier_enabled
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Check BOM data (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id)
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id) INTO has_outbound;

  -- Check deep tier datasets if enabled (nodes + edges only)
  IF v_deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = p_project_id) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = p_project_id) INTO has_deep_tier_edges;
  END IF;

  RETURN jsonb_build_object(
    'bom_level', v_bom_level,
    'deep_tier_enabled', v_deep_tier_enabled,
    'has_bom', has_bom,
    'has_inbound', has_inbound,
    'has_outbound', has_outbound,
    'has_deep_tier_nodes', has_deep_tier_nodes,
    'has_deep_tier_edges', has_deep_tier_edges,
    'completed', CASE
      WHEN v_deep_tier_enabled THEN
        (has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges)
      ELSE
        (has_bom AND has_inbound AND has_outbound)
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_datasets(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  result jsonb;
BEGIN
  -- Ensure this function has the correct caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, bom_level
  INTO v_org, v_org_id, v_bom_level
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  result := jsonb_build_object(
    'bom_level', v_bom_level,
    'bom', CASE 
      WHEN v_bom_level = 'single' THEN COALESCE((
        SELECT jsonb_agg(to_jsonb(b.*)) FROM public.bom_single_level b WHERE b.project_id = p_project_id
      ), '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg(to_jsonb(bm.*)) FROM public.bom_multi_level bm WHERE bm.project_id = p_project_id
      ), '[]'::jsonb)
    END,
    'inbound', COALESCE((
      SELECT jsonb_agg(to_jsonb(i.*)) FROM public.inbound_logistics i WHERE i.project_id = p_project_id
    ), '[]'::jsonb),
    'outbound', COALESCE((
      SELECT jsonb_agg(to_jsonb(o.*)) FROM public.outbound_logistics o WHERE o.project_id = p_project_id
    ), '[]'::jsonb),
    'multiTier', COALESCE((
      SELECT jsonb_agg(to_jsonb(m.*)) FROM public.multi_tier_supply_chain m WHERE m.project_id = p_project_id
    ), '[]'::jsonb)
  );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_scenario_simulation_results(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  simulation_id uuid,
  scenario_id uuid,
  scenario_name text,
  scenario_description text,
  scenario_effects jsonb,
  status text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  metrics jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Enforce organization access control
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = p_project_id 
    AND public.org_is_current_user_org(p.organization_id, p.organization)
  ) THEN
    RAISE EXCEPTION 'Access denied: project not found or not in your organization';
  END IF;
  
  -- Return scenario simulation results with organization access control
  RETURN QUERY
  SELECT 
    sr.id as simulation_id,
    sp.id as scenario_id,
    sp.scenario_name,
    sp.description as scenario_description,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'effect_type', se.effect_type,
          'magnitude', se.magnitude,
          'unit', se.unit
        )
      ) FILTER (WHERE se.id IS NOT NULL),
      '[]'::jsonb
    ) as scenario_effects,
    sr.status,
    sr.started_at,
    sr.completed_at,
    sr.metrics
  FROM public.simulation_results sr
  JOIN public.projects proj ON proj.id = sr.project_id
  CROSS JOIN LATERAL unnest(sr.scenario_ids) AS scenario_id_unnest(scenario_id)
  JOIN public.disruption_scenario_profiles sp ON sp.id = scenario_id_unnest.scenario_id
  LEFT JOIN public.disruption_scenario_effects se ON se.profile_id = sp.id
  WHERE sr.project_id = p_project_id
    AND public.org_is_current_user_org(proj.organization_id, proj.organization)
    AND array_length(sr.scenario_ids, 1) > 0
  GROUP BY sr.id, sp.id, sp.scenario_name, sp.description, sr.status, sr.started_at, sr.completed_at, sr.metrics
  ORDER BY sr.started_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_simulation_results(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  status text,
  scenario_ids uuid[],
  started_at timestamptz,
  completed_at timestamptz,
  metrics jsonb,
  result_data jsonb,
  created_by uuid,
  organization text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (owner or admin in same org)
  SELECT p.organization, p.organization_id, p.modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Return simulation results for the project with fully qualified column names
  RETURN QUERY
  SELECT sr.id, sr.project_id, sr.plant_name, sr.status, sr.scenario_ids, 
         sr.started_at, sr.completed_at, sr.metrics, sr.result_data, 
         sr.created_by, sr.organization, sr.created_at, sr.updated_at
  FROM public.simulation_results sr
  WHERE sr.project_id = p_project_id
  ORDER BY sr.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_projects(
  p_user_id uuid,
  p_user_email text
) RETURNS SETOF public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Ensure RLS helper functions have context inside this call
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT p.*
  FROM public.projects p
  WHERE public.org_is_current_user_org(p.organization_id, p.organization)
  ORDER BY p.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rebuild_node_list(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  inserted_count integer := 0;
BEGIN
  -- Set user context for RLS and helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert new nodes discovered in supply_chain_data; keep existing nodes/details
  WITH nodes AS (
    SELECT scd.plant_name, scd.from_location AS node_id
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
    UNION
    SELECT scd.plant_name, scd.to_location AS node_id
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
  ), dedup AS (
    SELECT node_id, MIN(plant_name) AS plant_name
    FROM nodes
    GROUP BY node_id
  )
  INSERT INTO public.node_list (project_id, plant_name, node_id, organization, created_by)
  SELECT p_project_id, d.plant_name, d.node_id, v_org, public.get_current_user_id()
  FROM dedup d
  ON CONFLICT (project_id, node_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_synthetic_simulation_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_num_profiles integer DEFAULT 3,
  p_num_simulations integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_plant text;
  i integer;
  new_profile_id uuid;
  profile_ids uuid[] := ARRAY[]::uuid[];
  sim_id uuid;
  profile_name text;
  result_summary jsonb := '[]'::jsonb;
BEGIN
  -- Establish caller context for RLS helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (same org AND project owner or admin)
  SELECT organization, organization_id, modeler_id, plant_name
    INTO v_org, v_org_id, v_modeler, v_plant
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Create synthetic disruption scenario profiles using the v2 helper (with explicit casts and dates)
  FOR i IN 1..GREATEST(1, COALESCE(p_num_profiles, 3)) LOOP
    profile_name := 'Scenario ' || i;
    new_profile_id := public.create_disruption_scenario_v2(
      p_project_id       => p_project_id,
      p_plant_name       => v_plant,
      p_scenario_name    => profile_name,
      p_user_id          => p_user_id,
      p_user_email       => p_user_email,
      p_status           => 'draft'::public.disruption_status,
      p_description      => 'Synthetic scenario ' || i,
      p_tags             => ARRAY['seed'],
      p_targets          => jsonb_build_array(
                              jsonb_build_object(
                                'target_type','node',
                                'node_ids', jsonb_build_array('N' || i)
                              )
                            ),
      p_effects          => jsonb_build_array(
                              jsonb_build_object(
                                'effect_type','capacity_reduction',
                                'magnitude', (10 + i)::numeric,
                                'unit','percent'
                              )
                            ),
      p_settings         => jsonb_build_object('simulation_horizon_days', 7),
      p_disruption_start => NULL::date,
      p_disruption_end   => NULL::date
    );
    profile_ids := array_append(profile_ids, new_profile_id);
  END LOOP;

  -- Create synthetic simulation results referencing the seeded profiles
  FOR i IN 1..GREATEST(1, COALESCE(p_num_simulations, 3)) LOOP
    INSERT INTO public.simulation_results (
      project_id,
      plant_name,
      status,
      scenario_ids,
      started_at,
      completed_at,
      metrics,
      result_data
    ) VALUES (
      p_project_id,
      v_plant,
      'completed',
      ARRAY[ profile_ids[((i - 1) % GREATEST(1, COALESCE(array_length(profile_ids,1),1))) + 1] ],
      now() - interval '2 days',
      now() - interval '1 days',
      jsonb_build_object(
        'available_kpis', jsonb_build_array('fill_rate','revenue'),
        'baseline', jsonb_build_object(
          'fill_rate', jsonb_build_array(
            jsonb_build_object('day',0,'value',0.96),
            jsonb_build_object('day',7,'value',0.97)
          ),
          'revenue', jsonb_build_array(
            jsonb_build_object('day',0,'value',120000),
            jsonb_build_object('day',7,'value',125000)
          )
        ),
        'scenario', jsonb_build_object(
          'fill_rate', jsonb_build_array(
            jsonb_build_object('day',0,'value',0.90),
            jsonb_build_object('day',7,'value',0.95)
          ),
          'revenue', jsonb_build_array(
            jsonb_build_object('day',0,'value',110000),
            jsonb_build_object('day',7,'value',120000)
          )
        )
      ),
      jsonb_build_object(
        'seed_tag','demo_seed',
        'simulation_period', jsonb_build_object('start_day',0,'end_day',7)
      )
    ) RETURNING id INTO sim_id;

    result_summary := result_summary || jsonb_build_array(jsonb_build_object('simulation_id', sim_id));
  END LOOP;

  RETURN jsonb_build_object('profile_ids', profile_ids, 'simulations', result_summary);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_project_completion_status(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  v_deep_tier_enabled boolean;
  has_bom boolean := false;
  has_inbound boolean := false;
  has_outbound boolean := false;
  has_deep_tier_nodes boolean := false;
  has_deep_tier_edges boolean := false;
  is_complete boolean := false;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info and validate access
  SELECT organization, organization_id, bom_level, deep_tier_enabled
  INTO v_org, v_org_id, v_bom_level, v_deep_tier_enabled
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Check BOM data (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id)
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id) INTO has_outbound;

  -- Check deep tier datasets if enabled
  IF v_deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = p_project_id) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = p_project_id) INTO has_deep_tier_edges;
    is_complete := has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges;
  ELSE
    is_complete := has_bom AND has_inbound AND has_outbound;
  END IF;

  -- Update project completion status
  UPDATE public.projects 
  SET completed = is_complete, updated_at = now()
  WHERE id = p_project_id;

  -- Return status
  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'completed', is_complete,
    'bom_level', v_bom_level,
    'deep_tier_enabled', v_deep_tier_enabled,
    'datasets', jsonb_build_object(
      'has_bom', has_bom,
      'has_inbound', has_inbound,
      'has_outbound', has_outbound,
      'has_deep_tier_nodes', has_deep_tier_nodes,
      'has_deep_tier_edges', has_deep_tier_edges
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_scenario_effect_magnitude_by_profile(
  p_profile_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_magnitude numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_role text;
BEGIN
  -- Establish caller context for RLS helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  IF NOT EXISTS (
    SELECT 1
    FROM public.disruption_scenario_profiles sp
    JOIN public.projects p ON p.id = sp.project_id
    WHERE sp.id = p_profile_id
      AND public.org_is_current_user_org(p.organization_id, p.organization)
      AND (
        p.modeler_id = public.get_current_user_id()
        OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Update magnitude for all effects belonging to the profile_id
  UPDATE public.disruption_scenario_effects dse
  SET magnitude = p_magnitude,
      updated_at = now()
  WHERE dse.profile_id = p_profile_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upload_node_list_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
  v_plant text;
  inserted_count integer := 0;
  row_item jsonb;
BEGIN
  -- Set user context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, organization_id, modeler_id, plant_name INTO v_org, v_org_id, v_modeler, v_plant
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Process each row
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    -- Upsert node list data
    INSERT INTO public.node_list (
      project_id,
      plant_name,
      node_id,
      description_text,
      location_text,
      longitude,
      latitude,
      created_by,
      organization
    ) VALUES (
      p_project_id,
      COALESCE((row_item->>'plant_name')::text, v_plant),
      (row_item->>'node_id')::text,
      NULLIF(trim(row_item->>'description_text'), ''),
      NULLIF(trim(row_item->>'location_text'), ''),
      CASE 
        WHEN trim(row_item->>'longitude') = '' OR trim(row_item->>'longitude') IS NULL 
        THEN NULL 
        ELSE (row_item->>'longitude')::numeric 
      END,
      CASE 
        WHEN trim(row_item->>'latitude') = '' OR trim(row_item->>'latitude') IS NULL 
        THEN NULL 
        ELSE (row_item->>'latitude')::numeric 
      END,
      p_user_id,
      v_org
    )
    ON CONFLICT (project_id, node_id) 
    DO UPDATE SET
      description_text = EXCLUDED.description_text,
      location_text = EXCLUDED.location_text,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      updated_at = now();

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- Flush PostgREST's schema cache so the redefined RPCs are visible immediately.
SELECT pg_notify('pgrst', 'reload schema');
