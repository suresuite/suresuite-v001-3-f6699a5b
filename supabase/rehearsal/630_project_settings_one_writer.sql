-- §4 D254 · A PROJECT'S SETTINGS HAVE ONE WRITER PER VERB.
--
-- "Enable Deep Tier Network Analysis" did not save from the project's edit form: the
-- page sends `p_data_type`, which resolved the `update_project` overload that has no
-- deep-tier parameter. `20261001000015` drops every overload of `update_project` and
-- `create_project` and creates one of each taking both settings. Every call is made AS
-- anon — the browser's role (D155) — with the page's own named arguments.
--
--   §1 ONE OF EACH: exactly one `update_project` and one `create_project` exist.
--   §2 CREATE: the create form's call (data type AND deep tier) stores both; a call
--      that names neither (the seed scripts', the duplicate's before D254) stores the
--      column defaults.
--   §3 THE DEFECT: the edit form's call — every argument the page sends, deep tier on —
--      stores deep tier ON, and the next call turning it off stores OFF.
--   §4 OMISSION KEEPS: a call that names neither setting changes neither.
--   §5 GRANTS: anon and authenticated are EXPLICIT grantees; PUBLIC is not.

DO $d254$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_p1    uuid;
  v_p2    uuid;
  v_row   record;
BEGIN
  -- ══ §1 · one of each ══
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'update_project'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'D254/630 §1: update_project has more than one overload';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'create_project'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'D254/630 §1: create_project has more than one overload';
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'D254 Org', 'd254-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, is_active) VALUES
    (v_owner, 'D254 owner', 'd254o@example.invalid', 'x', 'modeler', 'D254 Org', v_org, true);

  -- ══ §2 · create ══
  SET LOCAL ROLE anon;
  v_p1 := public.create_project(p_name => 'D254 one', p_plant => 'D254 plant', p_model => 'Make-To-Order',
            p_bom_level => 'single', p_user_id => v_owner, p_user_email => 'd254o@example.invalid',
            p_user_name => 'D254 owner', p_simulation_start => DATE '2026-01-01',
            p_simulation_end => DATE '2026-12-31', p_data_type => 'uncurated',
            p_deep_tier_enabled => true);
  v_p2 := public.create_project(p_name => 'D254 two', p_plant => 'D254 plant', p_model => 'Make-To-Order',
            p_bom_level => 'single', p_user_id => v_owner, p_user_email => 'd254o@example.invalid',
            p_user_name => 'D254 owner');
  RESET ROLE;
  SELECT data_type, deep_tier_enabled INTO v_row FROM public.projects WHERE id = v_p1;
  IF v_row.data_type IS DISTINCT FROM 'uncurated' OR v_row.deep_tier_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'D254/630 §2: create stored data_type=% deep_tier=% (want uncurated, true)',
      v_row.data_type, v_row.deep_tier_enabled;
  END IF;
  SELECT data_type, deep_tier_enabled INTO v_row FROM public.projects WHERE id = v_p2;
  IF v_row.data_type IS DISTINCT FROM 'curated' OR v_row.deep_tier_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'D254/630 §2: create without settings stored data_type=% deep_tier=% (want curated, false)',
      v_row.data_type, v_row.deep_tier_enabled;
  END IF;

  -- ══ §3 · the defect: the edit form's call ══
  SET LOCAL ROLE anon;
  PERFORM public.update_project(p_project_id => v_p2, p_name => 'D254 two', p_plant => 'D254 plant',
            p_model => 'Make-To-Stock', p_bom_level => 'multi', p_user_id => v_owner,
            p_user_email => 'd254o@example.invalid', p_simulation_start => DATE '2026-01-01',
            p_simulation_end => DATE '2026-12-31', p_data_type => 'curated',
            p_deep_tier_enabled => true);
  RESET ROLE;
  SELECT supply_chain_model, bom_level, deep_tier_enabled INTO v_row FROM public.projects WHERE id = v_p2;
  IF v_row.deep_tier_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'D254/630 §3: the edit form turned deep tier on and the project stores %', v_row.deep_tier_enabled;
  END IF;
  IF v_row.supply_chain_model <> 'Make-To-Stock' OR v_row.bom_level <> 'multi' THEN
    RAISE EXCEPTION 'D254/630 §3: the other settings of the same call were not stored';
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.update_project(p_project_id => v_p2, p_name => 'D254 two', p_plant => 'D254 plant',
            p_model => 'Make-To-Stock', p_bom_level => 'multi', p_user_id => v_owner,
            p_user_email => 'd254o@example.invalid', p_simulation_start => DATE '2026-01-01',
            p_simulation_end => DATE '2026-12-31', p_data_type => 'uncurated',
            p_deep_tier_enabled => false);
  RESET ROLE;
  SELECT data_type, deep_tier_enabled INTO v_row FROM public.projects WHERE id = v_p2;
  IF v_row.deep_tier_enabled IS DISTINCT FROM false OR v_row.data_type IS DISTINCT FROM 'uncurated' THEN
    RAISE EXCEPTION 'D254/630 §3: turning deep tier off stored % (data_type %)', v_row.deep_tier_enabled, v_row.data_type;
  END IF;

  -- ══ §4 · omission keeps ══
  SET LOCAL ROLE anon;
  PERFORM public.update_project(p_project_id => v_p1, p_name => 'D254 one renamed', p_plant => 'D254 plant',
            p_model => 'Make-To-Order', p_bom_level => 'single', p_user_id => v_owner,
            p_user_email => 'd254o@example.invalid');
  RESET ROLE;
  SELECT name, data_type, deep_tier_enabled INTO v_row FROM public.projects WHERE id = v_p1;
  IF v_row.name <> 'D254 one renamed' THEN
    RAISE EXCEPTION 'D254/630 §4: the rename was not stored';
  END IF;
  IF v_row.data_type IS DISTINCT FROM 'uncurated' OR v_row.deep_tier_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'D254/630 §4: a call naming neither setting reset them to data_type=% deep_tier=%',
      v_row.data_type, v_row.deep_tier_enabled;
  END IF;
END $d254$;

-- ══ §5 · grants ══
DO $d254grants$
DECLARE
  v_fn   text;
  v_role text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.update_project(uuid, text, text, text, text, uuid, text, date, date, text, boolean)',
    'public.create_project(text, text, text, text, uuid, text, text, date, date, text, boolean)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
         WHERE p.oid = v_fn::regprocedure AND x.grantee = v_role::regrole
           AND x.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'D254/630 §5: % is not an EXPLICIT grantee of %', v_role, v_fn;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = v_fn::regprocedure AND x.grantee = 0) THEN
      RAISE EXCEPTION 'D254/630 §5: PUBLIC still holds EXECUTE on %', v_fn;
    END IF;
  END LOOP;
END $d254grants$;
