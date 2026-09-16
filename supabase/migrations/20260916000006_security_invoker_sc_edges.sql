-- Phase 3 / WP 3.0 / §8.3 — `sc_edges` runs as its CALLER (D38, view 2 of 6).
--
-- Base tables: `inbound_logistics`, `bom_single_level` (and the outbound arc).
-- Unlike the item masters these carry REAL policies — the `*_auth_read` /
-- `*_anon_read` pair is `USING (true)`, but the org-scoped pair added by
-- `20260915000004_org_identity_dual_read.sql` is not. Policies are PERMISSIVE
-- and therefore OR together, so today the open pair dominates and an invoking
-- reader still sees every row: no behaviour changes.
--
-- The value is the same as for `sc_nodes` and it is not hypothetical here. D28
-- is a standing decision — `anon` can read the lanes because the public network
-- pages render them — and the day that decision is revisited, this view must
-- narrow with the tables rather than stay open behind them. Leaving the view as
-- OWNER would mean the auth model could be tightened on every base table and
-- the same data would still leave through a view nobody re-read.

ALTER VIEW public.sc_edges SET (security_invoker = true);
