-- Phase 4 / WP 4.4 / §11 — ONE STALENESS RULE, AND A HASH CHANGE STOPS
-- REWRITING ROWS.
--
-- §11's WP 4.4 is one sentence and one clause:
--
--     "ONE staleness rule everywhere: stale iff `computed_from_hash <>
--      current_graph_hash()`; delete the three ad-hoc ones."
--     "…a hash change is a REVERSIBLE display state, never a persisted status
--      write."
--
-- The clause is D70 and it is the more important half. `expire_agent_proposals`
-- UPDATEs `proposals.status` to `expired` for grounding drift, ONE-WAY, FROM A
-- READ — `list_agent_proposals` calls it, so the first page load after a deploy
-- that moves the hash rewrites rows before anybody has edited anything. Nothing
-- un-expires them when the hash comes back, and the PRIOR STATUS IS GONE: the
-- row said `draft`, `proposed` or `approved`, and `expired` overwrote it.
--
-- ── THE RULE IS THREE-STATE AND §11 SAYS TWO, DELIBERATELY ─────────────────
--
-- "stale iff `computed_from_hash <> current_graph_hash()`" is exactly right for
-- a row that HAS a hash. WP 4.3 shipped the columns nullable, because a row
-- written before that package has no provenance and inventing one would be the
-- silent default `declared-fallback` (I6) forbids. So there are three states and
-- a boolean can only spell two of them:
--
--     fresh    — the row names the world the project is in now
--     stale    — the row names a DIFFERENT world; it was computed and is old
--     unknown  — the row names NO world; nothing can say whether it is current
--
-- Collapsing `unknown` into `stale` is the safe direction and `is_stale()` does
-- exactly that for the call sites that want a boolean. But collapsing it at the
-- point of DISPLAY would tell a user that a number is out of date when the truth
-- is that we cannot tell — which is T1 ("no number without a source") answered
-- with a guess. §11 is edited in the same commit to say three.
--
-- ── WHAT "ONE RULE" COSTS, AND WHY IT IS STILL ONE ─────────────────────────
--
-- `is_stale` and `freshness_of` are two functions and one rule: the second
-- delegates to the first and nothing else in the database compares a hash to
-- decide freshness. The three ad-hoc mechanisms §11 names are handled at the
-- bottom of this file; the count turned out to be two rather than three, and the
-- third was never what the brief said it was (see §16).
-- ============================================================================

-- ── 1 · `policy_overrides.seeded_from_hash` ────────────────────────────────
--
-- An override SEEDED from project data is a copy of a number the dataset had at
-- the moment of seeding. Re-upload the dataset and the copy does not move — and
-- §11's note is the reason this matters more than a display nit: THE ENGINE
-- READS OVERRIDES, NOT THE GRID. A stale seeded override is a simulation
-- correctness problem, not a cosmetic one, and the UI copy says so.
--
-- NULLABLE, and the NULL is meaningful rather than missing: an override a person
-- TYPED was never seeded from anything and is not stale when the data moves — it
-- is their decision, and their decision does not expire. Only a seeded one
-- carries a hash. This is the same shape as `computed_from_hash` (WP 4.3) and
-- the same reason there is no DEFAULT.

ALTER TABLE public.policy_overrides
  ADD COLUMN IF NOT EXISTS seeded_from_hash text;

COMMENT ON COLUMN public.policy_overrides.seeded_from_hash IS
  'WP 4.4 · the `current_graph_hash` of the moment this override was SEEDED from '
  'project data, or NULL if a person typed it. NULL is meaningful: a typed '
  'override is a decision and a decision does not go stale when the dataset '
  'moves. A seeded one does — and the ENGINE reads overrides rather than the '
  'grid, so a stale seeded override is a simulation-correctness problem. '
  'Freshness is computed from it and never written back (D70).';

-- ── 1b · THE WRITER, because a column nothing fills is a promise ──────────
--
-- `bulk_upsert_policy_overrides` is the only path into this table. It gains one
-- optional per-row flag, `seeded`, and STAMPS THE HASH ITSELF — the client does
-- not send one. Same stance as `analysis_apply_node_metrics` in WP 4.3: a caller
-- that supplies the provenance can supply the wrong provenance, and a column
-- that is confidently wrong is worse than one that is absent.
--
-- ON CONFLICT WRITES THE COLUMN RATHER THAN LEAVING IT, and that is the clause
-- that makes the distinction hold over time: a person typing over a seeded
-- override turns a copy into a DECISION, so the hash must go. Leaving it would
-- mark their deliberate value stale the next time the dataset moved.
--
-- The signature is unchanged — `(uuid, jsonb)` with the flag read out of each
-- row — so the deployed frontend keeps working across the deploy window and
-- simply writes NULL, which is the honest record for a call that cannot say.

CREATE OR REPLACE FUNCTION public.bulk_upsert_policy_overrides(
  p_project_id uuid,
  p_rows       jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_hash text;
BEGIN
  -- ONCE, outside the insert: a per-row call would rebuild the eleven-table
  -- snapshot for every override in a bulk seed, and two rows of one seed could
  -- land on different hashes if a write raced them.
  v_hash := public.current_graph_hash(p_project_id);

  INSERT INTO public.policy_overrides
    (project_id, scope, target_key, family, patch, seeded_from_hash, updated_at)
  SELECT
    p_project_id,
    r->>'scope',
    r->>'target_key',
    r->>'family',
    r->'patch',
    CASE WHEN COALESCE((r->>'seeded')::boolean, false) THEN v_hash ELSE NULL END,
    now()
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (project_id, scope, target_key, family)
  DO UPDATE SET patch            = excluded.patch,
                seeded_from_hash = excluded.seeded_from_hash,
                updated_at       = now();
END;
$fn$;

COMMENT ON FUNCTION public.bulk_upsert_policy_overrides(uuid, jsonb) IS
  'WP 4.4 · takes an optional per-row `seeded` boolean and stamps '
  '`seeded_from_hash` from `current_graph_hash` ITSELF — the caller does not send '
  'a hash, because a caller that supplies provenance can supply the wrong '
  'provenance. ON CONFLICT overwrites the column: typing over a seeded override '
  'turns a copy into a decision, and a decision does not go stale when the '
  'dataset moves. An older caller that sends no flag writes NULL, which is the '
  'honest record for a call that cannot say.';

-- ── 2 · THE RULE ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.freshness_of(
  _recorded_hash text,
  _project_id    uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT CASE
    -- A row that names no world cannot claim to be in this one. It is not stale
    -- — nothing says it is out of date — it is UNATTRIBUTED, and saying so is
    -- the difference between T1 and a guess that happens to be cautious.
    WHEN _recorded_hash IS NULL THEN 'unknown'
    WHEN _recorded_hash = public.current_graph_hash(_project_id) THEN 'fresh'
    ELSE 'stale'
  END;
$fn$;

COMMENT ON FUNCTION public.freshness_of(text, uuid) IS
  'WP 4.4 · THE staleness rule. Every freshness question in this database '
  'resolves here: a recorded hash equal to the project''s current `graph_hash` is '
  'fresh, a different one is stale, and NULL is UNKNOWN rather than stale — a row '
  'written before WP 4.3 has no provenance and reporting it as out of date would '
  'answer T1 with a guess. It replaces the timestamp comparisons §4 D12 is about: '
  '`last_data_time > last_calc_time` asks whether a clock moved, which an UPDATE '
  'writing the same value answers yes to and a restored backup answers no to.';

CREATE OR REPLACE FUNCTION public.is_stale(
  _recorded_hash text,
  _project_id    uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  -- Collapses `unknown` into "do not trust it", which is the safe direction for
  -- a caller that can only branch two ways. Display code calls `freshness_of`.
  SELECT public.freshness_of(_recorded_hash, _project_id) <> 'fresh';
$fn$;

COMMENT ON FUNCTION public.is_stale(text, uuid) IS
  'WP 4.4 · `freshness_of() <> ''fresh''`, for a caller that can only branch two '
  'ways. It is NOT a second rule — it delegates. Display surfaces call '
  '`freshness_of` so that "we cannot tell" is not reported as "out of date".';

REVOKE ALL ON FUNCTION public.freshness_of(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_stale(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freshness_of(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_stale(text, uuid) TO anon, authenticated, service_role;

-- ── 3 · `project_freshness` — the badge, and the Trust Report's section ─────
--
-- ONE round trip, because the alternative is six and a component that renders
-- six spinners. It answers, for one project: which world it is in now, which
-- dataset version that is, and how many rows of each derived table name that
-- world, a different one, or none at all.
--
-- `current_graph_hash` is called ONCE and passed down. Calling it per table
-- would rebuild the eleven-table snapshot six times for one badge, and — worse —
-- a concurrent write between two of those calls would produce a report whose
-- rows disagree about what "now" is. That is the failure §15 hit when a run
-- raced a deploy and read 1 787 rows in one query and 1 691 in another.

CREATE OR REPLACE FUNCTION public.project_freshness(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_hash     text;
  v_tables   jsonb := '{}'::jsonb;
  v_dsv      jsonb;
  v_runs     jsonb;
BEGIN
  IF NOT public.has_project_access(p_project_id) THEN
    RAISE EXCEPTION 'project_freshness: no access to project %', p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hash := public.current_graph_hash(p_project_id);

  -- One statement per derived table, each classifying its own rows against the
  -- single hash read above. `filter` rather than three scans.
  SELECT jsonb_object_agg(t, counts) INTO v_tables FROM (
    SELECT 'network_nodes' AS t, jsonb_build_object(
             'rows',    count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at)) AS counts
      FROM public.network_nodes WHERE project_id = p_project_id
    UNION ALL
    SELECT 'node_list', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at))
      FROM public.node_list WHERE project_id = p_project_id
    UNION ALL
    SELECT 'supply_chain_data', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at))
      FROM public.supply_chain_data WHERE project_id = p_project_id
    UNION ALL
    SELECT 'network_summary', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at))
      FROM public.network_summary WHERE project_id = p_project_id
    UNION ALL
    -- The one that is NOT a display concern. §11: the engine reads overrides,
    -- not the grid, so a stale seeded override changes what a simulation
    -- computes. A TYPED override (`seeded_from_hash IS NULL`) is a decision and
    -- is reported as `typed` rather than folded into `unknown` — it is not
    -- missing provenance, it has none to miss.
    SELECT 'policy_overrides', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE seeded_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE seeded_from_hash IS NOT NULL
                                           AND seeded_from_hash <> v_hash),
             'unknown', 0,
             'typed',   count(*) FILTER (WHERE seeded_from_hash IS NULL),
             'computed_at', max(updated_at))
      FROM public.policy_overrides WHERE project_id = p_project_id
  ) q;

  SELECT to_jsonb(d) - 'snapshot' INTO v_dsv
    FROM public.dataset_versions d
   WHERE d.project_id = p_project_id
   ORDER BY d.created_at DESC LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
           'analysis_kind', r.analysis_kind,
           'run_id', r.id,
           'status', r.status,
           'code_version', r.code_version,
           'finished_at', r.finished_at,
           'freshness', public.freshness_of(r.input_hash, p_project_id),
           'warnings', r.warnings)
         ORDER BY r.started_at DESC) INTO v_runs
    FROM (SELECT DISTINCT ON (analysis_kind) *
            FROM public.analysis_runs
           WHERE project_id = p_project_id AND status = 'succeeded'
           ORDER BY analysis_kind, started_at DESC) r;

  RETURN jsonb_build_object(
    'project_id',      p_project_id,
    'graph_hash',      v_hash,
    'graph_hash_short', left(COALESCE(v_hash, ''), 12),
    'dataset_version', v_dsv,
    'tables',          COALESCE(v_tables, '{}'::jsonb),
    'latest_runs',     COALESCE(v_runs, '[]'::jsonb),
    'measured_at',     now());
END; $fn$;

COMMENT ON FUNCTION public.project_freshness(uuid) IS
  'WP 4.4 · everything the freshness badge and the Trust Report''s per-table '
  'section need, in ONE round trip and against ONE read of `current_graph_hash`. '
  'Per table it is computed and never written (D70), so a project whose hash '
  'moves and moves back reports fresh again with no row rewritten. '
  '`policy_overrides` reports `typed` separately from `unknown`: a typed override '
  'has no provenance to miss, and the ENGINE reads overrides rather than the '
  'grid, so its staleness is a simulation-correctness fact rather than a display '
  'one.';

REVOKE ALL ON FUNCTION public.project_freshness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_freshness(uuid) TO anon, authenticated, service_role;

-- ── 4 · D70 · A HASH CHANGE STOPS REWRITING ROWS ───────────────────────────
--
-- The old function expired a proposal for two reasons under one UPDATE:
--
--     expires_at < now()              — TIME, which is genuinely one-way
--     grounding hash <> current hash  — DRIFT, which is not
--
-- Time only moves forwards, so writing `expired` for a TTL is a record of
-- something that happened. Drift moves both ways: edit a row, the hash changes;
-- undo the edit, it changes back. Persisting drift converts a REVERSIBLE fact
-- into an irreversible one, and does it FROM A READ — `list_agent_proposals`
-- calls this, so merely opening the page performs the write.
--
-- THE DAMAGE ALREADY DONE CANNOT BE REPAIRED HERE AND THIS FILE DOES NOT
-- PRETEND OTHERWISE. A drifted row was `draft`, `proposed` or `approved`;
-- `expired` overwrote it and `status_reason = 'grounding_drift'` records only
-- WHY. The prior status is not recoverable from the row, so no UPDATE in this
-- file can restore it — that is what "one-way" means, stated as a consequence
-- rather than as an adjective. §15 counts the affected rows in this package's
-- after-run so the number is known rather than estimated.

CREATE OR REPLACE FUNCTION public.expire_agent_proposals(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_n integer;
BEGIN
  -- TTL ONLY. Drift is answered by `proposal_grounding_state` below, computed
  -- at read time, so a proposal whose project drifts and drifts back is live
  -- again with nothing rewritten (WP 4.4, §4 D70).
  UPDATE public.proposals p
     SET status = 'expired',
         status_reason = 'ttl'
   WHERE p.project_id = p_project_id
     AND p.status IN ('draft','proposed','approved')
     AND p.expires_at < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $fn$;

COMMENT ON FUNCTION public.expire_agent_proposals(uuid) IS
  'WP 4.4 · TTL ONLY since this package (§4 D70). It expired grounding drift too, '
  'one-way, from a READ — `list_agent_proposals` calls it, so opening the page '
  'performed the write and a `schema_version` bump rewrote every grounded '
  'proposal before anybody had edited anything. Drift is reversible and is now '
  'computed by `proposal_grounding_state`. Rows already expired for '
  '`grounding_drift` CANNOT be restored: `expired` overwrote the prior status and '
  'the row does not record it.';

-- A PostgREST computed column: `proposals?select=*,grounding_state` resolves
-- here. Computing it rather than storing it is the whole of D70's clause.
CREATE OR REPLACE FUNCTION public.proposal_grounding_state(p public.proposals)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT CASE
    WHEN p.grounding ? 'policy_hash'
     AND p.grounding ->> 'policy_hash' IS DISTINCT FROM public.current_policy_hash(p.project_id)
      THEN 'policy_drift'
    WHEN p.grounding ? 'graph_hash'
      THEN public.freshness_of(p.grounding ->> 'graph_hash', p.project_id)
    ELSE 'ungrounded'
  END;
$fn$;

COMMENT ON FUNCTION public.proposal_grounding_state(public.proposals) IS
  'WP 4.4 · a PostgREST computed column. `fresh` / `stale` / `unknown` from the '
  'ONE rule for the graph hash, `policy_drift` when the policy hash moved, '
  '`ungrounded` when the proposal claims no hash at all. It is COMPUTED, so a '
  'project that drifts and drifts back leaves the proposal exactly as it was '
  '(§4 D70) — which is what `expire_agent_proposals` used to make impossible.';

REVOKE ALL ON FUNCTION public.proposal_grounding_state(public.proposals) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proposal_grounding_state(public.proposals)
  TO anon, authenticated, service_role;

-- ── 5 · the ad-hoc rules, retired ──────────────────────────────────────────
--
-- `should_recalculate_network_metrics` was deprecated IN PLACE by WP 4.2 with a
-- comment naming D12, and left live because a trigger called it. Its BODY is
-- replaced here rather than the function dropped, for the deploy-window reason
-- WP 4.3 established twice: migrations and the frontend deploy through different
-- workflows with no ordering between them, and `ProductLevelNetwork.tsx` is
-- still calling it in production while this migration lands. The RETURN SHAPE is
-- unchanged — `needs_recalculation`, `reason`, `last_calculated`,
-- `data_last_modified` — so the deployed caller keeps working and starts getting
-- an answer from the one rule instead of from a clock. WP 5.3 deletes it.
--
-- `data_last_modified` IS NOW NULL AND THAT IS THE POINT. The column asked when
-- the data last changed, which is the question D12 says is the wrong one; there
-- is no honest value to put there and inventing `now()` would be a fabricated
-- source (T1). NULL, and `reason` says why.

CREATE OR REPLACE FUNCTION public.should_recalculate_network_metrics(p_project_id uuid)
RETURNS TABLE(
  needs_recalculation boolean,
  reason text,
  last_calculated timestamp with time zone,
  data_last_modified timestamp with time zone
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_hash  text;
  v_state text;
  v_last  timestamptz;
BEGIN
  v_hash := public.current_graph_hash(p_project_id);

  SELECT max(n.computed_at) INTO v_last
    FROM public.network_nodes n WHERE n.project_id = p_project_id;

  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM public.network_nodes
                             WHERE project_id = p_project_id) THEN 'no_nodes'
           WHEN EXISTS (SELECT 1 FROM public.network_nodes
                         WHERE project_id = p_project_id
                           AND public.freshness_of(computed_from_hash, p_project_id) <> 'fresh')
             THEN 'not_fresh'
           ELSE 'fresh'
         END INTO v_state;

  RETURN QUERY SELECT
    v_state <> 'fresh',
    CASE v_state
      WHEN 'no_nodes'  THEN 'no network nodes for this project'
      WHEN 'not_fresh' THEN 'at least one node was computed from a different graph hash, or from none (WP 4.4: the one staleness rule)'
      ELSE 'every node names the project''s current graph hash'
    END,
    v_last,
    NULL::timestamptz;
END; $fn$;

COMMENT ON FUNCTION public.should_recalculate_network_metrics(uuid) IS
  'DEPRECATED (WP 4.2, §4 D12) and REIMPLEMENTED on the one staleness rule '
  '(WP 4.4). It compared `last_data_time > last_calc_time` — whether a clock '
  'moved, which an UPDATE writing the same value answers yes to and a restored '
  'backup answers no to — and did it with a query that seq-scanned '
  '`supply_chain_data` once per node. It now asks `freshness_of`. '
  '`data_last_modified` returns NULL: there is no honest value for "when did the '
  'data last change", and inventing one would be a fabricated source (T1). Kept '
  'only for the window in which the deployed frontend still calls it; WP 5.3 '
  'deletes it and its caller.';

-- The completion trigger, which turned out to COMPUTE AND THEN THROW AWAY. It
-- ran the expensive check above inside every `projects` UPDATE that flips
-- `completed = true` and then only `RAISE LOG`-ged the answer: it has never
-- invoked an analysis. Rewritten to log from the one rule, which costs a hash
-- instead of a cartesian product. Whether it should EXIST is WP 5.3's to settle
-- with the rest of the invocation paths; making it cheap and honest is this
-- package's.
CREATE OR REPLACE FUNCTION public.auto_calculate_network_metrics_on_completion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(OLD.completed, false) = false AND COALESCE(NEW.completed, false) = true THEN
    IF public.is_stale(
         (SELECT max(n.computed_from_hash) FROM public.network_nodes n
           WHERE n.project_id = NEW.id), NEW.id) THEN
      RAISE LOG
        'project % completed with network metrics that do not name its current graph hash', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;

COMMENT ON FUNCTION public.auto_calculate_network_metrics_on_completion() IS
  'WP 4.4 · it has never invoked an analysis — it ran '
  '`should_recalculate_network_metrics` inside every completion flip and then '
  'only RAISE LOG-ged the result, which is why `20260712110000` had to make that '
  'function fast rather than asking what it was for. Now it asks the one rule. '
  'Whether the trigger should exist at all is WP 5.3''s, with the rest of the '
  'invocation paths.';

SELECT pg_notify('pgrst', 'reload schema');
