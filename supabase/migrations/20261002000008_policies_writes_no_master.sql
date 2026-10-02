-- PLAN.md §23 WP 13.1 · §4 D280 — /policies NEVER WRITES THE ITEM MASTERS.
--
-- The owner's rule (2026-10-02): the item masters (materials, products,
-- suppliers, customers) stay exactly as uploaded — Project manager, the Item
-- Master editor and ERP sync write them, and nothing on /policies does. A value
-- changed on /policies is a policy override in the policy version.
--
-- `assign_material_supplier` is the one SQL writer /policies calls (the Supplier
-- stage's "assign a supplier" for a material with none). Its first two writes are
-- the LANE — the inbound row and its edge — and stay: assigning a supplier is an
-- input-data edit, gated by "Edit Input Data" in the grid (D230). Its third
-- write was a SUPPLIER MASTER row, "so capacity/reliability are editable right
-- away" — which they no longer need, because since WP 13.1 those cells save as
-- overrides on the row and the mapper reads them ahead of the master. Nothing
-- reads a bare supplier row the lane does not already imply: the engine builds a
-- supplier from its arcs (`project_map.py`, `sup_ids`), and an empty capacity is
-- unlimited with or without the row.
--
-- Same signature, so `CREATE OR REPLACE` keeps the function's grants. Existing
-- supplier rows this function created earlier are NOT touched (the owner's rule
-- also forbids migrating master values); `supabase/rehearsal/760` proves the
-- function now writes the lane and no master row, names its actor, and stays
-- idempotent.

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

  -- D36 (WP 3.3): LOCAL to this transaction, set BEFORE any tier-2 write, so the
  -- audit rows name the person who clicked.
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) Lane row (the engine + grid enrichment source). Guarded rather than
  --    ON CONFLICT so assigning an assigned supplier is a no-op (WP 3.3).
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

  -- 3) NO SUPPLIER MASTER ROW (§23 WP 13.1). /policies never writes the masters.
END;
$$;
GRANT EXECUTE ON FUNCTION public.assign_material_supplier TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
