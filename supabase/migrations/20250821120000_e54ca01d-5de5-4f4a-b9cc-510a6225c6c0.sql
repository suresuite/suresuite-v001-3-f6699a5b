-- Include plant_name in project uniqueness to avoid conflicts
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS uq_modeler_project;
ALTER TABLE public.projects ADD CONSTRAINT uq_modeler_project UNIQUE (modeler_id, plant_name, name);
