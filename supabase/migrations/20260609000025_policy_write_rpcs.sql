-- Fix policy table access for custom-auth users.
--
-- The app uses a custom auth system and the Supabase client always holds an
-- anon JWT.  All PostgREST requests arrive as the anon role.  The tables were
-- only granted to authenticated/service_role, so PostgREST returned PGRST205
-- ("table not found in schema cache") for every read and a permission error
-- for every write.
--
-- Fix:
--   1. GRANT SELECT to anon so reads work directly via .from(...)
--   2. Matching RLS policies so row-level security doesn't block anon reads
--   3. SECURITY DEFINER write RPCs that bypass anon restrictions (same pattern
--      as list_projects, snapshot_policy, create_disruption_scenario_v2)

-- ── Step 1: anon read grants ─────────────────────────────────────────────────
GRANT SELECT ON public.policy_defaults  TO anon;
GRANT SELECT ON public.policy_overrides TO anon;
GRANT SELECT ON public.policy_presets   TO anon;

-- ── Step 2: RLS policies for anon reads ─────────────────────────────────────
CREATE POLICY "Anon can read policy defaults"
  ON public.policy_defaults FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read policy overrides"
  ON public.policy_overrides FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read policy presets"
  ON public.policy_presets   FOR SELECT TO anon USING (true);

-- ── Step 3: SECURITY DEFINER write RPCs ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_policy_defaults(
  p_project_id        uuid,
  p_family            text,
  p_value             jsonb,
  p_strategy          text        DEFAULT NULL,
  p_active_preset     text        DEFAULT NULL,
  p_preset_applied_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
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
       SET active_preset      = p_active_preset,
           preset_applied_at  = p_preset_applied_at,
           updated_at         = now()
     WHERE project_id = p_project_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_policy_defaults TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.bulk_upsert_policy_overrides(
  p_project_id uuid,
  p_rows       jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.policy_overrides
    (project_id, scope, target_key, family, patch, updated_at)
  SELECT
    p_project_id,
    r->>'scope',
    r->>'target_key',
    r->>'family',
    r->'patch',
    now()
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (project_id, scope, target_key, family)
  DO UPDATE SET patch = excluded.patch, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_policy_overrides TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_policy_override(
  p_project_id uuid,
  p_scope      text,
  p_target_key text,
  p_family     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.policy_overrides
   WHERE project_id = p_project_id
     AND scope       = p_scope
     AND target_key  = p_target_key
     AND family      = p_family;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_policy_override TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.clear_policy_preset(
  p_project_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.policy_defaults
     SET active_preset     = NULL,
         preset_applied_at = NULL,
         updated_at        = now()
   WHERE project_id = p_project_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_policy_preset TO anon, authenticated;

-- Flush PostgREST schema cache so tables + new functions are visible immediately
SELECT pg_notify('pgrst', 'reload schema');
