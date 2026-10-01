-- Phase 10 / WP 10.2 / §9.5 · §4 D241, D242 — A POLICY VERSION IS ITS CONTENT.
--
-- Two defects with one root. `snapshot_policy` always INSERTed, so every Run &
-- Validate run and every Lab "Save version & run" minted a NEW id for the SAME
-- `policy_hash` (D241). And the model card was matched by that id, never by the
-- hash (D242): a card recorded on version A could not be found from version B
-- although A and B are one model, so a freshly opened Lab read *unvalidated*, the
-- run was stamped with no `model_validation_id`, and inheritance never fired.
--
-- The fix is the rule the blueprint already states for every other artifact (A5,
-- §9.5): identity is content. This migration makes it true in four places.
--
--   1. `policy_versions.version_no` — "policy v4", per project, ONE NUMBER PER
--      CONTENT. Existing duplicate rows (one hash, several ids) share the number of
--      their content, so the history reads as the models a person actually made
--      rather than as a log of button presses. Assigned by a BEFORE INSERT trigger,
--      so a direct INSERT (the table still grants one to the API roles) numbers too.
--   2. `snapshot_policy` returns the EXISTING version when the project already has
--      one with this hash — the OLDEST such row, so repeated calls always answer the
--      same id — and appends any new note to it. Nothing is inserted.
--   3. Cards are matched by `(project_id, policy_hash, graph_hash, scenario_hash)`:
--      the active-card unique index, `record_model_validation`'s supersede, and a new
--      `active_model_validation_by_content`. The old `active_model_validation(id, …)`
--      keeps its signature (the deployed dispatcher calls it until the function
--      redeploys — migrations and functions deploy through different workflows) and
--      now resolves the id to its hash first, so even the old caller matches by
--      content.
--   4. `apply_validation_to_scenario` REFUSES a card whose triple is not the
--      project's current one. It used to take a card id and trust the caller — the
--      browser had matched by version id, so the database applied whatever it was
--      handed.
--
-- ── WHAT THE SUPERSEDE STEP DOES TO EXISTING ROWS ──────────────────────────
--
-- The old unique index was per VERSION ID, so two active cards could exist for one
-- content triple (one per duplicate version). The new index is per CONTENT and
-- would refuse to build over them. Before building it, every such group keeps its
-- newest card active and the rest become `superseded`, linked by `superseded_by` —
-- the same transition `record_model_validation` has always made, applied to cards
-- that were only ever separate because of D241. No card is deleted and none is
-- edited otherwise; staleness stays derived (§9.5 addendum (2)).
-- ============================================================================

-- ── 1 · version_no ─────────────────────────────────────────────────────────

ALTER TABLE public.policy_versions ADD COLUMN IF NOT EXISTS version_no integer;

-- Backfill: number the DISTINCT contents of each project in order of first
-- appearance. A legacy row with no stored hash is its own content (nothing can say
-- it equals another without recomputing a hash nobody stored).
WITH firsts AS (
  SELECT project_id,
         COALESCE(policy_hash, 'id:' || id::text) AS content,
         min(created_at) AS first_at,
         min(id::text)   AS first_id
    FROM public.policy_versions
   GROUP BY project_id, COALESCE(policy_hash, 'id:' || id::text)
), numbered AS (
  SELECT project_id, content,
         row_number() OVER (PARTITION BY project_id ORDER BY first_at, first_id) AS n
    FROM firsts
)
UPDATE public.policy_versions pv
   SET version_no = numbered.n
  FROM numbered
 WHERE pv.version_no IS NULL
   AND numbered.project_id = pv.project_id
   AND numbered.content = COALESCE(pv.policy_hash, 'id:' || pv.id::text);

CREATE INDEX IF NOT EXISTS policy_versions_project_hash
  ON public.policy_versions (project_id, policy_hash);

-- Numbering on insert. The advisory lock serialises two inserts into one project,
-- so two concurrent saves cannot both take max+1. It is TRANSACTION-scoped and
-- keyed on the project, so nothing else waits on it.
CREATE OR REPLACE FUNCTION public.policy_versions_assign_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.version_no IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('policy_versions:' || NEW.project_id::text, 0));
  IF NEW.policy_hash IS NOT NULL THEN
    SELECT version_no INTO NEW.version_no
      FROM public.policy_versions
     WHERE project_id = NEW.project_id
       AND policy_hash = NEW.policy_hash
       AND version_no IS NOT NULL
     ORDER BY created_at, id
     LIMIT 1;
  END IF;
  IF NEW.version_no IS NULL THEN
    SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no
      FROM public.policy_versions
     WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS policy_versions_number ON public.policy_versions;
CREATE TRIGGER policy_versions_number
  BEFORE INSERT ON public.policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.policy_versions_assign_number();

