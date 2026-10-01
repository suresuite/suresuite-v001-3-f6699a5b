-- ============================================================================
-- Phase 11 / WP 11.3 · blueprint §8.4 · T1, T4 · §4 D258, D259, D263
-- THE TUPLE, READABLE WHERE A PERSON READS IT.
--
-- A snapshot names its four level versions (WP 11.1, 11.2), and the surfaces must
-- print them: "simulation inputs v4" on a Validated Model, "P3 · R2 · F5 · S4" beside
-- a snapshot, the level versions in a run's Reproducibility Record. The browser
-- cannot read `graph_level_versions` directly: its policy is `has_project_access`,
-- which learns the caller from the session or the actor setting, and the browser
-- calls as `anon` with neither (D28, D155 — D257 is the same shape). So the numbers
-- are served by ONE read, `dataset_version_tuple`, and `list_dataset_versions` —
-- the existing version list — returns it per row instead of authoring the join twice.
--
-- The brief said "no migration" for this package; a read the browser can reach is
-- the one thing a page cannot do without (§16 · WP 11.3).
--
-- WHAT IT EXPOSES. Nothing `dataset_versions` does not already: that table is read by
-- every API role (`dataset_versions_read_all`, D28's pinned list) and carries each
-- level hash beside the composite. A level version's NUMBER is a count over those.
-- ============================================================================

-- One snapshot's own number and its four level versions.
CREATE OR REPLACE FUNCTION public.dataset_version_tuple(p_dataset_version_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'dataset_version_id', dv.id,
    'version_no', dv.version_no,
    'graph_hash', dv.graph_hash,
    'created_at', dv.created_at,
    'product',    (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash)
                     FROM public.graph_level_versions g WHERE g.id = dv.product_version_id),
    'process',    (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash)
                     FROM public.graph_level_versions g WHERE g.id = dv.process_version_id),
    'firm',       (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash)
                     FROM public.graph_level_versions g WHERE g.id = dv.firm_version_id),
    'simulation', (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash)
                     FROM public.graph_level_versions g WHERE g.id = dv.simulation_version_id))
  FROM public.dataset_versions dv
  WHERE dv.id = p_dataset_version_id;
$$;
GRANT EXECUTE ON FUNCTION public.dataset_version_tuple(uuid) TO anon, authenticated, service_role;

-- The version list, with each snapshot's number and tuple. RETURNS TABLE cannot
-- widen in place: DROP + CREATE, the new columns appended so a positional reader is
-- unchanged, the grant restated.
DROP FUNCTION IF EXISTS public.list_dataset_versions(uuid);
CREATE FUNCTION public.list_dataset_versions(p_project_id uuid)
RETURNS TABLE (
  id           uuid,
  label        text,
  graph_hash   text,
  author_email text,
  created_at   timestamptz,
  version_no   integer,
  tuple        jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT dv.id, dv.label, dv.graph_hash, dv.author_email, dv.created_at, dv.version_no,
         public.dataset_version_tuple(dv.id)
  FROM public.dataset_versions dv
  WHERE dv.project_id = p_project_id
  ORDER BY dv.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_dataset_versions(uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
