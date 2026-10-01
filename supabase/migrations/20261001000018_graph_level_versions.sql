-- ============================================================================
-- Phase 11 / WP 11.1 · blueprint §8.4 · gate `single-source` · §4 D257
-- A VERSION PER LEVEL.
--
-- WP 10.1 gave the graph three named levels — product, process, firm — and a HASH
-- for each, stored on every `dataset_versions` row. It numbered only the
-- composite. So "Product graph v3" was not a sentence the system could produce,
-- and the product page named the composite: a deep-tier upload (firm only) made
-- it read "Graph unsaved" and then a new number although nothing it shows moved.
--
--   1. `graph_level_versions` — one row per (project, level, content): the FIRST
--      time a project's level had that hash. Numbered per project PER LEVEL, so a
--      change to one level moves that level's number and no other, and a revert
--      returns the earlier number (deduplicated against ANY earlier version of the
--      level, as WP 10.1 does for the composite). Immutable by trigger.
--   2. Registration is a TRIGGER on `dataset_versions`, so every capture point WP
--      10.1 built — dispatch, the promotion, combine, the deep-tier capture, an
--      analysis claim — registers levels for free and there is no second capture
--      path to forget. The snapshot learns its TUPLE (`product_version_id`,
--      `process_version_id`, `firm_version_id`): a snapshot IS its level versions.
--   3. Backfill, in history order per project, so numbers follow history.
--   4. `get_graph_version_state` returns each level's version beside the
--      composite — one read, as D233 requires.
--
-- WHAT IT DOES NOT DO. It moves no hash: the levels are WP 10.1's, `level_spec`
-- stays 1, and the composite is untouched. The fourth level the CHECK admits,
-- `simulation`, is WP 11.2's to register — the scope is NAMED there (its hash is
-- the snapshot's `inputs` domain digest), and the vocabulary is admitted here so
-- the table does not need a second migration to learn it.
--
-- `dataset_versions` is NOT made immutable by this package. It is immutable by
-- convention (`snapshot_dataset` itself fills NULL level hashes on an old row), and
-- the registration below writes the tuple onto the row it registers — so a
-- trigger refusing every UPDATE would refuse this package's own writer (§16 · WP
-- 11.0 recorded the brief's claim otherwise).
-- ============================================================================

-- ── 1 · the store ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.graph_level_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  level                    text NOT NULL CHECK (level IN ('product', 'process', 'firm', 'simulation')),
  level_hash               text NOT NULL,
  version_no               integer NOT NULL,
  level_spec               integer,
  first_dataset_version_id uuid REFERENCES public.dataset_versions(id) ON DELETE SET NULL,
  author_user_id           uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_level_versions_content_key UNIQUE (project_id, level, level_hash),
  CONSTRAINT graph_level_versions_number_key  UNIQUE (project_id, level, version_no)
);

COMMENT ON TABLE public.graph_level_versions IS
  'WP 11.1 · §4 D257. One row per (project, level, content): the first time a '
  'project''s product, process, firm or simulation level had that hash, numbered '
  'per project PER LEVEL ("Product graph v3"). Registered from `dataset_versions` '
  'by trigger, deduplicated against any earlier version of the level, immutable.';

ALTER TABLE public.graph_level_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.graph_level_versions TO anon, authenticated, service_role;
DROP POLICY IF EXISTS graph_level_versions_select ON public.graph_level_versions;
CREATE POLICY graph_level_versions_select ON public.graph_level_versions
  FOR SELECT USING (public.has_project_access(project_id));

DROP TRIGGER IF EXISTS audit_graph_level_versions_insert ON public.graph_level_versions;
CREATE TRIGGER audit_graph_level_versions_insert AFTER INSERT ON public.graph_level_versions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_graph_level_versions_update ON public.graph_level_versions;
CREATE TRIGGER audit_graph_level_versions_update AFTER UPDATE ON public.graph_level_versions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_graph_level_versions_delete ON public.graph_level_versions;
CREATE TRIGGER audit_graph_level_versions_delete AFTER DELETE ON public.graph_level_versions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

-- Numbered per project PER LEVEL, on insert, under the same key the registration
-- takes — so a direct insert numbers too, and two registrations of one level
-- cannot both read the same max.
CREATE OR REPLACE FUNCTION public._graph_level_versions_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.version_no IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'graph_level_versions:' || NEW.project_id::text || ':' || NEW.level, 0));
  SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no
    FROM public.graph_level_versions
   WHERE project_id = NEW.project_id AND level = NEW.level;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_versions_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS graph_level_versions_number ON public.graph_level_versions;
