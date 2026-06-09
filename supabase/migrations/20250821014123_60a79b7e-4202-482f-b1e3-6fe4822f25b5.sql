-- Create bulk insert functions that set user context and insert rows in a single DB call to satisfy RLS

CREATE OR REPLACE FUNCTION public.bulk_insert_bom_single_level(
  p_rows jsonb,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  INSERT INTO public.bom_single_level (product_id, material_id, consumption_rate, plant_name, project_id)
  SELECT product_id, material_id, consumption_rate, plant_name, project_id
  FROM jsonb_to_recordset(p_rows) AS x(
    product_id text,
    material_id text,
    consumption_rate numeric,
    plant_name text,
    project_id uuid
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_bom_multi_level(
  p_rows jsonb,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  INSERT INTO public.bom_multi_level (material_id, level, higher_level_component_id, consumption_rate, plant_name, project_id)
  SELECT material_id, level, higher_level_component_id, consumption_rate, plant_name, project_id
  FROM jsonb_to_recordset(p_rows) AS x(
    material_id text,
    level integer,
    higher_level_component_id text,
    consumption_rate numeric,
    plant_name text,
    project_id uuid
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_inbound_logistics(
  p_rows jsonb,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  INSERT INTO public.inbound_logistics (supplier_id, material_id, volume, time_unit, lead_time, unit_price, plant_name, project_id)
  SELECT supplier_id, material_id, volume, time_unit, lead_time, unit_price, plant_name, project_id
  FROM jsonb_to_recordset(p_rows) AS x(
    supplier_id text,
    material_id text,
    volume numeric,
    time_unit text,
    lead_time numeric,
    unit_price numeric,
    plant_name text,
    project_id uuid
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_outbound_logistics(
  p_rows jsonb,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  INSERT INTO public.outbound_logistics (customer_id, product_id, volume, time_unit, expected_lead_time, unit_price, plant_name, project_id)
  SELECT customer_id, product_id, volume, time_unit, expected_lead_time, unit_price, plant_name, project_id
  FROM jsonb_to_recordset(p_rows) AS x(
    customer_id text,
    product_id text,
    volume numeric,
    time_unit text,
    expected_lead_time numeric,
    unit_price numeric,
    plant_name text,
    project_id uuid
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_multi_tier_supply_chain(
  p_rows jsonb,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  INSERT INTO public.multi_tier_supply_chain (from_firm_id, to_firm_id, to_firm_tier, to_firm_relationship, plant_name, project_id)
  SELECT from_firm_id, to_firm_id, to_firm_tier, to_firm_relationship, plant_name, project_id
  FROM jsonb_to_recordset(p_rows) AS x(
    from_firm_id text,
    to_firm_id text,
    to_firm_tier integer,
    to_firm_relationship text,
    plant_name text,
    project_id uuid
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;