-- =====================================================================
-- B8 Network Cartographer v2 (network_map_diff) — product-level
-- decomposition. Phase D / G12 / AI agents — v1.5 Phase 4c
-- (ai-agents.md §18.2 v2; blueprint §12 G16 run-readiness contract).
--
-- Behavior-neutral with the flag off (§9 kill-switch discipline): this
-- migration only adds two SECURITY DEFINER assign RPCs — the BOM-line and
-- outbound-lane analogues of 20260705000002_assign_material_supplier —
-- that the agent-apply path (and nothing else new) calls when a proposal
-- carries add_bom_line / add_outbound_lane rows, which can only exist
-- under CARTOGRAPHER_PRODUCT_LEVEL. No table changes, no policy changes;
-- the same lane + supply_chain_data edge sequence an upload/combine
-- produces, WHERE-NOT-EXISTS idempotent.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- assign_bom_line: create one product × material BOM line with its
-- estimated consumption rate the way an upload would:
--   1. a bom_single_level row (the engine + grader source; consumption_rate
--      is the method-recomputed point value — the interval, method and
--      sources live on the proposal card, the §18.1 audit-trail precedent),
--   2. the matching supply_chain_data 'bom' edge (from = material,
--      to = product, material_consumption_rate = rate) so the grids update
--      immediately without re-running the full combine.
-- The rate is checked > 0 — BomLine.rate is the engine's hard
-- production-feasibility constraint (scsim/scsim/entities/network.py).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_bom_line(
  p_project_id  uuid,
  p_product_id  text,
  p_material_id text,
  p_rate        numeric,
  p_user_id     uuid,
  p_user_email  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_plant text;
  v_org   text;
BEGIN
  IF NULLIF(p_product_id, '') IS NULL OR NULLIF(p_material_id, '') IS NULL THEN
    RAISE EXCEPTION 'product_id and material_id are required';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'consumption rate must be > 0 (BomLine.rate is a hard engine constraint)';
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) BOM row (the engine + grader source).
  INSERT INTO public.bom_single_level
    (project_id, plant_name, product_id, material_id, consumption_rate)
  SELECT p_project_id, v_plant, p_product_id, p_material_id, p_rate
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bom_single_level
    WHERE project_id = p_project_id
      AND product_id = p_product_id
      AND material_id = p_material_id
  );

  -- 2) Edge row so get_supply_chain_data reflects the pair immediately
  --    (combine-project's 'bom' shape: from = material, to = product).
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location,
     material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, v_plant, 'bom', p_material_id, p_product_id,
         p_rate, 1.0, 0, p_user_id, v_org
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supply_chain_data
    WHERE project_id = p_project_id
      AND data_source = 'bom'
      AND from_location = p_material_id
      AND to_location = p_product_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_bom_line TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- assign_outbound_customer: create one STRUCTURAL product → customer lane
-- the way an upload would — economics (volume, unit_price, lead time) are
-- deliberately left NULL: no registered estimator method targets demand
-- (§18.2 v2 law), so the lane waits for the firm's own numbers:
--   1. an outbound_logistics row,
--   2. the matching supply_chain_data 'outbound' edge (from = product,
--      to = customer; rate 0 until a volume exists).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_outbound_customer(
  p_project_id  uuid,
  p_product_id  text,
  p_customer_id text,
  p_user_id     uuid,
  p_user_email  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_plant text;
  v_org   text;
BEGIN
  IF NULLIF(p_product_id, '') IS NULL OR NULLIF(p_customer_id, '') IS NULL THEN
    RAISE EXCEPTION 'product_id and customer_id are required';
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) Lane row (economics NULL — never estimated).
  INSERT INTO public.outbound_logistics
    (project_id, plant_name, product_id, customer_id)
  SELECT p_project_id, v_plant, p_product_id, p_customer_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.outbound_logistics
    WHERE project_id = p_project_id
      AND product_id = p_product_id
      AND customer_id = p_customer_id
  );

  -- 2) Edge row (combine-project's 'outbound' shape: rate carries the
  --    volume, 0 until one exists).
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location,
     material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, v_plant, 'outbound', p_product_id, p_customer_id,
         0, 1.0, 0, p_user_id, v_org
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supply_chain_data
    WHERE project_id = p_project_id
      AND data_source = 'outbound'
      AND from_location = p_product_id
      AND to_location = p_customer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_outbound_customer TO anon, authenticated, service_role;
