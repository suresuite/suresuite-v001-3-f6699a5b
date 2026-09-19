-- Phase 6 / WP 6.3 / §4 D88 + I5: the dual read, and it SAYS which half answered.
--
-- ── WHAT D88 IS, AND WHAT CHANGED ON 2026-09-19 ─────────────────────────────
--
-- WP 4.3 shipped the dual WRITE: an analyzer stamps the entity mirror
-- (`network_nodes.*_centrality` + `computed_from_hash`) AND records the same
-- numbers in `analysis_results`, so WP 5.3 could drop the columns without changing
-- what the product reports. §4 D88 then measured what a drop would cost —
-- 8 577 of 8 577 derived rows carrying no input hash, `analysis_results` = 0 — and
-- blocked it.
--
-- §15 run `35399391429` (2026-09-19) is the first read where the store is NOT
-- empty: 1 run, 439 results, and 439 of `network_nodes`' 1 824 rows carrying
-- `computed_from_hash`. So the store has a producer, the columns have legacy rows,
-- and BOTH are live at once. That is the state the brief calls for a dual read in.
--
-- ── WHY THE READ, AND NOT THE DROP ──────────────────────────────────────────
--
-- The other 1 385 rows predate provenance and can NEVER be backfilled: a row
-- written before WP 4.3 has no input hash, and inventing one is the fabricated
-- provenance `declared-fallback` (I6) forbids — a `computed_from_hash` that is
-- confidently wrong is worse than the NULL it replaced. So the columns stay until
-- every project has been re-run, and until then a reader must be able to get an
-- answer from either half AND BE TOLD WHICH. Not telling is the defect: two
-- numbers of different provenance rendered identically is T1 with the source
-- silently removed.
--
-- ── WHY IT IS IN THE RPC AND NOT IN THE PAGE ────────────────────────────────
--
-- `get_network_metrics_for_materials` is the only path to these numbers —
-- `ProductLevelNetwork` calls it, and nothing in `src/` reads the columns
-- directly. Putting the preference here means ONE implementation of "which half
-- answered", which is `single-source` (I1); putting it in the page would make the
-- next reader of the store write a second one, and the two would disagree about
-- staleness within a quarter (§4 D21).
--
-- ── THE SIGNATURE CHANGES, SO THIS IS A DROP AND CREATE ─────────────────────
--
-- `CREATE OR REPLACE FUNCTION` cannot change a `RETURNS TABLE` column list.
-- A DROP takes the function's grants with it — the lesson `supabase/rehearsal/210`
-- §2 was written for — so the grants are re-issued below and the rehearsal checks
-- them back as EXPLICIT grantees in `proacl` rather than asking
-- `has_function_privilege`, which cannot fail while PUBLIC keeps EXECUTE.
--
-- The added columns are ADDITIVE for the caller: a PostgREST rpc returning rows
-- hands the extra keys to JavaScript and the existing table ignores them until
-- the page is taught to render them.
--
-- Invariants: `input-hash` (I5) — a derived value now travels with the hash it
-- came from, whichever half supplied it; T1 — every number resolves to a source,
-- and the source is a column of the answer; T2 — the substitution (a legacy column
-- standing in for an absent store row) is visible at the point of display.
-- Proved behaviourally by `supabase/rehearsal/250_dual_read_node_metrics.sql`.

