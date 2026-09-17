-- =====================================================================
-- WP 4.2 — THE ANALYSIS STORE                        (Phase 4 / G1 / §11)
--
-- D19: "analysis results smeared onto entity columns; no identity or version."
-- Today a centrality is a COLUMN ON `network_nodes`, beside the `country` a user
-- typed. That shape cannot answer three questions, and the third is the one that
-- costs money:
--
--   * WHICH INPUTS produced this number? There is no answer. The column carries
--     no hash, so `0.42` is a claim about a world nobody can reconstruct — which
--     is `input-hash` (I5) and why WP 4.1 built the anchor before this package.
--   * WHICH CODE produced it? There is no answer either; a changed analyzer
--     overwrites its predecessor in place and the old number is gone.
--   * HAS THIS ALREADY BEEN COMPUTED? There is no answer, so every request
--     recomputes. `supabase/rehearsal/120` §1 was written RED against `main` on
--     exactly that: two identical requests, two full computations, and nothing
--     anywhere recording that the first one happened.
--
-- THE STORE IS AN IDENTITY, AND THE CACHE IS A CONSEQUENCE. The key is
-- (project, kind, input_hash, params_hash, code_version). Two runs with the same
-- key are the same run BY DEFINITION — not "probably still valid" — so a hit is
-- sound rather than a bet on a timestamp, which is what the three ad-hoc
-- staleness rules WP 4.4 deletes are.
--
-- WHY THE STORE DOES NOT COMPUTE ANYTHING. `getOrCompute` cannot run network
-- science: the analyses live in edge functions and in Python. So the primitive
-- here is LOOKUP-OR-CLAIM — `analysis_get_or_start` returns the finished run on
-- a hit and otherwise CLAIMS the key with a `running` row, and the caller
-- computes and calls `analysis_complete_run`. Splitting it that way is what
-- makes the concurrency answer checkable: the claim is one INSERT against one
-- unique index, so two parallel cold requests cannot both win it.
--
-- WHAT DOES NOT MOVE: no analyzer is migrated here and no entity column is
-- dropped. WP 4.3 dual-writes, WP 5.3 drops — after every reader has moved, and
-- dropping early is what makes it irreversible. Nothing in this file writes
-- `network_nodes`.
--
-- AND THE OUTPUTS STAY OUT OF `graph_hash`. WP 4.1 settled it, wrote it into the
-- snapshot's own header and pinned it with `graphHashCoverage.test.ts`. The
-- moment `analysis_results` exists, "just hash the outputs too" becomes a
-- tempting one-liner — `rehearsal/120` §7 asserts it against a running database
-- so that temptation fails a test rather than a review.
-- =====================================================================

-- ── 1 · analysis_runs — the identity ────────────────────────────────────────
--
-- `analysis_kind` IS TEXT AND NOT A PostgreSQL ENUM, and that is the whole of
-- §11's "open enum": `ALTER TYPE ... ADD VALUE` is a migration, so an enum type
-- would mean `lead_time_fit` costs a schema change and a deploy. The CHECK here
-- constrains the SHAPE (a lowercase identifier) and not the value set; the value
-- set — with each kind's params schema — is authored in the contract sidecar,
-- where `single-source` says a data fact belongs.

CREATE TABLE IF NOT EXISTS public.analysis_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  analysis_kind  text NOT NULL CHECK (analysis_kind ~ '^[a-z][a-z0-9_]*$'),

  -- THE KEY. All three NOT NULL on purpose: a nullable key column is D5's whole
  -- class — `NULL = NULL` is unknown, so `ON CONFLICT` inserts a duplicate
  -- instead of updating and the uniqueness silently constrains nothing. There is
  -- no `NULLS NOT DISTINCT` here because there are no NULLs to make distinct.
  input_hash     text NOT NULL,
  params_hash    text NOT NULL,
  code_version   text NOT NULL,

  -- The params as sent, beside the hash of them, so a run can be read without
  -- reversing a digest. `jsonb` and not `json`: key order is normalised, which
  -- is what lets the same params written two ways hash the same (§4 rehearsal
  -- 120 §4).
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,

  status         text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','succeeded','failed')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  duration_ms    integer,
  row_counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- `audit-actor` (G4) as a COLUMN and not an intention. NOT NULL, so a run that
  -- cannot name who asked for it cannot exist — the same stance
  -- `assert_writer_may_act` takes for the RPC writers (`20260917000005`).
  actor_user_id  uuid NOT NULL REFERENCES public.approved_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- THE KEY IS PARTIAL, AND THIS IS A DELIBERATE REFINEMENT OF §11's FLAT TUPLE.
