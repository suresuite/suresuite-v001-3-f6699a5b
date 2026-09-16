-- Phase 3 / WP 3.0 / §8.3 — EVERY RELATION IN PRODUCTION IS OWNED BY A MIGRATION (D43).
--
-- §15's schema probe found two tables in production's `public` schema that no
-- migration creates: `customers` and `product_code_map`. This is D4 (`risk_data`)
-- unclosed as a CLASS — WP 1.4 adopted the one instance it could see.
--
-- WHY R4 COULD NOT SEE THEM, because it matters for what replaces it. R4 ("no
-- orphan table") catches tables the CODE READS that no migration creates. So:
--
--   · `product_code_map` was an orphan until WP 1.4 closed D3 by DELETING the
--     dead read. The moment it did, the table stopped being an orphan by R4's
--     definition while remaining exactly as untracked as before.
--   · `customers` was never read at all, so it has been invisible since it was
--     created.
--
-- A rule that keys on "the code reads it" cannot see a table nothing reads. The
-- replacement is §15's probe, which keys on "production has it", and which now
-- FAILS the verification run rather than reporting (`verification-sql.mjs`).
--
-- ── THE TWO DECISIONS, AND THE EVIDENCE FOR EACH ────────────────────────────
--
-- ADOPT `customers`. It holds SIX ROWS (§15, run 35062943621) and its columns —
-- `segment`, `priority_weight`, `sla_fill_floor_pct` — are the inputs of the
-- customer-echelon policies (`P-C.x`, blueprint §4.2, Appendix A). It is a
-- half-built tier-2 master that somebody authored and never wired up. Dropping
-- it destroys authored data to close a gap that adoption closes just as well.
--
-- DROP `product_code_map`. It holds ZERO ROWS, and D3 established the rest:
-- there was never an upload path, never a writer, and never a template column
-- for it; the single read swallowed its own error and had never executed.
-- `loudFailure.test.ts` already asserts it is gone from the code and has no
-- sidecar. Adopting an empty table nothing has ever written would add a row to
-- the contract and a page to the docs describing a thing that does not exist —
-- which is the §5 T1 failure in its own reference material.
--
-- NEITHER STATEMENT CAN BE UNDONE BY THE NEXT ONE, so they are in this order:
-- the DROP is last, and it is the only destructive statement in the file.

-- ── 1 · customers, adopted ──────────────────────────────────────────────────
--
-- The column list is production's own, read back by §15 rather than guessed:
-- `information_schema.columns` for `public.customers`, in ordinal order. On a
-- fresh database this CREATE builds it; on production it is a no-op and the
-- statements below bring it to the same shape without touching a row.
--
-- NO `id` COLUMN, deliberately. Production's table has none, and the grain is
-- `(project_id, customer_id)` — one customer per project. Adding a surrogate
-- key to a table with a real natural key is how `inbound_logistics` ended up
-- with `id` as its ONLY uniqueness (D5, and WP 3.3 is still undoing it).

CREATE TABLE IF NOT EXISTS public.customers (
  project_id         uuid        NOT NULL,
  customer_id        text        NOT NULL,
  name               text,
  segment            text        NOT NULL DEFAULT 'default',
  priority_weight    numeric     NOT NULL DEFAULT 1.0,
  sla_fill_floor_pct numeric,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotent on both databases: every column already present is skipped.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS name               text,
  ADD COLUMN IF NOT EXISTS segment            text        NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS priority_weight    numeric     NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS sla_fill_floor_pct numeric,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at         timestamptz NOT NULL DEFAULT now();

-- ── the natural key ─────────────────────────────────────────────────────────
--
-- `natural-key` (I4) says every canonical table carries a natural-key unique
-- constraint. §15 reports the table has none — nothing stops the same customer
-- appearing twice in one project, which is D5's shape on a smaller table.
--
-- It is added through a guard rather than unconditionally, and the guard is not
-- defensive habit: if the six rows already contain a duplicate key, an
-- unguarded ADD CONSTRAINT aborts the whole migration and every statement after
-- it, which is the failure WP 2.1 hit three times. A duplicate here is a DATA
-- question and it gets a WARNING naming the rows, not a blocked deploy.
DO $customers_key$
DECLARE dupes integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.customers'::regclass
                AND conname = 'customers_project_customer_key') THEN
    RAISE NOTICE 'customers: natural key already present';
    RETURN;
  END IF;

  SELECT count(*) INTO dupes FROM (
    SELECT project_id, customer_id FROM public.customers
     GROUP BY 1, 2 HAVING count(*) > 1) d;

  IF dupes > 0 THEN
    RAISE WARNING 'customers: % duplicate (project_id, customer_id) group(s) — the natural key was NOT created. Deduplicate, then ALTER TABLE public.customers ADD CONSTRAINT customers_project_customer_key UNIQUE (project_id, customer_id);', dupes;
    RETURN;
  END IF;

  ALTER TABLE public.customers
    ADD CONSTRAINT customers_project_customer_key UNIQUE (project_id, customer_id);
  RAISE NOTICE 'customers: natural key (project_id, customer_id) created';
END $customers_key$;

-- ── who may read and write it ───────────────────────────────────────────────
--
-- The table has lived in production with no migration and therefore with no
-- policy anybody wrote down. RLS is enabled here with the pair every other
-- project-scoped tier-2 table uses: read within the organization, write by the
-- project's modeler or an admin.
--
-- NOT the `*_anon_read` policy the logistics lanes carry. Those are open because
-- the public network pages render them (D28, a standing decision). Nothing reads
-- `customers` at all, so there is no reader to keep working and no reason to
-- widen the exposure D28 already documents.

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

DROP POLICY IF EXISTS "Customers: organization access" ON public.customers;
CREATE POLICY "Customers: organization access" ON public.customers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = customers.project_id
               AND public.org_is_current_user_org(p.organization_id, p.organization))
  );