CREATE TRIGGER graph_level_versions_number
  BEFORE INSERT ON public.graph_level_versions
  FOR EACH ROW EXECUTE FUNCTION public._graph_level_versions_number();

-- Immutable. The one change a row may take is the cascade that forgets its first
-- snapshot when that snapshot is deleted (`ON DELETE SET NULL`) — the content and
-- its number stay true of the project whichever snapshot first carried them.
CREATE OR REPLACE FUNCTION public._graph_level_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'first_dataset_version_id') IS DISTINCT FROM (to_jsonb(OLD) - 'first_dataset_version_id')
     OR (NEW.first_dataset_version_id IS NOT NULL
         AND NEW.first_dataset_version_id IS DISTINCT FROM OLD.first_dataset_version_id) THEN
    RAISE EXCEPTION 'graph_level_versions: a level version is immutable (WP 11.1)'
      USING ERRCODE = 'P0A02';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_versions_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS graph_level_versions_immutable ON public.graph_level_versions;
CREATE TRIGGER graph_level_versions_immutable
  BEFORE UPDATE ON public.graph_level_versions
  FOR EACH ROW EXECUTE FUNCTION public._graph_level_versions_immutable();

-- ── 2 · a snapshot IS its tuple — and only a snapshot function writes one ───
--
-- §4 D264. `dataset_versions` has carried `dataset_versions_insert_all` (`FOR
-- INSERT … WITH CHECK (true)`) and an INSERT grant to `anon` and `authenticated`
-- since `20260703000001`. WP 2.4 measured it and pinned it rather than change it,
-- because the app runs as `anon`. But no path in the app, the edge functions or
-- the worker inserts a snapshot row directly — every writer is `snapshot_dataset`
-- (SECURITY DEFINER) or the service role — and from this package on a planted row
-- would not only carry any hash it liked (and so be what `snapshot_dataset`
-- dedupes onto, and what a run then binds to): it would mint LEVEL versions too.
-- The door is closed where it is opened, by the package that widened what it reaches.
DROP POLICY IF EXISTS "dataset_versions_insert_all" ON public.dataset_versions;
REVOKE INSERT ON public.dataset_versions FROM anon, authenticated;


ALTER TABLE public.dataset_versions
  ADD COLUMN IF NOT EXISTS product_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS process_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS firm_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL;

-- Register one snapshot's levels: for each level hash the row carries, the level
-- version of that content — the existing one when the project's level ever had it
-- (ANY earlier version, not the latest), a new numbered row otherwise — and write
-- the tuple onto the snapshot. A NULL level hash (firm before snapshot v3; every
-- level before WP 4.1) registers nothing and leaves that id NULL: an absence the
-- snapshot cannot support is not a version.
--
-- A derivation inside somebody else's statement: it names WHO and decides nothing.
-- The statement that froze the snapshot has set its actor; when it has not (a
-- backfill, a direct insert), the snapshot's own author is the actor.
CREATE OR REPLACE FUNCTION public._graph_level_register(p_dataset_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  dv     public.dataset_versions%ROWTYPE;
  v_spec integer := (public._dataset_level_hashes('{}'::jsonb) ->> 'level_spec')::int;
  v_ids  jsonb := '{}'::jsonb;
  v_lvl  text;
  v_hash text;
  v_id   uuid;
BEGIN
  SELECT * INTO dv FROM public.dataset_versions WHERE id = p_dataset_version_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF COALESCE(current_setting('app.current_user_id', true), '') = '' AND dv.author_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', dv.author_user_id::text, true);
  END IF;

  FOR v_lvl, v_hash IN
    SELECT l, h FROM (VALUES (1, 'product', dv.hash_product),
                             (2, 'process', dv.hash_process),
                             (3, 'firm',    dv.hash_firm)) x(o, l, h)
     ORDER BY o
  LOOP
    CONTINUE WHEN v_hash IS NULL;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'graph_level_versions:' || dv.project_id::text || ':' || v_lvl, 0));
    SELECT id INTO v_id FROM public.graph_level_versions
     WHERE project_id = dv.project_id AND level = v_lvl AND level_hash = v_hash;
    IF NOT FOUND THEN
      INSERT INTO public.graph_level_versions
        (project_id, level, level_hash, level_spec, first_dataset_version_id, author_user_id, created_at)
      VALUES
        (dv.project_id, v_lvl, v_hash, v_spec, dv.id, dv.author_user_id, dv.created_at)
      RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_object(v_lvl, v_id);
  END LOOP;

  UPDATE public.dataset_versions
     SET product_version_id = (v_ids ->> 'product')::uuid,
         process_version_id = (v_ids ->> 'process')::uuid,
         firm_version_id    = (v_ids ->> 'firm')::uuid
   WHERE id = dv.id
     AND (product_version_id IS DISTINCT FROM (v_ids ->> 'product')::uuid
       OR process_version_id IS DISTINCT FROM (v_ids ->> 'process')::uuid
       OR firm_version_id    IS DISTINCT FROM (v_ids ->> 'firm')::uuid);