-- §11 writes `UNIQUE (project_id, analysis_kind, input_hash, params_hash,
-- code_version)`. Taken literally, the FIRST failed attempt at a key OWNS it
-- forever: the retry cannot insert, so an analysis that crashed once can never
-- be run again on that input — a permanently poisoned cache entry with no way
-- out that does not delete history. Excluding `failed` keeps the failure as a
-- row (nothing is deleted, the audit trail stands, and repeated failures
-- accumulate as evidence) while leaving the key free for a retry. §11 is edited
-- in the same commit to say so.
CREATE UNIQUE INDEX IF NOT EXISTS analysis_runs_key_uniq
  ON public.analysis_runs (project_id, analysis_kind, input_hash, params_hash, code_version)
  WHERE status <> 'failed';

CREATE INDEX IF NOT EXISTS analysis_runs_project_kind_idx
  ON public.analysis_runs (project_id, analysis_kind, started_at DESC);

COMMENT ON TABLE public.analysis_runs IS
  'WP 4.2 · One execution of one analysis, identified by the world it ran against '
  '(input_hash), the parameters it ran with (params_hash) and the code that ran '
  '(code_version). Two runs with the same key ARE the same run, which is what '
  'makes a cache hit sound rather than a guess about freshness (D19).';
COMMENT ON COLUMN public.analysis_runs.input_hash IS
  'WP 4.1''s `current_graph_hash(project_id)` at the moment the run was claimed. '
  'This is the anchor invariant `input-hash` (I5) is about; WP 4.3 stamps the '
  'same value onto the tier-3 rows the analyzers already write.';
COMMENT ON COLUMN public.analysis_runs.analysis_kind IS
  'Open enum. The CHECK constrains the shape only — the catalog of kinds and each '
  'kind''s params schema is authored in supabase/contract/analysis_runs.contract.yaml, '
  'so a new kind costs a sidecar edit and not a migration (§11).';

-- ── 2 · analysis_results — the answer, one row per entity ───────────────────

CREATE TABLE IF NOT EXISTS public.analysis_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]*$'),
  entity_id    text NOT NULL,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per entity per run. Without this a partially-retried completion could
-- write a second metrics row for one node and every reader would have to guess
-- which is current — which is D19 rebuilt inside the table meant to end it.
CREATE UNIQUE INDEX IF NOT EXISTS analysis_results_entity_uniq
  ON public.analysis_results (run_id, entity_type, entity_id);

COMMENT ON TABLE public.analysis_results IS
  'WP 4.2 · What one run computed, one row per entity, IMMUTABLE. Rewriting a '
  'result would make the run''s key a lie: the key says these inputs and this '
  'code produced this answer, and an answer that can change afterwards is not '
  'identified by anything.';

-- ── 3 · never update, never delete — as a property of the SCHEMA ────────────
--
-- §11 says the store never updates and never deletes. WP 4.1's lesson is that an
-- invariant holding because today's callers happen to behave is not enforced at
-- all — `no-tier-skip` was "a property of today's code" for three packages. So
-- the refusal is a trigger, and `rehearsal/120` §6 proves it by attempting both.
--
-- DELETE IS NOT REFUSED, and the reason is worth stating rather than leaving as
-- an omission: `analysis_runs.project_id` cascades from `projects`, so refusing
-- DELETE here would make `delete_project` fail on any project that had ever been
-- analysed. Deleting a project is retention, not mutation of a result.

CREATE OR REPLACE FUNCTION public.analysis_results_are_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'analysis_results is append-only: a computed result may not be rewritten '
    '(WP 4.2, D19). Compute a new run — the key (project, kind, input_hash, '
    'params_hash, code_version) is what distinguishes it.'
    USING ERRCODE = 'P0A01';
END; $$;

DROP TRIGGER IF EXISTS analysis_results_no_update ON public.analysis_results;
CREATE TRIGGER analysis_results_no_update BEFORE UPDATE ON public.analysis_results
  FOR EACH STATEMENT EXECUTE FUNCTION public.analysis_results_are_immutable();

