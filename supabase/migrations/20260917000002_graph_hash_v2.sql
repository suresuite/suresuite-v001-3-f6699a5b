-- =====================================================================
-- WP 4.1 — the trust anchor covers what its readers read  (Phase 4 / G5 / §11)
--
-- `graph_hash` v1 (`20260703000001`) canonicalized six tables and called them
-- "the six tables the engine actually consumes (see datamap.py)". That was true
-- when it was written and it has not been true since:
--
--   * `datamap.py` reads `bom_multi_level` and PREFERS IT when it has rows, so
--     on a multi-level project the anchor hashes the one BOM table the run did
--     NOT read and ignores the one it did (§4 D11);
--   * `datamap.py` projects `lead_time_unit` — with a comment naming D9, because
--     PostgREST returns only what the projection names — and the snapshot does
--     not hash it, so 14 days and 14 weeks are the same dataset;
--   * `datamap.py` reads `demand_min` / `demand_max`, added to `products` after
--     v1 was written, and the snapshot does not hash those either;
--   * the row ORDERINGS are not total, so a project holding two rows that tie on
--     the ORDER BY can hash two different ways from identical data (§4 D68).
--
-- THE RULE CHANGES, AND THAT IS THE POINT. v1's rule was "mirror datamap.py
-- exactly", which requires a person to re-mirror a Python file whenever the
-- engine changes, and the three misses above are what that rule produced. v2's
-- rule is mechanical and checkable:
--
--     THE SNAPSHOT HASHES EVERY VALUE COLUMN OF EVERY TIER-2 INPUT TABLE.
--     A value column is every column except the surrogate `id`, the
--     `project_id` the snapshot is already scoped to, the audit timestamps
--     (`created_at`, `updated_at`), the ingestion provenance (`ingest_run_id`,
--     `source_row_id`, `source_system`, `source_external_id`,
--     `source_synced_at`) and the cosmetic `name`.
--
-- `graphHashCoverage.test.ts` reads the catalog and this file and FAILS when a
-- tier-2 value column is absent from the snapshot, so the next column somebody
-- adds cannot go missing the way `lead_time_unit` did. The cost of the new rule
-- is a CONSERVATIVE DIRTY — renaming a plant moves the hash although no run
-- reads `plant_name` — and that is the safe direction for a trust anchor: a
-- false "changed" is visible and a missed one is not (§5 T2).
--
-- THE SPLIT (§11). Two domains, because they answer different questions:
--
--   hash_inputs  — the tier-2 tables a SIMULATION reads. It moving means a run
--                  stamped with the old hash cannot be reproduced.
--   hash_network — the deep-tier network tables the multi-tier ANALYSES read
--                  (`tier2_suppliers`, `tier3_suppliers`,
--                  `multi_tier_supply_chain`). It moving means a network
--                  analysis is stale; no simulation changes.
--   graph_hash   — the COMPOSITE of the two, keeping its name and its place in
--                  `simulation_runs` (§11: a rename is a migration across every
--                  reader and it is not this package's).
--
-- WHAT IS DELIBERATELY OUT, and it is a claim about ABSENCE that WP 4.2 tests:
-- `node_list`, `network_nodes`, `network_edges` and `network_summary` are
-- DERIVED — they are what an analysis WROTE. Folding a derived artifact into
-- the identity of its own inputs is the confusion `input-hash` (I5) exists to
-- prevent, and it would move the hash when nothing a user typed had changed.
--
-- SCHEMA_VERSION 1 → 2, AND THE BLAST RADIUS IS NOT A SIDE EFFECT. See
-- §16 · WP 4.1 · C for the decision and the counts it was made against.
-- =====================================================================

-- 1. The two domain hashes ride alongside the composite ---------------------
--    NULL on every row written before this migration, and nothing can backfill
--    them: a historical `snapshot` holds no `network` domain and the rows it
--    was built from have moved on. A NULL here means "this version predates the
--    split", never "this version has no network".

ALTER TABLE public.dataset_versions
  ADD COLUMN IF NOT EXISTS hash_inputs  text,
  ADD COLUMN IF NOT EXISTS hash_network text;

COMMENT ON COLUMN public.dataset_versions.hash_inputs IS
  'SHA-256 over the `inputs` domain of `snapshot` — the tier-2 tables a simulation '
  'reads. NULL for versions frozen before WP 4.1; not backfillable.';
COMMENT ON COLUMN public.dataset_versions.hash_network IS
  'SHA-256 over the `network` domain of `snapshot` — the deep-tier network tables '
  'the multi-tier analyses read. NULL for versions frozen before WP 4.1.';

-- The snapshot's own version is IN the snapshot and is not copied into a column:
-- authoring it twice is the defect `single-source` (I1) names. Read it with
-- `snapshot->>'schema_version'`.

-- 2. The snapshot -----------------------------------------------------------
--    EVERY `ORDER BY` IS THE TABLE'S NATURAL KEY, which WP 3.3 made UNIQUE
--    (`20260916000018`, all seven `NULLS NOT DISTINCT`). That is what makes the
--    ordering TOTAL and therefore the text deterministic. v1 ordered by a
--    hand-picked prefix — `inbound` by `supplier_id, material_id, unit_price,
--    volume`, which omits `plant_name` — so two rows in different plants that
--    tie on all four could come back in either order and hash two ways from one
--    dataset (§4 D68). A hash that is not a function of its input is not an
--    identity.

CREATE OR REPLACE FUNCTION public._build_dataset_snapshot(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'schema_version', 2,

    -- ── the tables a SIMULATION reads ──────────────────────────────────────
    'inputs', jsonb_build_object(
      'suppliers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'supplier_id', s.supplier_id,
          'capacity_per_week', s.capacity_per_week,
          'reliability_score', s.reliability_score
        ) ORDER BY s.supplier_id)
        FROM public.suppliers s WHERE s.project_id = p_project_id
      ), '[]'::jsonb),

      'materials', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'material_id', m.material_id,
          'cost', m.cost,
          'holding_cost_pct', m.holding_cost_pct,
          'moq', m.moq,
          'initial_on_hand', m.initial_on_hand,
          'lead_time_dist', m.lead_time_dist,
          'lead_time_cv', m.lead_time_cv
        ) ORDER BY m.material_id)
        FROM public.materials m WHERE m.project_id = p_project_id
      ), '[]'::jsonb),

      -- `demand_min` / `demand_max` were added to `products` after v1 and
      -- `datamap.py` reads both; without them a triangular or uniform demand
      -- could be re-parameterized without moving the anchor.
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', p.product_id,
          'sell_price', p.sell_price,
          'production_capacity', p.production_capacity,
          'fulfillment_mode', p.fulfillment_mode,
          'demand_distribution', p.demand_distribution,
          'demand_mean', p.demand_mean,
          'demand_cv', p.demand_cv,
          'demand_min', p.demand_min,
          'demand_max', p.demand_max
        ) ORDER BY p.product_id)
        FROM public.products p WHERE p.project_id = p_project_id
      ), '[]'::jsonb),

      -- `customers` has never been hashed and is not read by `datamap.py`
      -- either — `project_map.py` synthesizes a Customer from the ids in
      -- `outbound_logistics` and never loads this table, so P-C.2 always sees
      -- default `segment` and `priority_weight` (§4 D69, WP 6.2). It is hashed
      -- here anyway: it is an INPUT a user typed, the economics are real, and
      -- the day a reader loads it the anchor must already cover it. Under the
      -- old rule it would have been missed exactly as `lead_time_unit` was.
      'customers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'customer_id', c.customer_id,
          'segment', c.segment,
          'priority_weight', c.priority_weight,
          'sla_fill_floor_pct', c.sla_fill_floor_pct
        ) ORDER BY c.customer_id)
        FROM public.customers c WHERE c.project_id = p_project_id
      ), '[]'::jsonb),

      -- `lead_time_unit` (D9/D10): `datamap.py` names it in its projection and
      -- `lead_time` without it is a number whose source a reader has to know
      -- rather than read (§5 T1).
      'inbound', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', il.plant_name,
          'supplier_id', il.supplier_id,
          'material_id', il.material_id,
          'unit_price', il.unit_price,
          'lead_time', il.lead_time,
          'lead_time_unit', il.lead_time_unit,
          'time_unit', il.time_unit,
          'volume', il.volume
        ) ORDER BY il.plant_name, il.supplier_id, il.material_id)
        FROM public.inbound_logistics il WHERE il.project_id = p_project_id
      ), '[]'::jsonb),

      'outbound', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', o.plant_name,
          'customer_id', o.customer_id,
          'product_id', o.product_id,
          'unit_price', o.unit_price,
          'volume', o.volume,
          'time_unit', o.time_unit,
          'expected_lead_time', o.expected_lead_time
        ) ORDER BY o.plant_name, o.customer_id, o.product_id)
        FROM public.outbound_logistics o WHERE o.project_id = p_project_id
      ), '[]'::jsonb),

      'bom', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', b.plant_name,
          'product_id', b.product_id,
          'material_id', b.material_id,
          'consumption_rate', b.consumption_rate
        ) ORDER BY b.plant_name, b.product_id, b.material_id)
        FROM public.bom_single_level b WHERE b.project_id = p_project_id
      ), '[]'::jsonb),

      -- D11 — THE TABLE THE ENGINE PREFERS. `datamap.py` reads
      -- `bom_multi_level` first and falls back to `bom_single_level` only when
      -- it is empty, so on a multi-level project v1 hashed the table the run
      -- did not read.
      'bom_multi_level', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', bm.plant_name,
          'material_id', bm.material_id,
          'higher_level_component_id', bm.higher_level_component_id,
          'level', bm.level,
          'consumption_rate', bm.consumption_rate
        ) ORDER BY bm.plant_name, bm.material_id, bm.higher_level_component_id, bm.level)
        FROM public.bom_multi_level bm WHERE bm.project_id = p_project_id
      ), '[]'::jsonb)
    ),

    -- ── the tables the multi-tier ANALYSES read ────────────────────────────
    -- All three hold ZERO rows in production (§15), so this half is free to add
    -- and UNEXERCISED until somebody uploads one. A green rehearsal on it is
    -- not a working path and must not be reported as one.
    'network', jsonb_build_object(
      'tier2_suppliers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', t.plant_name,
          'supplier_id', t.supplier_id,
          'upstream_supplier_id', t.upstream_supplier_id,
          'material_id', t.material_id,
          'relationship_type', t.relationship_type,
          'volume', t.volume,
          'unit_price', t.unit_price,
          'lead_time', t.lead_time,
          'time_unit', t.time_unit
        ) ORDER BY t.plant_name, t.supplier_id, t.upstream_supplier_id, t.material_id)
        FROM public.tier2_suppliers t WHERE t.project_id = p_project_id
      ), '[]'::jsonb),

      'tier3_suppliers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', t.plant_name,
          'supplier_id', t.supplier_id,
          'upstream_supplier_id', t.upstream_supplier_id,
          'material_id', t.material_id,
          'relationship_type', t.relationship_type,
          'volume', t.volume,
          'unit_price', t.unit_price,
          'lead_time', t.lead_time,
          'time_unit', t.time_unit
        ) ORDER BY t.plant_name, t.supplier_id, t.upstream_supplier_id, t.material_id)
        FROM public.tier3_suppliers t WHERE t.project_id = p_project_id
      ), '[]'::jsonb),

      'multi_tier', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', mt.plant_name,
          'from_firm_id', mt.from_firm_id,
          'to_firm_id', mt.to_firm_id,
          'to_firm_tier', mt.to_firm_tier,
          'to_firm_relationship', mt.to_firm_relationship
        ) ORDER BY mt.plant_name, mt.from_firm_id, mt.to_firm_id)
        FROM public.multi_tier_supply_chain mt WHERE mt.project_id = p_project_id
      ), '[]'::jsonb)
    )
  );
