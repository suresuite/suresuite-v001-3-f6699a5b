-- Phase 3 / WP 3.0 / §8.3 — `simulation_results_with_settings` (D38, view 3 of 6).
--
-- THIS ONE IS A REAL CHANGE, and it closes a real hole.
--
-- The view reads `simulation_results`, whose policies are org-scoped through
-- `org_is_current_user_org(p.organization_id, p.organization)`, plus
-- `disruption_scenario_profiles` and `disruption_scenario_settings`. As OWNER,
-- the view returned EVERY organization's simulation results — metrics and
-- `result_data` included — to anybody who could select from it. The base table
-- has said "your organization only" since WP 2.1 and the view has not been
-- listening.
--
-- Who reads it: nothing in `src/` or the edge functions selects this view; the
-- only code that names it is `delete-project`, through the SERVICE ROLE, which
-- is BYPASSRLS and therefore unchanged. So the fix costs no reader and removes
-- a cross-tenant read path that RLS already thought it had closed.

ALTER VIEW public.simulation_results_with_settings SET (security_invoker = true);
