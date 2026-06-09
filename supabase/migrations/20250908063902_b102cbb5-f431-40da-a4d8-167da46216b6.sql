-- Remove dependency on public.network_summary from completion calculation
CREATE OR REPLACE FUNCTION public.update_project_completion_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  has_bom BOOLEAN; 
  has_inbound BOOLEAN; 
  has_outbound BOOLEAN; 
  has_deep_tier_nodes BOOLEAN;
  has_deep_tier_edges BOOLEAN;
  deep_tier_enabled BOOLEAN;
  pid UUID;
BEGIN
  pid := COALESCE(NEW.project_id, OLD.project_id);

  -- Get deep tier setting for this project
  SELECT p.deep_tier_enabled INTO deep_tier_enabled
  FROM public.projects p 
  WHERE p.id = pid;

  -- Check if BOM exists (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid) 
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;

  -- If deep tier is enabled, check for deep tier datasets (nodes + edges only)
  IF deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = pid) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = pid) INTO has_deep_tier_edges;
    
    -- Update completion status without network_summary requirement
    UPDATE public.projects 
    SET completed = (has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges), 
        updated_at = now() 
    WHERE id = pid;
  ELSE
    -- Update completion status without deep tier requirements
    UPDATE public.projects 
    SET completed = (has_bom AND has_inbound AND has_outbound), 
        updated_at = now() 
    WHERE id = pid;
  END IF;

  RETURN NULL;
END;
$function$;
