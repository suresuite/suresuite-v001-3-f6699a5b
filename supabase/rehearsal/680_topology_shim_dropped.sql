-- Phase 11 / WP 11.5 · §4 D240 — THE LAST DEPLOY-WINDOW SHIM IS GONE, AND NOTHING
-- IN THE DATABASE STILL NAMES IT.
--
-- `20261001000023` drops `network_topology_hash`. A drop is only safe if nothing
-- calls the function, and PostgreSQL does not track a PL/pgSQL body's calls in
-- `pg_depend`: a function that still called it would be created happily and fail
-- at its first run, in production, inside somebody's analysis. So §2 reads every
-- function body and view definition in `public` for the name.

DO $d240$
DECLARE
  v_n     integer;
  v_names text;
BEGIN
  -- ══ §1 · the shim is gone ══
  IF to_regprocedure('public.network_topology_hash(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'D240/680 §1: `network_topology_hash(uuid)` still exists — the last deploy-window shim was not dropped';
  END IF;

  -- ══ §2 · nothing in the database names it ══
  SELECT count(*), string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_n, v_names
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ILIKE '%network_topology_hash%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D240/680 §2: % function(s) still call `network_topology_hash` and will fail at their first run: %', v_n, v_names;
  END IF;

  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_n, v_names
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('v', 'm')
     AND pg_get_viewdef(c.oid) ILIKE '%network_topology_hash%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D240/680 §2: % view(s) still name `network_topology_hash`: %', v_n, v_names;
  END IF;

  RAISE NOTICE 'D240/680: `network_topology_hash` is dropped and no function body or view in public names it';
END $d240$;
