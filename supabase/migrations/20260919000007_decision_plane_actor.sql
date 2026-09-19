-- Phase 6 / WP 6.4 / §4 D71 — the five writers describing six tables surfaced
--
-- **D54's lesson, measured for the third time.** A deferral does not only hide a
-- table from the documentation; it hides that table's WRITERS from every rule scoped
-- to the contract. WP 4.3 described four deep-tier tables and surfaced five writers
-- the scan had never seen, which corrected D71's headline by ten (D78). This package
-- describes six decision tables and surfaces SIX more — and `dataPlaneAudit.test.ts`
-- failed on them the moment the sidecars landed, which is the ratchet working.
--
-- FIVE OF THE SIX TAKE THE ONE LINE HERE. The sixth,
-- `sync_disruption_to_sim_scenario`, `RETURNS trigger`: PostgreSQL refuses a trigger
-- function with declared arguments, so the change is impossible rather than merely
-- unnecessary — and unnecessary too, because a trigger fires INSIDE someone else's
-- statement, where `app.current_user_id` already holds whatever that statement
-- established. Naming the actor is the caller's job and never the trigger's. It joins
-- `create_default_policy_defaults` on the justified list.
--
-- ONE OF THE FIVE ALREADY TOOK ITS ACTOR AND NEVER PASSED IT ON. `snapshot_policy`
-- has taken `p_user_id` since it was written, writes it into `created_by` and
-- `author_user_id`, and never told the trigger — so every policy version ever saved
-- carries the author IN THE ROW and an audit row that says `actor_known: false`. That
-- is WP 6.2 slice 11's shape exactly, and it costs one line with no signature change.
--
-- THE OTHER FOUR NEED A PARAMETER, SO THEY ARE DROP AND CREATE.
-- `CREATE OR REPLACE` cannot change a parameter count, and two overloads differing by
-- a trailing defaulted parameter make every unqualified GRANT ambiguous and every
-- PostgREST call a coin toss. `DROP` takes a function's grants with it and the
-- introspected artifact records functions rather than privileges, so a grant that
-- fails to come back is invisible to every static gate here — which is why
-- `supabase/rehearsal/290` §2 reads `proacl` for an EXPLICIT grantee rather than
-- asking `has_function_privilege`, a question that cannot fail while PUBLIC keeps
-- EXECUTE (WP 6.2 slice 12's finding, and the reason this file repeats its method).
--
-- `_actor_user_id uuid DEFAULT NULL` is APPENDED, so every existing caller keeps
-- working unchanged and nothing regresses by omission. The guard below stops a NULL
-- blanking an actor the caller's transaction had already set — a trigger-wired call
-- and a direct call reach the same body.

-- ── 1 · snapshot_policy: it already has the actor ───────────────────────────

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
  v_prev     jsonb;
BEGIN
  -- WP 6.4 · the one line. LOCAL — `true` — so it belongs to this transaction and
  -- cannot leak onto the next caller of a pooled connection. The COALESCE keeps a
  -- NULL from blanking an actor an enclosing statement already established.
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;

  v_snapshot := public._build_policy_snapshot(p_project_id);

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
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_snapshot,
    COALESCE(p_user_id, auth.uid()),
    COALESCE(p_user_id, auth.uid()),
    p_user_email,
    p_user_name,
    p_parent_version_id,
    v_prev,
    encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 2 · update_policy_version_notes ─────────────────────────────────────────
--
-- `LANGUAGE sql` becomes `plpgsql`: a SQL function has no statement to hang the
-- `set_config` on without folding it into the UPDATE, where its evaluation order is
-- not something to rely on for a security-relevant side effect.

DROP FUNCTION IF EXISTS public.update_policy_version_notes(uuid, text);
CREATE FUNCTION public.update_policy_version_notes(
  p_version_id    uuid,
  p_notes         text,
  _actor_user_id  uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  UPDATE public.policy_versions
     SET notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
   WHERE id = p_version_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_policy_version_notes(uuid, text, uuid) TO anon, authenticated;

-- ── 3 · delete_policy_version ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.delete_policy_version(uuid);
CREATE FUNCTION public.delete_policy_version(
  p_version_id   uuid,
  _actor_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_runs  bigint;
  v_cards bigint;
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;

  SELECT count(*) INTO v_runs  FROM public.simulation_runs  WHERE policy_version_id = p_version_id;
  SELECT count(*) INTO v_cards FROM public.model_validations WHERE policy_version_id = p_version_id;

  IF v_runs > 0 OR v_cards > 0 THEN
    RAISE EXCEPTION
      'Cannot delete: this version is bound to % simulation run(s) and % validated model card(s). Versions referenced by runs or model cards are kept for provenance.',
      v_runs, v_cards
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM public.policy_versions WHERE id = p_version_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_policy_version(uuid, uuid) TO anon, authenticated;

-- ── 4 · apply_validation_to_scenario ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.apply_validation_to_scenario(uuid, uuid);
CREATE FUNCTION public.apply_validation_to_scenario(
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

  UPDATE public.scenarios SET
    warmup_mode             = 'manual',
    warmup_days             = v_card.adopted_warmup_days,
    replications            = v_card.recommended_replications,
    inherited_validation_id = v_card.id
  WHERE id = p_scenario_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_validation_to_scenario(uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ── 5 · record_external_evidence ────────────────────────────────────────────
--
-- Its callers are EDGE FUNCTIONS — the cartographer and sentinel tools — whose
-- principal is an agent acting for a person. The parameter is appended for the same
-- reason as the others and the honest state is recorded rather than assumed: until an
-- agent turn carries the user it acts for, this one will be called with NULL and its
-- audit row will say so. That is D28's question, not this migration's answer.

DROP FUNCTION IF EXISTS public.record_external_evidence(uuid, text, text, text, numeric, jsonb, text);
CREATE FUNCTION public.record_external_evidence(
  p_project_id   uuid,
  p_source_id    text,
  p_url_or_ref   text,
  p_content_hash text,
  p_confidence   numeric,
  p_triple       jsonb,
  p_lei          text DEFAULT NULL,
  _actor_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;
  IF p_triple IS NULL OR jsonb_typeof(p_triple) <> 'object' THEN
    RAISE EXCEPTION 'triple must be a JSON object';
  END IF;

  SELECT id INTO v_id FROM public.external_evidence
   WHERE project_id = p_project_id
     AND source_id = p_source_id
     AND content_hash = p_content_hash
     AND md5(triple::text) = md5(p_triple::text)
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF (SELECT count(*) FROM public.external_evidence
       WHERE project_id = p_project_id) >= 5000 THEN
    RAISE EXCEPTION 'too_large: external-evidence cap (5000) reached for this project';
  END IF;

  INSERT INTO public.external_evidence
    (project_id, source_id, url_or_ref, content_hash, confidence, triple, lei)
  VALUES
    (p_project_id, p_source_id, NULLIF(p_url_or_ref, ''), p_content_hash,
     p_confidence, p_triple, NULLIF(upper(COALESCE(p_lei, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
-- The SAME grantees the DROP took away — `anon, authenticated, service_role`, as
-- `20260727000001` wrote them. Narrowing a grant while re-creating a function is a
-- change nobody asked for arriving inside a change about attribution.
GRANT EXECUTE ON FUNCTION public.record_external_evidence(uuid,text,text,text,numeric,jsonb,text,uuid)
  TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
