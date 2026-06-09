-- Create node_list table to store unique nodes derived from supply_chain_data
-- Includes metadata fields that can be enriched later

-- 1) Table
CREATE TABLE IF NOT EXISTS public.node_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  plant_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT,
  node_group TEXT,
  description_text TEXT,
  location_text TEXT,
  longitude NUMERIC,
  latitude NUMERIC,
  is_critical_node BOOLEAN,
  critical_node_score NUMERIC,
  prediction_timestamp TIMESTAMPTZ,
  created_by UUID,
  organization TEXT NOT NULL DEFAULT 'default_org',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT node_list_unique_per_project UNIQUE (project_id, node_id)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_node_list_project ON public.node_list(project_id);
CREATE INDEX IF NOT EXISTS idx_node_list_project_plant ON public.node_list(project_id, plant_name);

-- 2) RLS
ALTER TABLE public.node_list ENABLE ROW LEVEL SECURITY;

-- View policy: same org as the project
DROP POLICY IF EXISTS "Node list: project access view" ON public.node_list;
CREATE POLICY "Node list: project access view"
ON public.node_list
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND p.organization = public.get_current_user_org()
  )
);

-- Modify policies: owner modeler or admin in same org
DROP POLICY IF EXISTS "Node list: project access insert" ON public.node_list;
CREATE POLICY "Node list: project access insert"
ON public.node_list
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND p.organization = public.get_current_user_org()
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Node list: project access update" ON public.node_list;
CREATE POLICY "Node list: project access update"
ON public.node_list
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND p.organization = public.get_current_user_org()
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND p.organization = public.get_current_user_org()
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
);

DROP POLICY IF EXISTS "Node list: project access delete" ON public.node_list;
CREATE POLICY "Node list: project access delete"
ON public.node_list
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = node_list.project_id
      AND p.organization = public.get_current_user_org()
      AND (
        p.modeler_id = public.get_current_user_id() OR (
          SELECT user_role FROM public.get_current_approved_user() LIMIT 1
        ) = 'admin'
      )
  )
);

-- 3) Default + updated_at triggers
CREATE OR REPLACE FUNCTION public.set_node_list_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_org text;
BEGIN
  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.get_current_user_id();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_node_list_defaults ON public.node_list;
CREATE TRIGGER trg_node_list_defaults
BEFORE INSERT ON public.node_list
FOR EACH ROW
EXECUTE FUNCTION public.set_node_list_defaults();

DROP TRIGGER IF EXISTS trg_node_list_updated_at ON public.node_list;
CREATE TRIGGER trg_node_list_updated_at
BEFORE UPDATE ON public.node_list
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) RPC to rebuild/seed nodes from supply_chain_data
CREATE OR REPLACE FUNCTION public.rebuild_node_list(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  inserted_count integer := 0;
BEGIN
  -- Set user context for RLS and helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert new nodes discovered in supply_chain_data; keep existing nodes/details
  WITH nodes AS (
    SELECT scd.plant_name, scd.from_location AS node_id
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
    UNION
    SELECT scd.plant_name, scd.to_location AS node_id
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
  ), dedup AS (
    SELECT node_id, MIN(plant_name) AS plant_name
    FROM nodes
    GROUP BY node_id
  )
  INSERT INTO public.node_list (project_id, plant_name, node_id, organization, created_by)
  SELECT p_project_id, d.plant_name, d.node_id, v_org, public.get_current_user_id()
  FROM dedup d
  ON CONFLICT (project_id, node_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN inserted_count;
END;
$$;

-- 5) RPC to fetch node list for a project (optionally filter by plant)
CREATE OR REPLACE FUNCTION public.get_node_list(p_project_id uuid, p_plant_name text, p_user_id uuid, p_user_email text)
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
AS $$
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
  ORDER BY nl.node_id;
END;
$$;