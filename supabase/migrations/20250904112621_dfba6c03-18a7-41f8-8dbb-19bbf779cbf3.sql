
-- 1) Default setters for deep-tier tables (organization, created_by, uploaded_by)
CREATE OR REPLACE FUNCTION public.set_network_tables_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set organization from current user context
  IF NEW.organization IS NULL THEN
    NEW.organization := public.get_current_user_org();
  END IF;

  -- Set created_by if present and null
  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.get_current_user_id();
  END IF;

  -- Set uploaded_by if column exists on the table (all three deep-tier tables have it)
  IF NEW.uploaded_by IS NULL THEN
    NEW.uploaded_by := public.get_current_user_id();
  END IF;

  RETURN NEW;
END;
$$;

-- Attach BEFORE INSERT triggers (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bi_network_nodes_defaults') THEN
    CREATE TRIGGER bi_network_nodes_defaults
    BEFORE INSERT ON public.network_nodes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_network_tables_defaults();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bi_network_edges_defaults') THEN
    CREATE TRIGGER bi_network_edges_defaults
    BEFORE INSERT ON public.network_edges
    FOR EACH ROW
    EXECUTE FUNCTION public.set_network_tables_defaults();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bi_network_summary_defaults') THEN
    CREATE TRIGGER bi_network_summary_defaults
    BEFORE INSERT ON public.network_summary
    FOR EACH ROW
    EXECUTE FUNCTION public.set_network_tables_defaults();
  END IF;
END $$;

-- 2) Ensure project completion status updates when deep-tier tables change (row-level triggers)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'aud_network_nodes_completion') THEN
    CREATE TRIGGER aud_network_nodes_completion
    AFTER INSERT OR UPDATE OR DELETE ON public.network_nodes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_project_completion_status();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'aud_network_edges_completion') THEN
    CREATE TRIGGER aud_network_edges_completion
    AFTER INSERT OR UPDATE OR DELETE ON public.network_edges
    FOR EACH ROW
    EXECUTE FUNCTION public.update_project_completion_status();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'aud_network_summary_completion') THEN
    CREATE TRIGGER aud_network_summary_completion
    AFTER INSERT OR UPDATE OR DELETE ON public.network_summary
    FOR EACH ROW
    EXECUTE FUNCTION public.update_project_completion_status();
  END IF;
END $$;

-- 3) RPC: bulk insert network nodes
CREATE OR REPLACE FUNCTION public.bulk_insert_network_nodes(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF v_org <> public.get_current_user_org()
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows; treat uncritical fields as NULL if missing/empty
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_nodes (
      project_id,
      plant_name,
      uid,
      depth,
      name,
      country,
      industry,
      website,
      traded_as,
      number_of_employees,
      revenue,
      lat,
      long,
      is_seed
    ) VALUES (
      p_project_id,
      p_plant_name,
      r->>'uid',
      CASE WHEN r ? 'depth' AND NULLIF(r->>'depth','') IS NOT NULL THEN (r->>'depth')::int ELSE NULL END,
      NULLIF(r->>'name',''),
      NULLIF(r->>'country',''),
      NULLIF(r->>'industry',''),
      NULLIF(r->>'website',''),
      NULLIF(r->>'traded_as',''),
      CASE WHEN r ? 'number_of_employees' AND NULLIF(r->>'number_of_employees','') IS NOT NULL THEN (r->>'number_of_employees')::int ELSE NULL END,
      CASE WHEN r ? 'revenue' AND NULLIF(r->>'revenue','') IS NOT NULL THEN (r->>'revenue')::numeric ELSE NULL END,
      CASE WHEN r ? 'lat' AND NULLIF(r->>'lat','') IS NOT NULL THEN (r->>'lat')::numeric ELSE NULL END,
      CASE WHEN r ? 'long' AND NULLIF(r->>'long','') IS NOT NULL THEN (r->>'long')::numeric ELSE NULL END,
      CASE WHEN r ? 'is_seed' THEN COALESCE((r->>'is_seed')::boolean, false) ELSE false END
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

-- 4) RPC: bulk insert network edges
CREATE OR REPLACE FUNCTION public.bulk_insert_network_edges(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF v_org <> public.get_current_user_org()
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows; treat uncritical fields as NULL if missing/empty
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_edges (
      project_id,
      plant_name,
      src_uid,
      dst_uid,
      relation_type,
      relative_revenue,
      relative_revenue_percentage,
      depth,
      direction
    ) VALUES (
      p_project_id,
      p_plant_name,
      r->>'src_uid',
      r->>'dst_uid',
      NULLIF(r->>'relation_type',''),
      CASE WHEN r ? 'relative_revenue' AND NULLIF(r->>'relative_revenue','') IS NOT NULL THEN (r->>'relative_revenue')::numeric ELSE NULL END,
      CASE WHEN r ? 'relative_revenue_percentage' AND NULLIF(r->>'relative_revenue_percentage','') IS NOT NULL THEN (r->>'relative_revenue_percentage')::numeric ELSE NULL END,
      CASE WHEN r ? 'depth' AND NULLIF(r->>'depth','') IS NOT NULL THEN (r->>'depth')::int ELSE NULL END,
      NULLIF(r->>'direction','')
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

-- 5) RPC: bulk insert network summary
CREATE OR REPLACE FUNCTION public.bulk_insert_network_summary(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF v_org <> public.get_current_user_org()
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert one or multiple summary rows (usually one)
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_summary (
      project_id,
      plant_name,
      nodes_count,
      edges_count,
      tiers_data
    ) VALUES (
      p_project_id,
      p_plant_name,
      CASE WHEN r ? 'nodes_count' AND NULLIF(r->>'nodes_count','') IS NOT NULL THEN (r->>'nodes_count')::int ELSE NULL END,
      CASE WHEN r ? 'edges_count' AND NULLIF(r->>'edges_count','') IS NOT NULL THEN (r->>'edges_count')::int ELSE NULL END,
      COALESCE(r->'tiers_data', 'null'::jsonb)
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;
