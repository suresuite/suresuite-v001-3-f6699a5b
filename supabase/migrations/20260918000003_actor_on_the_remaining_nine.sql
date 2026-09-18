-- Phase 6 / WP 6.2 / §4 D71: the remaining NINE, in ONE migration.
--
-- Slice 11 closed the three that already took an actor. These take none, so each
-- needs a parameter as well as the line — which is why slice 11's gap check says
-- they are ONE migration and not nine: the change is identical, and nine
-- separate slices would cost nine migrations and nine rehearsals for one
-- invariant.
--
-- `_actor_user_id uuid DEFAULT NULL` is APPENDED, so every existing caller keeps
-- working with no change and no actor — exactly today's behaviour. A caller that
-- passes it gets an audit row that names a person. Nothing regresses by
-- omission, which is what makes a nine-function migration safe to land at once.
--
-- ── THE TENTH IS NOT HERE, AND THAT IS A CORRECTION ───────────────────────
--
-- `create_default_policy_defaults` was on the ratchet beside these nine and is
-- not an RPC at all: it `RETURNS trigger` and runs `FOR EACH ROW` on
-- `projects`. PostgreSQL REFUSES a trigger function with declared arguments, so
-- the change applied here is not merely unnecessary for it — it is impossible.
-- Nor is it needed: a trigger fires INSIDE someone else's statement, so
-- `app.current_user_id` already holds whatever that statement established, and
-- naming the actor is the caller's job rather than the trigger's.
--
-- Slice 11 also called it "reachable from nothing", which was wrong for the same
-- reason: the call-site counter looks for RPC names and a trigger is wired by
-- `EXECUTE FUNCTION`, not called by name. `20260609040000` attaches it.
--
-- ── WHY DROP AND CREATE RATHER THAN CREATE OR REPLACE ─────────────────────
--
-- `CREATE OR REPLACE FUNCTION` cannot change a function's parameter COUNT; it
-- creates a second overload instead. Two overloads differing only by a trailing
-- defaulted parameter make every unqualified `GRANT EXECUTE ON FUNCTION
-- public.<name>` ambiguous and every PostgREST call a coin toss.
--
-- SO EVERY GRANT IS RE-ISSUED BELOW, and that is the risk this migration carries
-- deliberately: DROP takes a function's grants with it, and a grant that fails
-- to come back is the anon role losing an RPC — a product regression no
-- data-contract gate would see, because the artifact records functions and not
-- privileges. `supabase/rehearsal/210` §2 checks every one AS the anon role.
--
-- EACH BODY IS THE EXISTING ONE, COPIED MECHANICALLY rather than retyped, with
-- the parameter appended and one guarded block inserted after `BEGIN`. The diff
-- against each original is exactly those two edits.

-- ── bulk_upsert_materials ─ originally `20260702000001_item_master_write_rpcs.sql` ──

DROP FUNCTION IF EXISTS public.bulk_upsert_materials(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.bulk_upsert_materials(
  p_project_id uuid,
  p_rows       jsonb,
  _actor_user_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_bad   text;
  v_count integer;
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
  SELECT r->>'lead_time_dist' INTO v_bad
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'lead_time_dist', '') IS NOT NULL
    AND r->>'lead_time_dist' NOT IN ('deterministic', 'lognormal', 'gamma')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid lead_time_dist "%" — engine accepts: deterministic, lognormal, gamma', v_bad;
  END IF;

  INSERT INTO public.materials
    (project_id, material_id, name, cost, holding_cost_pct, moq,
     initial_on_hand, lead_time_dist, lead_time_cv, updated_at)
  SELECT
    p_project_id,
    r->>'material_id',
    NULLIF(r->>'name', ''),
    NULLIF(r->>'cost', '')::numeric,
    NULLIF(r->>'holding_cost_pct', '')::numeric,
    NULLIF(r->>'moq', '')::numeric,
    NULLIF(r->>'initial_on_hand', '')::numeric,
    NULLIF(r->>'lead_time_dist', ''),
    NULLIF(r->>'lead_time_cv', '')::numeric,
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'material_id', '') IS NOT NULL
  ON CONFLICT (project_id, material_id) DO UPDATE SET
    name             = excluded.name,
    cost             = excluded.cost,
    holding_cost_pct = excluded.holding_cost_pct,
    moq              = excluded.moq,
    initial_on_hand  = excluded.initial_on_hand,
    lead_time_dist   = excluded.lead_time_dist,
    lead_time_cv     = excluded.lead_time_cv,
    updated_at       = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_materials TO anon, authenticated, service_role;

-- ── bulk_upsert_policy_overrides ─ originally `20260917000008_one_staleness_rule.sql` ──

DROP FUNCTION IF EXISTS public.bulk_upsert_policy_overrides(uuid, jsonb);

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

GRANT EXECUTE ON FUNCTION public.bulk_upsert_policy_overrides TO anon, authenticated;

-- ── bulk_upsert_products ─ originally `20260712000001_product_demand_bounds.sql` ──

