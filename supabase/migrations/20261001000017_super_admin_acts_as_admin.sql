-- Admin / §4 — a `super_admin` holds every right an `admin` holds.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- `app_role` has four values (user, modeler, admin, super_admin). Twenty-seven functions
-- decide "the project's owner, or an app admin" by comparing the caller's role to the
-- literal 'admin', and `super_admin` is a different enum value, so the person with the
-- most authority was refused by the gates built for the one below it. Reported by a
-- super admin who could not upload a data file: `ingest_land_file` applies
-- `has_project_access`, which read `modeler_id = caller OR role = 'admin'`.
--
-- The same predicate was authored in three shapes — `has_project_access` (SQL),
-- `project_rights_for_user` (the browser's rights, whose `v_land` mirrors the upload
-- gate) and an inline `v_role = 'admin'` in twenty-five writers and readers — and the
-- browser's copy, `useProjectRights`, `ProjectCard` and the `combine-project` edge
-- function, are changed beside it in the same commit.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
-- Each function below is its LIVE definition, byte for byte, with the one role test
-- widened: `= 'admin'` → `IN ('admin', 'super_admin')`. Nothing else in any body moves.
--
-- ── WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
--
-- THE ORGANIZATION TEST STAYS. Where a function also requires the project to belong to
-- the caller's ACTIVE organization (`org_is_current_user_org`, or `delete_project`'s
-- "admin of its organization"), a super admin working in another organization is still
-- refused, exactly as an admin is. Choosing to skip it would let one account write into
-- any customer's data; that is a separate decision and was declined (option 1).
-- `project_rights_for_user` keeps `visible` and `can_edit_project` as they were — a super
-- admin already passed them through `v_super`; only `v_land` (the upload gate) widens.
--
-- Also unchanged: `approved_users_sync_org_membership` and
-- `organization_members_match_account`, which label an `admin` account an organization
-- 'admin' and every other role 'member'. That is a label on a membership row, not a gate
-- on a write, and widening it changes who appears as an organization admin.
--
-- Every function keeps its signature, so CREATE OR REPLACE keeps its grants.

-- has_project_access  (last defined in 20260829120000_erp_connector_phase1_2.sql)
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.modeler_id = public.get_current_user_id()
           OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) IN ('admin', 'super_admin'))
  );
$$;

-- project_rights_for_user  (last defined in 20261001000004_project_rights_in_the_project.sql)
CREATE OR REPLACE FUNCTION public.project_rights_for_user(p_user_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user     public.approved_users%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_active   boolean;
  v_super    boolean;
  v_member   boolean;
  v_here     boolean;
  v_land     boolean;
  v_resolved jsonb;
  v_caps     jsonb;
BEGIN
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_user_id;
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF v_user.id IS NULL OR v_project.id IS NULL THEN RETURN NULL; END IF;

  -- A suspended account cannot sign in (D205), so it holds nothing, whatever its role says.
  v_active := COALESCE(v_user.is_active, true);
  v_super  := (v_user.role = 'super_admin'::public.app_role);
  -- D231 — rights are stated as the account has them WHILE WORKING IN THE PROJECT'S
  -- ORGANIZATION: a member of it sees the project there, whichever organization it is
  -- in right now (`working_in_project_org` says which, for a page that wants to).
  v_member := v_project.organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                 WHERE om.org_id = v_project.organization_id AND om.user_id = v_user.id);
  v_here   := v_project.organization_id IS NOT NULL AND v_user.organization_id = v_project.organization_id;
  -- `has_project_access` — the gate `ingest_land_file` applies to every upload.
  v_land   := v_project.modeler_id = v_user.id OR v_user.role IN ('admin'::public.app_role, 'super_admin'::public.app_role);

  -- The resolver's project answer, for the keys its project layer has an opinion on.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_resolved
    FROM jsonb_each(public.capabilities_for_user(v_user.id, v_project.id) -> 'features') f
   WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_object_agg(r.key,
           to_jsonb(v_active AND COALESCE((r.value #>> '{}')::boolean, false)
                    AND (r.key <> 'data_edit_inputs' OR v_land))), '{}'::jsonb)
    INTO v_caps
    FROM jsonb_each(v_resolved) r;

  RETURN jsonb_build_object(
    'account_active',        v_active,
    'visible',               v_active AND (v_super OR v_member),
    'can_edit_project',      v_active AND (v_super OR (v_member AND (v_project.modeler_id = v_user.id
                                                                     OR v_user.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)))),
    'working_in_project_org', v_here,
    'may_land_uploads',      v_active AND v_land,
    'capabilities',          v_caps,
    'resolved_capabilities', v_resolved);
