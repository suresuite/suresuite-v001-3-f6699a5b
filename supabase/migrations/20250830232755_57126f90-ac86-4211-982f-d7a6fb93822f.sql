
-- 1) Trigger function to normalize location fields for product/material
CREATE OR REPLACE FUNCTION public.normalize_node_location_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_effective_type text;
BEGIN
  -- Determine effective type: prefer explicit node_type, otherwise infer
  v_effective_type := lower(coalesce(NEW.node_type, public.classify_node_type(NEW.project_id, NEW.node_id)));

  -- Clear location fields for product/material
  IF v_effective_type IN ('product','material') THEN
    NEW.location_text := NULL;
    NEW.longitude := NULL;
    NEW.latitude := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Ensure trigger is present on node_list
DROP TRIGGER IF EXISTS node_list_normalize_location_fields ON public.node_list;

CREATE TRIGGER node_list_normalize_location_fields
BEFORE INSERT OR UPDATE ON public.node_list
FOR EACH ROW
EXECUTE FUNCTION public.normalize_node_location_fields();

-- 3) Backfill existing rows
UPDATE public.node_list nl
SET
  location_text = NULL,
  longitude = NULL,
  latitude = NULL,
  updated_at = now()
WHERE lower(coalesce(nl.node_type, public.classify_node_type(nl.project_id, nl.node_id))) IN ('product','material');
