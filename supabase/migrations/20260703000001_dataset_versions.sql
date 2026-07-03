-- =====================================================================
-- Dataset versions + graph_hash  (Phase A / G5 / §8.4)
--
-- Policies are versioned and hashed (policy_versions / policy_hash); the
-- graph + economics the engine reads were not, so re-uploading a CSV
-- silently changed the world behind every past and future run (gap G5).
--
-- This mirrors the policy-version data plane for the dataset:
--   * _build_dataset_snapshot(project) canonicalizes the six tables the
--     engine actually consumes (see sim-worker/sim_worker/datamap.py) into
--     a deterministic jsonb — the single hashing point.
--   * snapshot_dataset(project) stores that snapshot + a sha256 graph_hash,
--     deduped: if the current hash already matches the latest version it
--     returns that version instead of inserting a duplicate.
--   * current_graph_hash(project) recomputes the live hash for dirty
--     detection (client compares it to the run's / latest version's hash).
--   * simulation_runs.dataset_version_id + graph_hash bind each run to the
--     exact data it used, so a later CSV re-upload is detectable rather
--     than silent, and every run is (dataset, policy, scenario)-bound.
--
-- The hash is computed over the canonical *source rows* the engine reads
-- (not the normalized ProjectData) — simple, divergence-free, and correct
-- for reproducibility + dirty detection. Hashing the normalized
-- ProjectData (to also collapse cosmetic unit differences for the run
-- cache) is a Phase C / §9.2 refinement, as is the worker re-executing
-- against the frozen snapshot for full re-execution reproducibility.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Table -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dataset_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label          text,
  snapshot       jsonb NOT NULL,
  graph_hash     text NOT NULL,
  author_user_id uuid,
  author_email   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dataset_versions_project_created
  ON public.dataset_versions (project_id, created_at DESC);

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS dataset_version_id uuid REFERENCES public.dataset_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS graph_hash         text;

-- 2. Data-API access (same posture as policy_versions) ----------------------

ALTER TABLE public.dataset_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.dataset_versions TO anon, authenticated;
GRANT ALL            ON public.dataset_versions TO service_role;

DROP POLICY IF EXISTS "dataset_versions_read_all"   ON public.dataset_versions;
DROP POLICY IF EXISTS "dataset_versions_insert_all" ON public.dataset_versions;

CREATE POLICY "dataset_versions_read_all"
  ON public.dataset_versions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dataset_versions_insert_all"
  ON public.dataset_versions FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 3. Snapshot builder (single canonicalization point for hashing) -----------
--    Column sets mirror datamap.py exactly; cosmetic `name` columns are
--    excluded so a rename never invalidates a run. Rows are ordered by their
--    natural key so snapshot::text is stable.

CREATE OR REPLACE FUNCTION public._build_dataset_snapshot(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'schema_version', 1,
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'supplier_id', s.supplier_id,
        'capacity_per_week', s.capacity_per_week,
        'reliability_score', s.reliability_score
      ) ORDER BY s.supplier_id)
      FROM public.suppliers s WHERE s.project_id = p_project_id
    ), '[]'::jsonb),
    'materials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'material_id', m.material_id,
        'cost', m.cost,
        'holding_cost_pct', m.holding_cost_pct,
        'moq', m.moq,
        'initial_on_hand', m.initial_on_hand,
        'lead_time_dist', m.lead_time_dist,
        'lead_time_cv', m.lead_time_cv
      ) ORDER BY m.material_id)
      FROM public.materials m WHERE m.project_id = p_project_id
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.product_id,
        'sell_price', p.sell_price,
        'production_capacity', p.production_capacity,
        'fulfillment_mode', p.fulfillment_mode,
        'demand_distribution', p.demand_distribution,
        'demand_mean', p.demand_mean,
        'demand_cv', p.demand_cv
      ) ORDER BY p.product_id)
      FROM public.products p WHERE p.project_id = p_project_id
    ), '[]'::jsonb),
    'inbound', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'supplier_id', il.supplier_id,
        'material_id', il.material_id,
        'unit_price', il.unit_price,
        'lead_time', il.lead_time,
        'time_unit', il.time_unit,
        'volume', il.volume
      ) ORDER BY il.supplier_id, il.material_id, il.unit_price, il.volume)
      FROM public.inbound_logistics il WHERE il.project_id = p_project_id
    ), '[]'::jsonb),
    'bom', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', b.product_id,
        'material_id', b.material_id,
        'consumption_rate', b.consumption_rate
      ) ORDER BY b.product_id, b.material_id)
      FROM public.bom_single_level b WHERE b.project_id = p_project_id
    ), '[]'::jsonb),
    'outbound', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', o.product_id,
        'customer_id', o.customer_id,
        'unit_price', o.unit_price,
        'volume', o.volume,
        'time_unit', o.time_unit
      ) ORDER BY o.product_id, o.customer_id, o.unit_price, o.volume)
      FROM public.outbound_logistics o WHERE o.project_id = p_project_id
    ), '[]'::jsonb)
  );
$$;

-- 4. current_graph_hash: dirty detection ------------------------------------

CREATE OR REPLACE FUNCTION public.current_graph_hash(p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT encode(extensions.digest(public._build_dataset_snapshot(p_project_id)::text, 'sha256'), 'hex');
$$;

GRANT EXECUTE ON FUNCTION public.current_graph_hash(uuid) TO anon, authenticated, service_role;

-- 5. snapshot_dataset: dedup-or-insert an immutable version -----------------

CREATE OR REPLACE FUNCTION public.snapshot_dataset(
  p_project_id uuid,
  p_label      text DEFAULT NULL,
  p_user_id    uuid DEFAULT NULL,
  p_user_email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_snapshot jsonb;
  v_hash     text;
  v_latest   public.dataset_versions%ROWTYPE;
  v_id       uuid;
BEGIN
  v_snapshot := public._build_dataset_snapshot(p_project_id);
  v_hash     := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');

  -- Dedup: identical to the latest version → reuse it (datasets change rarely
  -- and the full snapshot is large, so we never store a duplicate).
  SELECT * INTO v_latest
  FROM public.dataset_versions
  WHERE project_id = p_project_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_latest.graph_hash = v_hash THEN
    RETURN v_latest.id;
  END IF;

  INSERT INTO public.dataset_versions (
    project_id, label, snapshot, graph_hash, author_user_id, author_email
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Dataset ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_snapshot,
    v_hash,
    COALESCE(p_user_id, auth.uid()),
    p_user_email
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_dataset(uuid, text, uuid, text) TO anon, authenticated, service_role;

-- 6. list_dataset_versions --------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_dataset_versions(p_project_id uuid)
RETURNS TABLE (
  id           uuid,
  label        text,
  graph_hash   text,
  author_email text,
  created_at   timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, label, graph_hash, author_email, created_at
  FROM public.dataset_versions
  WHERE project_id = p_project_id
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_dataset_versions(uuid) TO anon, authenticated, service_role;

-- 7. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
