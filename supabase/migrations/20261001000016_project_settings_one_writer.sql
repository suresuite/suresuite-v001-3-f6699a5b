-- A project's settings have ONE writer per verb (PLAN.md §4 D255).
--
-- "Enable Deep Tier Network Analysis" on /project-manager did not save. The switch was
-- read into the form, and the Save button reported success, and the next load showed it
-- off again. Nothing refused it: the setting was never sent anywhere that writes it.
--
-- `update_project` had FIVE live overloads and `create_project` SIX. Two migrations,
-- three weeks apart, each added a tenth parameter to a different copy:
--
--   20250906113204  update_project(… date, date, p_deep_tier_enabled boolean)
--   20250923105656  create_project(… date, date, p_deep_tier_enabled boolean)
--   20250923120308  update_project(… date, date, p_data_type text)
--                   create_project(… date, date, p_data_type text)
--
-- The page sends `p_data_type`, so PostgREST resolves the `text` overload — the one that
-- has no deep-tier parameter and never touches the column. Adding `p_deep_tier_enabled`
-- to the call would not have helped: no overload takes BOTH names, so the call would
-- have stopped resolving at all. The fix landed in one copy and the page reached the
-- other — §4 D145's class, and the reason `dataPlaneAudit.test.ts` pins the list of
-- overloaded names so it may shrink and may not grow.
--
-- So every overload is dropped and ONE of each is created, taking both settings:
--
--   · `update_project` keeps the stored value when a setting is NOT supplied
--     (`COALESCE(p, column)`), as `p_data_type` already did — a caller that predates a
--     setting cannot reset it by omission;
--   · `create_project` defaults `deep_tier_enabled` to false and `data_type` to
--     'curated', the column defaults.
--
-- The bodies are otherwise the live `text` overloads' (20250923120308), unchanged: the
-- caller's context through `set_current_user_context`, so the audit row names the actor
-- and the RLS helpers resolve; the plan's project limit is the INSERT trigger's
-- (20260929000004) and is untouched. DROP takes the grants with it, so they are restated
-- explicitly — the app calls these as `anon` (D28).

DROP FUNCTION IF EXISTS public.update_project(uuid, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.update_project(uuid, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.update_project(uuid, text, text, text, text, uuid, text, date, date);
DROP FUNCTION IF EXISTS public.update_project(uuid, text, text, text, text, uuid, text, date, date, boolean);
DROP FUNCTION IF EXISTS public.update_project(uuid, text, text, text, text, uuid, text, date, date, text);

DROP FUNCTION IF EXISTS public.create_project(text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.create_project(text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.create_project(text, text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.create_project(text, text, text, text, uuid, text, text, date, date);
DROP FUNCTION IF EXISTS public.create_project(text, text, text, text, uuid, text, text, date, date, boolean);
DROP FUNCTION IF EXISTS public.create_project(text, text, text, text, uuid, text, text, date, date, text);

CREATE FUNCTION public.update_project(
  p_project_id uuid,
  p_name text,
  p_plant text,
  p_model text,
  p_bom_level text,
  p_user_id uuid,
  p_user_email text,
  p_simulation_start date DEFAULT NULL::date,
  p_simulation_end date DEFAULT NULL::date,
  p_data_type text DEFAULT NULL::text,
  p_deep_tier_enabled boolean DEFAULT NULL::boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  UPDATE public.projects
  SET
    name = p_name,
    plant_name = p_plant,
    supply_chain_model = p_model,
    bom_level = p_bom_level,
    simulation_start = p_simulation_start,
    simulation_end = p_simulation_end,
    data_type = COALESCE(p_data_type, data_type),
    deep_tier_enabled = COALESCE(p_deep_tier_enabled, deep_tier_enabled),
    updated_at = now()
  WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$function$;

CREATE FUNCTION public.create_project(
  p_name text,
  p_plant text,
  p_model text,
  p_bom_level text,
  p_user_id uuid,
  p_user_email text,
  p_user_name text,
  p_simulation_start date DEFAULT NULL::date,
  p_simulation_end date DEFAULT NULL::date,
  p_data_type text DEFAULT 'curated'::text,
  p_deep_tier_enabled boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  INSERT INTO public.projects (
    name,
    plant_name,
    supply_chain_model,
    bom_level,
    modeler_id,
    modeler_name,
    simulation_start,
    simulation_end,
    data_type,
    deep_tier_enabled
  ) VALUES (
    p_name,
    p_plant,
    p_model,
    p_bom_level,
    p_user_id,
    p_user_name,
    p_simulation_start,
    p_simulation_end,
    COALESCE(p_data_type, 'curated'),
    COALESCE(p_deep_tier_enabled, false)
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_project(uuid, text, text, text, text, uuid, text, date, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_project(uuid, text, text, text, text, uuid, text, date, date, text, boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_project(text, text, text, text, uuid, text, text, date, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project(text, text, text, text, uuid, text, text, date, date, text, boolean) TO anon, authenticated, service_role;