END;
$$;
-- Internal (§4 D248): no API role may mint a level version — the snapshot does.
REVOKE ALL ON FUNCTION public._graph_level_register(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._graph_level_register_snapshot()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._graph_level_register(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_register_snapshot() FROM PUBLIC, anon, authenticated;

-- Two events, two triggers: the insert every capture point makes, and the UPDATE
-- `snapshot_dataset` makes when a row frozen before WP 10.1 learns its level hashes.
-- The tuple write above sets no hash column, so it does not re-fire either.
DROP TRIGGER IF EXISTS dataset_versions_register_levels_ins ON public.dataset_versions;
CREATE TRIGGER dataset_versions_register_levels_ins
  AFTER INSERT ON public.dataset_versions
  FOR EACH ROW EXECUTE FUNCTION public._graph_level_register_snapshot();
DROP TRIGGER IF EXISTS dataset_versions_register_levels_upd ON public.dataset_versions;
CREATE TRIGGER dataset_versions_register_levels_upd
  AFTER UPDATE OF hash_product, hash_process, hash_firm ON public.dataset_versions
  FOR EACH ROW
  WHEN (NEW.hash_product IS DISTINCT FROM OLD.hash_product
     OR NEW.hash_process IS DISTINCT FROM OLD.hash_process
     OR NEW.hash_firm    IS DISTINCT FROM OLD.hash_firm)
  EXECUTE FUNCTION public._graph_level_register_snapshot();

-- ── 3 · backfill, in history order ───────────────────────────────────────
--
-- Per project, oldest snapshot first, so "Product graph v1" is the first product
-- content the project ever froze. Each call is the trigger's own function, so the
-- backfill cannot number by a rule the live path does not use. A FUNCTION rather
-- than a `DO` block so `rehearsal/650` §7 runs the code this migration ran, on a
-- planted history, instead of a copy of it.
CREATE OR REPLACE FUNCTION public._graph_level_backfill(p_project_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r   record;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.dataset_versions
            WHERE p_project_id IS NULL OR project_id = p_project_id
            ORDER BY project_id, created_at, id LOOP
    PERFORM public._graph_level_register(r.id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_backfill(uuid) FROM PUBLIC, anon, authenticated;

SELECT public._graph_level_backfill();

-- ── 4 · the state, per level ─────────────────────────────────────────────

-- One level's state: the version the live hash IS (null when unsaved), the latest
-- version, how many there are, and whether the live content is unsaved.
CREATE OR REPLACE FUNCTION public._graph_level_state(p_project_id uuid, p_level text, p_hash text)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'level', p_level,
    'hash', p_hash,
    'current_version', (
      SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'created_at', g.created_at)
        FROM public.graph_level_versions g
       WHERE g.project_id = p_project_id AND g.level = p_level AND g.level_hash = p_hash),
    'latest_version', (
      SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'level_hash', g.level_hash,
                                'created_at', g.created_at)
        FROM public.graph_level_versions g
       WHERE g.project_id = p_project_id AND g.level = p_level
       ORDER BY g.version_no DESC LIMIT 1),
    'version_count', (
      SELECT count(*) FROM public.graph_level_versions g
       WHERE g.project_id = p_project_id AND g.level = p_level),
    'unsaved', p_hash IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.graph_level_versions g
       WHERE g.project_id = p_project_id AND g.level = p_level AND g.level_hash = p_hash));
$$;
REVOKE ALL ON FUNCTION public._graph_level_state(uuid, text, text) FROM PUBLIC, anon, authenticated;

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
        'product_version_id', v_lat.product_version_id,
        'process_version_id', v_lat.process_version_id,
        'firm_version_id', v_lat.firm_version_id,
        'author_email', v_lat.author_email, 'created_at', v_lat.created_at) END,
    'version_count', v_n,
    -- WP 11.1 · §4 D257 — each level's own version, from the same stored hashes.
    'levels', jsonb_build_object(
      'product', public._graph_level_state(p_project_id, 'product', v_h ->> 'hash_product'),
      'process', public._graph_level_state(p_project_id, 'process', v_h ->> 'hash_process'),
      'firm',    public._graph_level_state(p_project_id, 'firm',    v_h ->> 'hash_firm')));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_graph_version_state(uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
