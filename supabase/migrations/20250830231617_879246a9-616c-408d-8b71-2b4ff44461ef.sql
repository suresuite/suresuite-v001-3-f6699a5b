
-- 1) Classifier: infer node_type from supply_chain_data usage
CREATE OR REPLACE FUNCTION public.classify_node_type(p_project_id uuid, p_node_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_customer boolean := false;
  is_product  boolean := false;
  is_material boolean := false;
  is_supplier boolean := false;
BEGIN
  -- Customer: appears as to_location in outbound
  SELECT EXISTS (
    SELECT 1 FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
      AND scd.data_source = 'outbound'
      AND scd.to_location = p_node_id
  ) INTO is_customer;

  -- Product: appears as from_location in outbound OR to_location in bom
  SELECT EXISTS (
    SELECT 1 FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
      AND (
        (scd.data_source = 'outbound' AND scd.from_location = p_node_id) OR
        (scd.data_source = 'bom'      AND scd.to_location  = p_node_id)
      )
  ) INTO is_product;

  -- Material: appears as to_location in inbound OR from_location in bom
  SELECT EXISTS (
    SELECT 1 FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
      AND (
        (scd.data_source = 'inbound' AND scd.to_location   = p_node_id) OR
        (scd.data_source = 'bom'     AND scd.from_location = p_node_id)
      )
  ) INTO is_material;

  -- Supplier: appears as from_location in inbound
  SELECT EXISTS (
    SELECT 1 FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
      AND scd.data_source = 'inbound'
      AND scd.from_location = p_node_id
  ) INTO is_supplier;

  -- Priority: customer > product > material > supplier
  IF is_customer THEN
    RETURN 'customer';
  ELSIF is_product THEN
    RETURN 'product';
  ELSIF is_material THEN
    RETURN 'material';
  ELSIF is_supplier THEN
    RETURN 'supplier';
  ELSE
    RETURN 'unknown';
  END IF;
END;
$function$;

-- 2) Trigger to auto-fill node_type / node_group on insert/update
CREATE OR REPLACE FUNCTION public.infer_node_list_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.node_type IS NULL OR NEW.node_type = '' THEN
    NEW.node_type := public.classify_node_type(NEW.project_id, NEW.node_id);
  END IF;

  IF NEW.node_group IS NULL OR NEW.node_group = '' THEN
    IF NEW.node_type IS NULL OR NEW.node_type = '' THEN
      NEW.node_group := NULL;
    ELSE
      NEW.node_group := initcap(NEW.node_type); -- e.g., "Customer"
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_infer_node_list_metadata ON public.node_list;
CREATE TRIGGER trg_infer_node_list_metadata
BEFORE INSERT OR UPDATE ON public.node_list
FOR EACH ROW EXECUTE FUNCTION public.infer_node_list_metadata();

-- 3) Backfill existing rows
UPDATE public.node_list nl
SET node_type = public.classify_node_type(nl.project_id, nl.node_id)
WHERE nl.node_type IS NULL OR nl.node_type = '';

UPDATE public.node_list nl
SET node_group = initcap(nl.node_type)
WHERE (nl.node_group IS NULL OR nl.node_group = '')
  AND (nl.node_type IS NOT NULL AND nl.node_type <> '');

-- 4) Sort get_node_list by required node type order, then node_id
CREATE OR REPLACE FUNCTION public.get_node_list(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  node_id text,
  node_type text,
  node_group text,
  description_text text,
  location_text text,
  longitude numeric,
  latitude numeric,
  is_critical_node boolean,
  critical_node_score numeric,
  prediction_timestamp timestamptz,
  created_by uuid,
  organization text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT
    nl.id,
    nl.project_id,
    nl.plant_name,
    nl.node_id,
    nl.node_type,
    nl.node_group,
    nl.description_text,
    nl.location_text,
    nl.longitude,
    nl.latitude,
    nl.is_critical_node,
    nl.critical_node_score,
    nl.prediction_timestamp,
    nl.created_by,
    nl.organization,
    nl.created_at,
    nl.updated_at
  FROM public.node_list nl
  WHERE nl.project_id = p_project_id
    AND (p_plant_name IS NULL OR nl.plant_name = p_plant_name)
  ORDER BY
    CASE lower(coalesce(nl.node_type, ''))
      WHEN 'customer' THEN 1
      WHEN 'product'  THEN 2
      WHEN 'material' THEN 3
      WHEN 'supplier' THEN 4
      ELSE 5
    END,
    nl.node_id;
END;
$function$;

-- 5) Keep node metadata refreshed after rebuild
CREATE OR REPLACE FUNCTION public.refresh_node_list_for_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_modeler uuid;
  v_email   text;
BEGIN
  -- Find project's modeler (owner) and email
  SELECT p.modeler_id INTO v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_modeler IS NULL THEN
    RETURN;
  END IF;

  SELECT au.email INTO v_email
  FROM public.approved_users au
  WHERE au.id = v_modeler
  LIMIT 1;

  -- Set context to project owner and rebuild
  PERFORM public.set_current_user_context(v_modeler, COALESCE(v_email, ''));
  PERFORM public.rebuild_node_list(p_project_id, v_modeler, v_email);

  -- Reclassify node metadata after rebuild to keep it in sync
  UPDATE public.node_list nl
  SET node_type  = public.classify_node_type(nl.project_id, nl.node_id),
      node_group = initcap(public.classify_node_type(nl.project_id, nl.node_id))
  WHERE nl.project_id = p_project_id;
END;
$function$;
