-- Phase 4 / WP 4.3 / §11 — THE ANALYZERS LEARN WHERE THEIR NUMBERS CAME FROM.
--
-- WP 4.2 built the store and wrote, in its own header, that "no analyzer is
-- migrated here". This is that migration's database half: every derived row
-- gains the two columns `input-hash` (I5) is actually about, and the two
-- per-row PostgREST writers that produced those rows become one statement each
-- that names its actor.
--
-- ── WHAT THIS FILE FOUND BEFORE IT WROTE ANYTHING, AND IT CHANGES THE PACKAGE ─
--
-- `analysis_runs.input_hash` is `current_graph_hash(project)`. That function
-- hashes ELEVEN tables (`20260917000002`, `_build_dataset_snapshot`) and NOT ONE
-- of them is an input to the two centrality analyzers. They read exactly:
--
--     get_network_nodes_for_prominence  → network_nodes(uid, revenue, name)
--     get_network_edges_for_prominence  → network_edges(src_uid, dst_uid,
--                                                       relative_revenue)
--
-- Both tables are in `graphHashCoverage.test.ts`'s `DERIVED_AND_OUT` list, which
-- is to say WP 4.1 deliberately kept them OUT of the anchor. That was right for
-- what WP 4.1 was doing and it is wrong the moment WP 4.2's store becomes these
-- analyzers' cache: a user re-uploads the node/edge CSV, `current_graph_hash`
-- does not move, `analysis_get_or_start` reports `cache_hit: true`, and the
-- centralities served are the ones computed against the PREVIOUS graph. A cache
-- key that cannot see its own inputs is not an identity, it is a guess with a
-- hash in it — which is the exact defect D19 and I5 exist to end, rebuilt one
-- layer up.
--
-- ── WHY THE FIX IS NOT "ADD THEM TO `graph_hash`", TODAY ────────────────────
--
-- Because that is a `schema_version` bump, and §4 D70 says what a bump does
-- while it is unfixed: `expire_agent_proposals` UPDATEs `proposals.status` to
-- `expired`, ONE-WAY, FROM A READ. WP 4.1's bump cost nothing only because §15
-- had measured 0 live proposals grounded on a hash first. Nothing has measured
-- that number today — this session cannot reach the live database (§15 runs in
-- CI) — so taking a bump here would be spending an unmeasured budget, which is
-- the one thing §4 D42 says never to do. D70 is WP 4.4's, and WP 4.4 is next.
--
-- ── SO THE TOPOLOGY TRAVELS IN `params`, DECLARED, AND IT IS AN IMPURITY ────
--
-- `network_topology_hash()` below digests exactly the six columns those two RPCs
-- return. The analyzers put it in `_params` as `topology_digest`, so the store's
-- five-part key DOES distinguish two different graphs and a hit is sound again.
--
-- It is in the wrong column and this file says so rather than letting a later
-- reader discover it: a topology digest is an INPUT, not a parameter, and it
-- belongs in `hash_network` beside `tier2_suppliers`. It is here because `params`
-- is already part of the key, already `jsonb`, already stored beside its own hash
-- for reading back, and — the deciding property — putting it there changes NO
-- stored hash and bumps NO `schema_version`, so it is reversible in a way the
-- correct fix is not. WP 4.4 moves it into the anchor in the same package that
-- makes D70 safe, and deletes the params entry. §16 carries the promise; the
-- sidecar's `analysis_kinds` block carries the declaration, so the impurity is
-- VISIBLE at the point it is used (T2) rather than true only in a migration
-- comment.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────────
--
--   * It drops NO column. §11 is explicit and so is the prompt: WP 5.3 drops,
--     after every reader has moved, and dropping early is the one thing that
--     makes this irreversible.
--   * It creates D72's index and NOTHING ELSE about the split. The first draft
--     of this header deferred the index too, reasoning that a dedup needs a
--     count and nothing had counted. That was wrong and §4 D72's own row says
--     so: WP 4.2's §15 run `35233002946` measured every project —
--     1 385 rows, ZERO duplicate `(project_id, uid)` keys, ZERO null `uid`. So
--     there is no dedup migration, no rows to lose, and one statement closes a
--     defect that has failed silently on every fallback run since it was
--     written. Verifying a precondition rather than inheriting it is the whole
--     of the difference.
-- ============================================================================

