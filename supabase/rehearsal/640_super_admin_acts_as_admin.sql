-- A `super_admin` HOLDS EVERY RIGHT AN `admin` HOLDS — `20261001000017`.
--
-- A super admin could not upload a data file: `ingest_land_file` applies
-- `has_project_access`, which read `modeler_id = caller OR role = 'admin'`, and
-- `super_admin` is a different `app_role`. Twenty-seven functions spelt the same test.
--
--   §1 THE UPLOAD GATE: `has_project_access` is true for the project's owner, an admin and
--      a super admin, and false for a modeler who is none of them.
--   §2 THE BROWSER'S COPY: `project_rights_for_user.may_land_uploads` says the same, so the
--      screen and the server cannot disagree.
--   §3 A WRITER: `get_simulation_results` (one of the twenty-five inline copies) admits a
--      super admin of the project's organization and still refuses the same modeler.
--   §4 THE ORGANIZATION TEST STAYS (option 1): a super admin ACTIVE IN ANOTHER organization
--      is refused by the same writer, exactly as an admin there would be.
--   §5 NO FUNCTION IS LEFT BEHIND: none of the twenty-seven live definitions compares a
--      role to the bare literal 'admin' without also naming 'super_admin'.

DO $d640$
DECLARE
  v_org_a   uuid := gen_random_uuid();
  v_org_b   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();
  v_super_b uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_proj    uuid := gen_random_uuid();
  v_who     uuid;
  v_label   text;
  v_got     boolean;
  v_bad     text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D640 A', 'd640a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D640 B', 'd640b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, is_active) VALUES
    (v_owner,   'D640 owner',   'd640o@example.invalid',  'x', 'modeler',     'D640 A', v_org_a, true),
    (v_admin,   'D640 admin',   'd640a@example.invalid',  'x', 'admin',       'D640 A', v_org_a, true),
    (v_super,   'D640 super',   'd640s@example.invalid',  'x', 'super_admin', 'D640 A', v_org_a, true),
    (v_super_b, 'D640 super B', 'd640sb@example.invalid', 'x', 'super_admin', 'D640 B', v_org_b, true),
    (v_other,   'D640 other',   'd640x@example.invalid',  'x', 'modeler',     'D640 A', v_org_a, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level)
    VALUES (v_proj, 'D640 project', v_owner, 'D640 plant', 'D640 A', v_org_a, 'single');

  -- ══ §1 · the upload gate ══
  FOR v_who, v_label, v_got IN
    SELECT * FROM (VALUES (v_owner, 'owner', true), (v_admin, 'admin', true),
                          (v_super, 'super_admin', true), (v_other, 'modeler', false)) t(u, l, want)
  LOOP
    PERFORM set_config('app.current_user_id', v_who::text, true);
    IF public.has_project_access(v_proj) IS DISTINCT FROM v_got THEN
      RAISE EXCEPTION 'D640/640 §1: has_project_access for a % is %, want %',
        v_label, NOT v_got, v_got;
    END IF;
  END LOOP;

  -- ══ §2 · the browser's copy ══
  FOR v_who, v_label, v_got IN
    SELECT * FROM (VALUES (v_owner, 'owner', true), (v_admin, 'admin', true),
                          (v_super, 'super_admin', true), (v_other, 'modeler', false)) t(u, l, want)
  LOOP
    IF (public.project_rights_for_user(v_who, v_proj) ->> 'may_land_uploads')::boolean
         IS DISTINCT FROM v_got THEN
      RAISE EXCEPTION 'D640/640 §2: may_land_uploads for a % is not %', v_label, v_got;
    END IF;
  END LOOP;

  -- ══ §3 · a writer, as the browser calls it ══
  SET LOCAL ROLE anon;
  PERFORM * FROM public.get_simulation_results(v_proj, v_super, 'd640s@example.invalid');
  BEGIN
    PERFORM * FROM public.get_simulation_results(v_proj, v_other, 'd640x@example.invalid');
    RAISE EXCEPTION 'D640/640 §3: a modeler who is not the owner read the results';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;

  -- ══ §4 · the organization test stays ══
  BEGIN
    PERFORM * FROM public.get_simulation_results(v_proj, v_super_b, 'd640sb@example.invalid');
    RAISE EXCEPTION 'D640/640 §4: a super admin active in ANOTHER organization read this project''s results';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- ══ §5 · none left behind ══
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = ANY (ARRAY[
       'has_project_access','project_rights_for_user','delete_project',
       'bulk_insert_bom_single_level','bulk_insert_bom_multi_level','bulk_insert_inbound_logistics',
       'bulk_insert_outbound_logistics','bulk_insert_multi_tier_supply_chain','bulk_insert_tier2_suppliers',
       'bulk_insert_tier3_suppliers','bulk_insert_network_nodes','bulk_insert_network_edges',
       'bulk_insert_network_summary','delete_project_dataset','combine_project_into_supply_chain',
       'rebuild_node_list','upload_node_list_data','seed_synthetic_simulation_data',
       'create_disruption_scenario','create_disruption_scenario_v2','delete_all_disruption_scenarios',
       'delete_disruption_scenario','create_simulation_result','get_simulation_results',
       'delete_simulation_result','delete_simulation_results_batch','ai_can_access_project'])
     -- The 11-argument `create_disruption_scenario_v2` was dropped by `20250902084844`; the
     -- introspector does not follow that drop (it names `disruption_status` unqualified), so
     -- a base built from its artifact still carries it. Production does not — and re-creating
     -- it here would bring back the ambiguity that drop removed. Only the live 13-argument one.
     AND NOT (p.proname = 'create_disruption_scenario_v2' AND p.pronargs <> 13)
     AND pg_get_functiondef(p.oid) ~ '''admin''' AND pg_get_functiondef(p.oid) !~ 'super_admin';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'D640/640 §5: these functions still test the bare admin role: %', v_bad;
  END IF;
END $d640$;
