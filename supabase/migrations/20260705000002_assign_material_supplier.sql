-- Phase A / G4 / §8.3 — assign a supplier to a material from the /policies grid.
--
-- BOM materials with no inbound lane render as "(unassigned supplier)" rows
-- and block verification ("assign one"), but the UI had no way to assign.
-- This RPC creates the sourcing relationship the way an upload would:
--   1. an inbound_logistics lane (supplier → material; economics left NULL for
--      the user to fill in the grid),
--   2. the matching supply_chain_data inbound edge so the grids update
--      immediately without re-running the full combine,
--   3. a suppliers master row (ON CONFLICT DO NOTHING) so capacity/reliability
--      are editable right away.
-- SECURITY DEFINER with explicit user params — the standard write path for
-- this app's custom auth (see 20260702000001_item_master_write_rpcs.sql).

CREATE OR REPLACE FUNCTION public.assign_material_supplier(
  p_project_id  uuid,
  p_material_id text,
  p_supplier_id text,
  p_user_id     uuid,
  p_user_email  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_plant text;
  v_org   text;
BEGIN
  IF NULLIF(p_material_id, '') IS NULL OR NULLIF(p_supplier_id, '') IS NULL THEN
    RAISE EXCEPTION 'material_id and supplier_id are required';
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) Lane row (the engine + grid enrichment source).
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id)
  SELECT p_project_id, v_plant, p_supplier_id, p_material_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inbound_logistics
    WHERE project_id = p_project_id
      AND supplier_id = p_supplier_id
      AND material_id = p_material_id
  );

  -- 2) Edge row so get_supply_chain_data reflects the pair immediately.
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location,
     material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, v_plant, 'inbound', p_supplier_id, p_material_id,
         0, 1.0, 0, p_user_id, v_org
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supply_chain_data
    WHERE project_id = p_project_id
      AND data_source = 'inbound'
      AND from_location = p_supplier_id
      AND to_location = p_material_id
  );

  -- 3) Supplier master row so capacity/reliability are editable right away.
  INSERT INTO public.suppliers (project_id, supplier_id)
  VALUES (p_project_id, p_supplier_id)
  ON CONFLICT (project_id, supplier_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_material_supplier TO anon, authenticated, service_role;
