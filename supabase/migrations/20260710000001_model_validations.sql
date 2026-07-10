-- =====================================================================
-- Model validations — the persisted V&V credibility artifact
-- (Phase B0 / G13 / §9.5; design: docs/design/phase-b0-core-loop.md §2)
--
-- The Run & Validate stage establishes warm-up, replication adequacy, and
-- statistical validation from real run output (Phase A), but the outcome
-- lived only in browser localStorage (gap G13). This migration gives it the
-- same immutable snapshot-plus-hash discipline as policy_versions (A5) and
-- dataset_versions (§8.4):
--
--   * model_validations: one ACTIVE card per provenance triple
--     (policy_version_id, graph_hash, scenario_hash). Re-validating the same
--     triple supersedes the old card (rows are never edited); revocation is
--     a status flip, also never a delete.
--   * scenario_hash is the BASELINE FINGERPRINT, not a hash of the full
--     scenario row: it covers the world-model fields (horizon, time step,
--     demand model) and deliberately EXCLUDES disruption_schedule /
--     recovery_overrides (events are the experiment, not the model — the
--     SnapshotStore family-digest precedent, A8) and estimation settings
--     (warmup / replications / seed / stopping rule — those are V&V
--     *outputs*; hashing them would make the card invalidate itself).
--   * The badge states (validated / stale / unvalidated) are DERIVED at
--     read time by comparing current hashes to the active card — staleness
--     is never stored, so reverting a drift self-heals to validated.
--   * scenarios.inherited_validation_id records which card seeded a
--     scenario's warm-up/replication settings (inheritance provenance).
--   * simulation_runs.scenario_hash + model_validation_id complete the
--     run-side provenance: the card in force at dispatch is immutable
--     history on the run row (stamped best-effort by sim-command, like the
--     dataset binding).
--   * Writes go through SECURITY DEFINER RPCs only; the table is
--     SELECT-only for clients.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Table -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.model_validations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- provenance triple (identity, §9.5) — hashes denormalized for drift display
  policy_version_id        uuid NOT NULL REFERENCES public.policy_versions(id) ON DELETE CASCADE,
  policy_hash              text NOT NULL,
  dataset_version_id       uuid REFERENCES public.dataset_versions(id) ON DELETE SET NULL,
  graph_hash               text NOT NULL,
  scenario_hash            text NOT NULL,
  scenario_fingerprint     jsonb NOT NULL,
  -- advisory 4th component: the evidence run's code_version. Unknown at
  -- dispatch time (the worker stamps it on completion), so it cannot gate;
  -- surfaces render a post-run stale marker when a run's code_version
  -- differs from the card's.
  engine_fingerprint       text,

  -- adopted content (what Lab scenarios inherit)
  adopted_warmup_days      integer NOT NULL CHECK (adopted_warmup_days >= 0),
  warmup_method            text NOT NULL DEFAULT 'engine'
                             CHECK (warmup_method IN ('engine', 'welch', 'mser5')),
  recommended_replications integer NOT NULL CHECK (recommended_replications >= 1),
  -- {confidence, target_precision, per_kpi: {kpi: {mean, half, rel, n}}}
  replication_basis        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{kpi, ks, ks_p, t, t_p, n, source, pass}] — empty for face validation
  validation_tests         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- verifier findings at adoption (§8.2 block/warn/info vocabulary)
  findings_snapshot        jsonb NOT NULL DEFAULT '[]'::jsonb,
  verdict                  text NOT NULL CHECK (verdict IN ('validated', 'rejected')),
  basis                    text NOT NULL DEFAULT 'statistical'
                             CHECK (basis IN ('statistical', 'face')),
  evidence_run_id          uuid REFERENCES public.simulation_runs(id) ON DELETE SET NULL,

  -- lifecycle (A5 discipline: supersede, never edit)
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'superseded', 'revoked')),
  superseded_by            uuid REFERENCES public.model_validations(id) ON DELETE SET NULL,
  validated_at             timestamptz NOT NULL DEFAULT now(),
  author_user_id           uuid,
  author_email             text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- One active card per triple (§9.5: "re-running V&V on the same triple
-- supersedes the card"). Cards on OTHER triples coexist: two validated
-- configurations of one project are both first-class.
CREATE UNIQUE INDEX IF NOT EXISTS model_validations_active_triple_uq
  ON public.model_validations (policy_version_id, graph_hash, scenario_hash)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS model_validations_project_created
  ON public.model_validations (project_id, created_at DESC);

-- 2. Column additions (all nullable — zero migration risk) -------------------

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS inherited_validation_id uuid
    REFERENCES public.model_validations(id) ON DELETE SET NULL;

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS scenario_hash       text,
  ADD COLUMN IF NOT EXISTS model_validation_id uuid
    REFERENCES public.model_validations(id) ON DELETE SET NULL;

-- policy_versions gets NO column: "validated" is derived through the active
-- card (docs/design/phase-b0-core-loop.md §2.2) — a denormalized flag would
-- be a second source of truth.

-- 3. Data-API access ----------------------------------------------------------
-- SELECT-only for clients; all writes go through the SECURITY DEFINER RPCs
-- below (tighter than the policy_versions posture, deliberately: cards are
-- consistency-checked artifacts, not free-form rows).

ALTER TABLE public.model_validations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.model_validations TO anon, authenticated;
GRANT ALL    ON public.model_validations TO service_role;

DROP POLICY IF EXISTS "model_validations_read_all" ON public.model_validations;
CREATE POLICY "model_validations_read_all"
  ON public.model_validations FOR SELECT TO anon, authenticated USING (true);

-- 4. Scenario fingerprint (single canonicalization point, like
--    _build_policy_snapshot / _build_dataset_snapshot) ------------------------

CREATE OR REPLACE FUNCTION public._build_scenario_fingerprint(p_scenario_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  -- Baseline fingerprint (§2.3 of the B0 design): world-model fields only.
  -- Excluded on purpose: disruption_schedule + recovery_overrides (events are
  -- the experiment — A8 family-digest precedent) and warmup/replications/
  -- seed/stopping_rule/primary_kpi (estimation settings / V&V outputs).
  -- fingerprint_version versions these rules (R7 discipline).
  SELECT jsonb_build_object(
    'fingerprint_version', 1,
    'horizon_days', s.horizon_days,
    'time_step',    s.time_step,
    'demand_model', s.demand_model
  )
  FROM public.scenarios s
  WHERE s.id = p_scenario_id;
$$;

CREATE OR REPLACE FUNCTION public.scenario_fingerprint_hash(p_scenario_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT encode(
    extensions.digest(public._build_scenario_fingerprint(p_scenario_id)::text, 'sha256'),
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public._build_scenario_fingerprint(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scenario_fingerprint_hash(uuid)   TO anon, authenticated, service_role;

-- 5. record_model_validation: supersede-and-insert on the triple --------------

CREATE OR REPLACE FUNCTION public.record_model_validation(
  p_project_id               uuid,
  p_policy_version_id        uuid,
  p_dataset_version_id       uuid,
  p_scenario_id              uuid,
  p_adopted_warmup_days      integer,
  p_warmup_method            text,
  p_recommended_replications integer,
  p_replication_basis        jsonb DEFAULT '{}'::jsonb,
  p_validation_tests         jsonb DEFAULT '[]'::jsonb,
  p_findings                 jsonb DEFAULT '[]'::jsonb,
  p_verdict                  text DEFAULT 'validated',
  p_basis                    text DEFAULT 'statistical',
  p_evidence_run_id          uuid DEFAULT NULL,
  p_user_id                  uuid DEFAULT NULL,
  p_user_email               text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id             uuid := gen_random_uuid();
  v_prev_id        uuid;
  v_policy_hash    text;
  v_graph_hash     text;
  v_fingerprint    jsonb;
  v_scenario_hash  text;
  v_engine         text;
  v_ver_project    uuid;
  v_scen_project   uuid;
  v_ds_project     uuid;
BEGIN
  -- Provenance consistency: every referenced artifact must belong to the project.
  SELECT project_id, policy_hash INTO v_ver_project, v_policy_hash
    FROM public.policy_versions WHERE id = p_policy_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy version % not found', p_policy_version_id; END IF;
  IF v_ver_project <> p_project_id THEN
    RAISE EXCEPTION 'policy version does not belong to project %', p_project_id;
  END IF;
  -- Legacy versions may predate policy_hash: hash the stored snapshot the
  -- same way snapshot_policy does, so the card is never hash-less.
  IF v_policy_hash IS NULL THEN
    SELECT encode(extensions.digest(snapshot::text, 'sha256'), 'hex')
      INTO v_policy_hash FROM public.policy_versions WHERE id = p_policy_version_id;
  END IF;

  SELECT project_id, graph_hash INTO v_ds_project, v_graph_hash
    FROM public.dataset_versions WHERE id = p_dataset_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset version % not found', p_dataset_version_id; END IF;
  IF v_ds_project <> p_project_id THEN
    RAISE EXCEPTION 'dataset version does not belong to project %', p_project_id;
  END IF;

  SELECT project_id INTO v_scen_project FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  IF v_scen_project <> p_project_id THEN
    RAISE EXCEPTION 'scenario does not belong to project %', p_project_id;
  END IF;

  v_fingerprint   := public._build_scenario_fingerprint(p_scenario_id);
  v_scenario_hash := encode(extensions.digest(v_fingerprint::text, 'sha256'), 'hex');

  -- Advisory engine fingerprint from the evidence run, when it has completed.
  IF p_evidence_run_id IS NOT NULL THEN
    SELECT NULLIF(code_version, '') INTO v_engine
      FROM public.simulation_runs WHERE id = p_evidence_run_id;
  END IF;

  -- Supersede the active card on this exact triple (rows are never edited
  -- otherwise; history stays drillable through superseded_by). At most one
  -- row can match (partial unique index). Flip status BEFORE the insert so
  -- the active-triple unique index never sees two active rows; link
  -- superseded_by AFTER the insert so the FK target exists.
  UPDATE public.model_validations
     SET status = 'superseded'
   WHERE policy_version_id = p_policy_version_id
     AND graph_hash        = v_graph_hash
     AND scenario_hash     = v_scenario_hash
     AND status            = 'active'
  RETURNING id INTO v_prev_id;

  INSERT INTO public.model_validations (
    id, project_id,
    policy_version_id, policy_hash,
    dataset_version_id, graph_hash,
    scenario_hash, scenario_fingerprint, engine_fingerprint,
    adopted_warmup_days, warmup_method,
    recommended_replications, replication_basis,
    validation_tests, findings_snapshot,
    verdict, basis, evidence_run_id,
    author_user_id, author_email
  ) VALUES (
    v_id, p_project_id,
    p_policy_version_id, v_policy_hash,
    p_dataset_version_id, v_graph_hash,
    v_scenario_hash, v_fingerprint, v_engine,
    p_adopted_warmup_days, COALESCE(p_warmup_method, 'engine'),
    p_recommended_replications, COALESCE(p_replication_basis, '{}'::jsonb),
    COALESCE(p_validation_tests, '[]'::jsonb), COALESCE(p_findings, '[]'::jsonb),
    p_verdict, p_basis, p_evidence_run_id,
    COALESCE(p_user_id, auth.uid()), p_user_email
  );

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.model_validations SET superseded_by = v_id WHERE id = v_prev_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_model_validation(
  uuid, uuid, uuid, uuid, integer, text, integer, jsonb, jsonb, jsonb,
  text, text, uuid, uuid, text
) TO anon, authenticated, service_role;

-- 6. active_model_validation: exact-triple resolution -------------------------
--    Used by sim-command at dispatch (stamping the run) and by the
--    useModelValidation hook. Badge DERIVATION (validated/stale/unvalidated)
--    stays client-side against current_policy_hash / current_graph_hash /
--    scenario_fingerprint_hash — staleness is computed, never stored.

CREATE OR REPLACE FUNCTION public.active_model_validation(
  p_policy_version_id uuid,
  p_graph_hash        text,
  p_scenario_hash     text
) RETURNS SETOF public.model_validations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT *
  FROM public.model_validations
  WHERE policy_version_id = p_policy_version_id
    AND graph_hash        = p_graph_hash
    AND scenario_hash     = p_scenario_hash
    AND status            = 'active'
    AND verdict           = 'validated'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.active_model_validation(uuid, text, text)
  TO anon, authenticated, service_role;

-- 7. apply_validation_to_scenario: the ONE definition of inheritance ----------
--    (§9.5: scenarios under a validated triple inherit adopted warm-up —
--    manual mode, adopted days — and the recommended replication count.)
--    Hand-editing warmup/replications in the UI clears
--    inherited_validation_id client-side: divergence is explicit, not silent.

CREATE OR REPLACE FUNCTION public.apply_validation_to_scenario(
  p_scenario_id   uuid,
  p_validation_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_card public.model_validations%ROWTYPE;
  v_scen_project uuid;
BEGIN
  SELECT * INTO v_card FROM public.model_validations WHERE id = p_validation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'validation % not found', p_validation_id; END IF;

  SELECT project_id INTO v_scen_project FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  IF v_scen_project <> v_card.project_id THEN
    RAISE EXCEPTION 'validation and scenario belong to different projects';
  END IF;

  -- updated_at is maintained by the scenarios_updated_at trigger.
  UPDATE public.scenarios SET
    warmup_mode             = 'manual',
    warmup_days             = v_card.adopted_warmup_days,
    replications            = v_card.recommended_replications,
    inherited_validation_id = v_card.id
  WHERE id = p_scenario_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_validation_to_scenario(uuid, uuid)
  TO anon, authenticated, service_role;

-- 8. revoke_model_validation: withdraw a card (status flip, never a delete) ---

CREATE OR REPLACE FUNCTION public.revoke_model_validation(p_validation_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.model_validations
     SET status = 'revoked'
   WHERE id = p_validation_id
     AND status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.revoke_model_validation(uuid)
  TO anon, authenticated, service_role;

-- 9. list_model_validations: card history for a project -----------------------

CREATE OR REPLACE FUNCTION public.list_model_validations(p_project_id uuid)
RETURNS TABLE (
  id                       uuid,
  policy_version_id        uuid,
  policy_hash              text,
  dataset_version_id       uuid,
  graph_hash               text,
  scenario_hash            text,
  engine_fingerprint       text,
  adopted_warmup_days      integer,
  warmup_method            text,
  recommended_replications integer,
  verdict                  text,
  basis                    text,
  status                   text,
  evidence_run_id          uuid,
  author_email             text,
  validated_at             timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, policy_version_id, policy_hash, dataset_version_id, graph_hash,
         scenario_hash, engine_fingerprint, adopted_warmup_days, warmup_method,
         recommended_replications, verdict, basis, status, evidence_run_id,
         author_email, validated_at
  FROM public.model_validations
  WHERE project_id = p_project_id
  ORDER BY validated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_model_validations(uuid)
  TO anon, authenticated, service_role;

-- 10. Realtime: badges update live on every surface ---------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'model_validations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.model_validations;
  END IF;
END $$;

ALTER TABLE public.model_validations REPLICA IDENTITY FULL;

-- 11. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
