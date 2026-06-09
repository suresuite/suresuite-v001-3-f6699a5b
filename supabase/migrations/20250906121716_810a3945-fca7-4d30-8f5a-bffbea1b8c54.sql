-- Create RPC to securely fetch deep tier datasets
CREATE OR REPLACE FUNCTION public.get_deep_tier_datasets(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_deep boolean;
  nodes jsonb := '[]'::jsonb;
  edges jsonb := '[]'::jsonb;
  summary jsonb := '[]'::jsonb;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and org access
  SELECT organization, deep_tier_enabled INTO v_org, v_deep
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;
  IF v_org <> public.get_current_user_org() THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF COALESCE(v_deep, false) = false THEN
    RETURN jsonb_build_object('nodes', nodes, 'edges', edges, 'summary', summary);
  END IF;

  -- Aggregate datasets
  SELECT COALESCE(jsonb_agg(to_jsonb(n.*)), '[]'::jsonb) INTO nodes
  FROM public.network_nodes n WHERE n.project_id = p_project_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(e.*)), '[]'::jsonb) INTO edges
  FROM public.network_edges e WHERE e.project_id = p_project_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) INTO summary
  FROM public.network_summary s WHERE s.project_id = p_project_id;

  RETURN jsonb_build_object('nodes', nodes, 'edges', edges, 'summary', summary);
END;
$function$;