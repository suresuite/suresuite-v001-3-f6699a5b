-- Add foreign key constraint with CASCADE delete to ensure disruption scenario profiles
-- are automatically deleted when their associated project is deleted
ALTER TABLE disruption_scenario_profiles 
ADD CONSTRAINT disruption_scenario_profiles_project_id_fkey 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- This creates a cascade chain:
-- Delete projects → Cascades to disruption_scenario_profiles
-- Delete disruption_scenario_profiles → Already cascades to:
--   - disruption_scenario_targets
--   - disruption_scenario_effects  
--   - disruption_scenario_settings