END; $$;

-- delete_project  (last defined in 20260930000002_admin_delete_organization.sql)
CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id uuid,
  p_user_id    uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists  boolean;
  v_org_id  uuid;
  v_modeler uuid;
  v_role    text;
  v_user_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'delete_project: this delete must name its actor'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT true, p.organization_id, p.modeler_id
    INTO v_exists, v_org_id, v_modeler
    FROM public.projects p
   WHERE p.id = p_project_id;
  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'delete_project: project % not found', p_project_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT au.role::text, au.organization_id INTO v_role, v_user_org
    FROM public.approved_users au WHERE au.id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'delete_project: % is not an approved user', p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
       v_modeler = p_user_id
    OR (v_role IN ('admin', 'super_admin') AND v_org_id IS NOT DISTINCT FROM v_user_org AND v_org_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'delete_project: % may not delete project % (only its owner or an admin of its organization may)',
      p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The actor, LOCAL to this transaction, so every trigger below names them.
  PERFORM public.set_current_user_context(p_user_id, COALESCE(p_user_email, ''));

  PERFORM public._delete_project_rows(p_project_id, p_user_id, p_user_email);
END;
$$;

-- bulk_insert_bom_single_level  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_bom_multi_level  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_inbound_logistics  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_outbound_logistics  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_multi_tier_supply_chain  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_tier2_suppliers  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_tier3_suppliers  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_network_nodes  (last defined in 20260915000004_org_identity_dual_read.sql)
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
     OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_network_edges  (last defined in 20260915000004_org_identity_dual_read.sql)
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
     OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- bulk_insert_network_summary  (last defined in 20250905160724_8fa65aa0-2b2c-4652-aee8-82b53ecc9d2a.sql)
CREATE OR REPLACE FUNCTION public.bulk_insert_network_summary(
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
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT p.organization, p.modeler_id INTO v_org, v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT au.role::text INTO v_role 
  FROM public.approved_users au 
  WHERE au.id = p_user_id 
  LIMIT 1;

  IF v_org <> (SELECT au.organization FROM public.approved_users au WHERE au.id = p_user_id LIMIT 1)
     OR NOT (v_modeler = p_user_id OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows into network_summary table
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_summary (
      project_id,
      plant_name,
      nodes_count,
      edges_count,
      tiers_data,
      created_by,
      uploaded_by,
      organization
    ) VALUES (
      p_project_id,
      p_plant_name,
      CASE WHEN r ? 'nodes_count' AND NULLIF(r->>'nodes_count','') IS NOT NULL THEN (r->>'nodes_count')::int ELSE NULL END,
      CASE WHEN r ? 'edges_count' AND NULLIF(r->>'edges_count','') IS NOT NULL THEN (r->>'edges_count')::int ELSE NULL END,
      CASE WHEN r ? 'tiers_data' THEN r->'tiers_data' ELSE NULL END,
      p_user_id,
      p_user_id,
      v_org
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- delete_project_dataset  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- combine_project_into_supply_chain  (last defined in 20261001000007_graph_levels_compute_once.sql)
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org     text;
  v_org_id  uuid;
  v_modeler uuid;
  v_role    text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
    FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- UNCHANGED (`20260920000003`): this path's authorization is D66's to move.
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org)
     OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM public.rebuild_supply_chain_lanes(p_project_id, p_user_id);
  -- WP 10.1 · §4 D234 — the world the combine ran over has a number.
  PERFORM public.snapshot_dataset(p_project_id,
    'After combine ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), p_user_id, p_user_email);
END;
$function$;

-- rebuild_node_list  (last defined in 20260920000001_one_node_classifier.sql)
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
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN public.node_list_discover(p_project_id, v_org, public.get_current_user_id());
END;
$$;

-- upload_node_list_data  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- seed_synthetic_simulation_data  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- create_disruption_scenario  (last defined in 20260915000004_org_identity_dual_read.sql)
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

  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- create_disruption_scenario_v2  (last defined in 20250828005114_4c7e88dc-9c73-4538-ab14-fe93b22d07dc.sql)
CREATE OR REPLACE FUNCTION public.create_disruption_scenario_v2(
  p_project_id uuid, 
  p_plant_name text, 
  p_scenario_name text, 
  p_user_id uuid, 
  p_user_email text, 
  p_status disruption_status DEFAULT 'draft'::disruption_status, 
  p_description text DEFAULT NULL::text, 
  p_tags text[] DEFAULT '{}'::text[], 
  p_targets jsonb DEFAULT NULL::jsonb, 
  p_effects jsonb DEFAULT NULL::jsonb, 
  p_settings jsonb DEFAULT NULL::jsonb,
  p_disruption_start date DEFAULT NULL::date,
  p_disruption_end date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  new_profile_id uuid;
  t jsonb;
  e jsonb;
  k text;
  v jsonb;
BEGIN
  -- Set user context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert profile with disruption dates
  INSERT INTO public.disruption_scenario_profiles (
    project_id, plant_name, scenario_name, status, description, tags, 
    created_by, organization, disruption_start, disruption_end
  ) VALUES (
    p_project_id, p_plant_name, p_scenario_name, COALESCE(p_status, 'draft'), 
    p_description, COALESCE(p_tags, '{}'), p_user_id, v_org, 
    p_disruption_start, p_disruption_end
  ) RETURNING id INTO new_profile_id;

  -- Insert targets
  IF p_targets IS NOT NULL AND jsonb_typeof(p_targets) = 'array' THEN
    FOR t IN SELECT * FROM jsonb_array_elements(p_targets) LOOP
      INSERT INTO public.disruption_scenario_targets (
        profile_id, target_type, node_ids, edge_list, selector
      ) VALUES (
        new_profile_id,
        COALESCE((t->>'target_type')::public.disruption_target_type, 'node'),
        CASE WHEN (t ? 'node_ids') THEN ARRAY(SELECT jsonb_array_elements_text(t->'node_ids')) ELSE NULL END,
        CASE WHEN (t ? 'edges') THEN t->'edges' ELSE NULL END,
        CASE WHEN (t ? 'selector') THEN t->'selector' ELSE NULL END
      );
    END LOOP;
  END IF;

  -- Insert effects
  IF p_effects IS NOT NULL AND jsonb_typeof(p_effects) = 'array' THEN
    FOR e IN SELECT * FROM jsonb_array_elements(p_effects) LOOP
      INSERT INTO public.disruption_scenario_effects (
        profile_id, effect_type, magnitude, unit
      ) VALUES (
        new_profile_id,
        (e->>'effect_type')::public.disruption_effect_type,
        COALESCE((e->>'magnitude')::numeric, 0),
        (e->>'unit')
      );
    END LOOP;
  END IF;

  -- Insert settings: accept object map or array of {key,value}
  IF p_settings IS NOT NULL THEN
    IF jsonb_typeof(p_settings) = 'object' THEN
      FOR k, v IN SELECT key, value FROM jsonb_each(p_settings) LOOP
        INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
        VALUES (new_profile_id, k, v)
        ON CONFLICT (profile_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END LOOP;
    ELSIF jsonb_typeof(p_settings) = 'array' THEN
      FOR e IN SELECT * FROM jsonb_array_elements(p_settings) LOOP
        INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
        VALUES (new_profile_id, e->>'key', COALESCE(e->'value', 'null'::jsonb))
        ON CONFLICT (profile_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END LOOP;
    END IF;
  END IF;

  RETURN new_profile_id;
END;
$function$;

-- delete_all_disruption_scenarios  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete all scenario profiles for this project (cascading deletes will handle related tables)
  DELETE FROM public.disruption_scenario_profiles 
  WHERE project_id = p_project_id;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$function$;

-- delete_disruption_scenario  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- create_simulation_result  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- get_simulation_results  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- delete_simulation_result  (last defined in 20260915000004_org_identity_dual_read.sql)
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
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete the simulation result
  DELETE FROM public.simulation_results WHERE id = p_simulation_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'simulation_not_found';
  END IF;
END;
$function$;

-- delete_simulation_results_batch  (last defined in 20260915000004_org_identity_dual_read.sql)
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
       NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
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

-- ai_can_access_project  (last defined in 20260915000004_org_identity_dual_read.sql)
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
    OR v_role IN ('admin', 'super_admin')
    OR v_plant_name IN (
      SELECT upa.plant
      FROM public.user_plant_access upa
      WHERE upa.user_id = public.get_current_user_id()
        AND upa.can_view = true
    )
  );
END;
$$;