$$;

-- 3. The domain hashes and the composite ------------------------------------
--    Derived from a snapshot that was built ONCE. Recomputing the snapshot per
--    domain would let a row change between two builds and produce a composite
--    that decomposes into two halves nothing ever held together.

CREATE OR REPLACE FUNCTION public._dataset_domain_hashes(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'schema_version', p_snapshot -> 'schema_version',
    'hash_inputs',  encode(extensions.digest((p_snapshot -> 'inputs')::text,  'sha256'), 'hex'),
    'hash_network', encode(extensions.digest((p_snapshot -> 'network')::text, 'sha256'), 'hex')
  );
$$;

-- THE COMPOSITE IS OVER THE TWO DOMAIN HASHES AND THE VERSION, not over the
-- whole snapshot text. Composing it this way means the composition is itself
-- visible: a third domain cannot be added without changing this object, and the
-- version is inside what is hashed, so v1 and v2 can never collide by accident.
CREATE OR REPLACE FUNCTION public._dataset_graph_hash(p_snapshot jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT encode(extensions.digest(public._dataset_domain_hashes(p_snapshot)::text, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.current_graph_hash(p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public._dataset_graph_hash(public._build_dataset_snapshot(p_project_id));
$$;

CREATE OR REPLACE FUNCTION public.current_hash_inputs(p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public._dataset_domain_hashes(public._build_dataset_snapshot(p_project_id)) ->> 'hash_inputs';
$$;

CREATE OR REPLACE FUNCTION public.current_hash_network(p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public._dataset_domain_hashes(public._build_dataset_snapshot(p_project_id)) ->> 'hash_network';
$$;

-- Same posture as `current_graph_hash`, which has been granted to `anon` since
-- `20260703000001`: these return a one-way digest of data the same caller can
-- already ask the composite about, so the split adds no exposure. It is named
-- rather than assumed because widening a grant by copying one is how a grant
-- gets widened (D37).
GRANT EXECUTE ON FUNCTION public.current_hash_inputs(uuid)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_hash_network(uuid) TO anon, authenticated, service_role;

-- 4. snapshot_dataset records all three -------------------------------------

CREATE OR REPLACE FUNCTION public.snapshot_dataset(
  p_project_id uuid,
  p_label      text DEFAULT NULL,
  p_user_id    uuid DEFAULT NULL,
  p_user_email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_snapshot jsonb;
  v_domains  jsonb;
  v_hash     text;
  v_latest   public.dataset_versions%ROWTYPE;
  v_id       uuid;
BEGIN
  -- A SEVENTH UNATTRIBUTED WRITER, AND D36'S LIST OF SIX NEVER HELD IT.
  -- `dataset_versions` is tier 3 and carries all three `audit_tier_write`
  -- triggers (`20260916000001:201`), the trigger reads
  -- `get_current_user_id()`, and this function has taken the author as a
  -- PARAMETER since `20260703000001` without ever telling it — so every
  -- dataset version ever frozen records `actor_known: false` beside an
  -- `author_user_id` the caller supplied. It is the same shape as
  -- `assign_material_supplier` (D36's own evidence: "never in the list of six
  -- because nothing had looked at it"), and the same one line closes it,
  -- because a SECURITY DEFINER function runs in a transaction it controls.
  -- LOCAL — `true` — so it cannot leak past this transaction on a pooled
  -- connection. `supabase/rehearsal/110` reads the row back.
  IF COALESCE(p_user_id, auth.uid()) IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', COALESCE(p_user_id, auth.uid())::text, true);
  END IF;

  v_snapshot := public._build_dataset_snapshot(p_project_id);
  v_domains  := public._dataset_domain_hashes(v_snapshot);
  v_hash     := public._dataset_graph_hash(v_snapshot);

  -- Dedup against the LATEST version only, unchanged from v1 and deliberately
  -- so: it is a "did anything change since the last freeze" test, not a search
  -- of history. Reverting an edit therefore creates a THIRD version carrying
  -- the first one's hash rather than returning the first — which is correct for
  -- an append-only version log and is what lets a run resolve the version it
  -- actually ran against. `dataset_versions` rows are never updated and never
  -- deleted, so no existing `simulation_runs.dataset_version_id` can stop
  -- resolving (§11's second exit check).
  SELECT * INTO v_latest
  FROM public.dataset_versions
  WHERE project_id = p_project_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_latest.graph_hash = v_hash THEN
    RETURN v_latest.id;
  END IF;

  INSERT INTO public.dataset_versions (
    project_id, label, snapshot, graph_hash, hash_inputs, hash_network,
    author_user_id, author_email
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Dataset ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_snapshot,
    v_hash,
    v_domains ->> 'hash_inputs',
    v_domains ->> 'hash_network',
    COALESCE(p_user_id, auth.uid()),
    p_user_email
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