-- ── 1 · the latest run whose answer a reader should prefer ──────────────────
--
-- `succeeded` ONLY, AND THE VOCABULARY WAS READ RATHER THAN ASSUMED. The first
-- draft filtered `status = 'completed'` — a reasonable word, and not one this schema
-- uses: the CHECK is `running | succeeded | failed`, and `analysis_complete_run`
-- writes `succeeded`. The read silently found nothing and reported every node as a
-- column answer, which is the failure mode this whole package is about, arriving in
-- its own implementation. `rehearsal/250` §1 caught it on the first run.
--
-- A `running` run has no results yet and a `failed` one has an answer nobody should
-- read; both are rows that stay (WP 4.2 deletes nothing), so the filter is on
-- status and not on existence.
--
-- `started_at DESC` and not `finished_at`: a run's identity is its inputs, and
-- `analysis_get_or_start` reuses a row for a repeated identity, so `finished_at`
-- can move on a run that answers an older question. `started_at` is the moment the
-- question was asked, which is the order a reader means by "latest".
CREATE OR REPLACE FUNCTION public.analysis_latest_run(
  _project_id uuid,
  _analysis_kind text
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id
    FROM public.analysis_runs r
   WHERE r.project_id = _project_id
     AND r.analysis_kind = _analysis_kind
     AND r.status = 'succeeded'
   ORDER BY r.started_at DESC, r.id
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.analysis_latest_run(uuid, text) IS
  'Phase 6 / WP 6.3 (§4 D88) — the SUCCEEDED run whose stored answer a reader '
  'should prefer for this project and kind, newest first by `started_at`. NULL '
  'means the store has nothing for this kind, which is a legitimate answer and '
  'the reason the dual read has a second half.';

REVOKE ALL ON FUNCTION public.analysis_latest_run(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_latest_run(uuid, text) TO anon, authenticated, service_role;

-- ── 2 · the dual read ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_network_metrics_for_materials(uuid, uuid, text);

CREATE FUNCTION public.get_network_metrics_for_materials(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS TABLE(
  id                         uuid,
  uid                        text,
  name                       text,
  revenue                    numeric,
  degree_centrality          numeric,
  weighted_degree_centrality numeric,
  eigenvector_centrality     numeric,
  betweenness_centrality     numeric,
  closeness_centrality       numeric,
  prominence                 numeric,
  connection_count           bigint,
  -- ── the provenance half, WP 6.3 ──
  -- 'store'  — from `analysis_results`, the reproducible answer;
  -- 'column' — from the entity mirror, because the store has no row for this
  --            node. Legacy, and possibly older than the dataset;
  -- 'none'   — neither half has a number. NOT the same as zero (§4 D17).
  metrics_source             text,
  run_id                     uuid,
  computed_from_hash         text,
  computed_at                timestamptz,
  -- Whether the hash the answer came from is the project's hash NOW. NULL when
  -- there is no hash to compare — which is every legacy row, and is why this is
  -- three-valued rather than a boolean with a default.
  hash_is_current            boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_run     uuid;
  v_hash    text;
  v_current text;
BEGIN
  -- Unchanged: the RPC authenticates its caller and sets the GUC the RLS
  -- predicates read.
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  v_run := public.analysis_latest_run(p_project_id, 'network_metrics');
  SELECT r.input_hash INTO v_hash FROM public.analysis_runs r WHERE r.id = v_run;
  v_current := public.current_graph_hash(p_project_id);

  RETURN QUERY
  SELECT
    nn.id,
    nn.uid,
    nn.name,
    nn.revenue,
    -- PREFER THE STORE, FALL BACK TO THE COLUMN — per METRIC, not per row.
    -- Per-metric because the two analyzers write different subsets: a
    -- `network_metrics` run supplies the five centralities and `prominence` comes
    -- from `calculate-node-prominence`, whose own run is a different kind. A
    -- row-level preference would drop `prominence` for every node the newer
    -- network_metrics run covers.
    COALESCE((ar.metrics ->> 'degree_centrality')::numeric,          nn.degree_centrality),
    COALESCE((ar.metrics ->> 'weighted_degree_centrality')::numeric, nn.weighted_degree_centrality),
    COALESCE((ar.metrics ->> 'eigenvector_centrality')::numeric,     nn.eigenvector_centrality),
    COALESCE((ar.metrics ->> 'betweenness_centrality')::numeric,     nn.betweenness_centrality),
    COALESCE((ar.metrics ->> 'closeness_centrality')::numeric,       nn.closeness_centrality),
    COALESCE((ar.metrics ->> 'prominence')::numeric,                 nn.prominence),
    (
      SELECT COUNT(*)::bigint
        FROM public.network_edges ne
       WHERE ne.project_id = p_project_id
         AND (ne.src_uid = nn.uid OR ne.dst_uid = nn.uid)
    ),
    -- WHICH HALF ANSWERED. `ar.id IS NOT NULL` and not "did any COALESCE take the
    -- left branch": a store row whose every metric is null is still the store
    -- answering, and reporting it as a column read would attribute a legacy
    -- provenance to a reproducible run.
    CASE
      WHEN ar.id IS NOT NULL THEN 'store'
      WHEN nn.degree_centrality IS NOT NULL
        OR nn.betweenness_centrality IS NOT NULL
        OR nn.eigenvector_centrality IS NOT NULL
        OR nn.closeness_centrality IS NOT NULL
        OR nn.weighted_degree_centrality IS NOT NULL
        OR nn.prominence IS NOT NULL                    THEN 'column'
      ELSE 'none'
    END,
    CASE WHEN ar.id IS NOT NULL THEN v_run ELSE NULL END,
    -- The hash comes from the RUN when the store answered and from the ROW when
    -- the column did. They are the same field's worth of meaning and different
    -- sources, and conflating them is how a legacy row would inherit a hash it
    -- never had.
    CASE WHEN ar.id IS NOT NULL THEN v_hash ELSE nn.computed_from_hash END,
    CASE WHEN ar.id IS NOT NULL THEN ar.created_at ELSE nn.computed_at END,
    CASE
      WHEN v_current IS NULL THEN NULL
      WHEN ar.id IS NOT NULL THEN (v_hash = v_current)
      WHEN nn.computed_from_hash IS NOT NULL THEN (nn.computed_from_hash = v_current)
      ELSE NULL     -- no hash on either side: unknown, which is not stale (D70)
    END
  FROM public.network_nodes nn
  LEFT JOIN public.analysis_results ar
         ON v_run IS NOT NULL
        AND ar.run_id = v_run
        AND ar.entity_type = 'node'
        AND ar.entity_id = nn.uid
  WHERE nn.project_id = p_project_id
    -- UNCHANGED FROM THE FUNCTION THIS REPLACES, deliberately. "Material node"
    -- is not a column on `network_nodes`; it is a node that appears as an end of
    -- a `bom`-sourced arc in `supply_chain_data`. Re-deriving the predicate here
    -- would be a second definition of which nodes this screen is about, and the
    -- package's subject is the PROVENANCE of the numbers, not which rows appear.
    AND EXISTS (
      SELECT 1 FROM public.supply_chain_data scd
       WHERE scd.project_id = p_project_id
         AND scd.data_source = 'bom'
         AND (scd.from_location = nn.uid OR scd.to_location = nn.uid)
    )
  -- ORDER BY also unchanged, and it reads the COLUMNS on purpose even though the
  -- values may come from the store. A row order that flipped depending on which
  -- half answered would reorder the table on the first re-run, which is a change
  -- to the screen this package did not ask for. It is a known inconsistency and
  -- it is stated rather than quietly fixed: the ordering is by the mirror, the
  -- numbers are by the store.
  ORDER BY nn.prominence DESC NULLS LAST, nn.degree_centrality DESC NULLS LAST;
END; $fn$;

COMMENT ON FUNCTION public.get_network_metrics_for_materials(uuid, uuid, text) IS
  'Phase 6 / WP 6.3 (§4 D88) — material-node network metrics, DUAL READ: the '
  'store (`analysis_results`) is preferred per metric, the entity mirror on '
  '`network_nodes` stands in where the store has no row, and `metrics_source` '
  'says which answered. The columns cannot be dropped yet because 1 385 rows '
  'predate provenance and a backfill would be invented provenance (I6), so a '
  'reader has to be told which half it got — T2, at the point of display.';

REVOKE ALL ON FUNCTION public.get_network_metrics_for_materials(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_network_metrics_for_materials(uuid, uuid, text)
  TO anon, authenticated, service_role;