-- A run's IDENTITY is frozen; its LIFECYCLE is not, or no run could ever finish.
-- That line is the whole distinction the table rests on: re-pointing an existing
-- run at a different `input_hash` would silently re-attribute a stored answer to
-- a world it never saw.
CREATE OR REPLACE FUNCTION public.analysis_runs_identity_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id    IS DISTINCT FROM OLD.project_id
  OR NEW.analysis_kind IS DISTINCT FROM OLD.analysis_kind
  OR NEW.input_hash    IS DISTINCT FROM OLD.input_hash
  OR NEW.params_hash   IS DISTINCT FROM OLD.params_hash
  OR NEW.params        IS DISTINCT FROM OLD.params
  OR NEW.code_version  IS DISTINCT FROM OLD.code_version
  OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
  OR NEW.started_at    IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION
      'analysis_runs: the key and the actor are immutable (WP 4.2). A run names '
      'the world, the parameters, the code and the person it belongs to; change '
      'any of them and it is a different run.'
      USING ERRCODE = 'P0A01';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS analysis_runs_identity_frozen ON public.analysis_runs;
CREATE TRIGGER analysis_runs_identity_frozen BEFORE UPDATE ON public.analysis_runs
  FOR EACH ROW EXECUTE FUNCTION public.analysis_runs_identity_is_immutable();

-- ── 4 · the audit triggers ─────────────────────────────────────────────────
--
-- Both tables are tier 3 and both are IN THE CONTRACT as of this package, so
-- `dataPlaneAudit.test.ts` requires all three triggers on each. Writing them is
-- not a formality: D54 is precisely that a table OUTSIDE the contract is outside
-- the rule, and §15 measured six such tables carrying zero triggers between them.
-- Verbose rather than looped, for the reason `20260916000001` gives: a FOREACH
-- loop is invisible to the introspector.

DROP TRIGGER IF EXISTS audit_analysis_runs_insert ON public.analysis_runs;
CREATE TRIGGER audit_analysis_runs_insert AFTER INSERT ON public.analysis_runs
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_analysis_runs_update ON public.analysis_runs;
CREATE TRIGGER audit_analysis_runs_update AFTER UPDATE ON public.analysis_runs
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_analysis_runs_delete ON public.analysis_runs;
CREATE TRIGGER audit_analysis_runs_delete AFTER DELETE ON public.analysis_runs
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

DROP TRIGGER IF EXISTS audit_analysis_results_insert ON public.analysis_results;
CREATE TRIGGER audit_analysis_results_insert AFTER INSERT ON public.analysis_results
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_analysis_results_update ON public.analysis_results;
CREATE TRIGGER audit_analysis_results_update AFTER UPDATE ON public.analysis_results
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_analysis_results_delete ON public.analysis_results;
CREATE TRIGGER audit_analysis_results_delete AFTER DELETE ON public.analysis_results
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

-- ── 5 · RLS ────────────────────────────────────────────────────────────────
--
-- Read follows project reachability, which is `has_project_access` — the same
-- predicate every other project-scoped table uses, and uuid-only since WP 3.0
-- (`uuid-identity`, D29). NO WRITE POLICY, deliberately: every write goes
-- through the SECURITY DEFINER RPCs below, so `no-tier-skip` (I2) holds here by
-- the schema and not by the absence of a caller who thought to bypass it.

ALTER TABLE public.analysis_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analysis_runs_select ON public.analysis_runs;
CREATE POLICY analysis_runs_select ON public.analysis_runs
  FOR SELECT USING (public.has_project_access(project_id));

DROP POLICY IF EXISTS analysis_results_select ON public.analysis_results;
CREATE POLICY analysis_results_select ON public.analysis_results
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.analysis_runs r
     WHERE r.id = analysis_results.run_id
       AND public.has_project_access(r.project_id)));

-- ── 6 · getOrCompute, as lookup-or-claim ───────────────────────────────────
--
-- THE CONCURRENCY ANSWER IS THE `ON CONFLICT DO NOTHING`, not the SELECT above
-- it. Two parallel requests on a COLD key both miss the lookup — that read is
-- not a lock and nothing pretends it is. They then both attempt the INSERT, one
-- wins the unique index, and the loser's `RETURNING` is EMPTY rather than an
-- error, which is how it learns to go and read the winner's row. A
-- read-then-write with no unique index would produce two runs and two
-- computations of the same thing; §11's gap check asks for exactly this and
-- `scripts/` proves it from two real sessions, because one transaction cannot.

