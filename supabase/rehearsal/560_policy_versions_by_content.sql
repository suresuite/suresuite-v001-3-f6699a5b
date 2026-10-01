-- §4 D241, D242 · A POLICY VERSION IS ITS CONTENT, AND A CARD IS FOUND BY IT (WP 10.2).
--
-- What only a running database can settle:
--
-- §1 two saves of identical content are ONE row: the second call returns the first
--    id, inserts nothing, and appends a new note exactly once (a retry does not
--    double it).
-- §2 an edit mints a new version numbered v2; REVERTING the edit returns v1's id —
--    not a third row carrying v1's hash.
-- §3 a row inserted directly (the API roles still hold INSERT) is numbered too, and
--    a legacy duplicate of an existing content shares that content's number.
-- §4 a card recorded under one version id is found from ANOTHER id with the same
--    hash, through both the old entry point and the by-content one; recording again
--    under the other id supersedes it (one active card per content triple).
-- §5 inheritance applies a current card and REFUSES one the project has drifted
--    from (policy edited) or a scenario outside its world (fingerprint differs).
-- §6 the two functions whose shape changed are callable by the API roles, read
--    from `proacl` for an explicit grantee (WP 6.2 slice 12's method).

DO $pv560$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_proj    uuid := gen_random_uuid();
  v_scen    uuid := gen_random_uuid();
  v_scen2   uuid := gen_random_uuid();
  v_a       uuid;
  v_a2      uuid;
  v_b       uuid;
  v_back    uuid;
  v_dup     uuid := gen_random_uuid();
  v_direct  uuid := gen_random_uuid();
  v_ds      uuid;
  v_card    uuid;
  v_card2   uuid;
  v_found   uuid;
  v_n       integer;
  v_no      integer;
  v_notes   text;
  v_hash    text;
  v_state   text;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'r560@example.invalid', 'R560', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_proj, 'R560', v_user, 'P');
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;

  -- ══ §1 · identical content → one row ══
  v_a  := public.snapshot_policy(v_proj, 'first', v_user, NULL, NULL, NULL, 'note one');
  v_a2 := public.snapshot_policy(v_proj, 'second save, same content', v_user, NULL, NULL, NULL, 'note two');
  IF v_a2 IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'R560 §1: an identical save minted a new version (% then %) — D241', v_a, v_a2;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_versions WHERE project_id = v_proj;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R560 §1: % rows for one content, expected 1', v_n;
  END IF;
  PERFORM public.snapshot_policy(v_proj, NULL, v_user, NULL, NULL, NULL, 'note two');
  SELECT notes, version_no INTO v_notes, v_no FROM public.policy_versions WHERE id = v_a;
  IF v_notes IS DISTINCT FROM E'note one\n\nnote two' THEN
    RAISE EXCEPTION 'R560 §1: notes are %, expected both notes once each', quote_literal(v_notes);
  END IF;
  IF v_no IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'R560 §1: the first version is numbered %, not 1', v_no;
  END IF;

  -- ══ §2 · an edit is v2; reverting it is v1 again ══
  UPDATE public.policy_defaults
     SET inventory = COALESCE(inventory, '{}'::jsonb) || '{"r560_marker": 1}'::jsonb
   WHERE project_id = v_proj;
  v_b := public.snapshot_policy(v_proj, 'edited', v_user);
  IF v_b = v_a THEN
    RAISE EXCEPTION 'R560 §2: an edited policy returned the old version';
  END IF;
  SELECT version_no INTO v_no FROM public.policy_versions WHERE id = v_b;
  IF v_no IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R560 §2: the edited version is numbered %, not 2', v_no;
  END IF;
  UPDATE public.policy_defaults
     SET inventory = inventory - 'r560_marker'
   WHERE project_id = v_proj;
  v_back := public.snapshot_policy(v_proj, 'reverted', v_user);
  IF v_back IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'R560 §2: reverting the edit returned %, not the original version %', v_back, v_a;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_versions WHERE project_id = v_proj;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'R560 §2: % rows after edit + revert, expected 2', v_n;
  END IF;

  -- ══ §3 · a direct INSERT is numbered; a legacy duplicate shares its content's number ══
  SELECT policy_hash INTO v_hash FROM public.policy_versions WHERE id = v_a;
  INSERT INTO public.policy_versions (id, project_id, snapshot, policy_hash, created_at)
    SELECT v_dup, v_proj, snapshot, policy_hash, now() + interval '1 second'
      FROM public.policy_versions WHERE id = v_a;
  SELECT version_no INTO v_no FROM public.policy_versions WHERE id = v_dup;
  IF v_no IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'R560 §3: a duplicate of v1''s content was numbered %, not 1', v_no;
  END IF;
  INSERT INTO public.policy_versions (id, project_id, snapshot, policy_hash)
    VALUES (v_direct, v_proj, '{"r560": "other"}'::jsonb, 'r560-other-hash');
  SELECT version_no INTO v_no FROM public.policy_versions WHERE id = v_direct;
  IF v_no IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'R560 §3: a new content inserted directly was numbered %, not 3', v_no;
  END IF;
  -- And the save still answers the OLDEST row of a content, never the duplicate.
  IF public.snapshot_policy(v_proj, NULL, v_user) IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'R560 §3: with a duplicate present, the save did not return the oldest row';
  END IF;

  -- ══ §4 · a card is found by content, from any version id with that hash ══
  INSERT INTO public.scenarios (id, project_id, name) VALUES (v_scen, v_proj, 'R560 baseline');
  v_ds := public.snapshot_dataset(v_proj, NULL, v_user);
  v_card := public.record_model_validation(
    v_proj, v_a, v_ds, v_scen, 70, 'engine', 12,
    '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'validated', 'face', NULL, v_user, NULL);

  SELECT id INTO v_found FROM public.active_model_validation(
    v_dup, (SELECT graph_hash FROM public.dataset_versions WHERE id = v_ds),
    public.scenario_fingerprint_hash(v_scen));
  IF v_found IS DISTINCT FROM v_card THEN
    RAISE EXCEPTION 'R560 §4: the card recorded on version A was not found from version B with the same hash (got %) — D242', v_found;
  END IF;
  SELECT id INTO v_found FROM public.active_model_validation_by_content(
    v_proj, v_hash, (SELECT graph_hash FROM public.dataset_versions WHERE id = v_ds),
    public.scenario_fingerprint_hash(v_scen));
  IF v_found IS DISTINCT FROM v_card THEN
    RAISE EXCEPTION 'R560 §4: active_model_validation_by_content did not find the card';
  END IF;

  v_card2 := public.record_model_validation(
    v_proj, v_dup, v_ds, v_scen, 84, 'engine', 20,
    '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'validated', 'face', NULL, v_user, NULL);
  SELECT count(*) INTO v_n FROM public.model_validations
   WHERE project_id = v_proj AND status = 'active';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R560 §4: % active cards for one content triple, expected 1', v_n;
  END IF;
  IF (SELECT superseded_by FROM public.model_validations WHERE id = v_card) IS DISTINCT FROM v_card2 THEN
    RAISE EXCEPTION 'R560 §4: recording under the other id did not supersede the first card';
  END IF;

  -- ══ §5 · inheritance: current card applies, drift refuses ══
  PERFORM public.apply_validation_to_scenario(v_scen, v_card2, v_user);
  IF (SELECT inherited_validation_id FROM public.scenarios WHERE id = v_scen) IS DISTINCT FROM v_card2 THEN
    RAISE EXCEPTION 'R560 §5: a current card was not applied';
  END IF;

  INSERT INTO public.scenarios (id, project_id, name, horizon_days)
    VALUES (v_scen2, v_proj, 'R560 other world', 999);
  v_state := NULL;
  BEGIN
    PERFORM public.apply_validation_to_scenario(v_scen2, v_card2, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R560 §5: a card was applied to a scenario outside its world';
  END IF;

  UPDATE public.policy_defaults
     SET inventory = COALESCE(inventory, '{}'::jsonb) || '{"r560_marker": 2}'::jsonb
   WHERE project_id = v_proj;
  v_state := NULL;
  BEGIN
    PERFORM public.apply_validation_to_scenario(v_scen, v_card2, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R560 §5: a card was applied after the project''s policies drifted from it';
  END IF;

  -- ══ §6 · grants, read from proacl ══
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    SELECT count(*) INTO v_n
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE p.oid IN ('public.list_policy_versions(uuid)'::regprocedure,
                     'public.active_model_validation_by_content(uuid,text,text,text)'::regprocedure)
       AND r.rolname IN ('anon', 'authenticated')
       AND a.privilege_type = 'EXECUTE';
    IF v_n < 4 THEN
      RAISE EXCEPTION 'R560 §6: % of 4 explicit EXECUTE grants present (anon/authenticated × 2 functions)', v_n;
    END IF;
  END IF;
END
$pv560$;