-- ── 0 · D72 · THE KEY `network_nodes` HAS NEVER HAD ────────────────────────
--
-- `calculate-network-science-metrics` upserts with `onConflict: 'project_id,uid'`
-- and PostgreSQL rejects it with 42P10 — there is no unique or exclusion
-- constraint matching the ON CONFLICT specification — because the table's only
-- uniqueness is the surrogate `network_nodes_pkey`. The handler logs and carries
-- on, so the per-node update that follows matches zero rows and the function
-- reports success over a project with no metrics at all.
--
-- `NULLS NOT DISTINCT`, and §15 measuring `null_uid = 0` is not a reason to omit
-- it: `uid` IS NULLABLE, nullability is a schema property a later `ALTER` can
-- change, and a plain unique index constrains every row EXCEPT the null ones
-- while `ON CONFLICT` inserts duplicates rather than updating (§4 D5, and
-- `20260916000018` demonstrates it in three lines rather than arguing it). All
-- seven keys WP 3.3 landed say the same thing for the same reason.
--
-- IT IS NOT A NATURAL KEY ON A TIER-2 TABLE YET. `network_nodes` is described as
-- tier 3 in this commit (the sidecar says why), so `contract:check` R5 does not
-- reach it. The index is here because the UPSERT needs an arbiter, not because
-- a gate asked for it — and when WP 5.3 drops the computed columns and the
-- remainder becomes tier 2, R5 finds the key already there.

CREATE UNIQUE INDEX IF NOT EXISTS network_nodes_natural_key
  ON public.network_nodes (project_id, uid) NULLS NOT DISTINCT;

COMMENT ON INDEX public.network_nodes_natural_key IS
  'WP 4.3 · §4 D72. The arbiter `calculate-network-science-metrics`''s fallback '
  'upsert has been naming since it was written, and which did not exist — so the '
  'statement failed with 42P10 on every run, was logged, and the function carried '
  'on to update zero rows and report success.';

-- ── 1 · `computed_from_hash` + `computed_at` — I5, as columns ───────────────
--
-- On the tables that carry a value an analysis WROTE, and only those. The list
-- is not "every table in DERIVED_AND_OUT":
--
--   network_nodes    ✓ five centralities + `prominence`
--   node_list        ✓ `is_critical_node`, `critical_node_score`
--   supply_chain_data ✓ `is_critical_node`, `critical_node_score` (the live one:
--                       `predict-critical-nodes` writes HERE, not to node_list)
--   network_summary  ✓ `nodes_count`/`edges_count`/`tiers_data` are counts OF a
--                       graph, so every value column is derived
--   network_edges    ✗ EVERY column is uploaded — `src_uid`, `dst_uid`,
--                       `relative_revenue`, `depth`, `direction`. Nothing
--                       computes it. It is in `DERIVED_AND_OUT` by NAME rather
--                       than by nature, and giving it provenance columns no
--                       writer could ever fill is how a schema acquires a
--                       promise instead of a fact.

ALTER TABLE public.network_nodes
  ADD COLUMN IF NOT EXISTS computed_from_hash text,
  ADD COLUMN IF NOT EXISTS computed_at        timestamptz;

ALTER TABLE public.node_list
  ADD COLUMN IF NOT EXISTS computed_from_hash text,
  ADD COLUMN IF NOT EXISTS computed_at        timestamptz;

ALTER TABLE public.network_summary
  ADD COLUMN IF NOT EXISTS computed_from_hash text,
  ADD COLUMN IF NOT EXISTS computed_at        timestamptz;

ALTER TABLE public.supply_chain_data
  ADD COLUMN IF NOT EXISTS computed_from_hash text,
  ADD COLUMN IF NOT EXISTS computed_at        timestamptz;

COMMENT ON COLUMN public.network_nodes.computed_from_hash IS
  'WP 4.3 · The `analysis_runs.input_hash` of the run that wrote this row''s '
  'computed columns. NULL means "written before WP 4.3, provenance unknown" and '
  'is a reportable state, not a default — `declared-fallback` (I6) forbids a '
  'silent one. Invariant `input-hash` (I5).';
COMMENT ON COLUMN public.node_list.computed_from_hash IS
  'WP 4.3 · See network_nodes.computed_from_hash. NULL means the row predates '
  'the analyzers carrying provenance.';
COMMENT ON COLUMN public.network_summary.computed_from_hash IS
  'WP 4.3 · See network_nodes.computed_from_hash.';
