-- Phase 6 / WP 6.2 / §4 D71: three SECURITY DEFINER writers that already took
-- the actor and never told the trigger.
--
-- `audit-actor` (G4) says every tier transition writes an audit row NAMING the
-- actor. Sixteen `SECURITY DEFINER` functions write a tier-2/3/4 table without
-- setting `app.current_user_id`; `dataPlaneAudit.test.ts` holds them as a
-- RATCHET because a gate would be red on arrival.
--
-- THREE OF THE SIXTEEN NEED NO SIGNATURE CHANGE AND NO CLIENT CHANGE. They
-- already take `p_user_id` — `apply_policy_bundle`, `assign_bom_line` and
-- `assign_outbound_customer` — and simply never pass it on. That is exactly the
-- shape `assign_material_supplier` had before `20260916000021`, which WP 3.3
-- closed with one line and a rehearsal that reads the row back.
--
-- The other thirteen are a different size and are NOT in this migration: ten
-- take no actor parameter at all, so closing them changes a signature AND every
-- caller, and three (`analysis_mark_critical_nodes`, `etl_replace_supply_chain`,
-- `mrp_apply_staged_products`) already attribute through `assert_writer_may_act`
-- and stay on the ratchet only because a text scan cannot follow a call.
--
-- EACH BODY BELOW IS THE EXISTING ONE, COPIED MECHANICALLY rather than retyped,
-- with one guarded block inserted after `BEGIN`. A `CREATE OR REPLACE` that
-- silently drops a line of an existing function is a regression no gate here
-- would catch, so the copy was scripted and the diff against the original is
-- exactly the inserted block.
--
-- Proof is `supabase/rehearsal/200`: it POISONS `app.current_user_id` with a
-- stranger's id first, calls each function with a different actor, and reads the
-- audit row back. A row naming the right person can then only have come from
-- the function.

-- ── assign_bom_line ─ originally `20260728000001_cartographer_product_level.sql` ──

CREATE OR REPLACE FUNCTION public.assign_bom_line(
  p_project_id  uuid,
  p_product_id  text,
  p_material_id text,
  p_rate        numeric,
  p_user_id     uuid,
  p_user_email  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_plant text;
  v_org   text;
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
  IF NULLIF(p_product_id, '') IS NULL OR NULLIF(p_material_id, '') IS NULL THEN
    RAISE EXCEPTION 'product_id and material_id are required';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'consumption rate must be > 0 (BomLine.rate is a hard engine constraint)';
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) BOM row (the engine + grader source).
  INSERT INTO public.bom_single_level
    (project_id, plant_name, product_id, material_id, consumption_rate)
  SELECT p_project_id, v_plant, p_product_id, p_material_id, p_rate
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bom_single_level
    WHERE project_id = p_project_id
      AND product_id = p_product_id
      AND material_id = p_material_id
  );

  -- 2) Edge row so get_supply_chain_data reflects the pair immediately
  --    (combine-project's 'bom' shape: from = material, to = product).
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location,
     material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, v_plant, 'bom', p_material_id, p_product_id,
         p_rate, 1.0, 0, p_user_id, v_org
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supply_chain_data
    WHERE project_id = p_project_id
      AND data_source = 'bom'
      AND from_location = p_material_id
      AND to_location = p_product_id
  );
END;
$$;

-- ── assign_outbound_customer ─ originally `20260728000001_cartographer_product_level.sql` ──

CREATE OR REPLACE FUNCTION public.assign_outbound_customer(
  p_project_id  uuid,
  p_product_id  text,
  p_customer_id text,
  p_user_id     uuid,
  p_user_email  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_plant text;
  v_org   text;
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
  IF NULLIF(p_product_id, '') IS NULL OR NULLIF(p_customer_id, '') IS NULL THEN
    RAISE EXCEPTION 'product_id and customer_id are required';
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) Lane row (economics NULL — never estimated).
  INSERT INTO public.outbound_logistics
    (project_id, plant_name, product_id, customer_id)
  SELECT p_project_id, v_plant, p_product_id, p_customer_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.outbound_logistics
    WHERE project_id = p_project_id
      AND product_id = p_product_id
      AND customer_id = p_customer_id
  );

  -- 2) Edge row (combine-project's 'outbound' shape: rate carries the
  --    volume, 0 until one exists).
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location,
     material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, v_plant, 'outbound', p_product_id, p_customer_id,
         0, 1.0, 0, p_user_id, v_org
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supply_chain_data
    WHERE project_id = p_project_id
      AND data_source = 'outbound'
      AND from_location = p_product_id
      AND to_location = p_customer_id
  );
END;
$$;

-- ── apply_policy_bundle ─ originally `20260716000001_apply_policy_bundle.sql` ──

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
