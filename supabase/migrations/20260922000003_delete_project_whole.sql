-- Project Manager / §4 D170 — deleting a project is ONE transaction, and it either
-- deletes the whole project or deletes nothing.
--
-- MEASURED BEFORE WRITING (§15 run `35790886083`, section (7)). Every "Delete project"
-- in production goes through the `delete-project` edge function, whose LIVE build is
-- from 2026-03-17 (§4 D168). It runs the deletion in the background, answers the
-- browser `202 Deletion started` before any of it has happened, then deletes table by
-- table in 200-row batches through a service-role client — and stops at
-- `product_code_map`, a table `20260916000003` dropped. Six attempts on one project
-- between 21:35 and 22:07 on 2026-09-22 each logged `PGRST205 … product_code_map`.
-- Each had already removed rows before failing (`node_list` 136, `bom_single_level`
-- 271), each wrote them with `actor_known: false`, and the project row is still there.
-- So in production a project CANNOT be deleted, and trying destroys its data.
--
-- THE FIX IS IN THE DATABASE BECAUSE ONLY THE DATABASE CAN MAKE IT ATOMIC. Batches
-- over PostgREST are N transactions; a failure in batch N leaves N-1 committed. This
-- function is one statement from the caller's side: if anything in it raises, nothing
-- it did survives.
--
-- It replaces the `delete_project` of `20260915000004`, which nothing calls (the
-- page calls the edge function) and which was wrong in four ways it would have shown
-- the first time anybody did:
--   · it read `projects.organization` (text) to decide the project EXISTS, so a
--     project with a NULL display org — `20260915000004` made the uuid the only
--     identity — reported `project_not_found`;
--   · it deleted the derived lanes BEFORE their sources, which §4 D142's statement
--     triggers now rebuild from the sources — derived rows could come back;
--   · it omitted `supply_chain_data_multi_tier`, `disruption_scenarios` and every
--     table that carries `project_id` with no foreign key, so the project delete
--     either failed or left them behind (§4 D117's class);
--
-- AUTHORIZATION, stated: the project's owner may delete it, and an `admin` may delete a
-- project of their own organization — the same "owner or admin" every other project
-- write in this schema uses (`has_project_access`, `combine_project_into_supply_chain`).
-- A `super_admin` is NOT admitted here, deliberately: no other project gate admits one,
-- and a card that offered Delete but refused Upload, Edit and Combine would be a
-- screen that lies about what its buttons do. Widening every gate together is an
-- access-control decision (§4 D66's, WP 7.1), not a side effect of fixing a delete. The actor
-- is a PARAMETER and is written into the GUC LOCAL to this transaction, so every
-- audit row this delete causes names who did it (`audit-actor`, G4) — which the
-- edge function's batches never did. It is client-asserted, as every actor in this
-- application is (§4 D28).
--
-- WHAT IS DELETED EXPLICITLY, and why only these: every table with a `project_id`
-- and NO foreign key to `projects` (the rest CASCADE, `20260919000005` gave the last
-- seven theirs). Logs are kept on purpose — `ai_chat_events`, `ai_usage_logs`,
-- `api_request_logs` record what happened, and deleting a project does not unhappen it.

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
    OR (v_role = 'admin' AND v_org_id IS NOT DISTINCT FROM v_user_org AND v_org_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'delete_project: % may not delete project % (only its owner or an admin of its organization may)',
      p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The actor, LOCAL to this transaction, so every trigger below names them.
  PERFORM public.set_current_user_context(p_user_id, COALESCE(p_user_email, ''));

  -- 1) Disruption profiles and their children, and the legacy scenarios table.
  DELETE FROM public.disruption_scenario_effects e USING public.disruption_scenario_profiles sp
   WHERE e.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_targets t USING public.disruption_scenario_profiles sp
   WHERE t.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_settings s USING public.disruption_scenario_profiles sp
   WHERE s.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_profiles WHERE project_id = p_project_id;
  DELETE FROM public.disruption_scenarios         WHERE project_id = p_project_id;

  -- 2) Results and the deep-tier network.
  DELETE FROM public.simulation_results WHERE project_id = p_project_id;
  DELETE FROM public.network_edges      WHERE project_id = p_project_id;
  DELETE FROM public.network_nodes      WHERE project_id = p_project_id;

  -- 3) SOURCES BEFORE DERIVED (§4 D142). The four lanes carry a statement trigger
  --    that rebuilds both edge tables from them; deleting them while the project row
  --    still exists rebuilds from EMPTY, which writes nothing.
  DELETE FROM public.inbound_logistics       WHERE project_id = p_project_id;
  DELETE FROM public.outbound_logistics      WHERE project_id = p_project_id;
  DELETE FROM public.bom_single_level        WHERE project_id = p_project_id;
  DELETE FROM public.bom_multi_level         WHERE project_id = p_project_id;
  DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;

  -- 4) Derived, now that nothing can re-derive them.
  DELETE FROM public.supply_chain_data            WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;
  DELETE FROM public.node_list                    WHERE project_id = p_project_id;

  -- 5) The project. Everything with a foreign key to it CASCADEs (or is SET NULL:
  --    chat threads and user files are detached, not destroyed).
  DELETE FROM public.projects WHERE id = p_project_id;

  -- 6) Belt to the braces: a trigger that fired inside step 5's cascade finds no
  --    project and writes nothing (`rebuild_supply_chain_lanes` checks), but these
  --    three tables have no foreign key to stop a row outliving its project, so the
  --    function says so in code rather than trusting every present and future trigger.
  DELETE FROM public.supply_chain_data            WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;
  DELETE FROM public.node_list                    WHERE project_id = p_project_id;
END;
$$;

COMMENT ON FUNCTION public.delete_project(uuid, uuid, text) IS
  'D170 — deletes ONE project and everything scoped to it in a single transaction: '
  'all of it or none of it. The owner or an admin of the project''s organization '
  'may call it; the actor is set LOCAL so every audit row names them. '
  'Sources are deleted before derived lanes (D142). Logs are kept.';

-- ONLY THE EDGE FUNCTION CALLS IT, SO ONLY THE SERVICE ROLE MAY. The version this
-- replaces carried no grant at all, so PUBLIC — `anon` included — held EXECUTE on a
-- SECURITY DEFINER delete whose actor is a parameter. Nothing in the browser calls it
-- (the page calls `delete-project`), so narrowing it breaks no caller.
REVOKE ALL ON FUNCTION public.delete_project(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_project(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(uuid, uuid, text) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