COMMENT ON COLUMN public.supply_chain_data.computed_from_hash IS
  'WP 4.3 · The run that last wrote `is_critical_node`/`critical_node_score` on '
  'this row. The rest of the row is combine-project''s ETL output and is NOT '
  'what this column describes.';

-- ── 2 · `network_topology_hash` — the digest `graph_hash` cannot see ────────
--
-- Deliberately narrow: the SIX columns the two prominence RPCs actually return,
-- and not every column of the two tables. A digest wider than the read is a
-- digest that reports a changed input when nothing the analysis saw changed,
-- and every spurious miss is a full recomputation — the cost D19 is about.
--
-- ORDER IS FIXED by an explicit ORDER BY. `string_agg` over an unordered scan is
-- non-deterministic across plans, so the same graph would digest two ways and
-- the cache would miss at random. That is not hypothetical: it is why
-- `_build_dataset_snapshot` orders every one of its eleven blocks.
--
-- NULL is distinguished from the empty string. `coalesce(x,'')` would make a
-- node with no name and a node named '' the same graph.

CREATE OR REPLACE FUNCTION public.network_topology_hash(p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT encode(extensions.digest(
    jsonb_build_object(
      'nodes', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(n.uid, n.name, n.revenue) ORDER BY n.uid, n.id)
          FROM public.network_nodes n WHERE n.project_id = p_project_id
      ), '[]'::jsonb),
      'edges', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(e.src_uid, e.dst_uid, e.relative_revenue)
                         ORDER BY e.src_uid, e.dst_uid, e.id)
          FROM public.network_edges e WHERE e.project_id = p_project_id
      ), '[]'::jsonb)
    )::text, 'sha256'), 'hex');
$fn$;

COMMENT ON FUNCTION public.network_topology_hash(uuid) IS
  'WP 4.3 · A digest of exactly what `get_network_nodes_for_prominence` and '
  '`get_network_edges_for_prominence` return, which is the input to the two '
  'centrality analyzers and is NOT covered by `current_graph_hash` — that '
  'function hashes eleven tier-2 tables and `network_nodes`/`network_edges` are '
  'in `graphHashCoverage.test.ts`''s DERIVED_AND_OUT list. Until WP 4.4 folds '
  'this into `hash_network` (which is a `schema_version` bump, and D70 must land '
  'first), the analyzers carry it in `analysis_runs.params` as `topology_digest` '
  'so the store''s key can still tell two different graphs apart. A project with '
  'no deep-tier data digests the empty graph, which is a real answer and not a '
  'NULL — two empty projects SHOULD share a run.';