DROP POLICY IF EXISTS "Customers: modifiers only" ON public.customers;
CREATE POLICY "Customers: modifiers only" ON public.customers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = customers.project_id
               AND public.org_is_current_user_org(p.organization_id, p.organization)
               AND (p.modeler_id = public.get_current_user_id()
                    OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = customers.project_id
               AND public.org_is_current_user_org(p.organization_id, p.organization)
               AND (p.modeler_id = public.get_current_user_id()
                    OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
  );

-- ── the tier-2 audit, because it is a tier-2 table ──────────────────────────
--
-- `dataPlaneAudit.test.ts` failed the moment this table entered the contract,
-- and it was right to: its rule is "every tier 2/3/4 table in the contract has
-- insert, update and delete triggers", derived from the contract rather than
-- from a list somebody maintains. WP 2.3 installed twelve tables' worth of
-- triggers and could not have installed this one — the table had no migration
-- then. A gate that is complete BY CONSTRUCTION catches exactly that case, one
-- commit after the table appears, instead of a year later.
--
-- Statement-level with transition tables, matching WP 2.3 exactly: one audit
-- row per statement with the row count in it, never one per row.

DROP TRIGGER IF EXISTS audit_customers_insert ON public.customers;
CREATE TRIGGER audit_customers_insert AFTER INSERT ON public.customers
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_customers_update ON public.customers;
CREATE TRIGGER audit_customers_update AFTER UPDATE ON public.customers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_customers_delete ON public.customers;
CREATE TRIGGER audit_customers_delete AFTER DELETE ON public.customers
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

COMMENT ON TABLE public.customers IS
  'Tier 2 customer master, one row per (project_id, customer_id). Adopted in '
  'Phase 3 / WP 3.0 (PLAN.md §4 D43): it existed in production with six rows and '
  'no creating migration. Carries the customer-echelon policy inputs (segment, '
  'priority weight, SLA fill floor); no reader yet.';

-- ── 2 · product_code_map, dropped ───────────────────────────────────────────
--
-- The last statement in the file and the only irreversible one. Zero rows; no
-- writer has ever existed; the one read was deleted by WP 1.4 (D3) after it was
-- established that it had never executed. Nothing in `src/`, `supabase/functions/`,
-- `sim-worker/` or `scsim/` references it except comments recording its removal.
DROP TABLE IF EXISTS public.product_code_map;
