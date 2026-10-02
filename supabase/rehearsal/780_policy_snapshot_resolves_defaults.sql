-- PLAN.md §23 WP 13.4 · §4 D204 (a) — THE POLICY SNAPSHOT STORES THE DEFAULTS THE PAGE SHOWS.
--
-- `20261002000010` merges each stored `policy_defaults` family over
-- `policy_bundle_defaults()` (the page's Zod defaults, generated). What only a
-- running database can settle:
--
--   §1 A project that saved NOTHING snapshots the page's defaults: backorders allowed,
--      κ = 8, a 1 000 units/day line rate at 85 % — the three D204 (a) measured.
--   §2 A stored value wins over the default, key by key; a stored key the bundle does
--      not know is kept; a stored JSON null family is all defaults.
--   §3 The version a save stores IS that snapshot, and the project is not dirty after
--      it (`current_policy_hash` = the version's `policy_hash`).

DO $wp134a$
DECLARE
  v_user uuid := gen_random_uuid();
  v_proj uuid := gen_random_uuid();
  v_snap jsonb;
  v_pv   uuid;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES (v_user, 'r780@example.invalid', 'R780', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R780', v_user, 'P');
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  UPDATE public.policy_defaults
     SET sourcing = '{}', inventory = '{}', transport = '{}', fulfillment = '{}',
         production = '{}', recovery = '{}', demand = '{}'
   WHERE project_id = v_proj;

  -- ══ §1 · nothing saved: the page's defaults ══
  v_snap := public._build_policy_snapshot(v_proj);
  IF (v_snap #> '{defaults,fulfillment,backorder_allowed}') IS DISTINCT FROM 'true'::jsonb
     OR (v_snap #> '{defaults,inventory,coverage_weeks}') IS DISTINCT FROM '8'::jsonb
     OR (v_snap #> '{defaults,production,capacity_units_per_day}') IS DISTINCT FROM '1000'::jsonb
     OR (v_snap #> '{defaults,production,utilization_cap_pct}') IS DISTINCT FROM '85'::jsonb THEN
    RAISE EXCEPTION 'R780 §1: an empty project does not snapshot the page''s defaults: %', v_snap -> 'defaults';
  END IF;
  IF (v_snap -> 'defaults' -> 'inventory') IS DISTINCT FROM (public.policy_bundle_defaults() -> 'inventory') THEN
    RAISE EXCEPTION 'R780 §1: an empty family is not exactly the bundle''s';
  END IF;

  -- ══ §2 · stored wins, unknown kept, null family = defaults ══
  UPDATE public.policy_defaults
     SET inventory = '{"coverage_weeks": 12, "r780_unknown": "kept"}',
         fulfillment = 'null'::jsonb
   WHERE project_id = v_proj;
  v_snap := public._build_policy_snapshot(v_proj);
  IF (v_snap #> '{defaults,inventory,coverage_weeks}') IS DISTINCT FROM '12'::jsonb
     OR (v_snap #>> '{defaults,inventory,r780_unknown}') IS DISTINCT FROM 'kept'
     OR (v_snap #> '{defaults,inventory,type}') IS DISTINCT FROM '"min_max"'::jsonb
     OR (v_snap #> '{defaults,fulfillment,backorder_allowed}') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'R780 §2: the merge is not stored-over-defaults: %', v_snap -> 'defaults';
  END IF;

  -- ══ §3 · the saved version is that snapshot, and the project is clean after it ══
  v_pv := public.snapshot_policy(v_proj, 'R780', v_user);
  IF (SELECT snapshot FROM public.policy_versions WHERE id = v_pv) IS DISTINCT FROM v_snap THEN
    RAISE EXCEPTION 'R780 §3: the stored version is not the resolved snapshot';
  END IF;
  IF (SELECT policy_hash FROM public.policy_versions WHERE id = v_pv) IS DISTINCT FROM public.current_policy_hash(v_proj) THEN
    RAISE EXCEPTION 'R780 §3: the project reads dirty right after a save';
  END IF;

  RAISE NOTICE 'WP 13.4: the policy snapshot stores the defaults the page shows (D204 a)';
END $wp134a$;
