-- Phase B0 / §8: arc-table write performance — statement-level completion
-- triggers + project_id indexes.
--
-- The completion-status trigger (update_project_completion_status) has been
-- FOR EACH ROW on all five dataset tables since 20250820145837: every row of
-- a bulk upload fires 4 EXISTS probes + an UPDATE of the projects row. A
-- 1,000-row CSV upload = 1,000 full recomputes and 1,000 projects-row
-- updates; the TRON ver2 seed (1,173 arcs) hit PostgREST's statement timeout
-- on this path (SQLSTATE 57014). The recompute depends only on the project
-- id, so per-row firing is pure amplification.
--
-- Fix, in two independent halves:
--   1. project_id indexes (IF NOT EXISTS) on the five dataset tables — the
--      EXISTS probes and the per-project DELETEs (delete_project_dataset)
--      stop scanning other projects' rows.
--   2. The row-level completion triggers become statement-level triggers
--      with transition tables: one recompute per affected project per
--      STATEMENT, regardless of row count. Semantics are identical — the old
--      row trigger ignored row content and recomputed from the tables.

-- ── 1. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS inbound_logistics_project_idx  ON public.inbound_logistics(project_id);
CREATE INDEX IF NOT EXISTS outbound_logistics_project_idx ON public.outbound_logistics(project_id);
CREATE INDEX IF NOT EXISTS bom_single_level_project_idx   ON public.bom_single_level(project_id);
CREATE INDEX IF NOT EXISTS bom_multi_level_project_idx    ON public.bom_multi_level(project_id);
CREATE INDEX IF NOT EXISTS multi_tier_project_idx         ON public.multi_tier_supply_chain(project_id);

-- ── 2. Statement-level completion recompute ──────────────────────────────────
-- One shared body: recompute completion for one project id.
CREATE OR REPLACE FUNCTION public.recompute_project_completion(pid uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  has_bom BOOLEAN; has_inbound BOOLEAN; has_outbound BOOLEAN; has_multi BOOLEAN;
BEGIN
  IF pid IS NULL THEN RETURN; END IF;
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid)
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)
  ) INTO has_bom;
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics  WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;
  SELECT EXISTS(SELECT 1 FROM public.multi_tier_supply_chain WHERE project_id = pid) INTO has_multi;

  UPDATE public.projects
  SET completed = (has_bom AND has_inbound AND has_outbound AND has_multi),
      updated_at = now()
  WHERE id = pid;
END;
$$;

-- Statement-trigger wrapper: recompute once per DISTINCT project id in the
-- statement's transition table ("affected" — bound below per trigger event).
CREATE OR REPLACE FUNCTION public.update_project_completion_stmt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  FOR pid IN SELECT DISTINCT project_id FROM affected LOOP
    PERFORM public.recompute_project_completion(pid);
  END LOOP;
  RETURN NULL;
END;
$$;

-- Swap the row-level triggers for statement-level ones on all five tables.
DO $$
DECLARE
  t text;
  legacy_trigger text;
BEGIN
  FOR t, legacy_trigger IN SELECT * FROM (VALUES
    ('bom_single_level',        'bom_sl_completion'),
    ('bom_multi_level',         'bom_ml_completion'),
    ('inbound_logistics',       'inbound_completion'),
    ('outbound_logistics',      'outbound_completion'),
    ('multi_tier_supply_chain', 'multi_tier_completion')
  ) AS v(tbl, trg) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', legacy_trigger, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', legacy_trigger || '_ins', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', legacy_trigger || '_upd', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', legacy_trigger || '_del', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON public.%I '
      'REFERENCING NEW TABLE AS affected '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.update_project_completion_stmt()',
      legacy_trigger || '_ins', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON public.%I '
      'REFERENCING NEW TABLE AS affected '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.update_project_completion_stmt()',
      legacy_trigger || '_upd', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON public.%I '
      'REFERENCING OLD TABLE AS affected '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.update_project_completion_stmt()',
      legacy_trigger || '_del', t);
  END LOOP;
END;
$$;
