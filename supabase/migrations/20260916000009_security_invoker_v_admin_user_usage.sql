-- Phase 3 / WP 3.0 / §8.3 — `v_admin_user_usage` (D38, view 5 of 6).
--
-- THE ONE THAT CANNOT TAKE THE FIX, AND THE REHEARSAL IS HOW WE KNOW.
--
-- The plan's shape for D38 is `security_invoker = true`, per view, with tests.
-- This view was written as one line like the other five, the rehearsal applied
-- it to a real PostgreSQL 16 and the assertion came back:
--
--     ERROR:  permission denied for table approved_users
--
-- Not a policy denial — a GRANT denial. `20250826015629` runs
-- `REVOKE ALL ON TABLE public.approved_users FROM anon, authenticated`, on
-- purpose: the authentication table is reached through RPCs and never selected
-- directly. A view running as its CALLER inherits the caller's grants, so with
-- `security_invoker = true` this view raises for EVERY logged-in reader,
-- including the super admins whose two pages (`AdminDashboard`, `AdminUsers`)
-- are its only consumers. The "fix" would have taken the admin area down, and
-- it would have done it on the deploy, because nothing in this repository
-- executed SQL until D31 closed.
--
-- ── SO THE HOLE IS CLOSED THE OTHER WAY ─────────────────────────────────────
--
-- The defect is not "the view runs as its owner"; that is the mechanism. The
-- defect is that the view hands out results the base tables would refuse:
-- `ai_usage_logs` says `current_is_super_admin() OR user_id = me`, and this view
-- has been returning every user's month-to-date requests, tokens and SPEND to
-- anyone who could select from it. A per-person cost figure.
--
-- The view keeps owner rights — it needs them to read `approved_users` at all —
-- and states the rule itself, in the one place every reader passes through.
-- `current_is_super_admin()` is the same predicate `ai_usage_logs`'s own policy
-- uses, so the view now refuses exactly what the table refuses instead of
-- quietly disagreeing with it.
--
-- A NON-SUPER-ADMIN NOW SEES NOTHING HERE, where before they saw everything.
-- That is the intended change and it costs no page: both readers are inside
-- `/admin`, which `canAccessRoute` already restricts to super admins. It is
-- narrower than the `ai_usage_logs` policy (which would also let a user see
-- their OWN usage), and deliberately so — this is an ADMIN view, and a user's
-- own usage belongs on a user-facing surface with its own query, not on the
-- roll-up an administrator reads.
--
-- RECORDED AS A DECLARED EXCEPTION, not as an oversight:
-- `supabase/rehearsal/030_view_security_invoker.sql` asserts that every view in
-- `public` either runs as its caller or is this view carrying this predicate,
-- and asserts the predicate's effect for both kinds of reader. A future view
-- that quietly runs as its owner still fails.
--
-- The column list is reproduced verbatim from `20260709000002_super_admin_phase1.sql`
-- because `CREATE OR REPLACE VIEW` requires the same names, order and types;
-- the only change is the final WHERE.

CREATE OR REPLACE VIEW public.v_admin_user_usage AS
SELECT au.id AS user_id, au.name, au.email, au.role::text AS role,
       au.organization, au.organization_id, au.is_active,
       COALESCE(mtd.requests, 0) AS mtd_requests,
       COALESCE(mtd.tokens, 0)   AS mtd_tokens,
       COALESCE(mtd.cost_usd, 0) AS mtd_cost_usd,
       (SELECT budget_usd FROM public.ai_budgets b
         WHERE b.scope='user' AND b.scope_id=au.id AND b.period='monthly' LIMIT 1) AS monthly_budget_usd
FROM public.approved_users au
LEFT JOIN LATERAL (
  SELECT count(*) AS requests, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost_usd
  FROM public.ai_usage_logs l
  WHERE l.user_id = au.id AND l.created_at >= date_trunc('month', now())
) mtd ON true
WHERE public.current_is_super_admin();

COMMENT ON VIEW public.v_admin_user_usage IS
  'Per-user month-to-date AI usage for the admin area. Runs as its OWNER by '
  'necessity — approved_users is REVOKEd from authenticated (20250826015629) so '
  'security_invoker would raise for every reader — and therefore states its own '
  'authorization: super admins only, the same predicate ai_usage_logs enforces. '
  'The declared exception to D38; asserted in supabase/rehearsal/030_view_security_invoker.sql.';
