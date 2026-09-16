-- Phase 2 / WP 2.4 / PLAN.md §9 — REVOKE THE AUDIT-FORGERY PATH WP 2.3 OPENED (D37).
--
-- WP 2.4 is a security review, and the first thing it found was WP 2.3's own bug.
--
-- `20260916000001:69` created the `admin_audit_logs` compatibility view and wrote:
--
--     GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated, anon, service_role;
--
-- The grant it replaced (`20260709000002:253`) was `TO authenticated` — anon was
-- never meant to have it. Two mistakes in one line: INSERT on a view that only ever
-- needed to be readable, and `anon` added to a privilege the original withheld.
--
-- WHY THAT IS FORGERY AND NOT UNTIDINESS. A Postgres view runs as its OWNER unless
-- `security_invoker` is set, so a write through the view does NOT go through the
-- base table's row-level security. `audit_logs` has two SELECT policies and no
-- INSERT policy at all — RLS denies writes by default, which is the enforcement
-- WP 2.2 and 2.3 deliberately rely on — and the view walked straight past it.
-- Reproduced on PostgreSQL 16:
--
--     SET ROLE anon;
--     INSERT INTO public.admin_audit_logs (action, target_type)
--       VALUES ('forged.by.anon','organizations');    -- INSERT 0 1
--     -- lands in audit_logs with plane='admin'
--     INSERT INTO public.audit_logs (action) VALUES ('direct');
--     -- ERROR: permission denied  ← the base table was never the way in
--
-- An anonymous caller could write rows into the ADMIN plane of the audit log: the
-- table whose entire purpose is to say who did what. Fabricated history is worse
-- than absent history, because it is believed.
--
-- THIS IS A NEW MIGRATION AND NOT AN EDIT, on purpose. `20260916000001` is already
-- recorded as applied in production, and `supabase db push` keys on the version —
-- editing that file would fix the repo and leave production exactly as it is
-- (PLAN.md §16, WP 2.1's outcome note). A live grant is revoked by a live
-- statement.

-- ── 1. take the privilege back ───────────────────────────────────────────────
-- Revoked from every role rather than just anon: the view is a READ shim for the
-- deploy window, it has no writers, and `authenticated` should not have carried
-- INSERT either — that was inherited from the base table's grant, where an RLS
-- policy stood behind it. Here nothing does.
REVOKE INSERT ON public.admin_audit_logs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL    ON public.admin_audit_logs FROM anon;

-- Restore exactly what `20260709000002` granted, and nothing more.
GRANT SELECT ON public.admin_audit_logs TO authenticated, service_role;

-- ── 2. stop the view bypassing RLS at all ────────────────────────────────────
-- Defence in depth, and the part that makes the class of bug impossible rather
-- than this instance of it fixed. With `security_invoker = true` the view is
-- evaluated as the CALLER, so `audit_logs`'s policies apply to anything read
-- through it — a future grant on this view cannot become a way around them.
ALTER VIEW public.admin_audit_logs SET (security_invoker = true);

-- ── 3. the same hazard, checked on the schema's other views ──────────────────
-- Seven views exist and none of them was declared security_invoker, so each is a
-- potential bypass of its base tables' RLS wherever it is granted. This migration
-- fixes the one it opened and does NOT silently change the other six: they have
-- readers whose behaviour would change, and `sc_nodes` in particular is read by
-- the engine mapper. Recorded as D38 and left to a package that can test them.
COMMENT ON VIEW public.admin_audit_logs IS
  'Transition shim for the admin_audit_logs -> audit_logs rename (WP 2.3). '
  'security_invoker so it cannot bypass audit_logs RLS; SELECT only. '
  'Drop it once no deployed code reads the old name.';

SELECT pg_notify('pgrst', 'reload schema');
