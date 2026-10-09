-- §4 D305 · DELETING A DEEP-TIER DATASET FITS IN THE BROWSER'S STATEMENT TIMEOUT.
--
-- `20261009000002` replaces the per-ROW completion trigger on `network_nodes`,
-- `network_edges` and `network_summary` with per-STATEMENT triggers sharing one body. What
-- only a running database can settle:
--
--   §1 THE DELETE: 10 000 deep edges of one project are deleted through
--      `delete_project_dataset` as `anon` in under 3 s — the statement timeout the browser
--      runs under (measured with `clock_timestamp()`, because a timeout set inside a running
--      statement is never armed). With the old row trigger this took about 10 s locally (5.25 s at
--      8 000, 26.99 s at 20 000) and was cancelled.
--   §2 THE FLAG STILL MOVES: `projects.completed`, planted true, is recomputed (to false —
--      the project has no lane data) by an INSERT into each deep-tier table, and again by a
--      DELETE.
--   §3 THE TRIGGERS: on each of the three tables the row trigger is gone and the three
--      statement triggers exist, FOR EACH STATEMENT.
--   §4 GRANTS: neither `_project_completion_refresh` nor `_project_completion_touch` is
--      callable by PUBLIC, `anon` or `authenticated` (590 §7 holds every helper to this).

DO $d305$
DECLARE
  v_org  uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_p    uuid := gen_random_uuid();
  v_n    integer;
  v_t    text;
  v_t0   timestamptz;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'D305 Org', 'd305-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_user, 'd305@example.invalid', 'D305 Admin', 'x', 'admin', 'D305 Org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level, deep_tier_enabled) VALUES
    (v_p, 'D305 p', v_user, 'D305P', 'D305 Org', v_org, 'single', true);

  -- ── §2 the flag still moves (before the bulk rows, so each statement is small) ──
  FOREACH v_t IN ARRAY ARRAY['network_nodes', 'network_edges', 'network_summary'] LOOP
    UPDATE public.projects SET completed = true WHERE id = v_p;
    IF v_t = 'network_nodes' THEN
      INSERT INTO public.network_nodes (project_id, plant_name, organization, uid, depth)
      VALUES (v_p, 'D305P', 'D305 Org', 'd305-n1', 1);
    ELSIF v_t = 'network_edges' THEN
      INSERT INTO public.network_edges (project_id, plant_name, organization, src_uid, dst_uid, depth)
      VALUES (v_p, 'D305P', 'D305 Org', 'd305-a', 'd305-b', 1);
    ELSE
      INSERT INTO public.network_summary (project_id, plant_name, organization)
      VALUES (v_p, 'D305P', 'D305 Org');
    END IF;
    IF (SELECT completed FROM public.projects WHERE id = v_p) THEN
      RAISE EXCEPTION 'D305/880 §2: an INSERT into % did not recompute projects.completed', v_t;
    END IF;

    UPDATE public.projects SET completed = true WHERE id = v_p;
    EXECUTE format('DELETE FROM public.%I WHERE project_id = $1', v_t) USING v_p;
    IF (SELECT completed FROM public.projects WHERE id = v_p) THEN
      RAISE EXCEPTION 'D305/880 §2: a DELETE from % did not recompute projects.completed', v_t;
    END IF;
  END LOOP;

  -- ── §1 the delete, as the browser makes it ──────────────────────────────
  INSERT INTO public.network_edges (project_id, plant_name, organization, src_uid, dst_uid, depth)
  SELECT v_p, 'D305P', 'D305 Org', 'd305-s' || g, 'd305-d' || g, 1 FROM generate_series(1, 10000) g;
  PERFORM set_config('app.current_user_id', '', true);

  -- `statement_timeout` is armed when a top-level statement starts, so setting it inside
  -- this block would never fire; the elapsed time is measured instead, against the same 3 s.
  v_t0 := clock_timestamp();
  SET LOCAL ROLE anon;
  v_n := public.delete_project_dataset(v_p, 'network_edges', v_user, 'd305@example.invalid');
  RESET ROLE;
  IF clock_timestamp() - v_t0 > interval '3 seconds' THEN
    RAISE EXCEPTION 'D305/880 §1: deleting 10 000 deep edges as anon took % — over the browser''s 3 s statement timeout',
      clock_timestamp() - v_t0;
  END IF;
  IF v_n IS DISTINCT FROM 10000 OR EXISTS (SELECT 1 FROM public.network_edges WHERE project_id = v_p) THEN
    RAISE EXCEPTION 'D305/880 §1: the delete reported % row(s) and left % behind',
      v_n, (SELECT count(*) FROM public.network_edges WHERE project_id = v_p);
  END IF;

  -- ── §3 the triggers ──────────────────────────────────────────────────────
  FOREACH v_t IN ARRAY ARRAY['network_nodes', 'network_edges', 'network_summary'] LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || v_t)::regclass
                AND tgname = 'update_completion_on_' || v_t || '_change') THEN
      RAISE EXCEPTION 'D305/880 §3: the per-row completion trigger is still on %', v_t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_trigger
     WHERE tgrelid = ('public.' || v_t)::regclass
       AND tgname IN ('completion_touch_ins', 'completion_touch_upd', 'completion_touch_del')
       AND tgtype & 1 = 0;   -- FOR EACH STATEMENT
    IF v_n <> 3 THEN
      RAISE EXCEPTION 'D305/880 §3: % has % of the three statement-level completion triggers', v_t, v_n;
    END IF;
  END LOOP;

  -- ── §4 grants ────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN ('public._project_completion_refresh(uuid)'::regprocedure,
                              'public._project_completion_touch()'::regprocedure)
                AND a.privilege_type = 'EXECUTE'
                AND (a.grantee = 0
                     OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))) THEN
    RAISE EXCEPTION 'D305/880 §4: a completion helper is executable by PUBLIC, anon or authenticated';
  END IF;

  RAISE NOTICE 'D305/880: 10 000 deep edges delete inside the browser''s 3 s statement timeout';
END;
$d305$;
