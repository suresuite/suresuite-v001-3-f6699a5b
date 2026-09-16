-- Phase 2 / WP 2.3 / PLAN.md §9 — THE DATA-PLANE AUDIT (D15).
--
-- `admin_audit_logs` records what a SUPER ADMIN did. Nothing records what anyone
-- else did to the data. WP 2.3's own gap check measured it: **22 live SQL
-- functions write tier 2, 3 or 4, and none of them emits an audit row** — plus six
-- more write paths in edge functions running as the service role. Every promote,
-- every ETL run, every override write and every dataset delete is unattributable.
-- That is `audit-actor` (§2.1 G4) having no implementation at all, and it is what
-- `audited: false` on every sidecar has been honestly recording.
--
-- WHY TRIGGERS AND NOT 22 EDITED FUNCTIONS. Instrumenting each RPC would be the
-- obvious reading of "emit on every tier transition", and it would be wrong twice:
-- it is 22 function bodies to reproduce exactly (the WP 2.1 lesson about how large
-- that diff gets), and it would still miss the SERVICE-ROLE writers — the ingest
-- and ETL edge functions go straight to the table and never call an RPC. A trigger
-- on the table catches every writer that exists and every writer added later,
-- which is the difference between a rule and a list.
--
-- STATEMENT-LEVEL, NOT ROW-LEVEL, and this is the load-bearing detail. A row-level
-- trigger on `bulk_insert_inbound_logistics` would write one audit row per uploaded
-- lane — tens of thousands for one upload, and an audit log nobody can read is the
-- same as no audit log. Postgres transition tables (`REFERENCING NEW TABLE`) give
-- one row per STATEMENT with the row count in it, which is the grain a reader
-- actually wants: "Dana replaced 8,412 inbound lanes at 14:02", not 8,412 lines.
--
-- WHAT THIS CANNOT DO, said here rather than discovered later: a trigger sees the
-- actor only when the caller set `app.current_user_id`. A service-role write with
-- no session context records `actor_user_id: NULL` — the row still says WHAT
-- happened and WHEN, and is explicit that WHO is unknown. That is worth having and
-- it is not the same as attribution. Closing it means the ingest functions setting
-- user context, which is their own change, not this one (§16).

-- ── 1. generalize admin_audit_logs -> audit_logs ─────────────────────────────
-- A RENAME, not a new table: "admin history intact" is one of this package's exit
-- checks, and copying rows into a second table is how history stops being intact.
-- The column shape is unchanged; `plane` is added beside it.

ALTER TABLE IF EXISTS public.admin_audit_logs RENAME TO audit_logs;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS plane text NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_plane_known') THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_plane_known CHECK (plane IN ('admin','data','access'));
  END IF;
END $$;

-- Every row that existed before this migration was written by log_admin_action(),
-- which refuses a non-super-admin. They are all admin-plane by construction; the
-- column default records that rather than a backfill guessing at it.
UPDATE public.audit_logs SET plane = 'admin' WHERE plane IS NULL;

CREATE INDEX IF NOT EXISTS audit_logs_plane_created_idx
  ON public.audit_logs (plane, created_at DESC);

-- A transition shim. Migrations deploy on push; the frontend (Vercel) and the edge
-- functions (supabase-functions.yml) deploy on their own schedules, so there is a
-- window in which the table has been renamed and code still asks for the old name.
-- The view closes that window. It is not a permanent alias: the two call sites are
-- moved in this same change, and the view is dropped by whoever removes the last
-- reader (§16 names it).
CREATE OR REPLACE VIEW public.admin_audit_logs AS
  SELECT id, actor_user_id, action, target_type, target_id, before, after, ip, user_agent, created_at
    FROM public.audit_logs
   WHERE plane = 'admin';
GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated, anon, service_role;

