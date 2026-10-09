-- Profile / §4 D304 — an ADMIN or OWNER of an organization may delete a project of it and
-- delete the data inside one, whatever the account role.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- Owner-requested, after D303 let an organization admin create projects: "admin of the
-- organization can also delete a project and delete the data within one project". Both
-- deleting writers authorize from the ACCOUNT role and the project's creator alone:
--
--   · `delete_project` (`20261001000017`) — the project's `modeler_id`, or an `admin` /
--     `super_admin` account working in the project's organization.
--   · `delete_project_dataset` (`20261003000001`) — the project's organization is the
--     caller's, AND (the `modeler_id`, or an `admin` / `super_admin` account).
--
-- Neither reads `organization_members.org_role`, so an organization Admin with a `user`
-- account was refused on every project but the ones it created itself.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `project_org_admin(user, project)` — the one new answer, authored once: the caller is
--     working in the project's organization (`approved_users.organization_id`, D210, the
--     same condition the account-admin branch already has) AND holds an `owner` or `admin`
--     membership of it.
--   · `delete_project` and `delete_project_dataset` — each body verbatim from the migration
--     named above, with that answer added as one more way through their existing check
--     (the lines marked D304). Nothing they admitted before is refused now.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- Uploading and editing a project's data and policies stay the project role's (D279), and
-- editing a project's settings stays `can_edit_project`'s: the organization role adds
-- DELETION, as asked, and nothing else. `delete-project` (the edge function) only calls
-- `delete_project`, so it needs no change. The caller's identity is client-asserted (D28).

-- ── 1 · the answer ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_org_admin(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.projects p
      JOIN public.approved_users au
        ON au.id = _user_id AND au.organization_id = p.organization_id
      JOIN public.organization_members m
        ON m.user_id = au.id AND m.org_id = p.organization_id AND m.org_role IN ('owner', 'admin')
     WHERE p.id = _project_id);
$$;
-- internal: reached through the two deleting writers. Supabase's default privileges grant
-- `anon` and `authenticated` EXECUTE on every new function (D278's §7), so both are named.
REVOKE ALL ON FUNCTION public.project_org_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_org_admin(uuid, uuid) IS
  'D304 — the caller works in the project''s organization and is an owner or admin of it. '
  'Read by delete_project and delete_project_dataset as one more way through their check.';

-- ── 2 · delete_project ───────────────────────────────────────────────────────
-- `20261001000017`'s body with the line marked D304.
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
    OR public.project_org_admin(p_user_id, p_project_id)   -- D304
  ) THEN
    RAISE EXCEPTION 'delete_project: % may not delete project % (only its creator, an app admin or an admin of its organization, working in it, may)',
      p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The actor, LOCAL to this transaction, so every trigger below names them.
  PERFORM public.set_current_user_context(p_user_id, COALESCE(p_user_email, ''));

  PERFORM public._delete_project_rows(p_project_id, p_user_id, p_user_email);
END;
$$;


-- ── 3 · delete_project_dataset ───────────────────────────────────────────────
-- `20261003000001`'s body with the check widened (marked D304).
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

  -- Authorization: same org AND (project owner or admin, or an admin of the organization — D304)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org)
     OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')
             OR public.project_org_admin(public.get_current_user_id(), p_project_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(p_dataset) = 'inbound' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'outbound' THEN
    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'demand_forecasts' THEN
    -- PLAN.md §24 WP 14.2 — the per-row forecast buckets.
    DELETE FROM public.demand_forecasts WHERE project_id = p_project_id;
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
  ELSIF lower(p_dataset) IN ('network_nodes','deep_nodes') THEN
    DELETE FROM public.network_nodes WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('network_edges','deep_edges') THEN
    DELETE FROM public.network_edges WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('network_summary','deep_summary') THEN
    DELETE FROM public.network_summary WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'deep_tier' THEN
    DELETE FROM public.network_edges WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := temp_count;

    DELETE FROM public.network_nodes WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    DELETE FROM public.network_summary WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;
  ELSIF lower(p_dataset) = 'node_list_uploads' THEN
    UPDATE public.node_list
       SET description_text = NULL,
           location_text    = NULL,
           latitude         = NULL,
           longitude        = NULL,
           updated_at       = now()
     WHERE project_id = p_project_id
       AND (description_text IS NOT NULL OR location_text IS NOT NULL
            OR latitude IS NOT NULL OR longitude IS NOT NULL);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
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

    DELETE FROM public.demand_forecasts WHERE project_id = p_project_id;
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