COMMENT ON COLUMN public.policy_versions.version_no IS
  'WP 10.2 · §4 D241. "Policy v4": one number per CONTENT (policy_hash) per '
  'project, in order of first appearance. Rows that predate deduplication and '
  'share a hash share the number.';

-- The version list carries the number. `RETURNS TABLE` cannot widen in place, so
-- DROP + CREATE; the grant is restated. The browser falls back to a direct SELECT
-- for the length of the deploy window, which is what that fallback exists for.
DROP FUNCTION IF EXISTS public.list_policy_versions(uuid);
CREATE FUNCTION public.list_policy_versions(p_project_id uuid)
RETURNS TABLE (
  id                uuid,
  label             text,
  notes             text,
  author_email      text,
  author_name       text,
  parent_version_id uuid,
  policy_hash       text,
  created_at        timestamptz,
  run_count         bigint,
  card_count        bigint,
  version_no        integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    v.id, v.label, v.notes, v.author_email, v.author_name,
    v.parent_version_id, v.policy_hash, v.created_at,
    (SELECT count(*) FROM public.simulation_runs  r WHERE r.policy_version_id = v.id),
    (SELECT count(*) FROM public.model_validations m WHERE m.policy_version_id = v.id),
    v.version_no
  FROM public.policy_versions v
  WHERE v.project_id = p_project_id
  ORDER BY v.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_policy_versions(uuid) TO anon, authenticated;

-- ── 2 · snapshot_policy deduplicates ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_policy(
  p_project_id        uuid,
  p_label             text DEFAULT NULL,
  p_user_id           uuid DEFAULT NULL,
  p_user_email        text DEFAULT NULL,
  p_user_name         text DEFAULT NULL,
  p_parent_version_id uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id       uuid;
  v_snapshot jsonb;
  v_hash     text;
  v_prev     jsonb;
  v_note     text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  -- WP 6.4 · the actor, LOCAL to this transaction; a NULL never blanks one an
  -- enclosing statement already set.
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;

  v_snapshot := public._build_policy_snapshot(p_project_id);
  v_hash     := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');

  -- One save at a time per project, so two identical saves racing each other
  -- cannot both miss the lookup below and insert two rows for one content. The
  -- numbering trigger takes the same key; a re-entrant advisory lock is free.
  PERFORM pg_advisory_xact_lock(hashtextextended('policy_versions:' || p_project_id::text, 0));

  -- D241: the content already has a version → that version IS this save. The
  -- OLDEST row, so the answer is the same on every call.
  SELECT id INTO v_id
    FROM public.policy_versions
   WHERE project_id = p_project_id
     AND policy_hash = v_hash
   ORDER BY created_at, id
   LIMIT 1;

  IF FOUND THEN
    -- A note is the one thing a repeat save may add. Appended, never replaced,
    -- and not twice: a client retrying the same save must not double it.
    IF v_note IS NOT NULL THEN
      UPDATE public.policy_versions
         SET notes = CASE
                       WHEN notes IS NULL THEN v_note
                       WHEN position(v_note IN notes) > 0 THEN notes
                       ELSE notes || E'\n\n' || v_note
                     END
       WHERE id = v_id
         AND (notes IS NULL OR position(v_note IN notes) = 0);
    END IF;
    RETURN v_id;
  END IF;

  IF p_parent_version_id IS NOT NULL THEN
    SELECT snapshot INTO v_prev FROM public.policy_versions WHERE id = p_parent_version_id;
  ELSE
    SELECT snapshot INTO v_prev
    FROM public.policy_versions
    WHERE project_id = p_project_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.policy_versions (
    project_id, label, notes, snapshot, created_by,
    author_user_id, author_email, author_name,
    parent_version_id, previous_snapshot, policy_hash
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_note,
    v_snapshot,
    COALESCE(p_user_id, auth.uid()),
    COALESCE(p_user_id, auth.uid()),
    p_user_email,
    p_user_name,
    p_parent_version_id,
    v_prev,
    v_hash
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 3 · cards are matched by content ──────────────────────────────────────

-- A version's hash as a card would record it: the stored hash, or — for a legacy
-- row that predates `policy_hash` — the digest `record_model_validation` has always
-- computed for it. One definition, so the two can never disagree.
CREATE OR REPLACE FUNCTION public._policy_version_hash(p_policy_version_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(policy_hash, encode(extensions.digest(snapshot::text, 'sha256'), 'hex'))
    FROM public.policy_versions
   WHERE id = p_policy_version_id;
$$;
-- An internal helper: its SECURITY DEFINER callers run as owner, so the API
-- roles need no EXECUTE — and Supabase grants them one by default (§4 D248).
REVOKE ALL ON FUNCTION public._policy_version_hash(uuid) FROM PUBLIC, anon, authenticated;

-- Supersede the duplicates the old per-id index allowed (see the header).
WITH ranked AS (
  SELECT id,
         first_value(id) OVER w AS keeper,
         row_number()    OVER w AS rn
    FROM public.model_validations
   WHERE status = 'active'
  WINDOW w AS (PARTITION BY project_id, policy_hash, graph_hash, scenario_hash
               ORDER BY validated_at DESC, created_at DESC, id DESC)
)
UPDATE public.model_validations mv
   SET status = 'superseded',
       superseded_by = ranked.keeper
  FROM ranked
 WHERE mv.id = ranked.id
   AND ranked.rn > 1;

DROP INDEX IF EXISTS public.model_validations_active_triple_uq;
CREATE UNIQUE INDEX IF NOT EXISTS model_validations_active_content_uq
  ON public.model_validations (project_id, policy_hash, graph_hash, scenario_hash)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.active_model_validation_by_content(
  p_project_id    uuid,
  p_policy_hash   text,
  p_graph_hash    text,
  p_scenario_hash text
) RETURNS SETOF public.model_validations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT *
    FROM public.model_validations
   WHERE project_id    = p_project_id
     AND policy_hash   = p_policy_hash
     AND graph_hash    = p_graph_hash
     AND scenario_hash = p_scenario_hash
     AND status        = 'active'
     AND verdict       = 'validated'
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.active_model_validation_by_content(uuid, text, text, text)
  TO anon, authenticated, service_role;

-- The old entry point, same signature, now by content: the id is resolved to its
-- project and hash, and any version with that hash finds the card.
CREATE OR REPLACE FUNCTION public.active_model_validation(
  p_policy_version_id uuid,
  p_graph_hash        text,
  p_scenario_hash     text
) RETURNS SETOF public.model_validations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT mv.*
    FROM public.policy_versions pv
    CROSS JOIN LATERAL public.active_model_validation_by_content(
      pv.project_id, public._policy_version_hash(pv.id), p_graph_hash, p_scenario_hash
    ) mv
   WHERE pv.id = p_policy_version_id;
$$;

-- record_model_validation: same signature and body, except the supersede step
-- matches the CONTENT triple, which is what the new unique index enforces.
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
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;

  SELECT project_id INTO v_ver_project
    FROM public.policy_versions WHERE id = p_policy_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy version % not found', p_policy_version_id; END IF;
  IF v_ver_project <> p_project_id THEN
    RAISE EXCEPTION 'policy version does not belong to project %', p_project_id;
  END IF;
  v_policy_hash := public._policy_version_hash(p_policy_version_id);

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

  IF p_evidence_run_id IS NOT NULL THEN
    SELECT NULLIF(code_version, '') INTO v_engine
      FROM public.simulation_runs WHERE id = p_evidence_run_id;
  END IF;

  -- Supersede the active card on this CONTENT triple — whichever version id it
  -- was recorded under (D242).
  UPDATE public.model_validations
     SET status = 'superseded'
   WHERE project_id    = p_project_id
     AND policy_hash   = v_policy_hash
     AND graph_hash    = v_graph_hash
     AND scenario_hash = v_scenario_hash
     AND status        = 'active'
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

-- ── 4 · inheritance refuses a card that is not the project's current model ──
--
-- Same signature as `20260919000007`, so `CREATE OR REPLACE` keeps its grants.
-- The three comparisons are the badge's own (§9.5 addendum (2)): the project's
-- live policy content, its live graph, and THIS scenario's baseline fingerprint.
-- A stale card is not inherited — it is a different model.
CREATE OR REPLACE FUNCTION public.apply_validation_to_scenario(
  p_scenario_id   uuid,
  p_validation_id uuid,
  _actor_user_id  uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_card public.model_validations%ROWTYPE;
  v_scen_project uuid;
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;

  SELECT * INTO v_card FROM public.model_validations WHERE id = p_validation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'validation % not found', p_validation_id; END IF;

  SELECT project_id INTO v_scen_project FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  IF v_scen_project <> v_card.project_id THEN
    RAISE EXCEPTION 'validation and scenario belong to different projects';
  END IF;

  IF v_card.status <> 'active' OR v_card.verdict <> 'validated' THEN
    RAISE EXCEPTION 'validation % is not an active validated model', p_validation_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.scenario_fingerprint_hash(p_scenario_id) IS DISTINCT FROM v_card.scenario_hash THEN
    RAISE EXCEPTION 'scenario % is not in the validated model''s world (scenario fingerprint differs)', p_scenario_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.current_policy_hash(v_card.project_id) IS DISTINCT FROM v_card.policy_hash THEN
    RAISE EXCEPTION 'the project''s policies are not the validated model''s (policy content differs)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.current_graph_hash(v_card.project_id) IS DISTINCT FROM v_card.graph_hash THEN
    RAISE EXCEPTION 'the project''s data is not the validated model''s (graph differs)'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.scenarios SET
    warmup_mode             = 'manual',
    warmup_days             = v_card.adopted_warmup_days,
    replications            = v_card.recommended_replications,
    inherited_validation_id = v_card.id
  WHERE id = p_scenario_id;
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
