-- Phase 3 / WP 3.0 / §8.3 — `simulation_result_scenarios` (D38, view 4 of 6).
--
-- The same base table and the same hole as view 3: `simulation_results`, org
-- scoped by policy, unfiltered through the view. Separate migration because it
-- is a separate object with a separate reader list, and because a revert of one
-- must not drag the other with it.
--
-- `delete-project/index.ts` calls `deleteTableByProjectId('simulation_result_scenarios')`
-- inside a try/catch that logs "likely a view" and carries on — so it is a
-- service-role write attempt against a view, which fails today and will keep
-- failing in exactly the same way. `security_invoker` does not change it.

ALTER VIEW public.simulation_result_scenarios SET (security_invoker = true);
