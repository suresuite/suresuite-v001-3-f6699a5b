-- Profile / §4 D305 — deleting a deep-tier dataset no longer times out: the project's
-- completion flag is recomputed once per STATEMENT on the three deep-tier tables, not once
-- per row.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- Owner-reported: the trash button on the Deep Edges tab "does not work". The delete itself
-- is one statement (`delete_project_dataset` → `DELETE FROM network_edges WHERE project_id`),
-- but `network_edges`, `network_nodes` and `network_summary` each still carry the 2025
-- FOR EACH ROW trigger `update_completion_on_<table>_change`, which runs
-- `update_project_completion_status()` for EVERY row: six EXISTS probes and an UPDATE of the
-- same `projects` row, so N rows write N versions of one row in one transaction. Measured on
-- a local PostgreSQL 16 with this repository's schema, deleting a project's deep edges as
-- `anon`:
--
--     2 000 edges   0.73 s        8 000 edges   5.25 s        20 000 edges   26.99 s
--
-- and 0.02 / 0.08 / 0.21 s with that one trigger disabled. The browser calls as `anon`
-- (D155), whose statement timeout on Supabase is 3 s, so a deep-tier network above roughly
-- five thousand edges could not be emptied by anyone — the statement was cancelled and
-- nothing was deleted. Uploading a large deep-tier network pays the same cost.
--
-- `20260712100000` fixed exactly this for the five lane tables (statement-level triggers over
-- transition tables) and did not touch the three deep-tier ones.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `_project_completion_refresh(pid)` — the body of `update_project_completion_status()`
--     (`20250908063902`), MOVED into a function of the project id. Its rule is unchanged:
--     BOM, inbound and outbound, plus deep-tier nodes and edges when the project has deep
--     tier enabled.
--   · `update_project_completion_status()` (the trigger function) now calls it, so the row
--     trigger and the statement trigger share one body rather than two copies.
--   · `_project_completion_touch()` — a statement trigger function: one refresh per DISTINCT
--     project id in the statement's transition table.
--   · On `network_nodes`, `network_edges` and `network_summary`: the row trigger is dropped
--     and `completion_touch_ins` / `_upd` / `_del` replace it. Written as static SQL rather
--     than `20260712100000`'s `EXECUTE format(...)`, so the introspector and
--     `live-sql.mjs` can see them.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- The flag means what it meant. `recompute_project_completion` (`20260712100000`, the lane
-- tables' statement body) still requires multi-tier data and ignores deep tier — a second,
-- disagreeing definition of `projects.completed` that predates this and is left alone: the
-- page computes completeness itself and does not read the column for its checklist.

-- ── 1 · one body ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._project_completion_refresh(pid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  has_bom BOOLEAN;
  has_inbound BOOLEAN;
  has_outbound BOOLEAN;
  has_deep_tier_nodes BOOLEAN;
  has_deep_tier_edges BOOLEAN;
  deep_tier_enabled BOOLEAN;
BEGIN
  IF pid IS NULL THEN RETURN; END IF;

  -- Get deep tier setting for this project
  SELECT p.deep_tier_enabled INTO deep_tier_enabled
  FROM public.projects p
  WHERE p.id = pid;

  -- Check if BOM exists (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid)
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;

  -- If deep tier is enabled, check for deep tier datasets (nodes + edges only)
  IF deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = pid) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = pid) INTO has_deep_tier_edges;

    -- Update completion status without network_summary requirement
    UPDATE public.projects
    SET completed = (has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges),
        updated_at = now()
    WHERE id = pid;
  ELSE
    -- Update completion status without deep tier requirements
    UPDATE public.projects
    SET completed = (has_bom AND has_inbound AND has_outbound),
        updated_at = now()
    WHERE id = pid;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._project_completion_refresh(uuid) FROM PUBLIC, anon, authenticated;

-- The row-trigger function keeps its name and signature (the lane tables' 2025 triggers may
-- still call it) and delegates.
CREATE OR REPLACE FUNCTION public.update_project_completion_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._project_completion_refresh(COALESCE(NEW.project_id, OLD.project_id));
  RETURN NULL;
END;
$function$;

-- ── 2 · once per statement ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._project_completion_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
BEGIN
  FOR pid IN SELECT DISTINCT project_id FROM affected LOOP
    PERFORM public._project_completion_refresh(pid);
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._project_completion_touch() FROM PUBLIC, anon, authenticated;

-- ── 3 · the three deep-tier tables ───────────────────────────────────────────
DROP TRIGGER IF EXISTS update_completion_on_network_nodes_change ON public.network_nodes;
DROP TRIGGER IF EXISTS completion_touch_ins ON public.network_nodes;
DROP TRIGGER IF EXISTS completion_touch_upd ON public.network_nodes;
DROP TRIGGER IF EXISTS completion_touch_del ON public.network_nodes;
CREATE TRIGGER completion_touch_ins AFTER INSERT ON public.network_nodes
  REFERENCING NEW TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
CREATE TRIGGER completion_touch_upd AFTER UPDATE ON public.network_nodes
  REFERENCING NEW TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
CREATE TRIGGER completion_touch_del AFTER DELETE ON public.network_nodes
  REFERENCING OLD TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();

DROP TRIGGER IF EXISTS update_completion_on_network_edges_change ON public.network_edges;
DROP TRIGGER IF EXISTS completion_touch_ins ON public.network_edges;
DROP TRIGGER IF EXISTS completion_touch_upd ON public.network_edges;
DROP TRIGGER IF EXISTS completion_touch_del ON public.network_edges;
CREATE TRIGGER completion_touch_ins AFTER INSERT ON public.network_edges
  REFERENCING NEW TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
CREATE TRIGGER completion_touch_upd AFTER UPDATE ON public.network_edges
  REFERENCING NEW TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
CREATE TRIGGER completion_touch_del AFTER DELETE ON public.network_edges
  REFERENCING OLD TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();

DROP TRIGGER IF EXISTS update_completion_on_network_summary_change ON public.network_summary;
DROP TRIGGER IF EXISTS completion_touch_ins ON public.network_summary;
DROP TRIGGER IF EXISTS completion_touch_upd ON public.network_summary;
DROP TRIGGER IF EXISTS completion_touch_del ON public.network_summary;
CREATE TRIGGER completion_touch_ins AFTER INSERT ON public.network_summary
  REFERENCING NEW TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
CREATE TRIGGER completion_touch_upd AFTER UPDATE ON public.network_summary
  REFERENCING NEW TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
CREATE TRIGGER completion_touch_del AFTER DELETE ON public.network_summary
  REFERENCING OLD TABLE AS affected FOR EACH STATEMENT EXECUTE FUNCTION public._project_completion_touch();
