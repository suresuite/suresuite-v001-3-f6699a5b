-- Profile / §4 D275 — a policy write that names its actor is refused unless that actor holds
-- Edit Policies on the project.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
--
-- D232 made the analyst "run simulations and change nothing", and D230 made the browser obey
-- it — but only the browser. Every policy writer below took the actor as a parameter (D71) to
-- NAME it on the audit row and asked nothing else of it, so a client that skipped the page's
-- gate could still rewrite an analyst's project's policies. The owner asked for the server to
-- refuse those writes.
--
-- `assert_may_edit_policies(project, actor)` reads `project_rights_for_user` — the ONE answer
-- the browser's gate, /profile and both admin pages already read (D230) — and raises
-- `forbidden` (42501) when `data_edit_policies` is not held. Each of the eight writers calls it
-- once, straight after the block that sets `app.current_user_id`:
--
--   save_policy_defaults · bulk_upsert_policy_overrides · delete_policy_override ·
--   clear_policy_preset · restore_policy_version · update_policy_version_notes ·
--   delete_policy_version · apply_policy_bundle
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- (1) `snapshot_policy` is not gated: saving a VERSION on the way to a run changes no value
--     and stays allowed with Run Simulations (D230 decision 5).
-- (2) A call that names NO actor is unchanged. The Developer API's policy writes carry an API
--     key, not a user (D71's remainder, D28), and refusing them would end a product surface
--     rather than close a gap; naming a fabricated person would be worse. The key's own
--     `write:policies` scope governs that path.
-- (3) The actor is still CLIENT-ASSERTED (D28): this binds every caller that tells the truth
--     about who it is — the app, agent-apply — and not one that lies. It is the same strength
--     as the audit row the parameter already wrote, and the most a server can do until D28.
-- (4) An actor that is not an approved user is refused: the resolver has no answer for it, and
--     no answer is not a grant.
--
-- CREATE OR REPLACE with each function's existing signature, so every grant survives (the
-- DROP-and-CREATE risk `20260918000003` carried does not arise). Each body is the last
-- definition COPIED MECHANICALLY, with exactly one guarded line added.