CREATE OR REPLACE FUNCTION public.analysis_get_or_start(
  _project_id     uuid,
  _analysis_kind  text,
  _params         jsonb,
  _code_version   text,
  _actor_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_input_hash  text;
  v_params      jsonb := COALESCE(_params, '{}'::jsonb);
  v_params_hash text;
  v_run         public.analysis_runs;
BEGIN
  -- Authenticates and sets `app.current_user_id` LOCAL so the audit trigger
  -- names the person. It does NOT authorize: `20260917000005` removed a role
  -- gate from this preamble after it was found to refuse an organization admin
  -- on `combine-project`'s live path, and making `min_project_role` live is D66
  -- and WP 6.2's, not four RPCs' to answer ad hoc.
  PERFORM public.assert_writer_may_act('analysis_get_or_start', _project_id, _actor_user_id);

  IF _analysis_kind IS NULL OR _code_version IS NULL THEN
    RAISE EXCEPTION 'analysis_get_or_start: analysis_kind and code_version are part of the key and may not be NULL'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_input_hash  := public.current_graph_hash(_project_id);
  IF v_input_hash IS NULL THEN
    RAISE EXCEPTION 'analysis_get_or_start: project % has no graph hash, so a run could not name its inputs (I5)', _project_id
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Over `jsonb`, never over the text the caller sent: jsonb normalises key
  -- order and duplicate keys, so `{"a":1,"b":2}` and `{"b":2,"a":1}` are one
  -- key. Hashing the raw text would make the cache miss on whitespace.
  v_params_hash := encode(extensions.digest(v_params::text, 'sha256'), 'hex');

  -- 1 · the lookup. Only a SUCCEEDED run is a hit: a `running` row is a claim
  -- somebody else is still working on and has no results to return, and a
  -- `failed` one is outside the unique index entirely.
  SELECT * INTO v_run FROM public.analysis_runs
   WHERE project_id = _project_id AND analysis_kind = _analysis_kind
     AND input_hash = v_input_hash AND params_hash = v_params_hash
     AND code_version = _code_version AND status = 'succeeded'
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'run_id', v_run.id, 'cache_hit', true, 'status', v_run.status,
      'input_hash', v_run.input_hash, 'params_hash', v_run.params_hash,
      'code_version', v_run.code_version, 'row_counts', v_run.row_counts,
      'warnings', v_run.warnings, 'started_at', v_run.started_at,
      'finished_at', v_run.finished_at);
  END IF;

  -- 2 · the claim.
  INSERT INTO public.analysis_runs
    (project_id, analysis_kind, input_hash, params_hash, params, code_version, actor_user_id)
  VALUES
    (_project_id, _analysis_kind, v_input_hash, v_params_hash, v_params, _code_version, _actor_user_id)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_run;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'run_id', v_run.id, 'cache_hit', false, 'status', v_run.status,
      'input_hash', v_run.input_hash, 'params_hash', v_run.params_hash,
      'code_version', v_run.code_version, 'started_at', v_run.started_at);
  END IF;

  -- 3 · somebody else won the key between our lookup and our insert. Read their
  -- row and report it honestly: `cache_hit` is true only when there is an answer
  -- to hand back, so a caller that finds a `running` row knows to wait rather
  -- than being told it has results it cannot read.
  SELECT * INTO v_run FROM public.analysis_runs
   WHERE project_id = _project_id AND analysis_kind = _analysis_kind
     AND input_hash = v_input_hash AND params_hash = v_params_hash
     AND code_version = _code_version AND status <> 'failed'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis_get_or_start: lost the key race for project %/% and then could not find the winner', _project_id, _analysis_kind;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run.id, 'cache_hit', v_run.status = 'succeeded', 'status', v_run.status,
    'input_hash', v_run.input_hash, 'params_hash', v_run.params_hash,
    'code_version', v_run.code_version, 'row_counts', v_run.row_counts,
    'warnings', v_run.warnings, 'started_at', v_run.started_at,
    'finished_at', v_run.finished_at, 'claimed_by_other', true);
END; $fn$;

-- ── 7 · completing a run ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.analysis_complete_run(
  _run_id        uuid,
  _results       jsonb,
  _row_counts    jsonb,
  _warnings      jsonb,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run public.analysis_runs;
  v_n   integer := 0;
BEGIN
  SELECT * INTO v_run FROM public.analysis_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis_complete_run: no run %', _run_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.assert_writer_may_act('analysis_complete_run', v_run.project_id, _actor_user_id);

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION
      'analysis_complete_run: run % is already %, and a finished run is never rewritten (WP 4.2)',
      _run_id, v_run.status USING ERRCODE = 'P0A01';
  END IF;

  IF _results IS NOT NULL AND jsonb_typeof(_results) = 'array' THEN
    INSERT INTO public.analysis_results (run_id, entity_type, entity_id, metrics)
    SELECT _run_id,
           r ->> 'entity_type',
           r ->> 'entity_id',
           COALESCE(r -> 'metrics', '{}'::jsonb)
      FROM jsonb_array_elements(_results) r;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  UPDATE public.analysis_runs
     SET status      = 'succeeded',
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::integer),
         row_counts  = COALESCE(_row_counts, '{}'::jsonb),
         warnings    = COALESCE(_warnings, '[]'::jsonb)
   WHERE id = _run_id;

  RETURN jsonb_build_object('run_id', _run_id, 'status', 'succeeded', 'results_written', v_n);
