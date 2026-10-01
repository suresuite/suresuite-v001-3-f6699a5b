-- §4 D247 · CAPACITY: ORGANIZATION POOL + ROLE SHARE (WP 10.7).
--
-- §1 an under-share run is admitted, and its reservation is a ledger row naming
--    the member, the organization and the replication-weeks.
-- §2 a role's in-flight allowance binds (P0429) where the plan caps concurrency.
-- §3 completion settles the reservation at what actually ran — a cancelled run
--    counts the replications it did.
-- §4 an over-share run is REFUSED (P0402, with the numbers), while the same run
--    is admitted for a role whose share covers it.
-- §5 the organization's pool binds even an owner (P0402).
-- §6 the per-run replication cap — the plan's and a caller's — refuses (P0403).
-- §7 a caller's concurrency cap (/v1's key-scoped limit) and the plan's (P0429).
-- §8 storage: a run whose expected bytes overflow the pool is refused; the sweep
--    expiring a run RELEASES its bytes (a ledger 'expire' row), and the same run
--    is then admitted.
-- §9 a per-organization override of a role's share replaces the default, and
--    the storage share binds.
-- §10 an attach or a reuse consumes nothing.
-- §11 an organization with no plan (and an account with no organization) has no
--    limits: two runs of one analyst both admitted.
-- §12 retention follows the plan: a new period re-dates the organization's
--    standard runs, NULL keeps them without limit; no organization keeps 90 days.
-- §13 the doors: the internal helpers are not API doors, the Lab's read is, the
--    ledger reads nothing to anon, and the admin RPCs refuse a non-super-admin.

