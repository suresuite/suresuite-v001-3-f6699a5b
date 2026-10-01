-- ============================================================================
-- Phase 11 / WP 11.5 · §15 · §4 D240
-- THE LAST DEPLOY-WINDOW SHIM GOES: `network_topology_hash`.
--
-- WP 5.3 folded the deep-tier topology into the anchor (`hash_network`, D75), and
-- WP 10.1 stopped every caller in the repository from reading the params-borne
-- digest. The function stayed for one reason: the PUBLISHED analyzers called it
-- until a merge redeployed them, and migrations and functions deploy through
-- different workflows with no order between them (`20261001000007`).
--
-- The condition was a reading, and it has been taken. §15 run `36903620736`, taken
-- in the push after #339 merged with the migration fence unmoved at
-- `20261001000022`, shows a `prominence` run keyed on the FIRM level (probe 9) —
-- a run only the WP 10.1 build of `calculate-node-prominence` writes, and
-- `calculate-network-science-metrics` deploys in the same job of the same workflow.
-- Neither source calls the shim, and no SQL function body, view or rehearsal does.
--
-- What remains owed is the reading AFTER this drop deploys (WP 10.9's exit): a
-- `network_metrics` or `prominence` run succeeding with the function gone.
-- ============================================================================

DROP FUNCTION IF EXISTS public.network_topology_hash(uuid);

SELECT pg_notify('pgrst', 'reload schema');