-- ── 2. who may read which plane ──────────────────────────────────────────────
-- The admin plane stays super-admin-only, exactly as before. The data and access
-- planes are readable by an ADMIN OF THE SAME ORGANIZATION as the actor, which is
-- what §9 asks for. No column is added to do it: the actor's org is reachable
-- through `approved_users`, so "same column shape" holds.
--
-- NOTE ON D28: these are PERMISSIVE policies and therefore OR together. That is
-- correct HERE and it is worth saying why, because the same shape was a defect on
-- `approved_users`: each policy below grants a DISJOINT slice (super admin sees
-- everything; an org admin sees their own org's non-admin rows), so OR is the
-- intended union rather than an accidental escape hatch. There is no write policy —
-- audit rows are written by SECURITY DEFINER functions and by triggers, never by a
-- client, and RLS denying writes by default is the enforcement (WP 2.2's pattern).

DROP POLICY IF EXISTS "audit: super read" ON public.audit_logs;
CREATE POLICY "audit: super read" ON public.audit_logs
  FOR SELECT USING (public.current_is_super_admin());

DROP POLICY IF EXISTS "audit: org admins read their own org's data and access rows" ON public.audit_logs;
CREATE POLICY "audit: org admins read their own org's data and access rows" ON public.audit_logs
  FOR SELECT USING (
    plane IN ('data','access')
    AND EXISTS (
      SELECT 1
        FROM public.approved_users me
        JOIN public.approved_users actor ON actor.id = audit_logs.actor_user_id
       WHERE me.id = public.get_current_user_id()
         AND me.role = 'admin'::public.app_role
         AND me.organization_id IS NOT NULL
         AND me.organization_id = actor.organization_id
    )
  );

-- ── 3. the data/access emit ──────────────────────────────────────────────────
-- log_admin_action() CANNOT be reused and this is not a style preference: it opens
-- with `IF NOT is_super_admin(actor) THEN RAISE EXCEPTION 'forbidden'`. Data-plane
-- rows are by definition written by ordinary users doing ordinary work, so routing
-- them through it would make every T2 write fail for everyone who is not a super
-- admin. A separate emit is required, and it takes its actor EXPLICITLY, as
-- capabilities_for_user() and get_current_user_org_id() do.

CREATE OR REPLACE FUNCTION public.log_data_action(
  _actor_user_id uuid,
  _plane         text,
  _action        text,
  _target_type   text,
  _target_id     text,
  _before        jsonb DEFAULT NULL,
  _after         jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF _plane NOT IN ('data','access') THEN
    RAISE EXCEPTION 'log_data_action handles the data and access planes; % goes through log_admin_action', _plane
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, before, after)
  VALUES (_plane, _actor_user_id, _action, _target_type, _target_id, _before, _after)
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.log_data_action(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_data_action(uuid,text,text,text,text,jsonb,jsonb) TO service_role;

-- ── 4. the trigger that makes the coverage complete ──────────────────────────

CREATE OR REPLACE FUNCTION public.audit_tier_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n_new integer := 0;
  n_old integer := 0;
  actor uuid;
BEGIN
  actor := public.get_current_user_id();

  IF TG_OP IN ('INSERT','UPDATE') THEN SELECT count(*) INTO n_new FROM new_rows; END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN SELECT count(*) INTO n_old FROM old_rows; END IF;

  -- A statement that touched nothing is not a tier transition.
  IF GREATEST(n_new, n_old) = 0 THEN RETURN NULL; END IF;

  INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
  VALUES ('data', actor, lower(TG_OP), TG_TABLE_NAME, NULL,
          jsonb_build_object(
            'tier', TG_ARGV[0],
            'rows_after',  n_new,
            'rows_before', n_old,
            -- said in the row rather than inferred from a NULL actor later
            'actor_known', actor IS NOT NULL));
  RETURN NULL;
END; $$;
COMMENT ON FUNCTION public.audit_tier_write() IS
  'Statement-level audit for every tier 2/3/4 write. One row per STATEMENT with a '
  'row count, not one per row: a bulk upload would otherwise write tens of '
  'thousands of audit rows and an audit log nobody can read is no audit log.';

-- ── 5. the triggers, one set per tier 2/3/4 table ────────────────────────────
-- Written out rather than looped through EXECUTE format(...): WP 1.4 found that a
-- FOREACH loop is invisible to the introspector, which is how three tables ended up
-- with `rls.determinate: false`. Verbose and readable beats clever and unreadable.

-- bom_multi_level (tier 2)
DROP TRIGGER IF EXISTS audit_bom_multi_level_insert ON public.bom_multi_level;
CREATE TRIGGER audit_bom_multi_level_insert AFTER INSERT ON public.bom_multi_level
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_bom_multi_level_update ON public.bom_multi_level;
CREATE TRIGGER audit_bom_multi_level_update AFTER UPDATE ON public.bom_multi_level
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_bom_multi_level_delete ON public.bom_multi_level;
CREATE TRIGGER audit_bom_multi_level_delete AFTER DELETE ON public.bom_multi_level
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- bom_single_level (tier 2)
DROP TRIGGER IF EXISTS audit_bom_single_level_insert ON public.bom_single_level;
CREATE TRIGGER audit_bom_single_level_insert AFTER INSERT ON public.bom_single_level
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_bom_single_level_update ON public.bom_single_level;
CREATE TRIGGER audit_bom_single_level_update AFTER UPDATE ON public.bom_single_level
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_bom_single_level_delete ON public.bom_single_level;
CREATE TRIGGER audit_bom_single_level_delete AFTER DELETE ON public.bom_single_level
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- dataset_versions (tier 3)
DROP TRIGGER IF EXISTS audit_dataset_versions_insert ON public.dataset_versions;
CREATE TRIGGER audit_dataset_versions_insert AFTER INSERT ON public.dataset_versions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_dataset_versions_update ON public.dataset_versions;
CREATE TRIGGER audit_dataset_versions_update AFTER UPDATE ON public.dataset_versions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_dataset_versions_delete ON public.dataset_versions;
CREATE TRIGGER audit_dataset_versions_delete AFTER DELETE ON public.dataset_versions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

-- inbound_logistics (tier 2)
DROP TRIGGER IF EXISTS audit_inbound_logistics_insert ON public.inbound_logistics;
CREATE TRIGGER audit_inbound_logistics_insert AFTER INSERT ON public.inbound_logistics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_inbound_logistics_update ON public.inbound_logistics;
CREATE TRIGGER audit_inbound_logistics_update AFTER UPDATE ON public.inbound_logistics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_inbound_logistics_delete ON public.inbound_logistics;
CREATE TRIGGER audit_inbound_logistics_delete AFTER DELETE ON public.inbound_logistics
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- materials (tier 2)
DROP TRIGGER IF EXISTS audit_materials_insert ON public.materials;
CREATE TRIGGER audit_materials_insert AFTER INSERT ON public.materials
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_materials_update ON public.materials;
CREATE TRIGGER audit_materials_update AFTER UPDATE ON public.materials
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_materials_delete ON public.materials;
CREATE TRIGGER audit_materials_delete AFTER DELETE ON public.materials
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- outbound_logistics (tier 2)
DROP TRIGGER IF EXISTS audit_outbound_logistics_insert ON public.outbound_logistics;
CREATE TRIGGER audit_outbound_logistics_insert AFTER INSERT ON public.outbound_logistics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_outbound_logistics_update ON public.outbound_logistics;
CREATE TRIGGER audit_outbound_logistics_update AFTER UPDATE ON public.outbound_logistics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_outbound_logistics_delete ON public.outbound_logistics;
CREATE TRIGGER audit_outbound_logistics_delete AFTER DELETE ON public.outbound_logistics
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- policy_defaults (tier 4)
DROP TRIGGER IF EXISTS audit_policy_defaults_insert ON public.policy_defaults;
CREATE TRIGGER audit_policy_defaults_insert AFTER INSERT ON public.policy_defaults
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_defaults_update ON public.policy_defaults;
CREATE TRIGGER audit_policy_defaults_update AFTER UPDATE ON public.policy_defaults
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_defaults_delete ON public.policy_defaults;
CREATE TRIGGER audit_policy_defaults_delete AFTER DELETE ON public.policy_defaults
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- policy_overrides (tier 4)
DROP TRIGGER IF EXISTS audit_policy_overrides_insert ON public.policy_overrides;
CREATE TRIGGER audit_policy_overrides_insert AFTER INSERT ON public.policy_overrides
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_overrides_update ON public.policy_overrides;
CREATE TRIGGER audit_policy_overrides_update AFTER UPDATE ON public.policy_overrides
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_overrides_delete ON public.policy_overrides;
CREATE TRIGGER audit_policy_overrides_delete AFTER DELETE ON public.policy_overrides
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- products (tier 2)
DROP TRIGGER IF EXISTS audit_products_insert ON public.products;
CREATE TRIGGER audit_products_insert AFTER INSERT ON public.products
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_products_update ON public.products;
CREATE TRIGGER audit_products_update AFTER UPDATE ON public.products
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_products_delete ON public.products;
CREATE TRIGGER audit_products_delete AFTER DELETE ON public.products
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- suppliers (tier 2)
DROP TRIGGER IF EXISTS audit_suppliers_insert ON public.suppliers;
CREATE TRIGGER audit_suppliers_insert AFTER INSERT ON public.suppliers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_suppliers_update ON public.suppliers;
CREATE TRIGGER audit_suppliers_update AFTER UPDATE ON public.suppliers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_suppliers_delete ON public.suppliers;
CREATE TRIGGER audit_suppliers_delete AFTER DELETE ON public.suppliers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- supply_chain_data (tier 3)
DROP TRIGGER IF EXISTS audit_supply_chain_data_insert ON public.supply_chain_data;
CREATE TRIGGER audit_supply_chain_data_insert AFTER INSERT ON public.supply_chain_data
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_supply_chain_data_update ON public.supply_chain_data;
CREATE TRIGGER audit_supply_chain_data_update AFTER UPDATE ON public.supply_chain_data
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_supply_chain_data_delete ON public.supply_chain_data;
CREATE TRIGGER audit_supply_chain_data_delete AFTER DELETE ON public.supply_chain_data
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');

-- supply_chain_data_multi_tier (tier 3)
DROP TRIGGER IF EXISTS audit_supply_chain_data_multi_tier_insert ON public.supply_chain_data_multi_tier;
CREATE TRIGGER audit_supply_chain_data_multi_tier_insert AFTER INSERT ON public.supply_chain_data_multi_tier
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_supply_chain_data_multi_tier_update ON public.supply_chain_data_multi_tier;
CREATE TRIGGER audit_supply_chain_data_multi_tier_update AFTER UPDATE ON public.supply_chain_data_multi_tier
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
DROP TRIGGER IF EXISTS audit_supply_chain_data_multi_tier_delete ON public.supply_chain_data_multi_tier;
CREATE TRIGGER audit_supply_chain_data_multi_tier_delete AFTER DELETE ON public.supply_chain_data_multi_tier
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('3');
-- ── 6. export becomes a governed action (§5.2) ───────────────────────────────
-- The `export` capability has existed since `20260711000002`, it is in the TS
-- catalog, and WP 2.2 even gave it per-project-role grants. **Nothing has ever
-- checked it.** A repo-wide search finds no call site. So this is the FIRST check,
-- not an extension of one, and §5.2 is right that it is the one with teeth: without
-- it A4 — the verifiable export — is an exfiltration path with a citation attached.
--
-- WHAT THIS IS AND IS NOT, because over-claiming here would be exactly the sin §5
-- forbids. The product's exports are built in the browser from data the page has
-- already fetched (`ProjectDataViewer.downloadCSV`, `DataManager`'s node-list
-- download). By the time a user clicks Download, the bytes are already on their
-- machine. So:
--
--   · This function is a real CHECK — the SERVER decides, raises 42501 when the
--     capability is absent, and records the attempt either way. It governs the
--     product's export action and makes every export attributable.
--   · It is NOT a data-exfiltration control. A client that never calls it still
--     has the data it already read. Closing THAT means exports being SERVER-built
--     — the export endpoint returns the bytes, and the capability gates the
--     endpoint rather than the button. That is a real change to how export works
--     and it belongs with A4's verifiable export, not here (§16).
--
-- IT RETURNS THE DECISION; IT DOES NOT RAISE. The first version of this function
-- raised 42501 on a refusal, which is the obvious shape and is self-defeating: the
-- audit INSERT and the RAISE are in the SAME transaction, so the exception rolls
-- back the very row that records the refusal. A refused export left no trace at
-- all. That is not a subtlety I reasoned about — the exit check "refused AND
-- audited" caught it on a live database, with the refusal working and the audit row
-- absent. Postgres has no autonomous transactions, so the fix is not to raise:
-- the caller gets `allowed: false` and refuses, and the audit row COMMITS.
--
-- The decision is still the SERVER'S — it reads the capability the caller cannot
-- influence — and a caller that ignores the answer is in exactly the position
-- described above: holding data it had already fetched. What this buys is that
-- every export attempt, allowed or refused, is on the record.

CREATE OR REPLACE FUNCTION public.record_export(
  _actor_user_id uuid,
  _project_id    uuid,
  _export_kind   text,
  _row_count     integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caps    jsonb;
  v_allowed boolean;
  v_id      uuid;
BEGIN
  -- A missing actor is a CALLER BUG, not a refusal, so this one does raise: there
  -- is nobody to attribute the row to and recording it would be a lie.
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'an export must name its actor' USING ERRCODE = '22023';
  END IF;

  v_caps := CASE
    WHEN _project_id IS NULL THEN public.capabilities_for_user(_actor_user_id)
    ELSE public.capabilities_for_user(_actor_user_id, _project_id)
  END;
  v_allowed := COALESCE((v_caps -> 'features' ->> 'export')::boolean, false);

  v_id := public.log_data_action(
    _actor_user_id, 'access',
    CASE WHEN v_allowed THEN 'export.allowed' ELSE 'export.refused' END,
    'project', _project_id::text, NULL,
    jsonb_build_object('kind', _export_kind, 'row_count', _row_count,
                       'allowed', v_allowed));

  RETURN jsonb_build_object(
    'allowed',  v_allowed,
    'audit_id', v_id,
    'reason',   CASE WHEN v_allowed THEN NULL
                     ELSE 'the "export" capability is not granted for this user on this project' END);
END; $$;
REVOKE ALL ON FUNCTION public.record_export(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_export(uuid, uuid, text, integer) TO anon, authenticated, service_role;

-- ── 6. flush PostgREST ───────────────────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