REVOKE ALL ON FUNCTION public.network_topology_hash(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.network_topology_hash(uuid) TO service_role;

-- ── 3 · `analysis_apply_node_metrics` — the dual-write's entity half ────────
--
-- WHAT IT REPLACES, and the number is the point. `calculate-network-science-
-- metrics` ran ONE `.update()` PER NODE in a loop and `calculate-node-prominence`
-- ran one per node in parallel. Since WP 2.3 each of those statements writes its
-- own audit row saying `actor_known: false`, because a service-role PostgREST
-- call cannot set the GUC the trigger reads (D36). §15 measured 1 385 rows in
-- `network_nodes`; one prominence run over that project therefore wrote 1 385
-- audit rows into the log that statement grain exists to keep readable. This is
-- the same fix `analysis_mark_critical_nodes` got in `20260917000003`, applied
-- to the two writers WP 4.1 did not reach.
--
-- THE PROVENANCE IS NOT A PARAMETER. `computed_from_hash` is read off the RUN,
-- inside this function, so a caller cannot stamp a row with a hash the run does
-- not carry. Passing it in would make the two halves of the dual-write
-- independently wrong, which is the failure mode a dual-write exists to catch.

CREATE OR REPLACE FUNCTION public.analysis_apply_node_metrics(
  _run_id        uuid,
  _metrics       jsonb,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run     public.analysis_runs;
  v_updated integer := 0;
  v_seen    integer := 0;
BEGIN
  IF jsonb_typeof(_metrics) <> 'array' THEN
    RAISE EXCEPTION 'analysis_apply_node_metrics: _metrics must be a json array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_run FROM public.analysis_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis_apply_node_metrics: no run %', _run_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- A finished run's answer is frozen (WP 4.2). Stamping entity rows from it
  -- afterwards would let a stored result and its mirror drift apart with the
  -- run still claiming to describe both.
  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION
      'analysis_apply_node_metrics: run % is %, and the entity mirror is written '
      'while the run is running or not at all (WP 4.3)', _run_id, v_run.status
      USING ERRCODE = 'P0A01';
  END IF;

  -- Authenticates and sets `app.current_user_id` LOCAL, so the tier-3 audit
  -- trigger names a person. It does not authorize — see `20260917000005`.
  PERFORM public.assert_writer_may_act('analysis_apply_node_metrics', v_run.project_id, _actor_user_id);

  v_seen := jsonb_array_length(_metrics);
  IF v_seen = 0 THEN
    RETURN jsonb_build_object('rows_updated', 0, 'metrics_supplied', 0,
                              'computed_from_hash', v_run.input_hash);
  END IF;

  -- ONE statement, and it is scoped by the RUN's project rather than by a
  -- parameter: `analysis_mark_critical_nodes` had to DERIVE its project from the
  -- scored rows because its caller filtered by `plant_name`, which is not scoped
  -- to a project at all. Here the run already knows, so the scope is not
  -- something a caller can get wrong.
  --
  -- COALESCE on each metric: a partial update is legitimate —
  -- `calculate-node-prominence` computes `prominence` and nothing else, and must
  -- not blank the five centralities another run wrote.
  UPDATE public.network_nodes n
     SET prominence                 = COALESCE(m.prominence, n.prominence),
         degree_centrality          = COALESCE(m.degree_centrality, n.degree_centrality),
         weighted_degree_centrality = COALESCE(m.weighted_degree_centrality, n.weighted_degree_centrality),
         eigenvector_centrality     = COALESCE(m.eigenvector_centrality, n.eigenvector_centrality),
         betweenness_centrality     = COALESCE(m.betweenness_centrality, n.betweenness_centrality),
         closeness_centrality       = COALESCE(m.closeness_centrality, n.closeness_centrality),
         prominence_updated_at      = CASE WHEN m.prominence IS NOT NULL
                                           THEN now() ELSE n.prominence_updated_at END,
         network_metrics_updated_at = CASE WHEN m.degree_centrality IS NOT NULL
                                           THEN now() ELSE n.network_metrics_updated_at END,
         computed_from_hash         = v_run.input_hash,
         computed_at                = now(),
         updated_at                 = now()
    FROM jsonb_to_recordset(_metrics) AS m(
           uid                        text,
           prominence                 numeric,
           degree_centrality          numeric,
           weighted_degree_centrality numeric,
           eigenvector_centrality     numeric,
           betweenness_centrality     numeric,
           closeness_centrality       numeric)
   WHERE n.project_id = v_run.project_id AND n.uid = m.uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'rows_updated', v_updated,
    'metrics_supplied', v_seen,
    'computed_from_hash', v_run.input_hash);
END; $fn$;

REVOKE ALL ON FUNCTION public.analysis_apply_node_metrics(uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_apply_node_metrics(uuid,jsonb,uuid) TO service_role;

-- ── 4 · `analysis_mark_critical_nodes` learns which run it belongs to ───────
--
-- A THREE-ARGUMENT SIBLING RATHER THAN A REPLACEMENT, and the reason is a
-- deployment ordering rather than a preference: migrations and edge functions
-- deploy through different workflows with no ordering between them, so between
-- the two deploys the live `predict-critical-nodes` is still making the two-
-- argument call. Dropping that signature would fail every run in the window.
-- The two-argument form is kept as a thin delegation and marked deprecated; it
-- writes NULL provenance, which is the honest record of a call that could not
-- name its run.

CREATE OR REPLACE FUNCTION public.analysis_mark_critical_nodes(
  _actor_user_id uuid,
  _scores        jsonb,
  _run_id        uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_project  uuid;
  v_projects integer;
  v_updated  integer;
  v_hash     text;
  v_run      public.analysis_runs;
BEGIN
  IF jsonb_typeof(_scores) <> 'array' THEN
    RAISE EXCEPTION 'analysis_mark_critical_nodes: scores must be a json array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(_scores) = 0 THEN
    RETURN jsonb_build_object('rows_updated', 0);
  END IF;

  SELECT count(*), (array_agg(p))[1]
    INTO v_projects, v_project
    FROM (SELECT DISTINCT d.project_id AS p
            FROM public.supply_chain_data d
           WHERE d.id IN (SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(_scores) e)) q;

  IF COALESCE(v_projects, 0) = 0 THEN
    RAISE EXCEPTION 'analysis_mark_critical_nodes: none of the % scored id(s) exists',
      jsonb_array_length(_scores) USING ERRCODE = 'no_data_found';
  END IF;
  IF v_projects > 1 THEN
    RAISE EXCEPTION
      'analysis_mark_critical_nodes: the scored rows span % projects. One call writes '
      'under one project''s authority or it writes nothing.', v_projects
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A run given must BELONG to the rows being written. Without this check a
  -- caller could stamp project A's rows with project B's run and the provenance
  -- column would be worse than absent — it would be confidently wrong.
  IF _run_id IS NOT NULL THEN
    SELECT * INTO v_run FROM public.analysis_runs WHERE id = _run_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'analysis_mark_critical_nodes: no run %', _run_id
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_run.project_id <> v_project THEN
      RAISE EXCEPTION
        'analysis_mark_critical_nodes: run % belongs to project %, the scored rows to %',
        _run_id, v_run.project_id, v_project USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_hash := v_run.input_hash;
  END IF;

  PERFORM public.assert_writer_may_act('analysis_mark_critical_nodes', v_project, _actor_user_id);

  UPDATE public.supply_chain_data d
     SET is_critical_node      = s.is_critical,
         critical_node_score   = s.score,
         prediction_timestamp  = now(),
         computed_from_hash    = v_hash,
         computed_at           = now(),
         updated_at            = now()
    FROM jsonb_to_recordset(_scores) AS s(id uuid, is_critical boolean, score numeric)
   WHERE d.id = s.id AND d.project_id = v_project;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('project_id', v_project, 'rows_updated', v_updated,
                            'computed_from_hash', v_hash);
END; $fn$;

CREATE OR REPLACE FUNCTION public.analysis_mark_critical_nodes(
  _actor_user_id uuid,
  _scores        jsonb
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.analysis_mark_critical_nodes(_actor_user_id, _scores, NULL::uuid);
$fn$;

COMMENT ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb) IS
  'DEPRECATED by WP 4.3 — the three-argument form takes `_run_id` and stamps '
  '`computed_from_hash` (I5). This one exists only so the currently deployed '
  '`predict-critical-nodes` keeps working across the window between the '
  'migration deploy and the edge-function deploy, which are separate workflows '
  'with no ordering between them. It writes NULL provenance, which is the honest '
  'record of a call that could not name its run. Delete it in WP 5.3, once no '
  'deployed caller uses it.';

REVOKE ALL ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb) TO service_role;

-- ── 5 · `refresh_node_list_for_project` learns its actor ───────────────────
--
-- It takes only a project id, so every row it writes into `node_list` — a tier-3
-- table as of this package's sidecars — audits as `actor_known: false`. Its one
-- caller is `combine-project`, which HAS the actor and has had it all along.
-- Same shape as `assign_material_supplier` in WP 3.3: the actor existed, nothing
-- told the trigger.
--
-- An overload again rather than a replacement, for the deploy-window reason
-- above; and the one-argument form now sets the GUC from the project's modeler
-- rather than leaving it unset, which is a weaker claim than a real actor and is
-- labelled as such rather than dressed up.

CREATE OR REPLACE FUNCTION public.refresh_node_list_for_project(
  p_project_id   uuid,
  p_actor_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'refresh_node_list_for_project: a tier-3 write must name its actor (audit-actor, G4)'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  PERFORM set_config('app.current_user_id', p_actor_user_id::text, true);
  PERFORM public.refresh_node_list_for_project(p_project_id);
END; $fn$;

COMMENT ON FUNCTION public.refresh_node_list_for_project(uuid,uuid) IS
  'WP 4.3 · `refresh_node_list_for_project` with the actor the trigger needs. '
  'The one-argument form is kept for the deploy window and audits as '
  '`actor_known: false`; `combine-project` calls this one.';

REVOKE ALL ON FUNCTION public.refresh_node_list_for_project(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_node_list_for_project(uuid,uuid) TO service_role;

-- ── 6 · the audit triggers the four tables have never had ──────────────────
--
-- This is D54 collected. `dataPlaneAudit.test.ts` scopes the audit rule to
-- tables IN THE CONTRACT, so for as long as these four were deferred in
-- `coverage.yaml` their writes were unaudited with nothing to notice — §15
-- measured them at zero of four triggers and `contract:check` R11 has been
-- reporting "42 deferred, 42 unaudited" since WP 4.2 added the rule. Their
-- sidecars land in this commit, so the triggers must land with them or R9 turns
-- red, which is the gate doing exactly its job.
--
-- Verbose rather than looped: a FOREACH block is invisible to the introspector
-- (`20260916000001`'s own reason) and the artifact is what R9 reads.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['network_nodes','network_edges','network_summary','node_list'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s_insert ON public.%1$I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s_update ON public.%1$I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s_delete ON public.%1$I', t);
  END LOOP;
END $$;

CREATE TRIGGER audit_network_nodes_insert AFTER INSERT ON public.network_nodes
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_network_nodes_update AFTER UPDATE ON public.network_nodes
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_network_nodes_delete AFTER DELETE ON public.network_nodes
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

CREATE TRIGGER audit_network_edges_insert AFTER INSERT ON public.network_edges
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_network_edges_update AFTER UPDATE ON public.network_edges
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_network_edges_delete AFTER DELETE ON public.network_edges
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

CREATE TRIGGER audit_network_summary_insert AFTER INSERT ON public.network_summary
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_network_summary_update AFTER UPDATE ON public.network_summary
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_network_summary_delete AFTER DELETE ON public.network_summary
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

CREATE TRIGGER audit_node_list_insert AFTER INSERT ON public.node_list
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_node_list_update AFTER UPDATE ON public.node_list
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
CREATE TRIGGER audit_node_list_delete AFTER DELETE ON public.node_list
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

SELECT pg_notify('pgrst', 'reload schema');

-- ── 7 · THE AUTO-INVOKER FIRES ONCE PER ROW, AND THE ROW COUNT IS 2 129 ────
--
-- The WP 4.3 brief says to check whether `auto_calculate_network_metrics_on_
-- completion` should still fire on the `projects.completed` transition. Reading
-- for it found a SECOND auto-invoker that no defect row, no prompt and no plan
-- section has ever named, and it is the more expensive one by three orders of
-- magnitude.
--
-- `trigger_auto_calculate_prominence_nodes` and `..._edges` are declared
-- `FOR EACH ROW`. Each firing POSTs to `calculate-node-prominence`, which reads
-- the whole graph and recomputes every node. §15 measured `network_edges` at
-- 2 129 rows in one project, so ONE bulk upload of that project's edges fires
-- 2 129 HTTP requests, each one a full recomputation of the same graph.
--
-- WP 4.2's store does not save this, and it is worth being precise about why,
-- because "the cache will absorb it" is the obvious wrong answer: the topology
-- digest changes with EVERY inserted row, so each of the 2 129 requests presents
-- a DIFFERENT key. Every one is a genuine cold miss. The store would faithfully
-- record 2 129 runs of an analysis the user asked for once.
--
-- Statement grain is the fix and it is the same fix `20260916000001` made for
-- the audit triggers, for the same reason: a bulk insert is ONE statement.
--
-- ── AND THE COLUMN LIST HAD TO GO, WHICH POSTGRESQL DECIDED, NOT THIS FILE ──
--
-- The row-level UPDATE triggers were declared `AFTER UPDATE OF <input columns>`,
-- which is what kept an analysis write from re-triggering the analysis.
-- PostgreSQL refuses `REFERENCING ... TABLE` on a trigger with a column list
-- ("transition tables cannot be specified for triggers with column lists"), so
-- the filter moves INTO the function — and becomes better on the way. Comparing
-- `to_jsonb(row) - <derived columns>` instead of naming the input columns means
-- a column added to `network_nodes` next quarter is covered on the day it is
-- added, where the old list would have silently stopped noticing it. Same
-- lesson as `graphHashCoverage.test.ts`: fix the rule, not the three columns.
--
-- ── THE FALLBACK HAS NEVER WORKED ──────────────────────────────────────────
--
-- The handler catches `undefined_function`, but a database without `pg_net`
-- raises `invalid_schema_name` (3F000) on `net.http_post` — the SCHEMA is
-- missing, not the function — so the EXCEPTION branch was never reached and the
-- ENTIRE INSERT ABORTED. That is not theoretical: it is how this was found.
-- `supabase/rehearsal/130` could not insert one `network_edges` row until this
-- block landed, because the rehearsal database deliberately does not stub
-- `pg_net` (`rehearsal-schema.mjs`: "a migration that needs either is out of
-- this rehearsal's reach and the failure should say so rather than pass on a
-- fake"). A NOTIFICATION THAT CANNOT BE SENT MUST NOT DESTROY THE WRITE IT WAS
-- NOTIFYING ABOUT.

CREATE OR REPLACE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  -- What an ANALYSIS writes. A statement that touched only these has not changed
  -- the graph, so re-requesting the analysis would be the loop the old column
  -- list existed to prevent.
  k_derived  text[] := ARRAY[
    'prominence','prominence_updated_at','degree_centrality',
    'weighted_degree_centrality','eigenvector_centrality','betweenness_centrality',
    'closeness_centrality','network_metrics_updated_at',
    'computed_from_hash','computed_at','updated_at'];
  v_projects      uuid[];
  v_project_id    uuid;
  v_modeler_id    uuid;
  v_modeler_email text;
BEGIN
  -- TWO BRANCHES AND NOT ONE UNION, because `old_rows` does not exist on the
  -- INSERT trigger and PostgreSQL parses the whole query regardless of the
  -- TG_OP predicate inside it. PL/pgSQL parses a statement on first execution,
  -- so a branch never taken is never parsed — which is the only reason one
  -- function can serve both triggers.
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.project_id) INTO v_projects
      FROM new_rows n WHERE n.project_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT n.project_id) INTO v_projects
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE n.project_id IS NOT NULL
       AND (to_jsonb(n) - k_derived) IS DISTINCT FROM (to_jsonb(o) - k_derived);
  END IF;

  FOREACH v_project_id IN ARRAY COALESCE(v_projects, ARRAY[]::uuid[])
  LOOP
    -- Both halves must exist or there is no graph to compute over.
    IF NOT EXISTS (SELECT 1 FROM public.network_nodes WHERE project_id = v_project_id)
    OR NOT EXISTS (SELECT 1 FROM public.network_edges WHERE project_id = v_project_id) THEN
      CONTINUE;
    END IF;

    SELECT modeler_id INTO v_modeler_id FROM public.projects WHERE id = v_project_id;
    SELECT email INTO v_modeler_email FROM public.approved_users WHERE id = v_modeler_id;
    PERFORM public.set_current_user_context(v_modeler_id, COALESCE(v_modeler_email, ''));

    BEGIN
      PERFORM net.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object('Content-Type', 'application/json'),
        jsonb_build_object('project_id', v_project_id));
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        PERFORM extensions.http_post(
          'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
          jsonb_build_object('Content-Type', 'application/json'),
          jsonb_build_object('project_id', v_project_id));
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG
          'auto_calculate_prominence: could not notify for project % (%) — the '
          'rows are written; the analysis was not requested.', v_project_id, SQLERRM;
      END;
    END;
  END LOOP;

  RETURN NULL;  -- AFTER ... FOR EACH STATEMENT ignores the return value
END;
$fn$;

COMMENT ON FUNCTION public.auto_calculate_prominence_on_deep_tier_completion() IS
  'WP 4.3 · STATEMENT-level since this package. It was FOR EACH ROW, so a bulk '
  'upload of the 2 129 edges §15 measured in one project fired 2 129 full '
  'recomputations of the same graph — and WP 4.2''s store cannot absorb that, '
  'because the topology digest moves with every inserted row and each request is '
  'a genuine cold miss. The UPDATE filter moved from a trigger column list into '
  'the body (PostgreSQL refuses transition tables alongside a column list) and '
  'compares `to_jsonb(row) - <derived columns>`, so a column added later is '
  'covered on the day it is added. Also: the `undefined_function` handler never '
  'matched — a database without pg_net raises `invalid_schema_name` — so a '
  'failed notification aborted the write it was notifying about.';

DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes ON public.network_nodes;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges ON public.network_edges;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes_ins ON public.network_nodes;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes_upd ON public.network_nodes;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges_ins ON public.network_edges;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges_upd ON public.network_edges;

CREATE TRIGGER trigger_auto_calculate_prominence_nodes_ins
  AFTER INSERT ON public.network_nodes
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

CREATE TRIGGER trigger_auto_calculate_prominence_nodes_upd
  AFTER UPDATE ON public.network_nodes
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

CREATE TRIGGER trigger_auto_calculate_prominence_edges_ins
  AFTER INSERT ON public.network_edges
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

CREATE TRIGGER trigger_auto_calculate_prominence_edges_upd
  AFTER UPDATE ON public.network_edges
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

SELECT pg_notify('pgrst', 'reload schema');
