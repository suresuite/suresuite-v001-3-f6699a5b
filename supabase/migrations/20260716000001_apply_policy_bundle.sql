-- =====================================================================
-- apply_policy_bundle — the transactional Stage 2 apply wrapper
-- (Phase B / §12 / AI agents; design: docs/design/ai-agents.md §4.4
-- policy_bundle_diff row, §9.3).
--
-- One SECURITY DEFINER function = one transaction around §4.4 steps 2–3:
--   * merge family patches onto policy_defaults (the same row
--     save_policy_defaults writes),
--   * merge override patches into policy_overrides (the same keyed upsert
--     bulk_upsert_policy_overrides performs, but MERGING the patch onto an
--     existing row's patch — the diff is the smallest change, it must not
--     clobber sibling fields),
--   * snapshot_policy with the `agent:` label and the parent lineage
--     (parent_version_id = the version the diff was drafted against).
-- Any failure rolls back all three (nothing half-applied).
--
-- Staleness is enforced INSIDE the transaction: when p_expected_policy_hash
-- is supplied it must equal current_policy_hash(project) at execution time,
-- else the function raises 'stale_values: …' (§4.4 apply-time code; §8 T8) —
-- an out-of-band policy edit between approve and apply fails cleanly.
--
-- The post-snapshot gradeManifest (§4.4 step 4) runs in agent-apply
-- (TypeScript — the ONE shared grader): a block finding pre-computed on the
-- merged defaults means this function is never called, so "block ⇒ rollback"
-- holds with nothing mutated.
--
-- No privilege is added: this composes RPCs that are already anon-callable
-- (20260609000025, 20260612000001) plus reads, so it carries the same grants.
-- =====================================================================

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

GRANT EXECUTE ON FUNCTION public.apply_policy_bundle(uuid,jsonb,jsonb,text,uuid,text,uuid,text,text)
  TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