END; $fn$;

-- A run that died. Kept as a row — nothing is deleted — but outside the partial
-- unique index, so the key is free and a retry is possible. The alternative is a
-- cache entry that can never be recomputed (see the index's own comment).
CREATE OR REPLACE FUNCTION public.analysis_fail_run(
  _run_id        uuid,
  _warnings      jsonb,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_run public.analysis_runs;
BEGIN
  SELECT * INTO v_run FROM public.analysis_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis_fail_run: no run %', _run_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.assert_writer_may_act('analysis_fail_run', v_run.project_id, _actor_user_id);

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'analysis_fail_run: run % is already %', _run_id, v_run.status
      USING ERRCODE = 'P0A01';
  END IF;

  UPDATE public.analysis_runs
     SET status      = 'failed',
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::integer),
         warnings    = COALESCE(_warnings, '[]'::jsonb)
   WHERE id = _run_id;

  RETURN jsonb_build_object('run_id', _run_id, 'status', 'failed');
END; $fn$;

REVOKE ALL ON FUNCTION public.analysis_get_or_start(uuid,text,jsonb,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analysis_complete_run(uuid,jsonb,jsonb,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analysis_fail_run(uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_get_or_start(uuid,text,jsonb,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.analysis_complete_run(uuid,jsonb,jsonb,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.analysis_fail_run(uuid,jsonb,uuid) TO service_role;

GRANT SELECT ON public.analysis_runs    TO anon, authenticated, service_role;
GRANT SELECT ON public.analysis_results TO anon, authenticated, service_role;

-- ── 8 · `should_recalculate_network_metrics`, deprecated IN PLACE (D12) ─────
--
-- IN PLACE, not dropped: `auto_calculate_network_metrics_on_completion` calls it
-- inside every projects-row UPDATE that flips `completed = true`, so dropping it
-- here would break a live trigger for no gain this package can bank.
--
-- AND D12's ROW WAS STALE, which reading the live definition is what found. D12
-- cites `20250925164454_…sql:39-52` and that is NOT the live definition —
-- `20260712110000_network_metrics_check_performance.sql` replaced it. §4's row is
-- corrected in the same commit; the short version is that the cartesian half is
-- CLOSED and the "up to date for an empty project" half was MIS-STATED, and the
-- rewrite that closed the first silently closed what the second was reaching for
-- while its own header claimed "identical semantics".
--
-- WHAT REPLACES IT: the timestamp comparison itself. `last_data_time >
-- last_calc_time` asks whether a clock moved, which is not the same question as
-- whether the DATA changed — touching a row without changing a value makes it
-- say yes, and a restored backup makes it say no. `analysis_runs.input_hash` is
-- the question actually worth asking, and WP 4.4 deletes the three ad-hoc
-- staleness rules in favour of the one rule.

COMMENT ON FUNCTION public.should_recalculate_network_metrics(uuid) IS
  'DEPRECATED by WP 4.2 (§4 D12) — do not extend, do not add callers. Staleness '
  'here is a TIMESTAMP COMPARISON: it asks whether an updated_at moved, not '
  'whether the data changed, so an UPDATE that writes the same value reports '
  'stale and a restored backup reports fresh. The analysis store answers the '
  'real question — a run carries the `input_hash` (WP 4.1''s `current_graph_hash`) '
  'it was computed from, so "already computed" is an identity and not a clock. '
  'Still live because `auto_calculate_network_metrics_on_completion` calls it on '
  'every completion flip; WP 4.3 migrates that caller and WP 4.4 deletes the '
  'three ad-hoc staleness rules in favour of `computed_from_hash <> '
  'current_graph_hash()`. NOTE on D12''s own evidence: the live definition is '
  '`20260712110000_network_metrics_check_performance.sql`, NOT the '
  '`20250925164454` the defect row cited until this package read it.';

SELECT pg_notify('pgrst', 'reload schema');
