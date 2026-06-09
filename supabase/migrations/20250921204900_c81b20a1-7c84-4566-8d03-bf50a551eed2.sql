-- First, identify and remove orphaned disruption scenario profiles that reference non-existent projects
DELETE FROM disruption_scenario_profiles 
WHERE project_id NOT IN (SELECT id FROM projects);

-- Now add the foreign key constraint with CASCADE delete
ALTER TABLE disruption_scenario_profiles 
ADD CONSTRAINT disruption_scenario_profiles_project_id_fkey 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;