-- The registry rows are seeded by migration `20261001000009`; a base built from
-- an artifact that already holds it has the table and not the rows (as 590).
INSERT INTO public.sim_engines (slug, name, status, capabilities) VALUES
  ('scsim', 'scsim — the strategic engine', 'active', '{"compute": ["worker", "browser"]}'::jsonb),
  ('legacy-worker', 'Legacy worker engine (frozen)', 'retired', '{"compute": ["worker"]}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

DO $cap610$
DECLARE
  v_super   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_editor  uuid := gen_random_uuid();
  v_analyst uuid := gen_random_uuid();
  v_solo    uuid := gen_random_uuid();
  v_org     uuid := gen_random_uuid();
  v_org2    uuid := gen_random_uuid();
  v_proj    uuid := gen_random_uuid();
  v_proj2   uuid := gen_random_uuid();
  v_proj3   uuid := gen_random_uuid();
  v_scen    uuid := gen_random_uuid();
  v_scen2   uuid := gen_random_uuid();
  v_scen3   uuid := gen_random_uuid();
  v_run1    uuid;
  v_run2    uuid;
  v_run3    uuid;
  v_res     jsonb;
  v_n       bigint;
  v_state   text;
  v_msg     text;
  v_exp     timestamptz;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;
  -- The seeded defaults; a base built from an artifact that already holds the
  -- migration has the table and not the rows (as 570, 590).
  INSERT INTO public.plan_role_allowances (org_id, project_role, compute_share_pct, storage_share_pct, max_concurrent)
  VALUES (NULL, 'owner', 100, 100, NULL), (NULL, 'editor', 60, 60, 3),
         (NULL, 'analyst', 25, 25, 1), (NULL, 'viewer', 0, 0, 0)
  ON CONFLICT ON CONSTRAINT plan_role_allowances_org_role_key DO NOTHING;

  -- A plan: 100 replication-weeks a month, 50 replications a run, 10 in flight.
  INSERT INTO public.organizations (id, name, slug, compute_quota_rep_weeks_month, max_replications_per_run, max_concurrent_runs)
  VALUES (v_org, 'R615 Org', 'r610-org', 100, 50, 10),
         (v_org2, 'R615 Free', 'r610-free', NULL, NULL, NULL);
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id) VALUES
    (v_super,   'R615 super',   'r610s@example.invalid', extensions.crypt('pw-super-1', extensions.gen_salt('bf')), 'super_admin', 'R615 Org', v_org),
    (v_owner,   'R615 owner',   'r610o@example.invalid', 'x', 'user', 'R615 Org', v_org),
    (v_editor,  'R615 editor',  'r610e@example.invalid', 'x', 'user', 'R615 Org', v_org),
    (v_analyst, 'R615 analyst', 'r610a@example.invalid', 'x', 'user', 'R615 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id) VALUES
    (v_proj, 'R615', v_owner, 'P', 'R615 Org', v_org),
    (v_proj2, 'R615 free', v_owner, 'P', 'R615 Free', v_org2);
  -- An account with no organization, and its project.
  INSERT INTO public.approved_users (id, name, email, password_hash) VALUES (v_solo, 'R615 solo', 'r610solo@example.invalid', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj3, 'R615 no org', v_solo, 'P');
  IF (SELECT organization_id FROM public.projects WHERE id = v_proj3) IS NOT NULL THEN
    RAISE EXCEPTION 'R615 setup: a project of an account with no organization has one';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = v_proj AND user_id = v_owner) THEN
    INSERT INTO public.project_members (project_id, user_id, project_role) VALUES (v_proj, v_owner, 'owner');
  END IF;
  INSERT INTO public.project_members (project_id, user_id, project_role) VALUES
    (v_proj, v_editor, 'editor'), (v_proj, v_analyst, 'analyst'), (v_proj2, v_analyst, 'analyst')
  ON CONFLICT DO NOTHING;
  -- 21 days = 3 weeks: a run of n replications is 3n replication-weeks.
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed, replications) VALUES
    (v_scen, v_proj, 'R615', 21, 42, 5), (v_scen2, v_proj2, 'R615 free', 21, 42, 5),
    (v_scen3, v_proj3, 'R615 no org', 21, 42, 5);

  -- ══ §1 · under-share admitted, reserved in the ledger ══
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 5, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst), true, false, NULL);
  v_run1 := (v_res ->> 'run_id')::uuid;
  IF v_run1 IS NULL THEN RAISE EXCEPTION 'R615 §1: an under-share run was not admitted: %', v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.run_usage WHERE run_id = v_run1 AND kind = 'dispatch'
                    AND rep_weeks = 15 AND user_id = v_analyst AND org_id = v_org AND project_id = v_proj) THEN
    RAISE EXCEPTION 'R615 §1: the reservation is not 15 replication-weeks for the analyst in the organization: %',
      (SELECT jsonb_agg(to_jsonb(u)) FROM public.run_usage u WHERE run_id = v_run1);
  END IF;

  -- ══ §2 · the role's in-flight allowance ══
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0429' THEN v_state := 'refused'; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NULL OR v_msg NOT LIKE '%analyst role allows 1%' THEN
    RAISE EXCEPTION 'R615 §2: an analyst''s second run in flight was not refused with its reason (%)', v_msg;
  END IF;

  -- ══ §3 · completion settles at what ran ══
  UPDATE public.simulation_runs SET status = 'cancelled', rep_count_done = 2, ended_at = now() WHERE id = v_run1;
  SELECT rep_weeks INTO v_n FROM public.run_usage WHERE run_id = v_run1 AND kind = 'complete';
  IF v_n IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'R615 §3: a cancelled run after 2 of 5 replications settled at % replication-weeks, not 6', v_n;
  END IF;
  IF public._compute_used(v_org, v_analyst) <> 6 THEN
    RAISE EXCEPTION 'R615 §3: the analyst''s month reads %, not the 6 settled', public._compute_used(v_org, v_analyst);
  END IF;

  -- ══ §4 · over-share refused, the same run admitted for a wider share ══
  -- analyst: 25 % of 100 = 25; 6 used; 7 replications = 21 → 27 > 25.
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 7, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0402' THEN v_state := 'refused'; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NULL OR v_msg NOT LIKE '%needs 21 replication-weeks; your analyst share is 25 this month and you have 19 left%' THEN
    RAISE EXCEPTION 'R615 §4: an over-share run was not refused with its numbers (%)', v_msg;
  END IF;
  IF EXISTS (SELECT 1 FROM public.simulation_runs WHERE project_id = v_proj AND rep_count_target = 7) THEN
    RAISE EXCEPTION 'R615 §4: a refused run left a row';
  END IF;
  -- 6 replications = 18 → 24 ≤ 25: admitted.
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 6, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst), true, false, NULL);
  v_run2 := (v_res ->> 'run_id')::uuid;
  IF v_run2 IS NULL THEN RAISE EXCEPTION 'R615 §4: a run inside the share was refused: %', v_res; END IF;
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 6, ended_at = now() WHERE id = v_run2;
  -- editor: 60 % = 60; 15 replications = 45 — far over the analyst's share, inside the editor's.
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 15, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_editor), true, false, NULL);
  v_run3 := (v_res ->> 'run_id')::uuid;
  IF v_run3 IS NULL THEN RAISE EXCEPTION 'R615 §4: an editor''s run inside the editor share was refused: %', v_res; END IF;
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 15, ended_at = now() WHERE id = v_run3;

  -- ══ §5 · the pool binds an owner ══
  -- used: 6 + 18 + 45 = 69; an owner's 12 replications = 36 → 105 > 100.
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 12, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_owner), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0402' THEN v_state := 'refused'; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NULL OR v_msg NOT LIKE '%the organization has 31 of 100 left this month%' THEN
    RAISE EXCEPTION 'R615 §5: the organization''s pool did not bind an owner (%)', v_msg;
  END IF;

  -- ══ §6 · replications per run ══
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 51, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_owner), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0403' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R615 §6: the plan''s per-run replication cap did not bind'; END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 4, 'policy_hash', 'ph', 'graph_hash', 'gh',
             'limits', jsonb_build_object('max_replications', 3)), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0403' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R615 §6: a caller''s replication cap did not bind'; END IF;

  -- ══ §7 · concurrency: the caller's cap and the plan's ══
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_owner), true, false, NULL);
  IF (v_res ->> 'run_id') IS NULL THEN RAISE EXCEPTION 'R615 §7: a small owner run was refused: %', v_res; END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh',
             'limits', jsonb_build_object('max_concurrent_runs', 1)), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0429' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R615 §7: a caller''s concurrency cap did not bind'; END IF;
  UPDATE public.organizations SET max_concurrent_runs = 1 WHERE id = v_org;
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_owner), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0429' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R615 §7: the plan''s concurrency cap did not bind'; END IF;
  UPDATE public.organizations SET max_concurrent_runs = 10 WHERE id = v_org;
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 1, ended_at = now(), series_bytes = 0
   WHERE project_id = v_proj AND status = 'queued';

  -- ══ §8 · storage: refused, released on expiry, admitted ══
  UPDATE public.organizations SET storage_quota_bytes = 1000, compute_quota_rep_weeks_month = 1000 WHERE id = v_org;
  UPDATE public.simulation_runs SET series_bytes = 600 WHERE id = v_run2;
  UPDATE public.simulation_runs SET series_bytes = 0 WHERE id IN (v_run1, v_run3);
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_owner,
             'bytes_estimate', 500), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0402' THEN v_state := 'refused'; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NULL OR v_msg NOT LIKE '%keeps 600 of 1000 bytes%' THEN
    RAISE EXCEPTION 'R615 §8: a run overflowing the storage pool was not refused (%)', v_msg;
  END IF;
  UPDATE public.simulation_runs SET series_expires_at = now() - interval '1 day' WHERE id = v_run2;
  PERFORM public.sweep_expired_run_series(100);
  IF NOT EXISTS (SELECT 1 FROM public.run_usage WHERE run_id = v_run2 AND kind = 'expire' AND bytes = -600
                    AND user_id = v_analyst AND org_id = v_org) THEN
    RAISE EXCEPTION 'R615 §8: expiry wrote no release to the ledger';
  END IF;
  IF public._storage_used(v_org) <> 0 THEN
    RAISE EXCEPTION 'R615 §8: an expired run''s bytes are still counted (%)', public._storage_used(v_org);
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_owner,
             'bytes_estimate', 500), true, false, NULL);
  IF (v_res ->> 'run_id') IS NULL THEN RAISE EXCEPTION 'R615 §8: the run was refused after the release: %', v_res; END IF;
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 1, ended_at = now(), series_bytes = 100
   WHERE id = (v_res ->> 'run_id')::uuid;

  -- ══ §9 · an organization's override of a role's share ══
  PERFORM public.admin_set_role_allowance(v_super, 'r610s@example.invalid', v_org, 'analyst', 100, 25, 5);
  IF (public._capacity_state(v_proj, v_analyst) -> 'share' ->> 'max_concurrent')::int <> 5 THEN
    RAISE EXCEPTION 'R615 §9: the organization''s override did not replace the default: %',
      public._capacity_state(v_proj, v_analyst);
  END IF;
  -- storage share 25 % of 1000 = 250; the analyst keeps nothing live (run2 expired).
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst,
             'bytes_estimate', 300), true, false, NULL);
  EXCEPTION WHEN SQLSTATE 'P0402' THEN v_state := 'refused'; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NULL OR v_msg NOT LIKE '%your analyst share is 250 bytes%' THEN
    RAISE EXCEPTION 'R615 §9: the storage share did not bind (%)', v_msg;
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst,
             'bytes_estimate', 200), true, false, NULL);
  IF (v_res ->> 'run_id') IS NULL THEN RAISE EXCEPTION 'R615 §9: a run inside the storage share was refused'; END IF;

  -- ══ §10 · a reuse or an attach consumes nothing ══
  SELECT count(*) INTO v_n FROM public.run_usage WHERE kind = 'dispatch';
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst,
             'bytes_estimate', 200), false, true, NULL);
  -- A completed identical run exists (the editor's), so this is offered for reuse.
  IF v_res -> 'reuse' IS NULL THEN
    RAISE EXCEPTION 'R615 §10: an identical completed run was not offered for reuse: %', v_res;
  END IF;
  -- With no completed one to offer (forced past reuse), the queued one is attached.
  v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj,
             'rep_count_target', 1, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst,
             'bytes_estimate', 200), true, true, NULL);
  IF NOT COALESCE((v_res ->> 'attached')::boolean, false) THEN
    RAISE EXCEPTION 'R615 §10: an identical in-flight submission did not attach: %', v_res;
  END IF;
  IF (SELECT count(*) FROM public.run_usage WHERE kind = 'dispatch') <> v_n THEN
    RAISE EXCEPTION 'R615 §10: an attach reserved capacity';
  END IF;

  -- ══ §11 · no plan, no limits ══
  FOR i IN 1..2 LOOP
    v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen2, 'project_id', v_proj2,
               'rep_count_target', 200, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_analyst,
               'bytes_estimate', 1000000000), true, false, NULL);
    IF (v_res ->> 'run_id') IS NULL THEN RAISE EXCEPTION 'R615 §11: an organization without a plan was limited'; END IF;
    v_res := public.create_simulation_run(jsonb_build_object('scenario_id', v_scen3, 'project_id', v_proj3,
               'rep_count_target', 200, 'policy_hash', 'ph', 'graph_hash', 'gh', 'actor_user_id', v_solo), true, false, NULL);
    IF (v_res ->> 'run_id') IS NULL THEN RAISE EXCEPTION 'R615 §11: an account without an organization was limited'; END IF;
  END LOOP;

  -- ══ §12 · retention from the plan ══
  IF public.run_series_retention(v_proj) <> interval '90 days' OR public.run_series_retention(v_proj3) <> interval '90 days' THEN
    RAISE EXCEPTION 'R615 §12: the default period is not 90 days (%, %)',
      public.run_series_retention(v_proj), public.run_series_retention(v_proj3);
  END IF;
  PERFORM public.admin_set_org_capacity(v_super, 'r610s@example.invalid', v_org, 1000, 1000, 50, 10, 30);
  SELECT series_expires_at INTO v_exp FROM public.simulation_runs WHERE id = v_run3;
  IF v_exp IS NULL OR v_exp > now() + interval '31 days' OR v_exp < now() + interval '29 days' THEN
    RAISE EXCEPTION 'R615 §12: a 30-day plan did not re-date the organization''s standard runs (%)', v_exp;
  END IF;
  PERFORM public.admin_set_org_capacity(v_super, 'r610s@example.invalid', v_org, 1000, 1000, 50, 10, NULL);
  IF (SELECT series_expires_at FROM public.simulation_runs WHERE id = v_run3) IS NOT NULL
     OR public.run_series_retention(v_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'R615 §12: an unlimited plan still expires its runs';
  END IF;

  -- ══ §13 · the doors ══
  IF has_function_privilege('anon', 'public._capacity_admit(uuid,uuid,integer,bigint,bigint,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._capacity_state(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._compute_used(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._storage_used(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R615 §13: an internal capacity helper is an API door';
  END IF;
  SET LOCAL ROLE anon;
  v_res := public.get_my_capacity(v_proj, v_analyst);
  BEGIN
    SELECT count(*) INTO v_n FROM public.run_usage;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
  END;
  v_state := NULL;
  BEGIN
    PERFORM public.admin_set_role_allowance(v_owner, 'r610o@example.invalid', v_org, 'viewer', 100, 100, NULL);
  EXCEPTION WHEN OTHERS THEN v_state := 'refused';
  END;
  RESET ROLE;
  IF v_res ->> 'role' <> 'analyst' OR (v_res -> 'pool' ->> 'compute_quota_rep_weeks_month')::int <> 1000 THEN
    RAISE EXCEPTION 'R615 §13: the Lab''s read as anon is not the analyst''s picture: %', v_res;
  END IF;
  IF v_n <> 0 THEN RAISE EXCEPTION 'R615 §13: anon read % ledger rows', v_n; END IF;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R615 §13: a non-super-admin set a role''s share'; END IF;

  RAISE NOTICE 'R615 ok — under-share admitted, over-share refused, pool, caps, release on expiry, no plan no limits';
END
$cap610$;
