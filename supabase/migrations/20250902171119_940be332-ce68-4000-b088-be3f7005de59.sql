-- Enable real-time for disruption_scenario_effects table
ALTER TABLE public.disruption_scenario_effects REPLICA IDENTITY FULL;

-- Add table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.disruption_scenario_effects;