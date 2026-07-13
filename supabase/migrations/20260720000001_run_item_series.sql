-- =====================================================================
-- Single-run inspection mode: per-item weekly series (G17 / §9.5.1).
--
-- An inspection run (exactly 1 replication, user-chosen seed, engine trace
-- raised to full_debug) persists the engine's per-material and per-product
-- weekly matrices here — one row per (run, kind, item), `series` a map of
-- named weekly arrays:
--   kind='material': on_hand, in_transit, orders
--   kind='product':  demand, production, fulfillment, backlog, lost_units
--
-- Sized deliberately for ONE replication (~577 items × 156 weeks for the
-- reference project); multi-rep runs never write here — the worker only
-- receives rows when the engine produced them (full_debug + 1 rep).
--
-- A sibling table (not a run_replications column) so the multi-MB payload
-- stays out of the realtime postgres_changes stream the replication rows
-- ride on; the UI fetches one item's row on demand.
--
-- Auth posture mirrors run_replications (20260706000001 / 20260707000002):
-- the app always calls with the anon JWT; the Fly worker writes with the
-- service role; the browser engine path persists best-effort as anon.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.run_item_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.simulation_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('material', 'product')),
  item_id text NOT NULL,
  series jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS run_item_series_run_kind_item_uq
  ON public.run_item_series(run_id, kind, item_id);
CREATE INDEX IF NOT EXISTS run_item_series_run_idx
  ON public.run_item_series(run_id);

GRANT SELECT, INSERT, UPDATE ON public.run_item_series TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_item_series TO authenticated;
GRANT ALL ON public.run_item_series TO service_role;

ALTER TABLE public.run_item_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "run_item_series_anon_write" ON public.run_item_series;
CREATE POLICY "run_item_series_anon_write"
  ON public.run_item_series FOR ALL TO anon
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "run_item_series_auth_all" ON public.run_item_series;
CREATE POLICY "run_item_series_auth_all"
  ON public.run_item_series FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

SELECT pg_notify('pgrst', 'reload schema');
