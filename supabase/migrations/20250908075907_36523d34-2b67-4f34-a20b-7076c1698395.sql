-- Optimize deletions/selects by adding indexes
-- These are safe, concurrent-friendly creations

-- Core dataset tables
CREATE INDEX IF NOT EXISTS idx_supply_chain_data_project_id ON public.supply_chain_data(project_id);
CREATE INDEX IF NOT EXISTS idx_inbound_logistics_project_id ON public.inbound_logistics(project_id);
CREATE INDEX IF NOT EXISTS idx_outbound_logistics_project_id ON public.outbound_logistics(project_id);
CREATE INDEX IF NOT EXISTS idx_bom_single_level_project_id ON public.bom_single_level(project_id);
CREATE INDEX IF NOT EXISTS idx_bom_multi_level_project_id ON public.bom_multi_level(project_id);
CREATE INDEX IF NOT EXISTS idx_multi_tier_supply_chain_project_id ON public.multi_tier_supply_chain(project_id);

-- Deep-tier network tables
CREATE INDEX IF NOT EXISTS idx_network_nodes_project_id ON public.network_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_network_edges_project_id ON public.network_edges(project_id);

-- Derived/aux tables
CREATE INDEX IF NOT EXISTS idx_node_list_project_id ON public.node_list(project_id);
CREATE INDEX IF NOT EXISTS idx_simulation_results_project_id ON public.simulation_results(project_id);
CREATE INDEX IF NOT EXISTS idx_disruption_scenario_profiles_project_id ON public.disruption_scenario_profiles(project_id);

-- Disruption scenario children (profile_id lookups)
CREATE INDEX IF NOT EXISTS idx_dse_profile_id ON public.disruption_scenario_effects(profile_id);
CREATE INDEX IF NOT EXISTS idx_dst_profile_id ON public.disruption_scenario_targets(profile_id);
CREATE INDEX IF NOT EXISTS idx_dss_profile_id ON public.disruption_scenario_settings(profile_id);