DROP FUNCTION IF EXISTS public.bulk_upsert_products(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.bulk_upsert_products(
  p_project_id uuid,
  p_rows       jsonb,
  _actor_user_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_bad   text;
  v_count integer;
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
  SELECT r->>'fulfillment_mode' INTO v_bad
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'fulfillment_mode', '') IS NOT NULL
    AND lower(r->>'fulfillment_mode') NOT IN ('mto', 'mts')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid fulfillment_mode "%" — engine accepts: mto, mts (ato is not yet runnable)', v_bad;
  END IF;

  SELECT r->>'demand_distribution' INTO v_bad
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'demand_distribution', '') IS NOT NULL
    AND lower(r->>'demand_distribution') NOT IN ('triangular', 'deterministic', 'poisson', 'negbin')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid demand_distribution "%" — engine accepts: triangular, deterministic, poisson, negbin', v_bad;
  END IF;

  INSERT INTO public.products
    (project_id, product_id, name, sell_price, production_capacity,
     fulfillment_mode, demand_distribution, demand_mean, demand_cv,
     demand_min, demand_max, updated_at)
  SELECT
    p_project_id,
    r->>'product_id',
    NULLIF(r->>'name', ''),
    NULLIF(r->>'sell_price', '')::numeric,
    NULLIF(r->>'production_capacity', '')::numeric,
    lower(NULLIF(r->>'fulfillment_mode', '')),
    lower(NULLIF(r->>'demand_distribution', '')),
    NULLIF(r->>'demand_mean', '')::numeric,
    NULLIF(r->>'demand_cv', '')::numeric,
    NULLIF(r->>'demand_min', '')::numeric,
    NULLIF(r->>'demand_max', '')::numeric,
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'product_id', '') IS NOT NULL
  ON CONFLICT (project_id, product_id) DO UPDATE SET
    name                = excluded.name,
    sell_price          = excluded.sell_price,
    production_capacity = excluded.production_capacity,
    fulfillment_mode    = excluded.fulfillment_mode,
    demand_distribution = excluded.demand_distribution,
    demand_mean         = excluded.demand_mean,
    demand_cv           = excluded.demand_cv,
    demand_min          = excluded.demand_min,
    demand_max          = excluded.demand_max,
    updated_at          = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_products TO anon, authenticated, service_role;

-- ── bulk_upsert_suppliers ─ originally `20260702000001_item_master_write_rpcs.sql` ──

DROP FUNCTION IF EXISTS public.bulk_upsert_suppliers(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.bulk_upsert_suppliers(
  p_project_id uuid,
  p_rows       jsonb,
  _actor_user_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
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
  INSERT INTO public.suppliers
    (project_id, supplier_id, name, capacity_per_week, reliability_score, updated_at)
  SELECT
    p_project_id,
    r->>'supplier_id',
    NULLIF(r->>'name', ''),
    NULLIF(r->>'capacity_per_week', '')::numeric,  -- NULL = unlimited
    COALESCE(NULLIF(r->>'reliability_score', '')::numeric, 1.0),
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'supplier_id', '') IS NOT NULL
  ON CONFLICT (project_id, supplier_id) DO UPDATE SET
    name              = excluded.name,
    capacity_per_week = excluded.capacity_per_week,
    reliability_score = excluded.reliability_score,
    updated_at        = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_suppliers TO anon, authenticated, service_role;

-- ── clear_policy_preset ─ originally `20260609040000_consolidated_safe.sql` ──

DROP FUNCTION IF EXISTS public.clear_policy_preset(uuid);

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
  UPDATE public.policy_defaults
     SET active_preset     = NULL,
         preset_applied_at = NULL,
         updated_at        = now()
   WHERE project_id = p_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_policy_preset TO anon, authenticated;

-- ── delete_policy_override ─ originally `20260609040000_consolidated_safe.sql` ──

DROP FUNCTION IF EXISTS public.delete_policy_override(uuid, text, text, text);

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
  DELETE FROM public.policy_overrides
   WHERE project_id = p_project_id
     AND scope       = p_scope
     AND target_key  = p_target_key
     AND family      = p_family;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_policy_override TO anon, authenticated;

-- ── ensure_item_masters ─ originally `20260614000001_item_master.sql` ──

DROP FUNCTION IF EXISTS public.ensure_item_masters(uuid);

CREATE OR REPLACE FUNCTION public.ensure_item_masters(p_project_id uuid,
  _actor_user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  INSERT INTO public.suppliers (project_id, supplier_id)
  SELECT DISTINCT p_project_id, il.supplier_id
  FROM public.inbound_logistics il
  WHERE il.project_id = p_project_id AND il.supplier_id IS NOT NULL
  ON CONFLICT (project_id, supplier_id) DO NOTHING;

  INSERT INTO public.materials (project_id, material_id)
  SELECT DISTINCT p_project_id, m FROM (
    SELECT material_id AS m FROM public.inbound_logistics WHERE project_id = p_project_id
    UNION
    SELECT material_id     FROM public.bom_single_level   WHERE project_id = p_project_id
  ) q WHERE m IS NOT NULL
  ON CONFLICT (project_id, material_id) DO NOTHING;

  INSERT INTO public.products (project_id, product_id)
  SELECT DISTINCT p_project_id, p FROM (
    SELECT product_id AS p FROM public.bom_single_level  WHERE project_id = p_project_id
    UNION
    SELECT product_id      FROM public.outbound_logistics WHERE project_id = p_project_id
  ) q WHERE p IS NOT NULL
  ON CONFLICT (project_id, product_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_item_masters TO authenticated, anon, service_role;

-- ── restore_policy_version ─ originally `20260612000001_policy_version_snapshots.sql` ──

DROP FUNCTION IF EXISTS public.restore_policy_version(uuid);

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

GRANT EXECUTE ON FUNCTION public.restore_policy_version TO anon, authenticated;

-- ── save_policy_defaults ─ originally `20260609040000_consolidated_safe.sql` ──

DROP FUNCTION IF EXISTS public.save_policy_defaults(uuid, text, jsonb, text, text, timestamptz);

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

GRANT EXECUTE ON FUNCTION public.save_policy_defaults TO anon, authenticated;
