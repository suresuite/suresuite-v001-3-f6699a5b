-- Phase 10 / WP 10.1 / §8.4 · §9.2 · gates `input-hash`, `single-source` · §4 D233–D240
-- GRAPH VERSIONS PER NETWORK LEVEL; METRICS COMPUTED ONCE.
--
-- Eight defects, one rule: an analysis is keyed by the hash of what it READS, and
-- that hash is a stored fact rather than a rebuild.
--
-- ── 1 · THE LEVEL HASHES, AND WHY `schema_version` STAYS 3 ─────────────────
--
-- Three named parts over the snapshot that `20260917000009` already builds:
--
--   product  the item masters, customers, the single-level BOM and the inbound /
--            outbound lanes — every column the `inputs` domain hashes except the
--            multi-level BOM;
--   process  the FLOW STRUCTURE the two lane graphs are rebuilt from:
--            `bom_multi_level` and `multi_tier_supply_chain` whole, plus the
--            endpoints and quantities (not the prices) of the single-level BOM and
--            the lanes, and which product ids exist. The process page reads
--            `supply_chain_data_multi_tier`, a DERIVED table nothing hashes — an
--            analysis output may not enter the identity of its own inputs — and
--            `rebuild_supply_chain_lanes` builds it from exactly these columns;
--   firm     the deep-tier topology (`network_nodes(uid, revenue)`,
--            `network_edges(src_uid, dst_uid, relative_revenue)`) and the tier-2 /
--            tier-3 supplier tables.
--
-- Each is a PROJECTION of facts the snapshot already holds — no column is hashed
-- here that the anchor did not hash before. So the composite `graph_hash` does not
-- move, and `schema_version` stays 3: a bump folds the version into the composite
-- and would have read every validated card and every run as "data drift" for a
-- change that added no fact. The brief asked for a bump AFTER measuring that blast
-- radius; not bumping makes the radius zero by construction, and
-- `supabase/rehearsal/570` §1 proves the composite is byte-identical. The level
-- rule carries its own version (`level_spec` 1) inside each level digest, so a
-- later change to a level moves that level and nothing else (§16 · WP 10.1).
--
-- ── 2 · THE STORED CURRENT HASH ─────────────────────────────────────────────
--
-- `project_graph_state` holds every hash of a project's live data, marked dirty by
-- statement triggers on all thirteen hashed tables and recomputed only when read
-- dirty. A `generation` counter guards the race a dirty flag alone loses: a reader
-- that started before a write commits cannot store a hash of the world before that
-- write over the flag the write raised (its UPDATE matches no row once the
-- generation moved). A read in a read-only transaction computes and returns the
-- answer and stores nothing.
--
-- ── 3 · A GRAPH VERSION PER UPLOAD, DEDUPLICATED AGAINST ANY VERSION ───────
--
-- `20260917000002` deduplicated against the LATEST version only and called it
-- deliberate. WP 10.1 reverses that on the owner's instruction: a reverted edit is
-- "Graph v3 again", not "v5 carrying v3's hash" — two names for one world. Rows stay
-- immutable, so a run still resolves the exact row it ran against. `version_no`
-- numbers each CONTENT per project. A version is taken at the end of every
-- promotion (`ingest_runs` reaching `applied`), every combine, and — through
-- `capture_graph_version` — once after a deep-tier upload's last chunk.
--
-- ── 4 · ANALYSES KEY ON THEIR LEVEL ─────────────────────────────────────────
--
-- `analysis_kinds` states each kind's `input_scope` ONCE; `analysis_get_or_start`
-- reads it. `network_metrics` declares a FALLBACK scope, because the analyzer reads
-- the lane graph when the deep tier is incomplete: the rule ("no deep-tier nodes or
-- no deep-tier edges") lives here and the analyzer is TOLD which graph to read.
-- ============================================================================

-- ── 1 · the level hashes ──────────────────────────────────────────────────

-- A projection of a snapshot array onto some of its keys, order preserved.
CREATE OR REPLACE FUNCTION public._jsonb_project(p_rows jsonb, p_keys text[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(
              (SELECT jsonb_object_agg(k, e.v -> k) FROM unnest(p_keys) AS k)
              ORDER BY e.ord)
       FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(v, ord)),
    '[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public._dataset_level_hashes(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  WITH s AS (
    SELECT p_snapshot -> 'inputs' AS i,
           p_snapshot -> 'network' AS n,
           COALESCE((p_snapshot ->> 'schema_version')::int, 1) AS v
  )
  SELECT jsonb_build_object(
    'level_spec', 1,
    'hash_product', CASE WHEN s.i IS NULL THEN NULL ELSE
      encode(extensions.digest(jsonb_build_object(
        'level', 'product', 'level_spec', 1,
        'suppliers', s.i -> 'suppliers', 'materials', s.i -> 'materials',
        'products', s.i -> 'products', 'customers', s.i -> 'customers',
        'inbound', s.i -> 'inbound', 'outbound', s.i -> 'outbound',
        'bom', s.i -> 'bom')::text, 'sha256'), 'hex') END,
    'hash_process', CASE WHEN s.i IS NULL OR s.n IS NULL THEN NULL ELSE
      encode(extensions.digest(jsonb_build_object(
        'level', 'process', 'level_spec', 1,
        'bom_multi_level', s.i -> 'bom_multi_level',
        'multi_tier', s.n -> 'multi_tier',
        'bom', public._jsonb_project(s.i -> 'bom',
                 ARRAY['plant_name','product_id','material_id','consumption_rate']),
        'inbound', public._jsonb_project(s.i -> 'inbound',
                 ARRAY['plant_name','supplier_id','material_id','volume','time_unit']),
        'outbound', public._jsonb_project(s.i -> 'outbound',
                 ARRAY['plant_name','customer_id','product_id','volume','time_unit']),
        'products', public._jsonb_project(s.i -> 'products', ARRAY['product_id'])
      )::text, 'sha256'), 'hex') END,
    -- The deep-tier topology entered the snapshot at v3 (`20260917000009`); a level
    -- computed from an older snapshot would hash its ABSENCE, which is not a fact.
    'hash_firm', CASE WHEN s.n IS NULL OR s.v < 3 THEN NULL ELSE
      encode(extensions.digest(jsonb_build_object(
        'level', 'firm', 'level_spec', 1,
        'deep_tier_nodes', s.n -> 'deep_tier_nodes',
        'deep_tier_edges', s.n -> 'deep_tier_edges',
        'tier2_suppliers', s.n -> 'tier2_suppliers',
        'tier3_suppliers', s.n -> 'tier3_suppliers')::text, 'sha256'), 'hex') END
  )
  FROM s;
$$;

-- Every hash of one snapshot, from ONE build.
CREATE OR REPLACE FUNCTION public._dataset_all_hashes(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT public._dataset_domain_hashes(p_snapshot)
      || public._dataset_level_hashes(p_snapshot)
      || jsonb_build_object('graph_hash', public._dataset_graph_hash(p_snapshot));
$$;

-- ── 2 · dataset_versions: level hashes and a number ───────────────────────

ALTER TABLE public.dataset_versions
  ADD COLUMN IF NOT EXISTS hash_product text,
  ADD COLUMN IF NOT EXISTS hash_process text,
  ADD COLUMN IF NOT EXISTS hash_firm    text,
  ADD COLUMN IF NOT EXISTS version_no   integer;

-- Backfilled from each row's OWN snapshot — a row is a fact about its moment, and a
-- level is a projection of it, so this is computation and not invention. A level
-- the snapshot cannot support (firm before v3; process/firm before v2) stays NULL.
UPDATE public.dataset_versions dv
   SET hash_product = h ->> 'hash_product',
       hash_process = h ->> 'hash_process',
       hash_firm    = h ->> 'hash_firm'
  FROM (SELECT id, public._dataset_level_hashes(snapshot) AS h FROM public.dataset_versions) x
 WHERE x.id = dv.id
   AND dv.hash_product IS NULL;

WITH firsts AS (
  SELECT project_id, graph_hash, min(created_at) AS first_at, min(id::text) AS first_id
    FROM public.dataset_versions GROUP BY project_id, graph_hash
), numbered AS (
  SELECT project_id, graph_hash,
         row_number() OVER (PARTITION BY project_id ORDER BY first_at, first_id) AS n
    FROM firsts
)
UPDATE public.dataset_versions dv
   SET version_no = numbered.n
  FROM numbered
 WHERE dv.version_no IS NULL
   AND numbered.project_id = dv.project_id
   AND numbered.graph_hash = dv.graph_hash;

CREATE INDEX IF NOT EXISTS dataset_versions_project_hash
  ON public.dataset_versions (project_id, graph_hash, created_at);

CREATE OR REPLACE FUNCTION public.dataset_versions_assign_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.version_no IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dataset_versions:' || NEW.project_id::text, 0));
  SELECT version_no INTO NEW.version_no
    FROM public.dataset_versions
   WHERE project_id = NEW.project_id AND graph_hash = NEW.graph_hash AND version_no IS NOT NULL
   ORDER BY created_at, id LIMIT 1;
  IF NEW.version_no IS NULL THEN
    SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no
      FROM public.dataset_versions WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dataset_versions_number ON public.dataset_versions;
CREATE TRIGGER dataset_versions_number
  BEFORE INSERT ON public.dataset_versions
  FOR EACH ROW EXECUTE FUNCTION public.dataset_versions_assign_number();

-- ── 3 · project_graph_state — the stored current hash ─────────────────────

CREATE TABLE IF NOT EXISTS public.project_graph_state (
  project_id     uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  schema_version integer,
  level_spec     integer,
  graph_hash     text,
  hash_inputs    text,
  hash_network   text,
  hash_product   text,
  hash_process   text,
  hash_firm      text,
  dirty          boolean NOT NULL DEFAULT true,
  generation     bigint  NOT NULL DEFAULT 0,
  computed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.project_graph_state IS
  'WP 10.1 · §4 D233. Every hash of a project''s LIVE data, stored. Marked dirty '
  'by statement triggers on the thirteen hashed tables; recomputed by '
  '`project_graph_hashes` only when read dirty; `generation` stops a reader that '
  'started before a write from storing the pre-write hash over the write''s flag.';

ALTER TABLE public.project_graph_state ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.project_graph_state TO anon, authenticated;
GRANT ALL    ON public.project_graph_state TO service_role;
DROP POLICY IF EXISTS project_graph_state_select ON public.project_graph_state;
CREATE POLICY project_graph_state_select ON public.project_graph_state
  FOR SELECT USING (public.has_project_access(project_id));

DROP TRIGGER IF EXISTS audit_project_graph_state_insert ON public.project_graph_state;
CREATE TRIGGER audit_project_graph_state_insert AFTER INSERT ON public.project_graph_state
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_project_graph_state_update ON public.project_graph_state;
CREATE TRIGGER audit_project_graph_state_update AFTER UPDATE ON public.project_graph_state
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_project_graph_state_delete ON public.project_graph_state;
CREATE TRIGGER audit_project_graph_state_delete AFTER DELETE ON public.project_graph_state
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

-- The touch. One function PER EVENT, shared by every hashed table: PostgreSQL
-- refuses transition tables on a trigger with more than one event, so each table
-- carries three triggers, and a body per event names only the transition table its
-- event has. A project being deleted is skipped: its row is gone before its children cascade
-- (`20260922000009`), and the state row cascades with it.
CREATE OR REPLACE FUNCTION public._graph_state_mark(p_project_ids uuid[])
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.project_graph_state AS s (project_id, dirty, generation)
  SELECT DISTINCT x, true, 1
    FROM unnest(p_project_ids) AS x
   WHERE x IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = x)
  ON CONFLICT (project_id) DO UPDATE
    SET dirty = true, generation = s.generation + 1, updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public._graph_state_touch_ins()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public._graph_state_mark(ARRAY(SELECT DISTINCT project_id FROM new_rows));
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._graph_state_touch_upd()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public._graph_state_mark(ARRAY(
    SELECT project_id FROM new_rows UNION SELECT project_id FROM old_rows));
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._graph_state_touch_del()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public._graph_state_mark(ARRAY(SELECT DISTINCT project_id FROM old_rows));
  RETURN NULL;
END;
$fn$;

-- WRITTEN OUT, NOT LOOPED. A `DO` block with `EXECUTE format(...)` is invisible to
-- the introspector, so a base built from the artifact would carry no trigger and the
-- stored hash would never go dirty — `contract:rehearse --since HEAD` found exactly
-- that on this file's first draft (and `20260916000001` says the same of its own
-- audit triggers: verbose and readable beats clever and unreadable).

-- suppliers
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.suppliers;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.suppliers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.suppliers;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.suppliers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.suppliers;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.suppliers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- materials
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.materials;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.materials
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.materials;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.materials
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.materials;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.materials
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- products
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.products;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.products
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.products;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.products
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.products;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.products
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- customers
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.customers;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.customers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.customers;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.customers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.customers;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.customers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- inbound_logistics
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.inbound_logistics;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.inbound_logistics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.inbound_logistics;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.inbound_logistics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.inbound_logistics;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.inbound_logistics
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- outbound_logistics
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.outbound_logistics;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.outbound_logistics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.outbound_logistics;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.outbound_logistics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.outbound_logistics;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.outbound_logistics
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- bom_single_level
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.bom_single_level;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.bom_single_level
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.bom_single_level;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.bom_single_level
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.bom_single_level;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.bom_single_level
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- bom_multi_level
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.bom_multi_level;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.bom_multi_level
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.bom_multi_level;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.bom_multi_level
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.bom_multi_level;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.bom_multi_level
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- tier2_suppliers
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.tier2_suppliers;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.tier2_suppliers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.tier2_suppliers;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.tier2_suppliers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.tier2_suppliers;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.tier2_suppliers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- tier3_suppliers
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.tier3_suppliers;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.tier3_suppliers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.tier3_suppliers;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.tier3_suppliers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.tier3_suppliers;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.tier3_suppliers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- multi_tier_supply_chain
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.multi_tier_supply_chain;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.multi_tier_supply_chain
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.multi_tier_supply_chain;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.multi_tier_supply_chain
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.multi_tier_supply_chain;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.multi_tier_supply_chain
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- network_nodes
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.network_nodes;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.network_nodes
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.network_nodes;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.network_nodes
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.network_nodes;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.network_nodes
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- network_edges
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.network_edges;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.network_edges
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.network_edges;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.network_edges
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.network_edges;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.network_edges
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- Store a computed set of hashes IF nothing moved since `p_generation` was read.
-- Silent in a read-only transaction and for a project that does not exist: the
-- caller still gets its answer, the cache just does not learn it.
CREATE OR REPLACE FUNCTION public._graph_state_store(
  p_project_id uuid, p_hashes jsonb, p_generation bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.project_graph_state AS s (
      project_id, schema_version, level_spec, graph_hash, hash_inputs, hash_network,
      hash_product, hash_process, hash_firm, dirty, generation, computed_at, updated_at)
    VALUES (
      p_project_id, (p_hashes ->> 'schema_version')::int, (p_hashes ->> 'level_spec')::int,
      p_hashes ->> 'graph_hash', p_hashes ->> 'hash_inputs', p_hashes ->> 'hash_network',
      p_hashes ->> 'hash_product', p_hashes ->> 'hash_process', p_hashes ->> 'hash_firm',
      false, p_generation, now(), now())
    ON CONFLICT (project_id) DO UPDATE
      SET schema_version = EXCLUDED.schema_version, level_spec = EXCLUDED.level_spec,
          graph_hash = EXCLUDED.graph_hash, hash_inputs = EXCLUDED.hash_inputs,
          hash_network = EXCLUDED.hash_network, hash_product = EXCLUDED.hash_product,
          hash_process = EXCLUDED.hash_process, hash_firm = EXCLUDED.hash_firm,
          dirty = false, computed_at = now(), updated_at = now()
      WHERE s.generation = p_generation;
  EXCEPTION
    WHEN read_only_sql_transaction OR foreign_key_violation THEN NULL;
  END;
END;
$$;

-- Internal: no API role may write the cache directly. The touch functions and the
-- readers below reach these as SECURITY DEFINER; nothing else can
-- (`dataPlaneAudit.test.ts` holds the revocation, on which their exemption from
-- the actor rule rests).
REVOKE ALL ON FUNCTION public._graph_state_mark(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._graph_state_store(uuid, jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._graph_state_touch_ins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._graph_state_touch_upd() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._graph_state_touch_del() FROM PUBLIC;

-- THE read. Every caller of a current hash comes through here.
CREATE OR REPLACE FUNCTION public.project_graph_hashes(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  st     public.project_graph_state%ROWTYPE;
  v_gen  bigint := 0;
  v_snap jsonb;
  v_h    jsonb;
BEGIN
  SELECT * INTO st FROM public.project_graph_state WHERE project_id = p_project_id;
  IF FOUND THEN
    v_gen := st.generation;
    IF NOT st.dirty AND st.graph_hash IS NOT NULL AND st.level_spec = 1 THEN
      RETURN jsonb_build_object(
        'schema_version', st.schema_version, 'level_spec', st.level_spec,
        'graph_hash', st.graph_hash, 'hash_inputs', st.hash_inputs,
        'hash_network', st.hash_network, 'hash_product', st.hash_product,
        'hash_process', st.hash_process, 'hash_firm', st.hash_firm,
        'computed_at', st.computed_at, 'stored', true);
    END IF;
  END IF;
  v_snap := public._build_dataset_snapshot(p_project_id);
  v_h    := public._dataset_all_hashes(v_snap);
  PERFORM public._graph_state_store(p_project_id, v_h, v_gen);
  RETURN v_h || jsonb_build_object('computed_at', now(), 'stored', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.project_graph_hashes(uuid) TO anon, authenticated, service_role;

-- The three existing entry points keep their signatures and read the state.
-- VOLATILE now, because the read may store; every existing caller is a POST or a
-- function, and a read-only transaction still gets its answer.
CREATE OR REPLACE FUNCTION public.current_graph_hash(p_project_id uuid)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.project_graph_hashes(p_project_id) ->> 'graph_hash'; $$;

CREATE OR REPLACE FUNCTION public.current_hash_inputs(p_project_id uuid)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.project_graph_hashes(p_project_id) ->> 'hash_inputs'; $$;

CREATE OR REPLACE FUNCTION public.current_hash_network(p_project_id uuid)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.project_graph_hashes(p_project_id) ->> 'hash_network'; $$;

-- The current hash of one LEVEL ('all' is the composite).
CREATE OR REPLACE FUNCTION public.current_level_hash(p_project_id uuid, p_scope text)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE p_scope
           WHEN 'all' THEN h ->> 'graph_hash'
           WHEN 'product' THEN h ->> 'hash_product'
           WHEN 'process' THEN h ->> 'hash_process'
           WHEN 'firm' THEN h ->> 'hash_firm'
         END
    FROM (SELECT public.project_graph_hashes(p_project_id) AS h) x;
$$;
GRANT EXECUTE ON FUNCTION public.current_level_hash(uuid, text) TO anon, authenticated, service_role;

-- ── 4 · snapshot_dataset: dedupe against ANY version ───────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_dataset(
  p_project_id uuid,
  p_label      text DEFAULT NULL,
  p_user_id    uuid DEFAULT NULL,
  p_user_email text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  st      public.project_graph_state%ROWTYPE;
  v_gen   bigint := 0;
  v_snap  jsonb;
  v_h     jsonb;
  v_id    uuid;
BEGIN
  IF COALESCE(p_user_id, auth.uid()) IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', COALESCE(p_user_id, auth.uid())::text, true);
  END IF;

  -- One version per content, so two concurrent saves of one world cannot both
  -- miss the lookup and insert twice. The numbering trigger takes the same key.
  PERFORM pg_advisory_xact_lock(hashtextextended('dataset_versions:' || p_project_id::text, 0));

  -- FAST PATH: the stored hash is clean and a version of it exists — that version
  -- IS this snapshot, and no snapshot needs building to say so.
  SELECT * INTO st FROM public.project_graph_state WHERE project_id = p_project_id;
  IF FOUND THEN
    v_gen := st.generation;
    IF NOT st.dirty AND st.graph_hash IS NOT NULL AND st.level_spec = 1 THEN
      SELECT id INTO v_id FROM public.dataset_versions
       WHERE project_id = p_project_id AND graph_hash = st.graph_hash
       ORDER BY created_at, id LIMIT 1;
      IF FOUND THEN RETURN v_id; END IF;
    END IF;
  END IF;

  v_snap := public._build_dataset_snapshot(p_project_id);
  v_h    := public._dataset_all_hashes(v_snap);
  PERFORM public._graph_state_store(p_project_id, v_h, v_gen);

  -- §4 D234: ANY version of this content, not the latest one — the OLDEST, so the
  -- answer is the same on every call.
  SELECT id INTO v_id FROM public.dataset_versions
   WHERE project_id = p_project_id AND graph_hash = v_h ->> 'graph_hash'
   ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN
    -- A row frozen before the level hashes existed learns them from the same
    -- world it already describes (its graph_hash equals this one's).
    UPDATE public.dataset_versions
       SET hash_product = v_h ->> 'hash_product',
           hash_process = v_h ->> 'hash_process',
           hash_firm    = v_h ->> 'hash_firm'
     WHERE id = v_id AND hash_product IS NULL;
    RETURN v_id;
  END IF;

  INSERT INTO public.dataset_versions (
    project_id, label, snapshot, graph_hash, hash_inputs, hash_network,
    hash_product, hash_process, hash_firm, author_user_id, author_email
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Dataset ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_snap,
    v_h ->> 'graph_hash', v_h ->> 'hash_inputs', v_h ->> 'hash_network',
    v_h ->> 'hash_product', v_h ->> 'hash_process', v_h ->> 'hash_firm',
    COALESCE(p_user_id, auth.uid()), p_user_email
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- The deep-tier upload's one call after its last chunk (a version per CHUNK would
-- number half-uploaded worlds). Attributed through the shared preamble, which
-- authenticates and authorizes nothing (D66, `20260917000005`).
CREATE OR REPLACE FUNCTION public.capture_graph_version(
  p_project_id    uuid,
  _actor_user_id  uuid,
  p_label         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_before bigint;
  v_id     uuid;
  v_row    public.dataset_versions%ROWTYPE;
BEGIN
  PERFORM public.assert_writer_may_act('capture_graph_version', p_project_id, _actor_user_id);
  SELECT count(*) INTO v_before FROM public.dataset_versions WHERE project_id = p_project_id;
  v_id := public.snapshot_dataset(p_project_id, p_label, _actor_user_id, NULL);
  SELECT * INTO v_row FROM public.dataset_versions WHERE id = v_id;
  RETURN jsonb_build_object(
    'dataset_version_id', v_row.id, 'version_no', v_row.version_no,
    'graph_hash', v_row.graph_hash,
    'created', (SELECT count(*) FROM public.dataset_versions WHERE project_id = p_project_id) > v_before);
END;
$$;
REVOKE ALL ON FUNCTION public.capture_graph_version(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_graph_version(uuid, uuid, text) TO anon, authenticated, service_role;

-- A promotion is an upload: version the world it produced. A derivation inside
-- somebody else's statement — it names who (the promoter, whom `ingest_apply_run`
-- already set as the session actor) and decides nothing.
CREATE OR REPLACE FUNCTION public._graph_version_after_promotion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.snapshot_dataset(
    NEW.project_id,
    'After upload ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
    NEW.applied_by_user_id,
    NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ingest_runs_graph_version ON public.ingest_runs;
CREATE TRIGGER ingest_runs_graph_version
  AFTER UPDATE OF status ON public.ingest_runs
  FOR EACH ROW
  WHEN (NEW.status = 'applied' AND OLD.status IS DISTINCT FROM 'applied')
  EXECUTE FUNCTION public._graph_version_after_promotion();

-- combine: the wrapper `20260920000003` defined, plus the version at its end.
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org     text;
  v_org_id  uuid;
  v_modeler uuid;
  v_role    text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
    FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- UNCHANGED (`20260920000003`): this path's authorization is D66's to move.
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org)
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM public.rebuild_supply_chain_lanes(p_project_id, p_user_id);
  -- WP 10.1 · §4 D234 — the world the combine ran over has a number.
  PERFORM public.snapshot_dataset(p_project_id,
    'After combine ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), p_user_id, p_user_email);
END;
$function$;

-- ── 5 · ONE read for the hook ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_graph_version_state(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_h   jsonb := public.project_graph_hashes(p_project_id);
  v_cur public.dataset_versions%ROWTYPE;
  v_lat public.dataset_versions%ROWTYPE;
  v_n   bigint;
BEGIN
  SELECT * INTO v_cur FROM public.dataset_versions
   WHERE project_id = p_project_id AND graph_hash = v_h ->> 'graph_hash'
   ORDER BY created_at, id LIMIT 1;
  SELECT * INTO v_lat FROM public.dataset_versions
   WHERE project_id = p_project_id ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT count(*) INTO v_n FROM public.dataset_versions WHERE project_id = p_project_id;
  RETURN jsonb_build_object(
    'current', v_h,
    'current_version', CASE WHEN v_cur.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_cur.id, 'version_no', v_cur.version_no, 'label', v_cur.label,
        'graph_hash', v_cur.graph_hash, 'created_at', v_cur.created_at) END,
    'latest', CASE WHEN v_lat.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_lat.id, 'version_no', v_lat.version_no, 'label', v_lat.label,
        'graph_hash', v_lat.graph_hash, 'hash_inputs', v_lat.hash_inputs,
        'hash_network', v_lat.hash_network, 'hash_product', v_lat.hash_product,
        'hash_process', v_lat.hash_process, 'hash_firm', v_lat.hash_firm,
        'author_email', v_lat.author_email, 'created_at', v_lat.created_at) END,
    'version_count', v_n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_graph_version_state(uuid) TO anon, authenticated, service_role;

-- ── 6 · analysis kinds, authored once ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analysis_kinds (
  kind           text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9_]*$'),
  input_scope    text NOT NULL CHECK (input_scope IN ('product','process','firm','all')),
  fallback_scope text CHECK (fallback_scope IN ('product','process','firm','all')),
  fallback_rule  text CHECK (fallback_rule IN ('deep_tier_incomplete')),
  description    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((fallback_scope IS NULL) = (fallback_rule IS NULL))
);

COMMENT ON TABLE public.analysis_kinds IS
  'WP 10.1 · §4 D235. Which level of the graph each analysis kind READS — the one '
  'place that is stated. `analysis_get_or_start` keys a run on that level''s hash, '
  'so a price edit does not invalidate a centrality. A kind not listed here keys '
  'on the composite (every level) — never stale, only less often reused.';

INSERT INTO public.analysis_kinds (kind, input_scope, fallback_scope, fallback_rule, description) VALUES
  ('network_metrics', 'firm', 'process', 'deep_tier_incomplete',
   'Centralities over the deep-tier network; over the lane graph (supply_chain_data) when the deep tier has no nodes or no edges.'),
  ('prominence', 'firm', NULL, NULL,
   'Node prominence over the deep-tier network (network_nodes, network_edges).'),
  ('critical_nodes', 'process', NULL, NULL,
   'Critical-node scores over the lane graph (supply_chain_data), which is rebuilt from the process level.'),
  ('combine_etl', 'process', NULL, NULL,
   'The lane ETL (rebuild_supply_chain_lanes), which reads the flow structure.'),
  ('process_structure', 'process', NULL, NULL,
   'Reachability on the process network (supply_chain_data_multi_tier), stored so the process page reads rather than recomputes.')
ON CONFLICT (kind) DO UPDATE
  SET input_scope = EXCLUDED.input_scope, fallback_scope = EXCLUDED.fallback_scope,
      fallback_rule = EXCLUDED.fallback_rule, description = EXCLUDED.description;

ALTER TABLE public.analysis_kinds ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.analysis_kinds TO anon, authenticated;
GRANT ALL    ON public.analysis_kinds TO service_role;
DROP POLICY IF EXISTS analysis_kinds_read ON public.analysis_kinds;
CREATE POLICY analysis_kinds_read ON public.analysis_kinds FOR SELECT USING (true);

ALTER TABLE public.analysis_runs
  ADD COLUMN IF NOT EXISTS input_scope text,
  ADD COLUMN IF NOT EXISTS dataset_version_id uuid
    REFERENCES public.dataset_versions(id) ON DELETE SET NULL;

-- Every run before this package keyed on the composite.
UPDATE public.analysis_runs SET input_scope = 'all' WHERE input_scope IS NULL;
ALTER TABLE public.analysis_runs ALTER COLUMN input_scope SET NOT NULL;
ALTER TABLE public.analysis_runs ALTER COLUMN input_scope SET DEFAULT 'all';
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analysis_runs_input_scope_check') THEN
    ALTER TABLE public.analysis_runs ADD CONSTRAINT analysis_runs_input_scope_check
      CHECK (input_scope IN ('product','process','firm','all'));
  END IF;
END
$chk$;

-- The scope a kind resolves to NOW — the declaration plus its fallback rule. The
-- getter and the freshness check both ask this, so they cannot disagree.
CREATE OR REPLACE FUNCTION public.analysis_scope_now(p_project_id uuid, p_kind text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
           WHEN k.fallback_rule = 'deep_tier_incomplete'
            AND (NOT EXISTS (SELECT 1 FROM public.network_nodes n WHERE n.project_id = p_project_id)
                 OR NOT EXISTS (SELECT 1 FROM public.network_edges e WHERE e.project_id = p_project_id))
           THEN k.fallback_scope
           ELSE k.input_scope
         END
    FROM public.analysis_kinds k
   WHERE k.kind = p_kind;
$$;
GRANT EXECUTE ON FUNCTION public.analysis_scope_now(uuid, text) TO anon, authenticated, service_role;

-- ── 7 · analysis_get_or_start keys on the level ───────────────────────────

CREATE OR REPLACE FUNCTION public.analysis_get_or_start(
  _project_id     uuid,
  _analysis_kind  text,
  _params         jsonb,
  _code_version   text,
  _actor_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_scope       text;
  v_hashes      jsonb;
  v_input_hash  text;
  v_dsv         uuid;
  v_params      jsonb := COALESCE(_params, '{}'::jsonb);
  v_params_hash text;
  v_run         public.analysis_runs;
BEGIN
  PERFORM public.assert_writer_may_act('analysis_get_or_start', _project_id, _actor_user_id);

  IF _analysis_kind IS NULL OR _code_version IS NULL THEN
    RAISE EXCEPTION 'analysis_get_or_start: analysis_kind and code_version are part of the key and may not be NULL'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- §4 D235: the level this kind reads, from the ONE place it is stated. A kind
  -- the catalog does not declare keys on EVERYTHING ('all', the composite) — the
  -- conservative answer, which keeps WP 4.2's open enum open (a new kind costs no
  -- migration) without ever serving a stale hit.
  v_scope := COALESCE(public.analysis_scope_now(_project_id, _analysis_kind), 'all');

  v_hashes := public.project_graph_hashes(_project_id);
  v_input_hash := CASE v_scope
                    WHEN 'all' THEN v_hashes ->> 'graph_hash'
                    ELSE v_hashes ->> ('hash_' || v_scope) END;
  IF v_input_hash IS NULL THEN
    RAISE EXCEPTION 'analysis_get_or_start: project % has no % hash, so a run could not name its inputs (I5)', _project_id, v_scope
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_params_hash := encode(extensions.digest(v_params::text, 'sha256'), 'hex');

  SELECT * INTO v_run FROM public.analysis_runs
   WHERE project_id = _project_id AND analysis_kind = _analysis_kind
     AND input_hash = v_input_hash AND params_hash = v_params_hash
     AND code_version = _code_version AND status = 'succeeded'
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'run_id', v_run.id, 'cache_hit', true, 'status', v_run.status,
      'input_hash', v_run.input_hash, 'input_scope', v_run.input_scope,
      'dataset_version_id', v_run.dataset_version_id,
      'params_hash', v_run.params_hash,
      'code_version', v_run.code_version, 'row_counts', v_run.row_counts,
      'warnings', v_run.warnings, 'started_at', v_run.started_at,
      'finished_at', v_run.finished_at);
  END IF;

  -- The graph version this run computes over (created if the world has none yet).
  v_dsv := public.snapshot_dataset(_project_id, NULL, _actor_user_id, NULL);

  INSERT INTO public.analysis_runs
    (project_id, analysis_kind, input_hash, input_scope, dataset_version_id,
     params_hash, params, code_version, actor_user_id)
  VALUES
    (_project_id, _analysis_kind, v_input_hash, v_scope, v_dsv,
     v_params_hash, v_params, _code_version, _actor_user_id)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_run;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'run_id', v_run.id, 'cache_hit', false, 'status', v_run.status,
      'input_hash', v_run.input_hash, 'input_scope', v_run.input_scope,
      'dataset_version_id', v_run.dataset_version_id,
      'params_hash', v_run.params_hash,
      'code_version', v_run.code_version, 'started_at', v_run.started_at);
  END IF;

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
    'input_hash', v_run.input_hash, 'input_scope', v_run.input_scope,
    'dataset_version_id', v_run.dataset_version_id,
    'params_hash', v_run.params_hash,
    'code_version', v_run.code_version, 'row_counts', v_run.row_counts,
    'warnings', v_run.warnings, 'started_at', v_run.started_at,
    'finished_at', v_run.finished_at, 'claimed_by_other', true);
END; $fn$;

-- Is a run's answer about the world as it is now? Its kind must still resolve to
-- the scope it ran at, and that level's hash must still be its input hash.
CREATE OR REPLACE FUNCTION public.analysis_run_is_current(p_run_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.input_scope = COALESCE(public.analysis_scope_now(r.project_id, r.analysis_kind), 'all')
     AND r.input_hash = public.current_level_hash(r.project_id, r.input_scope)
    FROM public.analysis_runs r
   WHERE r.id = p_run_id;
$$;
GRANT EXECUTE ON FUNCTION public.analysis_run_is_current(uuid) TO anon, authenticated, service_role;

-- The run a reader should prefer: the newest succeeded run that is CURRENT; NULL
-- when none is (`analysis_latest_run` remains the stale fallback, and a reader
-- that takes it says `hash_is_current = false`). §4 D238.
CREATE OR REPLACE FUNCTION public.analysis_current_run(_project_id uuid, _analysis_kind text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := COALESCE(public.analysis_scope_now(_project_id, _analysis_kind), 'all');
  v_hash  text;
  v_id    uuid;
BEGIN
  v_hash := public.current_level_hash(_project_id, v_scope);
  SELECT r.id INTO v_id
    FROM public.analysis_runs r
   WHERE r.project_id = _project_id AND r.analysis_kind = _analysis_kind
     AND r.status = 'succeeded' AND r.input_scope = v_scope AND r.input_hash = v_hash
   ORDER BY r.started_at DESC, r.id
   LIMIT 1;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.analysis_current_run(uuid, text) TO anon, authenticated, service_role;

-- ── 8 · the dual read prefers a current run ───────────────────────────────

CREATE OR REPLACE FUNCTION public.get_network_metrics_for_materials(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS TABLE(
  id                         uuid,
  uid                        text,
  name                       text,
  revenue                    numeric,
  degree_centrality          numeric,
  weighted_degree_centrality numeric,
  eigenvector_centrality     numeric,
  betweenness_centrality     numeric,
  closeness_centrality       numeric,
  prominence                 numeric,
  connection_count           bigint,
  metrics_source             text,
  run_id                     uuid,
  computed_from_hash         text,
  computed_at                timestamptz,
  hash_is_current            boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_run      uuid;
  v_hash     text;
  v_current  boolean;
  v_composite text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- §4 D238 — a run on the CURRENT level first; the newest run otherwise, said
  -- to be stale. It was "the newest", which let a newer run on an older graph win.
  v_run := COALESCE(public.analysis_current_run(p_project_id, 'network_metrics'),
                    public.analysis_latest_run(p_project_id, 'network_metrics'));
  SELECT r.input_hash INTO v_hash FROM public.analysis_runs r WHERE r.id = v_run;
  v_current := CASE WHEN v_run IS NULL THEN NULL ELSE public.analysis_run_is_current(v_run) END;
  v_composite := public.current_graph_hash(p_project_id);

  RETURN QUERY
  SELECT
    nn.id, nn.uid, nn.name, nn.revenue,
    COALESCE((ar.metrics ->> 'degree_centrality')::numeric,          nn.degree_centrality),
    COALESCE((ar.metrics ->> 'weighted_degree_centrality')::numeric, nn.weighted_degree_centrality),
    COALESCE((ar.metrics ->> 'eigenvector_centrality')::numeric,     nn.eigenvector_centrality),
    COALESCE((ar.metrics ->> 'betweenness_centrality')::numeric,     nn.betweenness_centrality),
    COALESCE((ar.metrics ->> 'closeness_centrality')::numeric,       nn.closeness_centrality),
    COALESCE((ar.metrics ->> 'prominence')::numeric,                 nn.prominence),
    (SELECT COUNT(*)::bigint FROM public.network_edges ne
      WHERE ne.project_id = p_project_id AND (ne.src_uid = nn.uid OR ne.dst_uid = nn.uid)),
    CASE
      WHEN ar.id IS NOT NULL THEN 'store'
      WHEN nn.degree_centrality IS NOT NULL OR nn.betweenness_centrality IS NOT NULL
        OR nn.eigenvector_centrality IS NOT NULL OR nn.closeness_centrality IS NOT NULL
        OR nn.weighted_degree_centrality IS NOT NULL OR nn.prominence IS NOT NULL THEN 'column'
      ELSE 'none'
    END,
    CASE WHEN ar.id IS NOT NULL THEN v_run ELSE NULL END,
    CASE WHEN ar.id IS NOT NULL THEN v_hash ELSE nn.computed_from_hash END,
    CASE WHEN ar.id IS NOT NULL THEN ar.created_at ELSE nn.computed_at END,
    CASE
      WHEN ar.id IS NOT NULL THEN v_current
      -- A legacy column carries the COMPOSITE it was computed against.
      WHEN nn.computed_from_hash IS NOT NULL AND v_composite IS NOT NULL
        THEN (nn.computed_from_hash = v_composite)
      ELSE NULL
    END
  FROM public.network_nodes nn
  LEFT JOIN public.analysis_results ar
         ON v_run IS NOT NULL AND ar.run_id = v_run
        AND ar.entity_type = 'node' AND ar.entity_id = nn.uid
  WHERE nn.project_id = p_project_id
    AND EXISTS (
      SELECT 1 FROM public.supply_chain_data scd
       WHERE scd.project_id = p_project_id
         AND scd.data_source = 'bom'
         AND (scd.from_location = nn.uid OR scd.to_location = nn.uid)
    )
  ORDER BY nn.prominence DESC NULLS LAST, nn.degree_centrality DESC NULLS LAST;
END; $fn$;

-- ── 9 · the firm page's read returns prominence and says where it came from ─
--
-- `get_network_nodes` never returned `prominence`, so the firm page ALWAYS showed
-- its local approximation as if it were the stored figure (§4 D239). RETURNS TABLE
-- cannot widen in place: DROP + CREATE, grants restated.

DROP FUNCTION IF EXISTS public.get_network_nodes(uuid, uuid, text, text);
CREATE FUNCTION public.get_network_nodes(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_plant_name text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, project_id uuid, plant_name text, uid text, name text, industry text,
  website text, traded_as text, number_of_employees integer, revenue numeric,
  depth integer, lat numeric, long numeric, is_seed boolean, uploaded_by uuid,
  created_by uuid, organization text, created_at timestamptz, updated_at timestamptz,
  country text,
  -- WP 10.1 · the stored prominence and its provenance (T1/T2).
  prominence numeric,
  metrics_source text,
  metrics_run_id uuid,
  metrics_computed_at timestamptz,
  hash_is_current boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_run     uuid;
  v_current boolean;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  v_run := COALESCE(public.analysis_current_run(p_project_id, 'prominence'),
                    public.analysis_latest_run(p_project_id, 'prominence'));
  v_current := CASE WHEN v_run IS NULL THEN NULL ELSE public.analysis_run_is_current(v_run) END;

  RETURN QUERY
  SELECT
    nn.id, nn.project_id, nn.plant_name, nn.uid, nn.name, nn.industry, nn.website,
    nn.traded_as, nn.number_of_employees, nn.revenue, nn.depth, nn.lat, nn.long,
    nn.is_seed, nn.uploaded_by, nn.created_by, nn.organization, nn.created_at,
    nn.updated_at, nn.country,
    COALESCE((ar.metrics ->> 'prominence')::numeric, nn.prominence),
    CASE WHEN ar.id IS NOT NULL THEN 'store'
         WHEN nn.prominence IS NOT NULL THEN 'column'
         ELSE 'none' END,
    CASE WHEN ar.id IS NOT NULL THEN v_run ELSE NULL END,
    CASE WHEN ar.id IS NOT NULL THEN ar.created_at ELSE nn.prominence_updated_at END,
    CASE WHEN ar.id IS NOT NULL THEN v_current ELSE NULL END
  FROM public.network_nodes nn
  LEFT JOIN public.analysis_results ar
         ON v_run IS NOT NULL AND ar.run_id = v_run
        AND ar.entity_type = 'node' AND ar.entity_id = nn.uid
  WHERE nn.project_id = p_project_id
    AND (p_plant_name IS NULL OR nn.plant_name = p_plant_name)
  ORDER BY nn.created_at;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_network_nodes(uuid, uuid, text, text) TO anon, authenticated, service_role;

-- ── 10 · process_structure — stored reachability on the process network ────
--
-- The process page computed reachability in the browser on every selection, by a
-- level-hopping walk that depended on the order rows arrived in and stopped at
-- level 5 (§4 D239). Stored now, once per process hash: for every level-1 node,
-- the nodes it reaches DOWNSTREAM (following arcs) and UPSTREAM (against them),
-- transitively, over `supply_chain_data_multi_tier`. A cache hit is a read.
CREATE OR REPLACE FUNCTION public.process_structure(
  p_project_id   uuid,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  k_code  constant text := 'process_structure@wp101.1';
  v_claim jsonb;
  v_run   uuid;
  v_res   jsonb;
  v_n     integer;
BEGIN
  v_claim := public.analysis_get_or_start(p_project_id, 'process_structure', '{}'::jsonb, k_code, _actor_user_id);
  v_run := (v_claim ->> 'run_id')::uuid;

  IF (v_claim ->> 'cache_hit')::boolean IS NOT TRUE THEN
    IF (v_claim ->> 'claimed_by_other')::boolean IS TRUE THEN
      RETURN v_claim || jsonb_build_object('in_progress', true, 'reachable', '{}'::jsonb);
    END IF;

    WITH RECURSIVE
    arcs AS (
      SELECT DISTINCT btrim(from_location) AS a, btrim(to_location) AS b
        FROM public.supply_chain_data_multi_tier
       WHERE project_id = p_project_id
         AND COALESCE(btrim(from_location), '') <> '' AND COALESCE(btrim(to_location), '') <> ''
    ),
    starts AS (
      SELECT DISTINCT btrim(from_location) AS s
        FROM public.supply_chain_data_multi_tier
       WHERE project_id = p_project_id AND level = 1 AND COALESCE(btrim(from_location), '') <> ''
      UNION
      SELECT DISTINCT btrim(to_location)
        FROM public.supply_chain_data_multi_tier
       WHERE project_id = p_project_id AND level = 1 AND data_source <> 'outbound'
         AND COALESCE(btrim(to_location), '') <> ''
    ),
    down(s, n, path) AS (
      SELECT s, s, ARRAY[s] FROM starts
      UNION ALL
      SELECT d.s, a.b, d.path || a.b FROM down d JOIN arcs a ON a.a = d.n
       WHERE a.b <> ALL (d.path) AND array_length(d.path, 1) < 64
    ),
    up(s, n, path) AS (
      SELECT s, s, ARRAY[s] FROM starts
      UNION ALL
      SELECT u.s, a.a, u.path || a.a FROM up u JOIN arcs a ON a.b = u.n
       WHERE a.a <> ALL (u.path) AND array_length(u.path, 1) < 64
    ),
    per AS (
      SELECT st.s,
             (SELECT COALESCE(jsonb_agg(DISTINCT d.n ORDER BY d.n), '[]'::jsonb) FROM down d WHERE d.s = st.s AND d.n <> st.s) AS downstream,
             (SELECT COALESCE(jsonb_agg(DISTINCT u.n ORDER BY u.n), '[]'::jsonb) FROM up u WHERE u.s = st.s AND u.n <> st.s) AS upstream
        FROM starts st
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'entity_type', 'node', 'entity_id', per.s,
             'metrics', jsonb_build_object('downstream', per.downstream, 'upstream', per.upstream))), '[]'::jsonb),
           count(*)
      INTO v_res, v_n
      FROM per;

    PERFORM public.analysis_complete_run(v_run, v_res,
      jsonb_build_object('nodes', v_n), '[]'::jsonb, _actor_user_id);
  END IF;

  RETURN v_claim || jsonb_build_object(
    'reachable', COALESCE((
      SELECT jsonb_object_agg(ar.entity_id, ar.metrics)
        FROM public.analysis_results ar
       WHERE ar.run_id = v_run AND ar.entity_type = 'node'), '{}'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.process_structure(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_structure(uuid, uuid) TO anon, authenticated, service_role;

-- ── 11 · the shims, and the auto-invoker that never worked ────────────────
--
-- `auto_calculate_prominence_on_deep_tier_completion` posted `{project_id}` with no
-- actor, so every call it ever made was refused with a 400 (§4 D237). DELETED, not
-- repaired: a trigger fires once per upload CHUNK and has no person to name, and
-- the pages now compute on a miss and read on a hit, which is what it was for.
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes_ins ON public.network_nodes;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes_upd ON public.network_nodes;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges_ins ON public.network_edges;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges_upd ON public.network_edges;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes ON public.network_nodes;
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges ON public.network_edges;
DROP FUNCTION IF EXISTS public.auto_calculate_prominence_on_deep_tier_completion();

-- No caller in the repository or among the deployed functions (§4 D240).
DROP FUNCTION IF EXISTS public.should_recalculate_network_metrics(uuid);
DROP FUNCTION IF EXISTS public.analysis_mark_critical_nodes(uuid, jsonb);

-- `network_topology_hash` STAYS for one deploy window: the DEPLOYED analyzers call
-- it until `supabase-functions.yml` redeploys them, and migrations and functions
-- deploy through different workflows with no order between them. Its drop is
-- WP 10.4's, after a §15 read confirms the deployed functions no longer call it.
COMMENT ON FUNCTION public.network_topology_hash(uuid) IS
  'DEPRECATED (WP 5.3, §4 D75) and UNCALLED in the repository since WP 10.1 (D240): '
  'kept only for the deploy window in which the published analyzers still call it. '
  'Dropped by WP 10.4.';

SELECT pg_notify('pgrst', 'reload schema');