CREATE OR REPLACE FUNCTION public.assert_may_edit_policies(p_project_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rights jsonb;
BEGIN
  -- No actor: the unattributed path, unchanged (above, (2)). No project: the caller raises
  -- its own "not found", which is the better error.
  IF p_actor IS NULL OR p_project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RETURN;
  END IF;
  v_rights := public.project_rights_for_user(p_actor, p_project_id);
  IF COALESCE((v_rights -> 'capabilities' ->> 'data_edit_policies')::boolean, false) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'forbidden: your role on this project does not include Edit Policies'
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'D275 — policy writes need Edit Policies; an Analyst runs simulations from the Simulation Lab.';
END; $$;
COMMENT ON FUNCTION public.assert_may_edit_policies(uuid, uuid) IS
  'D275 — raises forbidden unless the named actor holds data_edit_policies on the project, as '
  'project_rights_for_user (D230) states it. A NULL actor passes (the API-key path, D28). '
  'Internal: called by the eight policy writers, never by a client.';
REVOKE ALL ON FUNCTION public.assert_may_edit_policies(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── save_policy_defaults ─ last defined in `20260918000003_actor_on_the_remaining_nine.sql` ──

CREATE OR REPLACE FUNCTION public.save_policy_defaults(
  p_project_id        uuid,
  p_family            text,
  p_value             jsonb,
  p_strategy          text        DEFAULT NULL,
  p_active_preset     text        DEFAULT NULL,
  p_preset_applied_at timestamptz DEFAULT NULL,
  _actor_user_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN

  -- D71, closed for this path (WP 6.2 slice 12). LOCAL to this transaction and
  -- set BEFORE any tier write, so `audit_tier_write`'s `get_current_user_id()`
  -- resolves and the audit rows below name the caller rather than recording
  -- `actor_known: false`. Guarded: `_actor_user_id` is DEFAULT NULL so every
  -- existing caller keeps working unchanged, and an unguarded set_config would
  -- BLANK an actor the caller's transaction had already established.
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies(p_project_id, _actor_user_id);
  INSERT INTO public.policy_defaults (project_id, updated_at)
  VALUES (p_project_id, now())
  ON CONFLICT (project_id) DO NOTHING;

  EXECUTE format(
    'UPDATE public.policy_defaults SET %I = $1, updated_at = now() WHERE project_id = $2',
    p_family
  ) USING p_value, p_project_id;

  IF p_strategy IS NOT NULL THEN
    UPDATE public.policy_defaults
       SET fulfillment_strategy = p_strategy, updated_at = now()
     WHERE project_id = p_project_id;
  END IF;

  IF p_active_preset IS NOT NULL THEN
    UPDATE public.policy_defaults
       SET active_preset     = p_active_preset,
           preset_applied_at = p_preset_applied_at,
           updated_at        = now()
     WHERE project_id = p_project_id;
  END IF;
END;
$$;

-- ── bulk_upsert_policy_overrides ─ last defined in `20260918000003_actor_on_the_remaining_nine.sql` ──

CREATE OR REPLACE FUNCTION public.bulk_upsert_policy_overrides(
  p_project_id uuid,
  p_rows       jsonb,
  _actor_user_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_hash text;
BEGIN

  -- D71, closed for this path (WP 6.2 slice 12). LOCAL to this transaction and
  -- set BEFORE any tier write, so `audit_tier_write`'s `get_current_user_id()`
  -- resolves and the audit rows below name the caller rather than recording
  -- `actor_known: false`. Guarded: `_actor_user_id` is DEFAULT NULL so every
  -- existing caller keeps working unchanged, and an unguarded set_config would
  -- BLANK an actor the caller's transaction had already established.
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies(p_project_id, _actor_user_id);
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

-- ── delete_policy_override ─ last defined in `20260918000003_actor_on_the_remaining_nine.sql` ──

CREATE OR REPLACE FUNCTION public.delete_policy_override(
  p_project_id uuid,
  p_scope      text,
  p_target_key text,
  p_family     text,
  _actor_user_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN

  -- D71, closed for this path (WP 6.2 slice 12). LOCAL to this transaction and
  -- set BEFORE any tier write, so `audit_tier_write`'s `get_current_user_id()`
  -- resolves and the audit rows below name the caller rather than recording
  -- `actor_known: false`. Guarded: `_actor_user_id` is DEFAULT NULL so every
  -- existing caller keeps working unchanged, and an unguarded set_config would
  -- BLANK an actor the caller's transaction had already established.
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies(p_project_id, _actor_user_id);
  DELETE FROM public.policy_overrides
   WHERE project_id = p_project_id
     AND scope       = p_scope
     AND target_key  = p_target_key
     AND family      = p_family;
END;
$$;

-- ── clear_policy_preset ─ last defined in `20260918000003_actor_on_the_remaining_nine.sql` ──

CREATE OR REPLACE FUNCTION public.clear_policy_preset(
  p_project_id uuid,
  _actor_user_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN

  -- D71, closed for this path (WP 6.2 slice 12). LOCAL to this transaction and
  -- set BEFORE any tier write, so `audit_tier_write`'s `get_current_user_id()`
  -- resolves and the audit rows below name the caller rather than recording
  -- `actor_known: false`. Guarded: `_actor_user_id` is DEFAULT NULL so every
  -- existing caller keeps working unchanged, and an unguarded set_config would
  -- BLANK an actor the caller's transaction had already established.
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies(p_project_id, _actor_user_id);
  UPDATE public.policy_defaults
     SET active_preset     = NULL,
         preset_applied_at = NULL,
         updated_at        = now()
   WHERE project_id = p_project_id;
END;
$$;

-- ── restore_policy_version ─ last defined in `20260918000003_actor_on_the_remaining_nine.sql` ──

CREATE OR REPLACE FUNCTION public.restore_policy_version(p_version_id uuid,
  _actor_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row      public.policy_versions%ROWTYPE;
  v_defaults jsonb;
  v_is_v2    boolean;
BEGIN

  -- D71, closed for this path (WP 6.2 slice 12). LOCAL to this transaction and
  -- set BEFORE any tier write, so `audit_tier_write`'s `get_current_user_id()`
  -- resolves and the audit rows below name the caller rather than recording
  -- `actor_known: false`. Guarded: `_actor_user_id` is DEFAULT NULL so every
  -- existing caller keeps working unchanged, and an unguarded set_config would
  -- BLANK an actor the caller's transaction had already established.
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies((SELECT project_id FROM public.policy_versions WHERE id = p_version_id), _actor_user_id);
  SELECT * INTO v_row FROM public.policy_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version % not found', p_version_id; END IF;

  v_is_v2    := v_row.snapshot ? 'defaults';
  v_defaults := CASE WHEN v_is_v2 THEN v_row.snapshot -> 'defaults' ELSE v_row.snapshot END;

  UPDATE public.policy_defaults SET
    sourcing    = COALESCE(v_defaults -> 'sourcing',    sourcing),
    inventory   = COALESCE(v_defaults -> 'inventory',   inventory),
    transport   = COALESCE(v_defaults -> 'transport',   transport),
    fulfillment = COALESCE(v_defaults -> 'fulfillment', fulfillment),
    production  = COALESCE(v_defaults -> 'production',  production),
    recovery    = COALESCE(v_defaults -> 'recovery',    recovery),
    demand      = COALESCE(v_defaults -> 'demand',      demand),
    fulfillment_strategy = CASE
      WHEN v_is_v2 THEN COALESCE(v_row.snapshot ->> 'fulfillment_strategy', fulfillment_strategy)
      ELSE fulfillment_strategy
    END,
    updated_at  = now()
  WHERE project_id = v_row.project_id;

  -- v1 snapshots predate override capture: leave live overrides untouched.
  IF v_is_v2 THEN
    DELETE FROM public.policy_overrides WHERE project_id = v_row.project_id;

    INSERT INTO public.policy_overrides (project_id, scope, target_key, family, patch)
    SELECT
      v_row.project_id,
      o ->> 'scope',
      o ->> 'target_key',
      o ->> 'family',
      COALESCE(o -> 'patch', '{}'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_row.snapshot -> 'overrides', '[]'::jsonb)) AS o;
  END IF;
END;
$$;

-- ── update_policy_version_notes ─ last defined in `20260919000007_decision_plane_actor.sql` ──

CREATE OR REPLACE FUNCTION public.update_policy_version_notes(
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
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies((SELECT project_id FROM public.policy_versions WHERE id = p_version_id), _actor_user_id);
  UPDATE public.policy_versions
     SET notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
   WHERE id = p_version_id;
END;
$$;

-- ── delete_policy_version ─ last defined in `20260919000007_decision_plane_actor.sql` ──

CREATE OR REPLACE FUNCTION public.delete_policy_version(
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
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies((SELECT project_id FROM public.policy_versions WHERE id = p_version_id), _actor_user_id);

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

-- ── apply_policy_bundle ─ last defined in `20260918000002_actor_on_three_definer_writers.sql` ──

CREATE OR REPLACE FUNCTION public.apply_policy_bundle(
  p_project_id           uuid,
  p_defaults             jsonb DEFAULT '{}'::jsonb,  -- {family: patch-object}
  p_overrides            jsonb DEFAULT '[]'::jsonb,  -- [{scope,target_key,family,patch}]
  p_label                text  DEFAULT NULL,
  p_parent_version_id    uuid  DEFAULT NULL,
  p_expected_policy_hash text  DEFAULT NULL,
  p_user_id              uuid  DEFAULT NULL,
  p_user_email           text  DEFAULT NULL,
  p_user_name            text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_families   text[] := ARRAY['sourcing','inventory','transport','fulfillment',
                               'production','recovery','demand'];
  v_family     text;
  v_patch      jsonb;
  v_row        jsonb;
  v_current    text;
  v_version_id uuid;
  v_hash       text;
  v_n_overrides integer := 0;
BEGIN

  -- D71, closed for this path (WP 6.2 slice 11). LOCAL to this transaction and
  -- set BEFORE any tier-2/3 write, so `audit_tier_write`'s `get_current_user_id()`
  -- resolves and the audit rows below name the person who acted instead of
  -- recording `actor_known: false`. The actor was always a parameter here; only
  -- the one line telling the trigger about it was missing — the same shape
  -- `assign_material_supplier` had before `20260916000021`.
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;
  -- D275 · a named actor must hold Edit Policies on the project.
  PERFORM public.assert_may_edit_policies(p_project_id, p_user_id);
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;

  -- §8 T8 / pc-08: grounding freshness inside the transaction.
  IF p_expected_policy_hash IS NOT NULL THEN
    v_current := public.current_policy_hash(p_project_id);
    IF v_current IS DISTINCT FROM p_expected_policy_hash THEN
      RAISE EXCEPTION 'stale_values: the policy configuration changed since this proposal was drafted (expected hash %, current %)',
        left(p_expected_policy_hash, 12), left(COALESCE(v_current, 'none'), 12);
    END IF;
  END IF;

  -- Validate every family key before touching anything (dynamic SQL below
  -- interpolates the family as an identifier — whitelist first).
  FOR v_family IN SELECT jsonb_object_keys(COALESCE(p_defaults, '{}'::jsonb)) LOOP
    IF NOT v_family = ANY (v_families) THEN
      RAISE EXCEPTION 'unknown policy family %', v_family;
    END IF;
    IF jsonb_typeof(p_defaults -> v_family) <> 'object' THEN
      RAISE EXCEPTION 'defaults.% must be a patch object', v_family;
    END IF;
  END LOOP;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_overrides, '[]'::jsonb)) LOOP
    IF NOT (v_row ->> 'family') = ANY (v_families) THEN
      RAISE EXCEPTION 'unknown policy family % on override %',
        v_row ->> 'family', v_row ->> 'target_key';
    END IF;
    IF COALESCE(v_row ->> 'scope', '') = '' OR COALESCE(v_row ->> 'target_key', '') = '' THEN
      RAISE EXCEPTION 'override rows need scope and target_key';
    END IF;
    IF jsonb_typeof(v_row -> 'patch') <> 'object' THEN
      RAISE EXCEPTION 'override % needs a patch object', v_row ->> 'target_key';
    END IF;
  END LOOP;

  -- Step 2a: family-default patches, merged (jsonb ||) onto the live row.
  INSERT INTO public.policy_defaults (project_id, updated_at)
  VALUES (p_project_id, now())
  ON CONFLICT (project_id) DO NOTHING;

  FOR v_family IN SELECT jsonb_object_keys(COALESCE(p_defaults, '{}'::jsonb)) LOOP
    v_patch := p_defaults -> v_family;
    EXECUTE format(
      'UPDATE public.policy_defaults
          SET %I = COALESCE(%I, ''{}''::jsonb) || $1, updated_at = now()
        WHERE project_id = $2',
      v_family, v_family
    ) USING v_patch, p_project_id;
  END LOOP;

  -- Step 2b: override patches, merged onto any existing row's patch.
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_overrides, '[]'::jsonb)) LOOP
    INSERT INTO public.policy_overrides
      (project_id, scope, target_key, family, patch, updated_at)
    VALUES
      (p_project_id, v_row ->> 'scope', v_row ->> 'target_key',
       v_row ->> 'family', COALESCE(v_row -> 'patch', '{}'::jsonb), now())
    ON CONFLICT (project_id, scope, target_key, family)
    DO UPDATE SET
      patch = COALESCE(public.policy_overrides.patch, '{}'::jsonb) || EXCLUDED.patch,
      updated_at = now();
    v_n_overrides := v_n_overrides + 1;
  END LOOP;

  -- Step 3: snapshot with the agent label + parent lineage (§4.4; pc-09).
  v_version_id := public.snapshot_policy(
    p_project_id,
    COALESCE(p_label, 'agent: policy bundle'),
    p_user_id, p_user_email, p_user_name,
    p_parent_version_id
  );

  SELECT policy_hash INTO v_hash FROM public.policy_versions WHERE id = v_version_id;

  RETURN jsonb_build_object(
    'policy_version_id', v_version_id,
    'policy_hash', v_hash,
    'overrides_applied', v_n_overrides
  );
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
