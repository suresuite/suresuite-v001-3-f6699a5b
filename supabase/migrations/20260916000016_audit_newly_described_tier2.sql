-- Phase 3 / WP 3.2 / §8.1–8.4 — THE AUDIT FOLLOWS THE DESCRIPTION.
--
-- WP 2.3 put `audit_tier_write` on twelve tier-2/3/4 tables and
-- `dataPlaneAudit.test.ts` has enforced ever since that EVERY tier-2/3/4 table
-- IN THE CONTRACT carries all three triggers. That qualifier is doing the work,
-- and it was a hole nobody could see: a table with no sidecar is outside the
-- contract, so it is outside the rule, so nothing notices that its writes are
-- unattributable. `tier2_suppliers`, `tier3_suppliers` and
-- `multi_tier_supply_chain` sat in that gap from WP 2.3 until this package
-- described them — and describing them is what made the gate go red, in the same
-- session, rather than in a quarter.
--
-- So this migration is not a decision; it is the gate being obeyed. The
-- alternative was to relax the rule to "every table WP 2.3 happened to reach",
-- which measures nothing.
--
-- WP 3.2 also gives the first two of these a real writer: `ingest_apply_run`
-- promotes a CSV into them, and a promotion into an unaudited table is the
-- `audit-actor` hole this package is otherwise closing.
--
-- Statement-level with transition tables, one trigger per operation, written out
-- rather than looped — WP 2.3's shape exactly, and for its reason: a FOREACH loop
-- is invisible to the introspector.

-- multi_tier_supply_chain (tier 2)
DROP TRIGGER IF EXISTS audit_multi_tier_supply_chain_insert ON public.multi_tier_supply_chain;
CREATE TRIGGER audit_multi_tier_supply_chain_insert AFTER INSERT ON public.multi_tier_supply_chain
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_multi_tier_supply_chain_update ON public.multi_tier_supply_chain;
CREATE TRIGGER audit_multi_tier_supply_chain_update AFTER UPDATE ON public.multi_tier_supply_chain
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_multi_tier_supply_chain_delete ON public.multi_tier_supply_chain;
CREATE TRIGGER audit_multi_tier_supply_chain_delete AFTER DELETE ON public.multi_tier_supply_chain
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- tier2_suppliers (tier 2)
DROP TRIGGER IF EXISTS audit_tier2_suppliers_insert ON public.tier2_suppliers;
CREATE TRIGGER audit_tier2_suppliers_insert AFTER INSERT ON public.tier2_suppliers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_tier2_suppliers_update ON public.tier2_suppliers;
CREATE TRIGGER audit_tier2_suppliers_update AFTER UPDATE ON public.tier2_suppliers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_tier2_suppliers_delete ON public.tier2_suppliers;
CREATE TRIGGER audit_tier2_suppliers_delete AFTER DELETE ON public.tier2_suppliers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- tier3_suppliers (tier 2)
DROP TRIGGER IF EXISTS audit_tier3_suppliers_insert ON public.tier3_suppliers;
CREATE TRIGGER audit_tier3_suppliers_insert AFTER INSERT ON public.tier3_suppliers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_tier3_suppliers_update ON public.tier3_suppliers;
CREATE TRIGGER audit_tier3_suppliers_update AFTER UPDATE ON public.tier3_suppliers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_tier3_suppliers_delete ON public.tier3_suppliers;
CREATE TRIGGER audit_tier3_suppliers_delete AFTER DELETE ON public.tier3_suppliers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

SELECT pg_notify('pgrst', 'reload schema');
