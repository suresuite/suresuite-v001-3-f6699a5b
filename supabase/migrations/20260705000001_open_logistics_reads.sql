-- Phase A / G4 / §8.2 — open SELECT on the logistics/BOM lane tables.
--
-- WHY: the app authenticates via the custom `authenticate_approved_user` RPC
-- (no supabase.auth session — the client always runs as `anon`), and the
-- original SELECT policies on these tables gate on get_current_user_id(),
-- which reads the session GUC `app.current_user_id` set by set_user_context().
-- Under PostgREST connection pooling that GUC does not survive to subsequent
-- .from() reads, so the predicate evaluates NULL → every direct frontend read
-- of inbound_logistics / outbound_logistics / bom_* silently returns 0 rows.
-- Effect: the /policies stage grids, the item-master derived (≈) economics and
-- the Data map all showed 0 / "no data" while the SECURITY DEFINER RPC paths
-- (ProjectDataViewer, get_supply_chain_data) showed the same rows fine.
--
-- FIX: mirror the read model already accepted for the item masters
-- (materials / products / suppliers: USING (true) + GRANT SELECT TO anon in
-- 20260609040000_consolidated_safe.sql) — same class of commercial data.
-- Writes stay on their existing guarded policies/RPCs; only SELECT opens.
-- Do NOT reuse the GUC-based get_current_user_id() pattern for any table the
-- frontend reads directly — it cannot work with pooled connections.

-- ── inbound_logistics ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Inbound: viewable by project owner, admin, or plant access"
  ON public.inbound_logistics;
DROP POLICY IF EXISTS "inbound_logistics_anon_read" ON public.inbound_logistics;
DROP POLICY IF EXISTS "inbound_logistics_auth_read" ON public.inbound_logistics;
CREATE POLICY "inbound_logistics_auth_read"
  ON public.inbound_logistics FOR SELECT TO authenticated USING (true);
CREATE POLICY "inbound_logistics_anon_read"
  ON public.inbound_logistics FOR SELECT TO anon USING (true);
GRANT SELECT ON public.inbound_logistics TO anon, authenticated;

-- ── outbound_logistics ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Outbound: viewable by project owner, admin, or plant access"
  ON public.outbound_logistics;
DROP POLICY IF EXISTS "outbound_logistics_anon_read" ON public.outbound_logistics;
DROP POLICY IF EXISTS "outbound_logistics_auth_read" ON public.outbound_logistics;
CREATE POLICY "outbound_logistics_auth_read"
  ON public.outbound_logistics FOR SELECT TO authenticated USING (true);
CREATE POLICY "outbound_logistics_anon_read"
  ON public.outbound_logistics FOR SELECT TO anon USING (true);
GRANT SELECT ON public.outbound_logistics TO anon, authenticated;

-- ── bom_single_level ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "BOM Single: viewable by project owner, admin, or plant access"
  ON public.bom_single_level;
DROP POLICY IF EXISTS "bom_single_level_anon_read" ON public.bom_single_level;
DROP POLICY IF EXISTS "bom_single_level_auth_read" ON public.bom_single_level;
CREATE POLICY "bom_single_level_auth_read"
  ON public.bom_single_level FOR SELECT TO authenticated USING (true);
CREATE POLICY "bom_single_level_anon_read"
  ON public.bom_single_level FOR SELECT TO anon USING (true);
GRANT SELECT ON public.bom_single_level TO anon, authenticated;

-- ── bom_multi_level ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "BOM Multi: viewable by project owner, admin, or plant access"
  ON public.bom_multi_level;
DROP POLICY IF EXISTS "bom_multi_level_anon_read" ON public.bom_multi_level;
DROP POLICY IF EXISTS "bom_multi_level_auth_read" ON public.bom_multi_level;
CREATE POLICY "bom_multi_level_auth_read"
  ON public.bom_multi_level FOR SELECT TO authenticated USING (true);
CREATE POLICY "bom_multi_level_anon_read"
  ON public.bom_multi_level FOR SELECT TO anon USING (true);
GRANT SELECT ON public.bom_multi_level TO anon, authenticated;
